import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserProfile } from '../types';
import { Shield, Key, Mail, Fingerprint, ArrowRight, ArrowLeft, UserPlus, AlertCircle, KeyRound } from 'lucide-react';
import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import { AccountRecoveryModal } from './AccountRecoveryModal';

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

interface SignInProps {
  onLoginSuccess: (token: string, user: UserProfile, refreshToken?: string, expiresIn?: number) => void;
}

export const SignIn: React.FC<SignInProps> = ({ onLoginSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const webauthnActiveRef = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    try {
      WebAuthnAbortService.cancelCeremony();
    } catch (e) {}
    return () => {
      try {
        WebAuthnAbortService.cancelCeremony();
      } catch (e) {}
    };
  }, []);

  const handlePasskeyLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (webauthnActiveRef.current || loading) return;

    webauthnActiveRef.current = true;
    setLoading(true);
    setError(null);

    try {
      try {
        WebAuthnAbortService.cancelCeremony();
      } catch (err) {}
      await new Promise((resolve) => setTimeout(resolve, 350));

      const optRes = await fetch('/api/sso/login/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const options = await optRes.json();

      if (!optRes.ok) {
        throw new Error(options.error || 'Failed to get Passkey options');
      }

      let authResp;
      try {
        authResp = await safeStartAuthentication(options);
      } catch (webauthnErr: any) {
        const errMsg = webauthnErr?.message?.toLowerCase() || '';
        const errName = webauthnErr?.name || '';
        const isCancel =
          errName === 'NotAllowedError' ||
          errMsg.includes('cancelled') ||
          errMsg.includes('canceled') ||
          errMsg.includes('decline');

        if (isCancel) {
          throw new Error('Passkey verification was cancelled.');
        }
        throw webauthnErr;
      }

      const verifyRes = await fetch('/api/sso/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          loginResponse: authResp,
          challenge: options.challenge,
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.token) {
        throw new Error(verifyData.error || 'Passkey authentication failed');
      }

      onLoginSuccess(verifyData.token, verifyData.user, verifyData.refreshToken, verifyData.expiresIn);
      navigate('/profile');
    } catch (err: any) {
      setError(err.message || 'Passkey login failed');
    } finally {
      setLoading(false);
      webauthnActiveRef.current = false;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 sm:p-6 font-sans text-gray-900">
      <div className="w-full max-w-md bg-white rounded-3xl border border-gray-200/80 shadow-xl overflow-hidden p-6 sm:p-8 space-y-6 mx-auto">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto text-white shadow-lg shadow-indigo-100 shrink-0">
            <Shield className="w-7 h-7" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight break-words">Sign In with sasso</h1>
          <p className="text-xs text-gray-500 max-w-xs mx-auto">
            Log in securely using Native Passkeys (FIDO2 / WebAuthn Cross-Device QR)
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 border border-red-200 text-xs rounded-2xl p-3.5 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="leading-relaxed break-words">{error}</div>
          </div>
        )}

        {/* Native WebAuthn FIDO2 Passkey Login Button */}
        <div className="space-y-4">
          <button
            onClick={handlePasskeyLogin}
            disabled={loading}
            className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-2xl text-xs sm:text-sm font-extrabold shadow-md shadow-indigo-100 transition-all flex items-center justify-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed min-h-[48px] text-center cursor-pointer"
          >
            {loading ? (
              <span className="inline-block animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full shrink-0" />
            ) : (
              <Fingerprint className="w-4.5 h-4.5 shrink-0" />
            )}
            <span>{loading ? 'Verifying Passkey...' : 'Sign In with Passkey'}</span>
          </button>

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
            navigate('/profile');
          }}
        />

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-[10px] uppercase font-bold text-gray-400 bg-white px-3">
            New to sasso?
          </div>
        </div>

        {/* Link to Register */}
        <Link
          to="/signup"
          className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 rounded-2xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 text-center min-h-[44px]"
        >
          <UserPlus className="w-4 h-4 text-slate-600 shrink-0" />
          <span>Create an account & Register Passkey</span>
        </Link>
      </div>
    </div>
  );
};
