import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { UserProfile, ClientApp } from './types';
import { SignIn } from './components/SignIn';
import { SignUp } from './components/SignUp';
import { UserProfileDashboard } from './components/UserProfileDashboard';
import { DeveloperConsole } from './components/DeveloperConsole';
import { OAuthConsent } from './components/OAuthConsent';
import { WebAuthnAbortService } from '@simplewebauthn/browser';
import { ExternalLink } from 'lucide-react';
import { authManager } from './lib/apiClient';

import { QrApprovalModal } from './components/QrCodeLoginModal';

export default function App() {
  const [centralToken, setCentralToken] = useState<string | null>(authManager.getAccessToken());
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [appsList, setAppsList] = useState<ClientApp[]>([]);
  const [loadingSession, setLoadingSession] = useState(true);
  const [pendingQrSession, setPendingQrSession] = useState<string | null>(null);

  // Pending OAuth / OIDC Authorization Request
  const [oauthRequest, setOauthRequest] = useState<{
    clientId: string;
    redirectUri: string;
    state?: string;
    responseType?: string;
    accessType?: string;
    isExternal?: boolean;
  } | null>(null);

  const navigate = useNavigate();
  const location = useLocation();

  const refreshAppsList = (overrideToken?: string) => {
    const activeToken = overrideToken || authManager.getAccessToken();
    if (!activeToken) {
      setAppsList([]);
      return;
    }
    authManager.authenticatedFetch('/api/sso/apps')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAppsList(data);
        } else {
          setAppsList([]);
        }
      })
      .catch((err) => console.error('Failed to load apps:', err));
  };

  useEffect(() => {
    authManager.setOnTokenUpdated((newToken) => {
      setCentralToken(newToken);
    });

    authManager.setOnSessionExpired(() => {
      handleCentralLogout();
    });

    const restoreSession = async () => {
      try {
        const refreshRes = await authManager.refreshTokens();
        const activeToken = refreshRes.accessToken || refreshRes.token;
        if (activeToken && refreshRes.user) {
          setCurrentUser(refreshRes.user);
          setCentralToken(activeToken);
          refreshAppsList(activeToken);
        } else {
          setCentralToken(null);
          setCurrentUser(null);
        }
      } catch (e) {
        setCentralToken(null);
        setCurrentUser(null);
      } finally {
        setLoadingSession(false);
      }
    };

    restoreSession();

    // Check query params for QR session or OIDC / OAuth authorization request
    const params = new URLSearchParams(window.location.search);
    const qrSessParam = params.get('qrSession');
    if (qrSessParam) {
      setPendingQrSession(qrSessParam);
      sessionStorage.setItem('pending_qr_session', qrSessParam);
    } else {
      const savedQr = sessionStorage.getItem('pending_qr_session');
      if (savedQr) {
        setPendingQrSession(savedQr);
      }
    }

    const clientId = params.get('client_id');
    const redirectUri = params.get('redirect_uri');
    const responseType = params.get('response_type');
    const state = params.get('state');
    const accessType = params.get('access_type') || params.get('accessType');

    if (clientId && redirectUri) {
      setOauthRequest({
        clientId,
        redirectUri,
        state: state || undefined,
        responseType: responseType || 'code',
        accessType: accessType || undefined,
        isExternal: true,
      });
    }
  }, []);

  const handleCentralLoginSuccess = (token: string, user: UserProfile, _refreshToken?: string, expiresIn?: number) => {
    setCentralToken(token);
    setCurrentUser(user);
    authManager.saveTokens(token, expiresIn || 900);
    refreshAppsList(token);
  };

  const handleCentralLogout = async () => {
    try {
      WebAuthnAbortService.cancelCeremony();
    } catch (e) {}

    await new Promise((resolve) => setTimeout(resolve, 300));

    if (centralToken && currentUser) {
      fetch('/api/sso/logout-slo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: currentUser.email }),
        credentials: 'include',
      }).catch((err) => console.error(err));
    }

    setCentralToken(null);
    setCurrentUser(null);
    await authManager.clearTokens();
    setOauthRequest(null);
    navigate('/login');
  };

  const handleApproveOAuth = async (code: string) => {
    if (!oauthRequest) return;

    if (oauthRequest.isExternal) {
      setOauthRequest(null);
      const destUrl = oauthRequest.redirectUri;
      let redirectUrlWithCode = destUrl;
      if (destUrl.includes('://')) {
        try {
          const urlWithParams = new URL(destUrl);
          urlWithParams.searchParams.set('code', code);
          if (oauthRequest.state) {
            urlWithParams.searchParams.set('state', oauthRequest.state);
          }
          redirectUrlWithCode = urlWithParams.toString();
        } catch (e) {
          redirectUrlWithCode =
            destUrl +
            (destUrl.includes('?') ? '&' : '?') +
            `code=${encodeURIComponent(code)}` +
            (oauthRequest.state ? `&state=${encodeURIComponent(oauthRequest.state)}` : '');
        }
      } else {
        redirectUrlWithCode =
          destUrl +
          (destUrl.includes('?') ? '&' : '?') +
          `code=${encodeURIComponent(code)}` +
          (oauthRequest.state ? `&state=${encodeURIComponent(oauthRequest.state)}` : '');
      }
      window.location.href = redirectUrlWithCode;
      return;
    }

    setOauthRequest(null);
    navigate('/profile');
  };

  const handleCancelOAuth = () => {
    if (oauthRequest && oauthRequest.isExternal) {
      const destUrl = oauthRequest.redirectUri;
      const errorMsg = 'access_denied';
      let redirectUrlWithErr = destUrl;
      if (destUrl.includes('://')) {
        try {
          const urlWithParams = new URL(destUrl);
          urlWithParams.searchParams.set('error', errorMsg);
          if (oauthRequest.state) {
            urlWithParams.searchParams.set('state', oauthRequest.state);
          }
          redirectUrlWithErr = urlWithParams.toString();
        } catch (e) {
          redirectUrlWithErr =
            destUrl +
            (destUrl.includes('?') ? '&' : '?') +
            `error=${errorMsg}` +
            (oauthRequest.state ? `&state=${encodeURIComponent(oauthRequest.state)}` : '');
        }
      } else {
        redirectUrlWithErr =
          destUrl +
          (destUrl.includes('?') ? '&' : '?') +
          `error=${errorMsg}` +
          (oauthRequest.state ? `&state=${encodeURIComponent(oauthRequest.state)}` : '');
      }
      window.location.href = redirectUrlWithErr;
    } else {
      setOauthRequest(null);
      navigate('/profile');
    }
  };

  if (loadingSession) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 text-xs font-bold text-gray-500">
        Loading sasso session...
      </div>
    );
  }

  // If there's an active external OAuth authorization prompt
  if (oauthRequest && centralToken && currentUser) {
    return (
      <OAuthConsent
        centralToken={centralToken}
        currentUser={currentUser}
        oauthRequest={oauthRequest}
        appsList={appsList}
        onApproveOAuth={handleApproveOAuth}
        onCancelOAuth={handleCancelOAuth}
      />
    );
  }

  const isIframe = typeof window !== 'undefined' && window.self !== window.top;

  return (
    <div className="relative min-h-screen">
      {/* QR Code Approval Modal for cross-device login */}
      {pendingQrSession && centralToken && currentUser && (
        <QrApprovalModal
          qrSessionId={pendingQrSession}
          centralToken={centralToken}
          currentUser={currentUser}
          onApproved={() => {
            sessionStorage.removeItem('pending_qr_session');
            setPendingQrSession(null);
          }}
          onCancel={() => {
            sessionStorage.removeItem('pending_qr_session');
            setPendingQrSession(null);
          }}
        />
      )}

      {/* Open in New Tab Button - ONLY rendered inside iFrame */}
      {isIframe && (
        <div className="bg-slate-900 text-white text-xs px-4 py-2 flex items-center justify-end border-b border-slate-800 sticky top-0 z-50">
          <a
            href={window.location.href}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm text-xs"
          >
            <span>Open in New Tab</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

      <Routes>
      {/* Public Auth Routes */}
      <Route
        path="/login"
        element={
          !centralToken ? (
            <SignIn onLoginSuccess={handleCentralLoginSuccess} />
          ) : (
            <Navigate to="/profile" replace />
          )
        }
      />
      <Route
        path="/signup"
        element={
          !centralToken ? (
            <SignUp onLoginSuccess={handleCentralLoginSuccess} />
          ) : (
            <Navigate to="/profile" replace />
          )
        }
      />

      {/* Protected User Profile Route */}
      <Route
        path="/profile/*"
        element={
          centralToken && currentUser ? (
            <UserProfileDashboard
              currentUser={currentUser}
              centralToken={centralToken}
              onLogout={handleCentralLogout}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* Developer Console Route */}
      <Route
        path="/developer"
        element={
          centralToken && currentUser ? (
            <DeveloperConsole
              appsList={appsList}
              onRefreshApps={refreshAppsList}
              currentUser={currentUser}
              centralToken={centralToken}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* Root redirect */}
      <Route
        path="/"
        element={
          centralToken && currentUser ? (
            <Navigate to="/profile" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* Fallback redirect */}
      <Route
        path="*"
        element={
          centralToken && currentUser ? (
            <Navigate to="/profile" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
    </div>
  );
}
