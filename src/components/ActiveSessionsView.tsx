import React, { useState, useEffect } from 'react';
import { UserProfile, UserActiveSession } from '../types';
import { ConfirmModal } from './ConfirmModal';
import {
  Laptop,
  Smartphone,
  QrCode,
  Trash2,
  RefreshCw,
  Globe,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Key,
  ShieldCheck,
  Compass,
  Monitor
} from 'lucide-react';

interface ActiveSessionsViewProps {
  currentUser: UserProfile;
  centralToken: string;
  onBack?: () => void;
}

export const ActiveSessionsView: React.FC<ActiveSessionsViewProps> = ({
  currentUser,
  centralToken,
  onBack
}) => {
  const [sessions, setSessions] = useState<UserActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Confirm Modal state
  const [pendingRevokeSession, setPendingRevokeSession] = useState<{ id: string; name: string } | null>(null);

  // Client-side current browser info
  const clientUa = typeof navigator !== 'undefined' ? navigator.userAgent : '';

  const parseUserAgent = (ua: string) => {
    if (!ua) return { browser: 'Web Browser', os: 'Device OS', summary: 'Standard Browser' };
    
    let browser = 'Web Browser';
    let os = 'Unknown OS';

    if (ua.includes('Edg/')) browser = 'Microsoft Edge';
    else if (ua.includes('Chrome/')) browser = 'Google Chrome';
    else if (ua.includes('Firefox/')) browser = 'Mozilla Firefox';
    else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Apple Safari';
    else if (ua.includes('Opera') || ua.includes('OPR/')) browser = 'Opera';

    if (ua.includes('Android')) os = 'Android OS';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS Device';
    else if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'macOS';
    else if (ua.includes('Windows')) os = 'Windows OS';
    else if (ua.includes('Linux')) os = 'Linux OS';

    return {
      browser,
      os,
      summary: `${browser} on ${os}`
    };
  };

  const currentUaInfo = parseUserAgent(clientUa);

  const fetchSessions = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/user/active-sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${centralToken}`
        },
        body: JSON.stringify({ token: centralToken })
      });
      const data = await res.json();
      if (res.ok && data.sessions) {
        setSessions(data.sessions);
      }
    } catch (err) {
      console.error('Failed to fetch active sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [centralToken]);

  const promptRevokeSession = (sessionId: string, deviceName: string) => {
    setPendingRevokeSession({ id: sessionId, name: deviceName });
  };

  const confirmRevokeSession = async () => {
    if (!pendingRevokeSession) return;
    const { id: sessionId, name: deviceName } = pendingRevokeSession;

    setRevokingId(sessionId);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/user/revoke-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${centralToken}`
        },
        body: JSON.stringify({ sessionId, token: centralToken })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to revoke session');
      }

      setSuccessMsg(`Session for "${deviceName}" revoked successfully.`);
      setSessions(prev => prev.filter(s => s.sessionId !== sessionId));
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to revoke session');
    } finally {
      setRevokingId(null);
      setPendingRevokeSession(null);
    }
  };

  const passkeySessions = sessions.filter(s => s.loginType === 'passkey');
  const qrSessions = sessions.filter(s => s.loginType === 'qr_code');

  return (
    <div className="space-y-5">
      {/* Requirement 9: Top Back Button with content directly BELOW it */}
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
              <QrCode className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600 shrink-0" />
              <span>Active Sessions & Device Security</span>
            </h3>
            <p className="text-[11px] sm:text-xs text-gray-500">
              Passkey sessions (direct biometric/key login) and QR sessions (laptop scans via mobile)
            </p>
          </div>

          <button
            onClick={fetchSessions}
            className="self-start sm:self-auto px-3 py-1.5 bg-gray-50 hover:bg-indigo-50 text-gray-700 hover:text-indigo-600 border border-gray-200 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
            title="Refresh Sessions"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

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

      {/* Short Explanatory Banner for User */}
      <div className="bg-indigo-50/70 border border-indigo-100 rounded-2xl p-3.5 text-xs text-indigo-950 space-y-1">
        <div className="font-extrabold flex items-center gap-1.5 text-indigo-900">
          <ShieldCheck className="w-4 h-4 text-indigo-600" />
          <span>Session Types Explained</span>
        </div>
        <p className="text-[11px] leading-relaxed text-indigo-800">
          • <strong>Passkey Authenticated Session:</strong> Direct login using biometric (Touch ID/Face ID) or hardware security key on this device.<br />
          • <strong>QR Code Session:</strong> Logged in on a second device (e.g. laptop) by scanning its QR code with your mobile phone.
        </p>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-xs text-gray-400 font-semibold">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-600" />
          Loading active device sessions...
        </div>
      ) : (
        <div className="space-y-6">
          {/* SECTION 1: Passkey Active Sessions */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-indigo-600" />
              <h4 className="text-xs font-extrabold text-gray-900 uppercase tracking-wider">
                Passkey Authenticated Sessions ({passkeySessions.length})
              </h4>
            </div>

            {passkeySessions.length === 0 ? (
              <div className="bg-gray-50/70 border border-dashed border-gray-200 rounded-2xl p-4 text-center text-xs text-gray-500">
                No extra passkey sessions recorded.
              </div>
            ) : (
              <div className="space-y-2.5">
                {passkeySessions.map((s, idx) => {
                  const uaParsed = parseUserAgent(s.userAgent);
                  const isCurrentSession = idx === 0 || (s.userAgent && clientUa && s.userAgent.includes(clientUa.substring(0, 30)));
                  return (
                    <div
                      key={s.sessionId}
                      className="bg-white p-3.5 sm:p-4 rounded-2xl border border-gray-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-gray-300 transition-all"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
                          {s.userAgent.toLowerCase().includes('mobile') || s.userAgent.toLowerCase().includes('android') ? (
                            <Smartphone className="w-4 h-4 sm:w-5 sm:h-5" />
                          ) : (
                            <Laptop className="w-4 h-4 sm:w-5 sm:h-5" />
                          )}
                        </div>

                        <div className="min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-xs text-gray-900 truncate">
                              {s.deviceName || 'Passkey Device'}
                            </span>
                            <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded-md border border-indigo-100">
                              Passkey Login
                            </span>
                            {isCurrentSession && (
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-black rounded-md border border-emerald-200">
                                Current Active Session
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] font-semibold text-gray-700">
                            {uaParsed.summary}
                          </div>

                          <div className="text-[10px] font-mono text-gray-500 bg-gray-50 p-1.5 rounded-lg border border-gray-200/60 break-all select-all">
                            User-Agent: {s.userAgent}
                          </div>

                          <div className="flex items-center gap-2 text-[10px] text-gray-500 flex-wrap pt-0.5">
                            <span className="flex items-center gap-1 font-mono text-gray-600">
                              <Globe className="w-3 h-3 text-gray-400" /> IP: {s.ip}
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-gray-400" /> Logged in: {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Cannot revoke current active session - no button rendered */}
                      {!isCurrentSession && (
                        <button
                          onClick={() => handleRevokeSession(s.sessionId, s.deviceName)}
                          disabled={revokingId === s.sessionId}
                          className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 shrink-0 self-end sm:self-auto min-h-[36px]"
                        >
                          {revokingId === s.sessionId ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-red-600" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                          <span>Revoke Session</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SECTION 2: QR Code Login Sessions */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2">
              <QrCode className="w-4 h-4 text-amber-600" />
              <h4 className="text-xs font-extrabold text-gray-900 uppercase tracking-wider">
                QR Code Scanned Logins ({qrSessions.length})
              </h4>
            </div>

            {qrSessions.length === 0 ? (
              <div className="bg-amber-50/40 border border-dashed border-amber-200/80 rounded-2xl p-4 text-center text-xs text-amber-900/70">
                No active QR code sessions.
              </div>
            ) : (
              <div className="space-y-2.5">
                {qrSessions.map((s) => {
                  const uaParsed = parseUserAgent(s.userAgent);
                  return (
                    <div
                      key={s.sessionId}
                      className="bg-white p-3.5 sm:p-4 rounded-2xl border border-amber-200/80 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-amber-300 transition-all"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
                          <QrCode className="w-4 h-4 sm:w-5 sm:h-5" />
                        </div>

                        <div className="min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-xs text-gray-900 truncate">
                              {s.deviceName || 'Laptop (QR Login)'}
                            </span>
                            <span className="px-2 py-0.5 bg-amber-50 text-amber-800 text-[10px] font-bold rounded-md border border-amber-200">
                              QR Scan Login
                            </span>
                          </div>

                          <div className="text-[11px] font-semibold text-gray-700">
                            {uaParsed.summary}
                          </div>

                          <div className="text-[10px] font-mono text-gray-500 bg-gray-50 p-1.5 rounded-lg border border-gray-200/60 break-all select-all">
                            User-Agent: {s.userAgent}
                          </div>

                          <div className="flex items-center gap-2 text-[10px] text-gray-500 flex-wrap pt-0.5">
                            <span className="flex items-center gap-1 font-mono text-gray-600">
                              <Globe className="w-3 h-3 text-gray-400" /> IP: {s.ip}
                            </span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-gray-400" /> Logged in: {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => promptRevokeSession(s.sessionId, s.deviceName)}
                        disabled={revokingId === s.sessionId}
                        className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 shrink-0 self-end sm:self-auto min-h-[36px]"
                      >
                        {revokingId === s.sessionId ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-red-600" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span>Revoke Session</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!pendingRevokeSession}
        title="Revoke Session"
        message={`Are you sure you want to revoke session for "${pendingRevokeSession?.name}"? This device will be logged out immediately.`}
        confirmLabel="Revoke Session"
        cancelLabel="Keep Session"
        variant="danger"
        isLoading={!!revokingId}
        onConfirm={confirmRevokeSession}
        onCancel={() => setPendingRevokeSession(null)}
      />
    </div>
  );
};
