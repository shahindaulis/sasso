import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserProfile } from '../types';
import { Fingerprint, User, AlertCircle, ArrowLeft, CheckCircle } from 'lucide-react';
import { startRegistration, WebAuthnAbortService } from '@simplewebauthn/browser';

interface SignUpProps {
  onLoginSuccess: (token: string, user: UserProfile, refreshToken?: string, expiresIn?: number) => void;
}

export const SignUp: React.FC<SignUpProps> = ({ onLoginSuccess }) => {
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const webauthnActiveRef = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    return () => {
      try {
        WebAuthnAbortService.cancelCeremony();
      } catch (e) {}
    };
  }, []);

  const handleRegisterPasskey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim()) {
      setError('Please enter a valid User ID');
      return;
    }

    if (webauthnActiveRef.current || loading) return;

    webauthnActiveRef.current = true;
    setLoading(true);
    setError(null);

    try {
      try {
        WebAuthnAbortService.cancelCeremony();
      } catch (err) {}
      await new Promise((resolve) => setTimeout(resolve, 300));

      const cleanUserId = userId.trim().toLowerCase();

      const optRes = await fetch('/api/sso/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: cleanUserId, email: cleanUserId }),
      });
      const options = await optRes.json();

      if (!optRes.ok) {
        throw new Error(options.error || 'Failed to generate Passkey options');
      }

      let regResp;
      try {
        regResp = await startRegistration(options);
      } catch (webauthnErr: any) {
        const errMsg = webauthnErr?.message?.toLowerCase() || '';
        const errName = webauthnErr?.name || '';
        const isCancel =
          errName === 'NotAllowedError' ||
          errMsg.includes('cancelled') ||
          errMsg.includes('canceled') ||
          errMsg.includes('decline');

        if (isCancel) {
          throw new Error('Passkey registration was cancelled.');
        }
        throw webauthnErr;
      }

      const verifyRes = await fetch('/api/sso/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: cleanUserId,
          email: cleanUserId,
          registrationResponse: regResp,
          challenge: options.challenge,
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.token) {
        throw new Error(verifyData.error || 'Passkey verification failed');
      }

      setSuccess(true);
      setTimeout(() => {
        onLoginSuccess(verifyData.token, verifyData.user, verifyData.refreshToken, verifyData.expiresIn);
        navigate('/profile');
      }, 800);
    } catch (err: any) {
      setError(err.message || 'Passkey registration failed');
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
            <Fingerprint className="w-7 h-7" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight break-words">Create sasso Account</h1>
          <p className="text-xs text-gray-500 max-w-xs mx-auto">
            Enter a User ID to register a biometric Passkey for passwordless sign-in
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 border border-red-200 text-xs rounded-2xl p-3.5 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="leading-relaxed break-words">{error}</div>
          </div>
        )}

        {success && (
          <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs rounded-2xl p-3.5 flex items-center gap-2.5">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            <div className="font-bold break-words">Passkey Registered! Redirecting to Profile...</div>
          </div>
        )}

        {/* Register Form */}
        <form onSubmit={handleRegisterPasskey} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">
              Username <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
              <input
                type="text"
                required
                placeholder="Enter your Username (e.g. alex99)"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-gray-200 rounded-2xl text-xs sm:text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all outline-none min-h-[44px]"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || success}
            className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-2xl text-xs sm:text-sm font-extrabold shadow-md shadow-indigo-100 transition-all flex items-center justify-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed min-h-[48px] text-center cursor-pointer"
          >
            {loading ? (
              <span className="inline-block animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full shrink-0" />
            ) : (
              <Fingerprint className="w-4.5 h-4.5 shrink-0" />
            )}
            <span>{loading ? 'Creating Passkey...' : 'Register Passkey & Sign Up'}</span>
          </button>
        </form>

        <div className="pt-2 text-center">
          <Link
            to="/login"
            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors inline-flex items-center gap-1.5 p-2 rounded-xl"
          >
            <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
            <span>Already have an account? Sign In</span>
          </Link>
        </div>
      </div>
    </div>
  );
};
