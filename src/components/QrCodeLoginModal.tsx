import React, { useState, useEffect } from 'react';
import {
  QrCode,
  Smartphone,
  X,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Laptop,
  ShieldCheck,
  ExternalLink,
  Copy,
  Check
} from 'lucide-react';
import { UserProfile } from '../types';

interface QrCodeLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess?: (user: UserProfile, token: string) => void;
}

export const QrCodeLoginModal: React.FC<QrCodeLoginModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess
}) => {
  const [qrSessionId, setQrSessionId] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'pending' | 'approved' | 'expired' | 'error'>('pending');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generateQrSession = async () => {
    setLoading(true);
    setErrorMsg(null);
    setStatus('pending');

    try {
      const res = await fetch('/api/auth/qr/generate', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate QR session');
      }

      setQrSessionId(data.qrSessionId);
      setQrUrl(data.qrUrl);
      setExpiresAt(data.expiresAt);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error generating QR Code');
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      generateQrSession();
    }
  }, [isOpen]);

  // Poll for QR status every 2s
  useEffect(() => {
    if (!isOpen || !qrSessionId || status === 'approved' || status === 'expired') {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/qr/status?qrSessionId=${encodeURIComponent(qrSessionId)}`);
        const data = await res.json();

        if (res.ok) {
          if (data.status === 'approved' && data.user && data.token) {
            setStatus('approved');
            clearInterval(interval);
            setTimeout(() => {
              if (onLoginSuccess) {
                onLoginSuccess(data.user, data.token);
              }
              onClose();
            }, 1200);
          } else if (data.status === 'expired') {
            setStatus('expired');
            clearInterval(interval);
          }
        }
      } catch (err) {
        console.error('QR status check error:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isOpen, qrSessionId, status]);

  const handleCopyUrl = () => {
    if (qrUrl) {
      navigator.clipboard.writeText(qrUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isOpen) return null;

  // Render SVG QR Code image using high quality QuickChart API
  const qrImageSrc = qrUrl
    ? `https://quickchart.io/qr?text=${encodeURIComponent(qrUrl)}&size=240&margin=2`
    : '';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 relative space-y-4 text-center">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="space-y-1 pt-2">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-2">
            <QrCode className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-extrabold text-gray-900">
            Sign In with QR Code
          </h3>
          <p className="text-xs text-gray-500 max-w-xs mx-auto">
            Log in without registering a passkey on this device. Scan with your phone or open on an authorized device.
          </p>
        </div>

        {/* QR Display Area */}
        <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200 min-h-[260px] flex flex-col items-center justify-center relative">
          {loading ? (
            <div className="space-y-2 text-xs font-semibold text-gray-500">
              <RefreshCw className="w-8 h-8 animate-spin text-indigo-600 mx-auto" />
              <p>Generating secure QR Code...</p>
            </div>
          ) : status === 'approved' ? (
            <div className="space-y-2 text-emerald-700">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto animate-bounce" />
              <p className="text-sm font-extrabold">Login Approved!</p>
              <p className="text-xs text-emerald-600">Redirecting to dashboard...</p>
            </div>
          ) : status === 'expired' ? (
            <div className="space-y-3 text-gray-600">
              <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
              <p className="text-xs font-bold text-gray-800">QR Code Expired</p>
              <button
                onClick={generateQrSession}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-xs hover:bg-indigo-700 cursor-pointer flex items-center gap-2 mx-auto"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Generate New QR Code
              </button>
            </div>
          ) : qrUrl ? (
            <div className="space-y-3 w-full">
              <div className="bg-white p-2 rounded-xl shadow-xs border border-gray-200 inline-block">
                <img
                  src={qrImageSrc}
                  alt="QR Login Code"
                  className="w-48 h-48 mx-auto object-contain rounded-lg"
                />
              </div>

              <div className="flex items-center justify-center gap-2 text-[11px] font-bold text-indigo-700 bg-indigo-50 py-1.5 px-3 rounded-xl border border-indigo-100">
                <Smartphone className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <span>Scan with logged-in mobile camera</span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Action Options */}
        {qrUrl && status === 'pending' && (
          <div className="space-y-2 pt-1">
            <button
              onClick={handleCopyUrl}
              className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-700">QR Link Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-gray-500" />
                  <span>Copy Login Link for Second Device</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* --- Mobile QR Approval Modal Component (Triggered when user scans QR and visits app) --- */
interface QrApprovalModalProps {
  qrSessionId: string;
  centralToken: string;
  currentUser: UserProfile;
  onApproved: () => void;
  onCancel: () => void;
}

export const QrApprovalModal: React.FC<QrApprovalModalProps> = ({
  qrSessionId,
  centralToken,
  currentUser,
  onApproved,
  onCancel
}) => {
  const [approving, setApproving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleApprove = async () => {
    setApproving(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/auth/qr/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${centralToken}`
        },
        body: JSON.stringify({ qrSessionId, token: centralToken })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to approve QR code login');
      }

      setSuccess(true);
      setTimeout(() => {
        onApproved();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message || 'Approval failed');
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 space-y-4 text-center">
        <div className="w-14 h-14 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto">
          <Laptop className="w-7 h-7" />
        </div>

        <div className="space-y-1">
          <h3 className="text-lg font-extrabold text-gray-900">
            Approve QR Code Login?
          </h3>
          <p className="text-xs text-gray-600">
            A laptop/second device is requesting to sign in to your account:
          </p>
          <p className="text-xs font-extrabold text-indigo-700 bg-indigo-50 py-1 px-3 rounded-lg inline-block mt-1">
            {currentUser.email}
          </p>
        </div>

        {errorMsg && (
          <div className="bg-red-50 text-red-800 text-xs p-3 rounded-xl border border-red-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {success ? (
          <div className="bg-emerald-50 text-emerald-800 p-4 rounded-2xl border border-emerald-200 space-y-1">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
            <p className="text-xs font-extrabold">Login Approved Successfully!</p>
            <p className="text-[11px] text-emerald-600">The computer is now signed in.</p>
          </div>
        ) : (
          <div className="space-y-2 pt-2">
            <button
              onClick={handleApprove}
              disabled={approving}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-extrabold shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {approving ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              <span>{approving ? 'Approving Login...' : 'Yes, Approve Access'}</span>
            </button>

            <button
              onClick={onCancel}
              disabled={approving}
              className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl text-xs font-bold transition-all cursor-pointer"
            >
              Deny / Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
