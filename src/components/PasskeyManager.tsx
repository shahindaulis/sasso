import React, { useState, useEffect } from 'react';
import { UserProfile, RegisteredPasskey } from '../types';
import {
  KeyRound,
  Fingerprint,
  Usb,
  Wifi,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Smartphone,
  Laptop,
  HardDrive,
  ArrowLeft
} from 'lucide-react';
import { startRegistration, WebAuthnAbortService } from '@simplewebauthn/browser';

interface PasskeyManagerProps {
  currentUser: UserProfile;
  centralToken: string;
  onBack?: () => void;
}

export const PasskeyManager: React.FC<PasskeyManagerProps> = ({
  currentUser,
  centralToken,
  onBack
}) => {
  const [passkeys, setPasskeys] = useState<RegisteredPasskey[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [newDeviceName, setNewDeviceName] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchPasskeys = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/user/passkeys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${centralToken}`
        },
        body: JSON.stringify({ token: centralToken })
      });
      const data = await res.json();
      if (res.ok && data.passkeys) {
        setPasskeys(data.passkeys);
      }
    } catch (err) {
      console.error('Failed to fetch passkeys:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPasskeys();
  }, [centralToken]);

  const handleRegisterNewPasskey = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegistering(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      try {
        WebAuthnAbortService.cancelCeremony();
      } catch (err) {}
      await new Promise(resolve => setTimeout(resolve, 300));

      // 1. Fetch options
      const optRes = await fetch('/api/sso/register/options', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${centralToken}`
        },
        credentials: 'include',
        body: JSON.stringify({
          username: currentUser.username,
          token: centralToken
        }),
      });

      const options = await optRes.json();
      if (!optRes.ok) {
        throw new Error(options.error || 'Failed to initialize Passkey options');
      }

      // 2. Start browser WebAuthn prompt (supports YubiKey, Touch ID, Face ID, USB/NFC)
      let regResp;
      try {
        regResp = await startRegistration(options);
      } catch (webauthnErr: any) {
        const errMsg = webauthnErr?.message?.toLowerCase() || '';
        if (webauthnErr?.name === 'NotAllowedError' || errMsg.includes('cancel')) {
          throw new Error('Passkey registration was cancelled or timed out.');
        }
        throw webauthnErr;
      }

      // 3. Verify on server with custom device name
      const customName = newDeviceName.trim() || 'Passkey Device';
      const isYubiKey = options.authenticatorSelection?.authenticatorAttachment === 'cross-platform' ||
        regResp.response.transports?.includes('usb') ||
        regResp.response.transports?.includes('nfc');

      const verifyRes = await fetch('/api/sso/register/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${centralToken}`
        },
        credentials: 'include',
        body: JSON.stringify({
          username: currentUser.username,
          token: centralToken,
          registrationResponse: regResp,
          challenge: options.challenge,
          deviceName: customName,
          authenticatorType: isYubiKey ? 'Security Key (YubiKey)' : 'Platform Passkey'
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'Failed to verify new Passkey');
      }

      setSuccessMsg(`Registered passkey "${customName}" successfully!`);
      setNewDeviceName('');
      setShowAddForm(false);
      fetchPasskeys();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to register Passkey');
    } finally {
      setRegistering(false);
    }
  };

  const handleDeletePasskey = async (credentialID: string, deviceName: string) => {
    if (!window.confirm(`Are you sure you want to delete passkey "${deviceName}"?`)) {
      return;
    }

    setDeletingId(credentialID);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/user/passkeys/${encodeURIComponent(credentialID)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${centralToken}`
        }
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete passkey');
      }

      setSuccessMsg(`Passkey "${deviceName}" was deleted.`);
      setPasskeys(prev => prev.filter(p => p.credentialID !== credentialID));
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to delete passkey');
    } finally {
      setDeletingId(null);
    }
  };

  const getPasskeyIcon = (passkey: RegisteredPasskey) => {
    const name = passkey.deviceName.toLowerCase();
    const type = passkey.authenticatorType.toLowerCase();
    if (name.includes('yubikey') || type.includes('security key') || passkey.transports.includes('usb')) {
      return <HardDrive className="w-5 h-5 text-amber-600" />;
    }
    if (name.includes('phone') || name.includes('android') || name.includes('iphone')) {
      return <Smartphone className="w-5 h-5 text-indigo-600" />;
    }
    return <Laptop className="w-5 h-5 text-indigo-600" />;
  };

  return (
    <div className="space-y-4">
      {/* Header - Requirement 9: Back button on top, content directly below */}
      <div className="space-y-3 border-b border-gray-100 pb-3">
        {onBack && (
          <div>
            <button
              onClick={onBack}
              className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-700 transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-bold shrink-0 border border-gray-200/80"
              title="Go Back"
            >
              <ArrowLeft className="w-4 h-4 text-indigo-600" />
              <span>Back</span>
            </button>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm sm:text-base font-extrabold text-gray-900 flex items-center gap-2">
              <Fingerprint className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600 shrink-0" />
              <span>Registered Passkeys & Security Keys</span>
            </h3>
            <p className="text-[11px] sm:text-xs text-gray-500">
              Passkeys registered to your account for fast, passwordless login
            </p>
          </div>

          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="self-start sm:self-auto px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Passkey / YubiKey</span>
          </button>
        </div>
      </div>

      {/* Global Toast Feedback */}
      {errorMsg && (
        <div className="bg-red-50 text-red-800 border border-red-200 text-xs rounded-xl p-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs rounded-xl p-3 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Form: Register New Passkey or Security Key */}
      {showAddForm && (
        <form onSubmit={handleRegisterNewPasskey} className="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-4 space-y-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
              <KeyRound className="w-4 h-4 text-indigo-600" />
              Register New Passkey or Hardware Key
            </span>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-xs text-indigo-600 hover:underline font-semibold cursor-pointer"
            >
              Cancel
            </button>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold text-gray-700 block">
              Device Name / Label <span className="text-gray-400 font-normal">(e.g. Work YubiKey 5C, Macbook Touch ID)</span>
            </label>
            <input
              type="text"
              value={newDeviceName}
              onChange={(e) => setNewDeviceName(e.target.value)}
              placeholder="e.g. YubiKey 5C NFC or Personal iPhone"
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={registering}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {registering ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Fingerprint className="w-4 h-4" />
              )}
              <span>{registering ? 'Prompting Device...' : 'Start Device Registration'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Passkeys List */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center text-xs text-gray-400 font-semibold">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-600" />
          Loading passkeys...
        </div>
      ) : passkeys.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center space-y-2">
          <Fingerprint className="w-8 h-8 text-gray-300 mx-auto" />
          <p className="text-xs font-bold text-gray-700">No Passkeys Registered Yet</p>
          <p className="text-[11px] text-gray-500 max-w-xs mx-auto">
            Click "Add Passkey / YubiKey" above to register a biometric or hardware security key for instant login.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {passkeys.map((pk) => (
            <div
              key={pk.credentialID}
              className="bg-white p-3.5 rounded-2xl border border-gray-200 shadow-2xs flex items-center justify-between gap-3 hover:border-gray-300 transition-all"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center shrink-0">
                  {getPasskeyIcon(pk)}
                </div>

                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold text-xs text-gray-900 truncate">
                      {pk.deviceName || 'Passkey Device'}
                    </span>
                    <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded-md border border-indigo-100">
                      {pk.authenticatorType || 'Passkey'}
                    </span>
                  </div>

                  {/* Transports & Metadata */}
                  <div className="flex items-center gap-2 text-[10px] text-gray-500 flex-wrap">
                    <span className="font-mono text-gray-400 truncate max-w-[120px]" title={pk.credentialID}>
                      ID: {pk.credentialID.substring(0, 10)}...
                    </span>
                    <span>•</span>
                    <span>Created: {new Date(pk.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  </div>

                  {/* Badges for USB / NFC / Biometric */}
                  <div className="flex items-center gap-1 pt-1 flex-wrap">
                    {pk.transports.includes('usb') && (
                      <span className="px-1.5 py-0.5 bg-amber-50 text-amber-800 text-[9px] font-bold rounded border border-amber-200 inline-flex items-center gap-1">
                        <Usb className="w-2.5 h-2.5 text-amber-600" /> USB Key
                      </span>
                    )}
                    {pk.transports.includes('nfc') && (
                      <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-800 text-[9px] font-bold rounded border border-emerald-200 inline-flex items-center gap-1">
                        <Wifi className="w-2.5 h-2.5 text-emerald-600" /> NFC Key
                      </span>
                    )}
                    {pk.transports.includes('internal') && (
                      <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-800 text-[9px] font-bold rounded border border-indigo-200 inline-flex items-center gap-1">
                        <ShieldCheck className="w-2.5 h-2.5 text-indigo-600" /> Biometric Touch/Face
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Revoke / Delete Button - Cannot delete if only 1 passkey exists */}
              {passkeys.length > 1 && (
                <button
                  onClick={() => handleDeletePasskey(pk.credentialID, pk.deviceName)}
                  disabled={deletingId === pk.credentialID}
                  className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-xl transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                  title="Delete/Revoke Passkey"
                >
                  {deletingId === pk.credentialID ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-red-600" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
