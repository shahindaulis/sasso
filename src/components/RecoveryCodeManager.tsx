import React, { useState, useEffect } from 'react';
import { UserProfile } from '../types';
import {
  KeyRound,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ShieldAlert,
  Lock
} from 'lucide-react';

interface RecoveryCodeManagerProps {
  currentUser: UserProfile;
  centralToken: string;
  onBack?: () => void;
}

export const RecoveryCodeManager: React.FC<RecoveryCodeManagerProps> = ({
  currentUser,
  centralToken,
  onBack
}) => {
  const [recoveryCode, setRecoveryCode] = useState<string>('');
  const [isMasked, setIsMasked] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [regenerating, setRegenerating] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchRecoveryCode = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/user/recovery-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${centralToken}`
        },
        body: JSON.stringify({ token: centralToken })
      });
      const data = await res.json();
      if (res.ok && data.recoveryCode) {
        setRecoveryCode(data.recoveryCode);
      } else {
        setRecoveryCode(currentUser.recoveryCode || 'REC-XXXX-XXXX-XXXX');
      }
    } catch (err) {
      console.error('Failed to fetch recovery code:', err);
      setRecoveryCode(currentUser.recoveryCode || 'REC-XXXX-XXXX-XXXX');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecoveryCode();
  }, [centralToken]);

  const handleCopy = () => {
    if (!recoveryCode) return;
    navigator.clipboard.writeText(recoveryCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerateCode = async () => {
    setRegenerating(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/user/recovery-code/regenerate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${centralToken}`
        },
        body: JSON.stringify({ token: centralToken })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to regenerate recovery code');
      }

      setRecoveryCode(data.recoveryCode);
      setIsMasked(false); // Unmask newly generated code so user can note it down immediately
      setSuccessMsg('New recovery code generated successfully! Your old code is permanently invalidated.');
      setShowConfirmModal(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error regenerating recovery code');
    } finally {
      setRegenerating(false);
    }
  };

  const getMaskedCode = (code: string) => {
    if (!code) return 'REC-••••-••••-••••';
    const parts = code.split('-');
    if (parts.length >= 4) {
      return `${parts[0]}-••••-••••-••••`;
    }
    return '••••-••••-••••-••••';
  };

  return (
    <div className="space-y-5">
      {/* Top Header with Back Button - Requirement 9 */}
      <div className="space-y-3 border-b border-gray-100 pb-4">
        {onBack && (
          <div>
            <button
              onClick={onBack}
              className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-700 transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-bold shrink-0 border border-gray-200/80"
              title="Go Back"
            >
              <ArrowLeft className="w-4 h-4 text-amber-600" />
              <span>Back</span>
            </button>
          </div>
        )}

        <div>
          <h3 className="text-sm sm:text-base font-extrabold text-gray-900 flex items-center gap-2">
            <KeyRound className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600 shrink-0" />
            <span>Account Recovery Code</span>
          </h3>
          <p className="text-[11px] sm:text-xs text-gray-500">
            Your master bypass code to recover account if you lose your Passkey or YubiKey
          </p>
        </div>
      </div>

      {/* Global Alerts */}
      {errorMsg && (
        <div className="bg-red-50 text-red-800 border border-red-200 text-xs rounded-xl p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs rounded-xl p-3 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Main Recovery Code Display Card */}
      <div className="bg-gradient-to-br from-amber-50/70 via-white to-amber-50/30 p-5 rounded-3xl border border-amber-200/80 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-600" />
            <span className="text-xs font-bold text-amber-950">Master Recovery Passcode</span>
          </div>

          <button
            onClick={() => setIsMasked(!isMasked)}
            className="px-3 py-1 bg-white hover:bg-amber-100/60 text-amber-900 border border-amber-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            {isMasked ? (
              <>
                <Eye className="w-3.5 h-3.5 text-amber-700" />
                <span>Show Code</span>
              </>
            ) : (
              <>
                <EyeOff className="w-3.5 h-3.5 text-amber-700" />
                <span>Hide Code</span>
              </>
            )}
          </button>
        </div>

        {/* Code Input Box */}
        <div className="relative flex items-center">
          <div className="w-full bg-white border border-amber-200 rounded-2xl p-4 font-mono text-center text-lg font-black tracking-wider text-gray-800 shadow-inner select-all">
            {loading ? (
              <span className="text-xs font-normal text-gray-400 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-amber-600" /> Loading code...
              </span>
            ) : isMasked ? (
              <span className="text-gray-400">{getMaskedCode(recoveryCode)}</span>
            ) : (
              <span className="text-amber-900 bg-amber-50/80 px-3 py-1 rounded-lg border border-amber-200">{recoveryCode}</span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
          <button
            onClick={handleCopy}
            disabled={loading || !recoveryCode}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-2xs disabled:opacity-50"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-white" />
                <span>Copied to Clipboard!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copy Recovery Code</span>
              </>
            )}
          </button>

          <button
            onClick={() => setShowConfirmModal(true)}
            className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-2xs"
          >
            <RefreshCw className="w-4 h-4 text-red-600" />
            <span>Regenerate Code</span>
          </button>
        </div>
      </div>

      {/* Safety Notice */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-600 space-y-1.5">
        <div className="font-extrabold text-slate-900 flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4 text-indigo-600" />
          <span>Security Guidelines</span>
        </div>
        <p className="leading-relaxed">
          Keep this code stored safely in a password manager or printed on paper. If you lose access to your device or passkey, entering this code on the Sign In page will immediately restore account access.
        </p>
      </div>

      {/* Confirmation Modal for Regenerate */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 space-y-4 text-center">
            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-extrabold text-gray-900">
                Regenerate Recovery Code?
              </h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                Your current recovery code will be permanently deleted and invalidated in the database. Any old copies will no longer work.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                disabled={regenerating}
                className="w-1/2 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>

              <button
                onClick={handleRegenerateCode}
                disabled={regenerating}
                className="w-1/2 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-extrabold shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {regenerating ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>{regenerating ? 'Replacing...' : 'Yes, Replace Code'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
