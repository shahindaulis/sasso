// Client API Interceptor with In-Memory Access Token & Server-Set HttpOnly Cookie Refresh Token

export interface TokenResponse {
  token: string;
  accessToken: string;
  expiresIn: number;
  user?: any;
}

type QueueItem = {
  resolve: (value: Response | PromiseLike<Response>) => void;
  reject: (reason?: any) => void;
  url: string;
  options: RequestInit;
};

class AuthTokenManager {
  private inMemoryAccessToken: string | null = null;
  private isRefreshing = false;
  private activeRefreshPromise: Promise<TokenResponse> | null = null;
  private failedQueue: QueueItem[] = [];
  private silentRefreshTimer: any = null;
  private onSessionExpiredCallback: (() => void) | null = null;
  private onTokenUpdatedCallback: ((accessToken: string) => void) | null = null;

  constructor() {
    // Clear legacy localStorage tokens to ensure max security (In-Memory Access Token & HttpOnly Cookie)
    try {
      localStorage.removeItem('sasso_central_token');
      localStorage.removeItem('sasso_refresh_token');
    } catch (e) {}
  }

  public setOnSessionExpired(cb: () => void) {
    this.onSessionExpiredCallback = cb;
  }

  public setOnTokenUpdated(cb: (accessToken: string) => void) {
    this.onTokenUpdatedCallback = cb;
  }

  public getAccessToken(): string | null {
    return this.inMemoryAccessToken;
  }

  public saveTokens(accessToken: string, expiresInSeconds: number = 900) {
    this.inMemoryAccessToken = accessToken;
    
    if (this.onTokenUpdatedCallback) {
      this.onTokenUpdatedCallback(accessToken);
    }

    // Schedule Silent Refresh (Primary mechanism)
    this.scheduleSilentRefresh(expiresInSeconds);
  }

  public async clearTokens() {
    this.inMemoryAccessToken = null;
    if (this.silentRefreshTimer) {
      clearTimeout(this.silentRefreshTimer);
      this.silentRefreshTimer = null;
    }
    try {
      localStorage.removeItem('sasso_central_token');
      localStorage.removeItem('sasso_refresh_token');
      await fetch('/api/sso/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    } catch (e) {}
  }

  // 1. PRIMARY: Silent Token Refresh (Proactive timer before token expires)
  public scheduleSilentRefresh(expiresInSeconds: number) {
    if (this.silentRefreshTimer) {
      clearTimeout(this.silentRefreshTimer);
    }

    // Refresh 1 minute (60 seconds) before expiry (or 20% of total lifetime if short-lived)
    const refreshLeadTime = Math.min(60, expiresInSeconds * 0.2);
    const refreshDelayMs = Math.max(5000, (expiresInSeconds - refreshLeadTime) * 1000);

    console.log(`[Silent Refresh] Scheduled proactive refresh in ${(refreshDelayMs / 1000).toFixed(0)} seconds`);

    this.silentRefreshTimer = setTimeout(() => {
      console.log('[Silent Refresh] Executing proactive background token refresh via HttpOnly cookie...');
      this.refreshTokens()
        .then(() => {
          console.log('[Silent Refresh] Success! In-memory Access Token rotated via HttpOnly cookie.');
        })
        .catch((err) => {
          console.warn('[Silent Refresh] Silent refresh failed, fallback 401 interceptor ready:', err);
        });
    }, refreshDelayMs);
  }

  // Execute token refresh API request (Uses browser-sent HttpOnly cookie)
  public async refreshTokens(): Promise<TokenResponse> {
    if (this.activeRefreshPromise) {
      return this.activeRefreshPromise;
    }

    this.activeRefreshPromise = (async () => {
      try {
        const response = await fetch('/api/sso/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          this.inMemoryAccessToken = null;
          if (this.silentRefreshTimer) {
            clearTimeout(this.silentRefreshTimer);
            this.silentRefreshTimer = null;
          }
          if (this.onSessionExpiredCallback) {
            this.onSessionExpiredCallback();
          }
          throw new Error(errorData.error || 'Session expired or refresh token invalid');
        }

        const data: TokenResponse = await response.json();
        const token = data.accessToken || data.token;
        this.saveTokens(token, data.expiresIn || 900);
        return data;
      } finally {
        this.activeRefreshPromise = null;
      }
    })();

    return this.activeRefreshPromise;
  }

  // Process queued requests after refresh finishes (Mutex Queue Processor)
  private processQueue(error: any, newToken: string | null = null) {
    this.failedQueue.forEach((prom) => {
      if (error) {
        prom.reject(error);
      } else if (newToken) {
        // Clone headers and replace Authorization header with new in-memory token
        const updatedHeaders = new Headers(prom.options.headers || {});
        updatedHeaders.set('Authorization', `Bearer ${newToken}`);

        const newOptions: RequestInit = {
          ...prom.options,
          headers: updatedHeaders,
          credentials: 'include',
        };

        fetch(prom.url, newOptions)
          .then((res) => prom.resolve(res))
          .catch((err) => prom.reject(err));
      }
    });

    this.failedQueue = [];
  }

  // 2. FALLBACK: 401 Interceptor with Mutex Request Queueing
  public async authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const accessToken = this.getAccessToken();

    const headers = new Headers(options.headers || {});
    if (accessToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }

    const requestOptions: RequestInit = {
      ...options,
      headers,
      credentials: 'include',
    };

    const response = await fetch(url, requestOptions);

    // If request succeeds or fails with non-401, return response directly
    if (response.status !== 401) {
      return response;
    }

    // 401 Received! Token might be expired or invalid.
    console.warn(`[401 Interceptor] Request to ${url} got 401 Unauthorized. Triggering Fallback Mutex Queueing.`);

    if (this.isRefreshing) {
      // Locking Mechanism: Refresh is already in-flight! Queue this request until refresh completes.
      console.log(`[Request Queue] Queueing parallel request to ${url} while token refresh is in progress.`);
      return new Promise<Response>((resolve, reject) => {
        this.failedQueue.push({ resolve, reject, url, options });
      });
    }

    // Acquire lock
    this.isRefreshing = true;

    try {
      console.log('[401 Interceptor] Initiating token refresh via HttpOnly cookie (Mutex Lock acquired)...');
      const refreshData = await this.refreshTokens();
      const newToken = refreshData.accessToken || refreshData.token;

      // Unlock and process queued requests
      this.isRefreshing = false;
      this.processQueue(null, newToken);

      // Retry original failed request with new token
      const retryHeaders = new Headers(options.headers || {});
      retryHeaders.set('Authorization', `Bearer ${newToken}`);

      return fetch(url, {
        ...options,
        headers: retryHeaders,
        credentials: 'include',
      });
    } catch (refreshErr) {
      this.isRefreshing = false;
      this.processQueue(refreshErr, null);
      throw refreshErr;
    }
  }
}

export const authManager = new AuthTokenManager();
