import React, { useState, useEffect, useRef } from 'react';
import { UserProfile, ClientApp } from '../types';
import { Shield, Key, Mail, User, CheckCircle, ArrowRight, AppWindow, ExternalLink, Fingerprint, KeyRound } from 'lucide-react';
import { startRegistration, startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import { AccountRecoveryModal } from './AccountRecoveryModal';

// Safe WebAuthn execution wrappers to handle browser/OS Credentials Manager lock release
const safeStartAuthentication = async (options: Parameters<typeof startAuthentication>[0]) => {
  // 1. Pehle se chal rahe kisi bhi passkey prompt ko abort cancel command bheja
  try {
    WebAuthnAbortService.cancelCeremony();
  } catch (err) {}

  // 2. Browser/OS ke Credentials Manager ko release hone ke liye 150ms ka waqt diya
  await new Promise((resolve) => setTimeout(resolve, 150));

  try {
    return await startAuthentication(options);
  } catch (err: any) {
    const errMsg = (err?.message || '').toLowerCase();
    const errName = err?.name || '';

    // Check if user explicitly clicked 'Cancel' on the browser/OS native popup
    const isExplicitUserCancel =
      (errName === 'NotAllowedError' &&
        !errMsg.includes('credential') &&
        !errMsg.includes('failed') &&
        !errMsg.includes('unknown') &&
        !errMsg.includes('abort') &&
        !errMsg.includes('pending') &&
        !errMsg.includes('invalid') &&
        !errMsg.includes('open') &&
        !errMsg.includes('talking') &&
        !errMsg.includes('busy')) ||
      errMsg.includes('user cancelled') ||
      errMsg.includes('user canceled') ||
      errMsg.includes('decline') ||
      errMsg.includes('dismiss');

    if (isExplicitUserCancel) {
      throw err;
    }

    // 3. Page refresh, logout ya leftover credentials manager lock error pe automatic retry
    try {
      WebAuthnAbortService.cancelCeremony();
    } catch (cErr) {}
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Dobara naya authentication start kar diya (User ko 2nd click nahi karna padega)
    return await startAuthentication(options);
  }
};

const safeStartRegistration = async (options: Parameters<typeof startRegistration>[0]) => {
  // 1. Send cancel ceremony signal to abort any active passkey prompt
  try {
    WebAuthnAbortService.cancelCeremony();
  } catch (err) {}

  // 2. Initial wait for browser/OS Credentials Manager to release
  await new Promise((resolve) => setTimeout(resolve, 350));

  let attempts = 0;
  const maxAttempts = 4;
  const retryDelays = [400, 600, 800];

  while (attempts < maxAttempts) {
    try {
      return await startRegistration(options);
    } catch (err: any) {
      attempts++;
      const errMsg = err?.message?.toLowerCase() || '';
      const errName = err?.name || '';

      // User explicit cancellation check
      const isExplicitUserCancel =
        (errName === 'NotAllowedError' && !errMsg.includes('credential') && !errMsg.includes('unknown') && !errMsg.includes('failed')) ||
        errMsg.includes('user cancelled') ||
        errMsg.includes('user canceled') ||
        errMsg.includes('decline') ||
        errMsg.includes('dismiss');

      if (isExplicitUserCancel) {
        throw err;
      }

      const isCleanupError =
        errName === 'NotAllowedError' ||
        errName === 'InvalidStateError' ||
        errName === 'AbortError' ||
        errName === 'OperationError' ||
        errName === 'UnknownError' ||
        errMsg.includes('credential') || // Matches both 'credential manager' and 'credentials manager'
        errMsg.includes('unknown error') ||
        errMsg.includes('talking') ||
        errMsg.includes('cancelled') ||
        errMsg.includes('canceled') ||
        errMsg.includes('abort') ||
        errMsg.includes('pending') ||
        errMsg.includes('operation error') ||
        errMsg.includes('failed to open') ||
        errMsg.includes('failed to take') ||
        errMsg.includes('already in progress') ||
        errMsg.includes('not allowed');

      if (isCleanupError && attempts < maxAttempts) {
        // Automatic Silent Retry: Cancel ceremony again and wait for OS credentials manager release
        try {
          WebAuthnAbortService.cancelCeremony();
        } catch (cErr) {}
        await new Promise((resolve) => setTimeout(resolve, retryDelays[attempts - 1] || 500));
        continue;
      }
      throw err;
    }
  }
  return await startRegistration(options);
};

interface CentralSsoAppProps {
  centralToken: string | null;
  onLoginSuccess: (token: string, user: UserProfile) => void;
  onLogout: () => void;
  oauthRequest: {
    clientId: string;
    redirectUri: string;
    accessType?: string;
  } | null;
  onApproveOAuth: (code: string) => void;
  onCancelOAuth: () => void;
  appsList: ClientApp[];
}

export const CentralSsoApp: React.FC<CentralSsoAppProps> = ({
  centralToken,
  onLoginSuccess,
  onLogout,
  oauthRequest,
  onApproveOAuth,
  onCancelOAuth,
  appsList
}) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);

  // Synchronous guards to prevent double-triggering or overlapping WebAuthn requests
  const webauthnActiveRef = useRef(false);

  // Helper to cleanly cancel active WebAuthn ceremony and wait for OS/browser Credentials Manager teardown
  const cancelAndResetWebAuthnCeremony = async (delayMs: number = 300) => {
    try {
      WebAuthnAbortService.cancelCeremony();
    } catch (err) {}

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      WebAuthnAbortService.cancelCeremony();
    } catch (err) {}
  };

  useEffect(() => {
    try {
      WebAuthnAbortService.cancelCeremony();
    } catch (err) {}
    // Clean up active ceremony on component unmount
    return () => {
      try {
        WebAuthnAbortService.cancelCeremony();
      } catch (err) {}
    };
  }, []);

  const toggleRegisterMode = async (reg: boolean) => {
    // Explicitly cancel any active credentials ceremony with teardown delay
    await cancelAndResetWebAuthnCeremony(300);
    setIsRegistering(reg);
    setError(null);
    setSuccessMsg(null);
    setEmail('');
  };

  // Auto-fetch profile if token is set
  useEffect(() => {
    if (centralToken) {
      verifyCentralSession();
    } else {
      setCurrentUser(null);
    }
  }, [centralToken]);

  const verifyCentralSession = async () => {
    try {
      const res = await fetch('/api/sso/verify-central', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: centralToken })
      });
      const data = await res.json();
      if (res.ok) {
        setCurrentUser(data.user);
      } else {
        onLogout();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // WebAuthn Passkey Registration
  const handleRegisterPasskey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || webauthnActiveRef.current) return;
    if (!email) {
      setError('Please enter your email to register a passkey.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    webauthnActiveRef.current = true;

    try {
      // 1. Fetch fresh registration options
      const optionsRes = await fetch('/api/sso/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const optionsData = await optionsRes.json();
      if (!optionsRes.ok) {
        throw new Error(optionsData.error || 'Failed to get registration options');
      }

      // 2. Start WebAuthn registration with safe credentials manager wrapper
      let registrationResponse;
      try {
        registrationResponse = await safeStartRegistration({
          optionsJSON: optionsData,
        });
      } catch (browserErr: any) {
        const errMsg = browserErr.message || '';
        const isCanceled = browserErr.name === 'NotAllowedError' || 
          errMsg.toLowerCase().includes('cancel') || 
          errMsg.toLowerCase().includes('abort') ||
          errMsg.toLowerCase().includes('declined') ||
          errMsg.toLowerCase().includes('aborted');

        if (isCanceled) {
          throw new Error('Passkey registration request was canceled.');
        }
        throw new Error(`Passkey registration failed: ${browserErr.message}`);
      }

      // 3. Verify response on server
      const verifyRes = await fetch('/api/sso/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, registrationResponse, challenge: optionsData.challenge }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'Passkey verification failed');
      }

      setSuccessMsg('Passkey registered successfully! Identity created.');

      if (verifyData.token && verifyData.user) {
        onLoginSuccess(verifyData.token, verifyData.user);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      try {
        WebAuthnAbortService.cancelCeremony();
      } catch (err) {}
      setLoading(false);
      webauthnActiveRef.current = false;
    }
  };

  // WebAuthn Passkey Login (Usernameless & Passwordless!)
  const handleLoginPasskey = async () => {
    if (loading || webauthnActiveRef.current) return;

    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    webauthnActiveRef.current = true;

    try {
      try {
        WebAuthnAbortService.cancelCeremony();
      } catch (err) {}
      await new Promise((resolve) => setTimeout(resolve, 200));

      // 1. Fetch fresh login options on user click
      const optionsRes = await fetch('/api/sso/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const optionsData = await optionsRes.json();
      if (!optionsRes.ok) {
        throw new Error(optionsData.error || 'Failed to get login options');
      }

      // 2. Start WebAuthn login assertion in browser with safe credentials manager wrapper
      let loginResponse;
      try {
        loginResponse = await safeStartAuthentication({
          optionsJSON: optionsData,
        });
      } catch (browserErr: any) {
        const errMsg = browserErr.message || '';
        const isCanceled = browserErr.name === 'NotAllowedError' || 
          errMsg.toLowerCase().includes('cancel') || 
          errMsg.toLowerCase().includes('abort') ||
          errMsg.toLowerCase().includes('declined') ||
          errMsg.toLowerCase().includes('aborted');

        if (isCanceled) {
          throw new Error('Authentication request was canceled.');
        }
        throw new Error(`Passkey authentication failed: ${browserErr.message}`);
      }

      // 3. Verify response on server
      const verifyRes = await fetch('/api/sso/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginResponse, challenge: optionsData.challenge }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'Passkey authentication failed');
      }

      setSuccessMsg('Logged in successfully via Passkey!');

      if (verifyData.token && verifyData.user) {
        onLoginSuccess(verifyData.token, verifyData.user);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      try {
        WebAuthnAbortService.cancelCeremony();
      } catch (err) {}
      setLoading(false);
      webauthnActiveRef.current = false;
    }
  };

  const handleApprove = async () => {
    if (!oauthRequest || !centralToken) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/sso/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          centralToken,
          clientId: oauthRequest.clientId,
          redirectUri: oauthRequest.redirectUri,
          accessType: oauthRequest.accessType,
          access_type: oauthRequest.accessType
        })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Authorization failed');
      }

      onApproveOAuth(data.code);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const currentRequestApp = oauthRequest 
    ? appsList.find(app => app.id === oauthRequest.clientId) 
    : null;

  // Detect if inside an iframe
  const isIframe = window.self !== window.top;

  return (
    <div className="bg-slate-50 min-h-[480px] rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
      {/* SSO Bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-indigo-100 text-indigo-600 rounded-lg font-bold tracking-tight text-lg">
            sa
          </div>
          <span className="font-bold text-gray-800 text-lg">sasso</span>
        </div>

        {/* TOP RIGHT CORNER: Iframe breakout trigger */}
        <a
          href={window.location.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-100 transition-colors"
          title="Open application in a new tab"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>Open in New Tab</span>
        </a>
      </div>

      {/* Main Body */}
      <div className="flex-1 p-6 flex flex-col justify-center max-w-md mx-auto w-full">

        {/* Error / Success alerts */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-red-700 text-xs font-medium">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-100 rounded-lg text-emerald-700 text-xs font-medium flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* 1. OAUTH CONSENT SCREEN */}
        {oauthRequest && currentUser && (
          <div className="space-y-5 bg-white p-6 rounded-2xl border border-indigo-100 shadow-md animate-fade-in">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center gap-4 bg-gray-50 p-3 rounded-xl border border-gray-100">
                <span className="p-2 bg-indigo-100 text-indigo-700 rounded-lg font-bold text-sm">sasso</span>
                <span className="text-gray-400">➜</span>
                <span className="p-2 bg-blue-100 text-blue-700 rounded-lg font-bold text-sm capitalize">
                  {currentRequestApp?.name || oauthRequest.clientId}
                </span>
              </div>
              <h3 className="font-bold text-gray-900 text-base mt-2">Authorization Request</h3>
              <p className="text-xs text-gray-500">
                <span className="font-semibold text-gray-800">{currentRequestApp?.name || oauthRequest.clientId}</span> wishes to sign you in using your sasso account.
              </p>
            </div>

            <div className="border-y border-gray-100 py-3 text-xs space-y-2 text-gray-600">
              <p className="font-medium text-gray-500 uppercase tracking-wider text-[10px]">Permitted Profile Information:</p>
              <div className="flex items-center gap-3 bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                <img 
                  src={currentUser.avatarUrl} 
                  alt={currentUser.firstName} 
                  className="w-10 h-10 rounded-full border animate-pulse"
                  referrerPolicy="no-referrer"
                />
                <div>
                  <p className="font-semibold text-gray-800">{currentUser.firstName} {currentUser.lastName}</p>
                  <p className="text-[10px] text-gray-400 font-mono">{currentUser.email}</p>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 leading-relaxed pt-1">
                The client app will receive a secure, cryptographic JWT token. You will log into this app instantly.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onCancelOAuth}
                className="flex-1 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={loading}
                className="flex-1 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors flex items-center justify-center gap-1 shadow-sm"
              >
                {loading ? 'Authenticating...' : 'Approve & Continue'}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* 2. AUTHENTICATED PANEL (Default view when logged in and no OAuth pending) */}
        {!oauthRequest && currentUser && (
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm text-center space-y-4">
            <div className="relative inline-block">
              <img 
                src={currentUser.avatarUrl} 
                alt="Profile" 
                className="w-20 h-20 rounded-full mx-auto border-2 border-indigo-100 object-cover shadow-sm"
                referrerPolicy="no-referrer"
              />
              <span className="absolute bottom-0 right-0 p-1.5 bg-emerald-500 text-white rounded-full border-2 border-white">
                <CheckCircle className="w-3.5 h-3.5" />
              </span>
            </div>
            
            <div className="space-y-1">
              <h3 className="font-bold text-gray-900 text-lg">Welcome, {currentUser.firstName}!</h3>
              <p className="text-xs text-gray-400 font-mono">{currentUser.email}</p>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-left space-y-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">SSO Status Console</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white p-2 rounded-lg border border-gray-100">
                  <p className="text-[10px] text-gray-400">Master Session</p>
                  <p className="font-bold text-indigo-600 mt-0.5">Active</p>
                </div>
                <div className="bg-white p-2 rounded-lg border border-gray-100">
                  <p className="text-[10px] text-gray-400">Sync Scope</p>
                  <p className="font-bold text-emerald-600 mt-0.5">Cross-Origin</p>
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <button
                onClick={async () => {
                  await cancelAndResetWebAuthnCeremony(300);
                  await onLogout();
                }}
                className="w-full py-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1"
              >
                Sign Out Globally (SLO)
              </button>
              <p className="text-[9px] text-gray-400">
                Signs out of the central provider and invalidates your active SSO session key.
              </p>
            </div>
          </div>
        )}

        {/* 3. SIGN IN / LOGIN FORM */}
        {!currentUser && !isRegistering && (
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-5">
            <div className="text-center space-y-1">
              <h3 className="font-bold text-gray-900 text-lg">Sign in with sasso</h3>
              <p className="text-xs text-gray-500">Log in securely using passwordless Passkeys</p>
            </div>

            {oauthRequest && (
              <div className="p-2.5 bg-amber-50 border border-amber-100 rounded-lg text-amber-800 text-[11px] leading-relaxed">
                Sign in to authorize <span className="font-semibold">{currentRequestApp?.name || oauthRequest.clientId}</span> to access your profile.
              </div>
            )}

            <div className="space-y-4 pt-2">
              {/* Primary Usernameless & Passwordless Trigger */}
              <button
                type="button"
                onClick={handleLoginPasskey}
                disabled={loading}
                className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2"
              >
                <Fingerprint className="w-5 h-5 text-indigo-100 animate-pulse" />
                {loading ? 'Interacting with Device...' : 'Login with Passkey'}
              </button>

              <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-[11px] text-gray-500 leading-relaxed flex gap-2">
                <span className="text-indigo-500 font-bold">ℹ️</span>
                <span>
                  No email or password needed! Click the button above to authenticate with your device's biometrics or hardware key.
                </span>
              </div>

              <button
                type="button"
                onClick={() => setIsRecoveryOpen(true)}
                className="w-full py-2 px-3 text-center text-xs font-bold text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              >
                <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                <span>Lost Passkey? Recover Account via Recovery Code</span>
              </button>
            </div>

            <AccountRecoveryModal
              isOpen={isRecoveryOpen}
              onClose={() => setIsRecoveryOpen(false)}
              onLoginSuccess={(token, user) => {
                onLoginSuccess(token, user);
              }}
            />

            <div className="text-center pt-2 border-t border-gray-50">
              <span className="text-xs text-gray-400 font-medium">New to sasso? </span>
              <button
                type="button"
                onClick={() => toggleRegisterMode(true)}
                className="text-xs font-bold text-indigo-600 hover:underline"
              >
                Create an account
              </button>
            </div>
          </div>
        )}

        {/* 4. REGISTRATION FORM */}
        {!currentUser && isRegistering && (
          <form 
            onSubmit={handleRegisterPasskey} 
            className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4"
          >
            <div className="text-center space-y-1">
              <h3 className="font-bold text-gray-900 text-lg">Create Account</h3>
              <p className="text-xs text-gray-500">Register email to activate your passkey</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4.5 w-4.5 text-gray-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50/50"
                  placeholder="name@example.com"
                />
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
                We will derive your user profile details and register a secure cryptographic key pair on your device.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl text-xs font-bold transition-colors shadow-sm flex items-center justify-center gap-1.5 mt-2"
            >
              <Fingerprint className="w-4 h-4 text-indigo-100" />
              {loading ? 'Creating Identity...' : 'Register Passkey'}
            </button>

            <div className="text-center pt-2">
              <span className="text-xs text-gray-400 font-medium">Already registered? </span>
              <button
                type="button"
                onClick={() => toggleRegisterMode(false)}
                className="text-xs font-bold text-indigo-600 hover:underline"
              >
                Sign in
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
