import React from 'react';
import { AlertTriangle, ShieldCheck, Fingerprint, X, Loader2 } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
  enableBiometricOption?: boolean;
  onConfirm: (useBiometric?: boolean) => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false,
  enableBiometricOption = false,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  const variantStyles = {
    danger: {
      bgIcon: 'bg-rose-100 text-rose-600',
      btn: 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200',
      border: 'border-rose-100'
    },
    warning: {
      bgIcon: 'bg-amber-100 text-amber-600',
      btn: 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-200',
      border: 'border-amber-100'
    },
    info: {
      bgIcon: 'bg-indigo-100 text-indigo-600',
      btn: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200',
      border: 'border-indigo-100'
    }
  }[variant];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className={`bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border ${variantStyles.border} transform transition-all`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-xl ${variantStyles.bgIcon}`}>
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">{title}</h3>
              <p className="text-xs font-medium text-slate-500">Security Confirmation Required</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="mt-4 text-sm text-slate-600 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-100">
          {message}
        </p>

        {enableBiometricOption && (
          <div className="mt-4 p-3 bg-indigo-50/80 border border-indigo-100 rounded-xl flex items-center justify-between text-xs text-indigo-900">
            <div className="flex items-center gap-2">
              <Fingerprint className="w-4 h-4 text-indigo-600" />
              <span>Biometric Passkey available</span>
            </div>
            <span className="font-semibold text-indigo-700 bg-white px-2 py-0.5 rounded-md border border-indigo-200">
              WebAuthn Protected
            </span>
          </div>
        )}

        <div className="mt-6 flex flex-col sm:flex-row items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="w-full sm:w-auto px-4 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>

          {enableBiometricOption && (
            <button
              type="button"
              onClick={() => onConfirm(true)}
              disabled={isLoading}
              className="w-full sm:w-auto px-4 py-2.5 text-sm font-semibold text-indigo-700 bg-indigo-100 hover:bg-indigo-200 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-xs disabled:opacity-50"
            >
              <Fingerprint className="w-4 h-4" />
              Verify Biometric
            </button>
          )}

          <button
            type="button"
            onClick={() => onConfirm(false)}
            disabled={isLoading}
            className={`w-full sm:w-auto px-5 py-2.5 text-sm font-semibold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 ${variantStyles.btn} disabled:opacity-50`}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
