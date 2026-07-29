import React, { useState } from 'react';
import { UserProfile } from '../types';
import {
  Mail,
  CheckCircle2,
  AlertTriangle,
  Send,
  KeyRound,
  ArrowLeft,
  ShieldCheck,
  RefreshCw,
  Lock
} from 'lucide-react';

interface EmailVerificationViewProps {
  currentUser: UserProfile;
  centralToken: string;
  onBack: () => void;
  onUserUpdated: (updatedUser: Partial<UserProfile>) => void;
}

export const EmailVerificationView: React.FC<EmailVerificationViewProps> = ({
  currentUser,
  centralToken,
  onBack,
  onUserUpdated,
}) => {
  const [isEmailVerified, setIsEmailVerified] = useState<boolean>(!!currentUser.isEmailVerified);
  const [currentEmail, setCurrentEmail] = useState<string>(currentUser.email || '');
  
  // Verification / Change Email Mode
  const [isChangingEmail, setIsChangingEmail] = useState(false);
  const [changeStep, setChangeStep] = useState<1 | 2>(1); // 1 = verify current email, 2 = verify new email

  // Input states
  const [emailInput, setEmailInput] = useState<string>(currentUser.email || '');
  const [newEmailInput, setNewEmailInput] = useState<string>('');
  const [otpCode, setOtpCode] = useState('');

  // Status & Feedback
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [devPreviewCode, setDevPreviewCode] = useState<string | null>(null);

  // Send Verification Code (for direct verification or new email verification in step 2)
  const handleSendVerificationCode = async (targetEmailToSend: string) => {
    if (!targetEmailToSend.trim() || !targetEmailToSend.includes('@')) {
      setErrorMsg('Please enter a valid email address (e.g. user@gmail.com)');
      return;
    }

    setIsSendingOtp(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setDevPreviewCode(null);

    try {
      const res = await fetch('/api/auth/send-verification-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetEmail: targetEmailToSend.trim(),
          userId: currentUser.uid,
          token: centralToken
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to send verification code');
      }

      setOtpSent(true);
      setSuccessMsg(data.message || `Verification code sent to ${targetEmailToSend.trim()}`);
      if (data.previewCode) {
        setDevPreviewCode(data.previewCode);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to send verification email');
    } finally {
      setIsSendingOtp(false);
    }
  };

  // Start Change Email Flow
  const handleStartChangeEmail = () => {
    setIsChangingEmail(true);
    setChangeStep(1);
    setOtpCode('');
    setOtpSent(false);
    setErrorMsg(null);
    setSuccessMsg(null);
    setDevPreviewCode(null);
    // Send code to current verified email first
    handleSendVerificationCode(currentEmail);
  };

  // Step 1: Verify OTP on Current Email
  const handleVerifyCurrentEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode || otpCode.trim().length !== 6) {
      setErrorMsg('Please enter a valid 6-digit verification code');
      return;
    }

    setIsVerifyingOtp(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/auth/verify-current-email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentEmail: currentEmail,
          code: otpCode.trim(),
          userId: currentUser.uid,
          token: centralToken
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Current email verification failed');
      }

      setSuccessMsg('Current email verified! Now enter your new email address below.');
      setChangeStep(2);
      setOtpCode('');
      setOtpSent(false);
      setDevPreviewCode(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Invalid code');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  // Direct Verify or Step 2 Verify (New Email)
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmailToVerify = isChangingEmail ? newEmailInput.trim() : emailInput.trim();

    if (!targetEmailToVerify || !targetEmailToVerify.includes('@')) {
      setErrorMsg('Please enter a valid email address');
      return;
    }
    if (!otpCode || otpCode.trim().length !== 6) {
      setErrorMsg('Please enter a valid 6-digit code');
      return;
    }

    setIsVerifyingOtp(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/auth/verify-email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetEmail: targetEmailToVerify,
          code: otpCode.trim(),
          userId: currentUser.uid,
          token: centralToken
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Verification failed');
      }

      setIsEmailVerified(true);
      setCurrentEmail(targetEmailToVerify);
      setIsChangingEmail(false);
      setChangeStep(1);
      setOtpSent(false);
      setOtpCode('');
      setDevPreviewCode(null);
      setSuccessMsg('Email address updated & verified successfully!');

      onUserUpdated({
        email: targetEmailToVerify,
        isEmailVerified: true
      });
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to verify code');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Navigation Header - Requirement 9: Back button on top, content directly below */}
      <div className="space-y-3 border-b border-gray-200 pb-4">
        {onBack && (
          <div>
            <button
              onClick={onBack}
              className="px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-xl text-xs flex items-center gap-2 transition-all cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isEmailVerified ? (
              <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-[11px] rounded-full flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Verified Email
              </span>
            ) : (
              <span className="px-2.5 py-1 bg-amber-100 text-amber-800 font-extrabold text-[11px] rounded-full flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                Unverified Email
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white rounded-3xl border border-gray-200 p-5 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-gray-900 flex items-center gap-2.5">
              <ShieldCheck className="w-6 h-6 text-indigo-600 shrink-0" />
              <span>Email Address Settings</span>
            </h2>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              Manage and verify your account email address.
            </p>
          </div>


        </div>

        {/* 7-Day Unverified Warning Banner */}
        {!isEmailVerified && (
          <div className="bg-amber-50 text-amber-900 border border-amber-200 text-xs sm:text-sm rounded-2xl p-4 flex items-center gap-3 shadow-xs">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <span className="font-bold">7-Day Verification Deadline:</span> Unverified accounts are automatically deleted after 7 days ({currentUser.verificationDeadline ? `Deadline: ${new Date(currentUser.verificationDeadline).toLocaleDateString()}` : 'within 7 days of creation'}). Please verify your email address below.
            </div>
          </div>
        )}

        {/* Feedback Messages */}
        {successMsg && (
          <div className="bg-emerald-50 text-emerald-900 border border-emerald-200 text-xs sm:text-sm font-medium rounded-2xl p-4 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div className="break-all">{successMsg}</div>
          </div>
        )}

        {errorMsg && (
          <div className="bg-red-50 text-red-900 border border-red-200 text-xs sm:text-sm font-medium rounded-2xl p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <div className="break-all">{errorMsg}</div>
          </div>
        )}

        {/* Dev Mode OTP Toast Preview */}
        {devPreviewCode && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl p-3.5 text-xs text-amber-900 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-amber-600" />
              <span>Dev OTP Preview: <strong className="font-mono text-sm underline">{devPreviewCode}</strong></span>
            </div>
          </div>
        )}

        {/* MODE A: Already Verified Email */}
        {isEmailVerified && !isChangingEmail && (
          <div className="bg-slate-50 border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Verified Email Address</div>
                <div className="text-base sm:text-lg font-bold text-gray-900 break-all mt-1">
                  {currentEmail || currentUser.email}
                </div>
              </div>

              <button
                type="button"
                onClick={handleStartChangeEmail}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-sm shrink-0 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Change Email Address</span>
              </button>
            </div>
          </div>
        )}

        {/* MODE B: Change Email Flow - Step 1: Verify Current Email */}
        {isChangingEmail && changeStep === 1 && (
          <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-5 sm:p-6 space-y-5">
            <div>
              <span className="text-[11px] font-extrabold text-amber-800 uppercase tracking-wider bg-amber-100 px-2.5 py-0.5 rounded-full">
                Step 1 of 2: Authorize Change
              </span>
              <h3 className="text-sm font-bold text-gray-900 mt-2">
                Verify Current Email Address
              </h3>
              <p className="text-xs text-gray-600 mt-0.5">
                For security, we sent a verification code to your current email: <strong className="break-all font-semibold text-gray-900">{currentEmail}</strong>
              </p>
            </div>

            <form onSubmit={handleVerifyCurrentEmailOtp} className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter 6-digit OTP code"
                  className="flex-1 bg-white border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl px-4 py-2.5 text-center text-base tracking-widest font-mono font-bold text-gray-900 outline-none"
                />
                <button
                  type="submit"
                  disabled={isVerifyingOtp || otpCode.length !== 6}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {isVerifyingOtp ? 'Verifying...' : 'Verify & Continue'}
                </button>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => handleSendVerificationCode(currentEmail)}
                  disabled={isSendingOtp}
                  className="text-xs font-bold text-indigo-600 hover:underline cursor-pointer disabled:opacity-50"
                >
                  {isSendingOtp ? 'Sending...' : 'Resend Code to Current Email'}
                </button>
                <button
                  type="button"
                  onClick={() => { setIsChangingEmail(false); setChangeStep(1); }}
                  className="text-xs font-bold text-gray-500 hover:underline cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* MODE C: Change Email Flow - Step 2: Enter & Verify New Email */}
        {isChangingEmail && changeStep === 2 && (
          <div className="bg-indigo-50/60 border border-indigo-200 rounded-2xl p-5 sm:p-6 space-y-5">
            <div>
              <span className="text-[11px] font-extrabold text-indigo-800 uppercase tracking-wider bg-indigo-100 px-2.5 py-0.5 rounded-full">
                Step 2 of 2: New Email Verification
              </span>
              <h3 className="text-sm font-bold text-gray-900 mt-2">
                Enter Your New Email Address
              </h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-800 mb-1.5">New Email Address</label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Mail className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
                    <input
                      type="email"
                      required
                      value={newEmailInput}
                      onChange={(e) => setNewEmailInput(e.target.value)}
                      placeholder="e.g. newuser@gmail.com"
                      className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-300 rounded-xl text-xs sm:text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSendVerificationCode(newEmailInput)}
                    disabled={isSendingOtp || !newEmailInput.trim() || !newEmailInput.includes('@')}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 shrink-0 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isSendingOtp ? 'Sending...' : otpSent ? 'Resend Code' : 'Send Code'}</span>
                  </button>
                </div>
              </div>

              {otpSent && (
                <form onSubmit={handleVerifyOtp} className="pt-3 border-t border-indigo-200 space-y-3">
                  <label className="block text-xs font-bold text-gray-800">
                    Enter 6-Digit OTP sent to <span className="break-all font-semibold text-indigo-700">{newEmailInput}</span>
                  </label>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="text"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="Enter 6-digit OTP"
                      className="flex-1 bg-white border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl px-4 py-2.5 text-center text-base tracking-widest font-mono font-bold text-gray-900 outline-none"
                    />
                    <button
                      type="submit"
                      disabled={isVerifyingOtp || otpCode.length !== 6}
                      className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isVerifyingOtp ? 'Verifying...' : 'Confirm & Update Email'}</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* MODE D: Direct Email Verification (for Unverified users) */}
        {!isEmailVerified && !isChangingEmail && (
          <div className="bg-slate-50 border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-5">
            <div>
              <label className="block text-xs font-bold text-gray-800 mb-1.5">
                Enter Email Address <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Mail className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="Enter email address (e.g. user@gmail.com)"
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-300 rounded-xl text-xs sm:text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleSendVerificationCode(emailInput)}
                  disabled={isSendingOtp || !emailInput.trim() || !emailInput.includes('@')}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 shrink-0 cursor-pointer min-h-[42px]"
                >
                  <Send className={`w-3.5 h-3.5 ${isSendingOtp ? 'animate-bounce' : ''}`} />
                  <span>{isSendingOtp ? 'Sending...' : otpSent ? 'Resend Code' : 'Send Verification Code'}</span>
                </button>
              </div>
            </div>

            {/* OTP Input Form */}
            <form onSubmit={handleVerifyOtp} className="pt-4 border-t border-gray-200 space-y-3">
              <label className="block text-xs font-bold text-gray-800 flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-indigo-600" />
                <span>Enter 6-Digit OTP Code</span>
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter 6-digit OTP"
                  className="flex-1 bg-white border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl px-4 py-2.5 text-center text-base tracking-widest font-mono font-bold text-gray-900 outline-none"
                />
                <button
                  type="submit"
                  disabled={isVerifyingOtp || otpCode.length !== 6}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer min-h-[42px]"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isVerifyingOtp ? 'Verifying...' : 'Verify Email'}</span>
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
