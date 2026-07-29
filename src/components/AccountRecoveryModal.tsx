import React, { useState } from 'react';
import { UserProfile } from '../types';
import {
  ShieldAlert,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  X,
  Fingerprint,
  RefreshCw,
  Trash2,
  User,
  Key
} from 'lucide-react';
import { startRegistration, WebAuthnAbortService } from '@simplewebauthn/browser';

interface AccountRecoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (token: string, user: UserProfile) => void;
}

export const AccountRecoveryModal: React.FC<AccountRecoveryModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
}) => {
  const [step, setStep] = useState<'enter_code' | 'register_new'>('enter_code');
  const [recoveryCodeInput, setRecoveryCodeInput] = useState('');
  const [identifierInput, setIdentifierInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [recoveredToken, setRecoveredToken] = useState<string | null>(null);
  const [recoveredUser, setRecoveredUser] = useState<UserProfile | null>(null);
  const [revokedCount, setRevokedCount] = useState<number>(0);

  if (!isOpen) return null;

  const handleVerifyRecoveryCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryCodeInput.trim()) {
      setErrorMsg('Please enter your Master Recovery Code');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/auth/verify-recovery-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recoveryCode: recoveryCodeInput.trim(),
          identifier: identifierInput.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to verify Master Recovery Code');
      }

      setRecoveredToken(data.token);
      setRecoveredUser(data.user);
      setRevokedCount(data.revokedCount || 0);

      setSuccessMsg(
        `Account recovered! ${
          data.revokedCount > 0
            ? `${data.revokedCount} old passkey(s) deleted permanently.`
            : 'Passkey storage cleared.'
        }`
      );

      setStep('register_new');
    } catch (err: any) {
      setErrorMsg(err.message || 'Invalid Master Recovery Code');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterNewPasskey = async () => {
    if (!recoveredUser || !recoveredToken) return;

    setLoading(true);
    setErrorMsg(null);

    try {
      try {
        WebAuthnAbortService.cancelCeremony();
      } catch (err) {}
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 1. Request registration options
      const optRes = await fetch('/api/sso/register/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: recoveredUser.email }),
      });

      const options = await optRes.json();
      if (!optRes.ok) {
        throw new Error(options.error || 'Failed to get Passkey options');
      }

      // 2. Start WebAuthn registration prompt on device
      let regResp;
      try {
        regResp = await startRegistration(options);
      } catch (webauthnErr: any) {
        const errMsg = webauthnErr?.message?.toLowerCase() || '';
        if (webauthnErr?.name === 'NotAllowedError' || errMsg.includes('cancel')) {
          throw new Error('Passkey registration was cancelled.');
        }
        throw webauthnErr;
      }

      // 3. Verify new passkey on server
      const verifyRes = await fetch('/api/sso/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: recoveredUser.email,
          registrationResponse: regResp,
          challenge: options.challenge,
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'Passkey verification failed');
      }

      // Login user with new passkey and token
      onLoginSuccess(verifyData.token || recoveredToken, verifyData.user || recoveredUser);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to register new passkey');
    } finally {
      setLoading(false);
    }
  };

  const handleSkipToDashboard = () => {
    if (recoveredToken && recoveredUser) {
      onLoginSuccess(recoveredToken, recoveredUser);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-200 overflow-hidden p-6 sm:p-8 space-y-5 relative">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center shrink-0">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-black text-gray-900">Passkey Recovery</h3>
            <p className="text-xs text-gray-500">Recover account with Master Recovery Code</p>
          </div>
        </div>

        {/* Feedback Messages */}
        {errorMsg && (
          <div className="bg-red-50 text-red-800 border border-red-200 text-xs rounded-2xl p-3.5 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed break-words">{errorMsg}</div>
          </div>
        )}

        {successMsg && (
          <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs rounded-2xl p-3.5 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed break-words">{successMsg}</div>
          </div>
        )}

        {/* STEP 1: Enter Recovery Code */}
        {step === 'enter_code' && (
          <form onSubmit={handleVerifyRecoveryCode} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 block">
                Master Recovery Code <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Key className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={recoveryCodeInput}
                  onChange={(e) => setRecoveryCodeInput(e.target.value.toUpperCase())}
                  placeholder="e.g. REC-A8B9-C1D2-E3F4"
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs sm:text-sm font-mono font-bold tracking-wider focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all uppercase"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700 block">
                Email or User ID <span className="text-gray-400 font-normal">(Optional)</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={identifierInput}
                  onChange={(e) => setIdentifierInput(e.target.value)}
                  placeholder="e.g. name@example.com or user_123"
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs sm:text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-[11px] text-amber-900 flex items-start gap-2.5">
              <Trash2 className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Automatic Wipe:</strong> Validating your Recovery Code will <strong>delete all old passkeys</strong> on file and alert your linked email address.
              </span>
            </div>

            <button
              type="submit"
              disabled={loading || !recoveryCodeInput.trim()}
              className="w-full py-3.5 px-4 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs sm:text-sm font-extrabold shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldAlert className="w-4 h-4" />
              )}
              <span>{loading ? 'Verifying Code...' : 'Verify Code & Wipe Old Passkeys'}</span>
            </button>
          </form>
        )}

        {/* STEP 2: Register New Passkey */}
        {step === 'register_new' && (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-2 text-emerald-900">
              <div className="flex items-center gap-2 font-black text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>Account Recovered & Secured!</span>
              </div>
              <p className="text-xs leading-relaxed text-emerald-800">
                {revokedCount > 0
                  ? `All ${revokedCount} old passkey(s) associated with ${recoveredUser?.email} have been deleted permanently.`
                  : `Old passkey storage cleared for ${recoveredUser?.email}.`}
              </p>
            </div>

            <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 text-center space-y-3">
              <Fingerprint className="w-8 h-8 text-indigo-600 mx-auto" />
              <div className="space-y-1">
                <h4 className="font-extrabold text-gray-900 text-sm">Create a New Passkey</h4>
                <p className="text-xs text-gray-500">
                  Register a fresh passkey on this device (Fingerprint, Face ID, or PIN) to log in going forward.
                </p>
              </div>

              <button
                type="button"
                onClick={handleRegisterNewPasskey}
                disabled={loading}
                className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-extrabold shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {loading ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Fingerprint className="w-4 h-4" />
                )}
                <span>{loading ? 'Registering Device...' : 'Register New Passkey Now'}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleSkipToDashboard}
              className="w-full py-2.5 text-center text-xs font-bold text-gray-500 hover:text-gray-800 transition-colors cursor-pointer"
            >
              Skip and go to Account Profile
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
