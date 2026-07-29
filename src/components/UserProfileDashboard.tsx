import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { UserProfile, ClientApp } from '../types';
import {
  User,
  Mail,
  LogOut,
  Terminal,
  Trash2,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Lock,
  AppWindow,
  X,
  Send,
  BadgeCheck,
  ShieldAlert,
  ChevronRight,
  ShieldCheck,
  Menu,
  HelpCircle,
  Calendar,
  Key
} from 'lucide-react';
import { EmailVerificationView } from './EmailVerificationView';
import { PasskeyManager } from './PasskeyManager';
import { ActiveSessionsView } from './ActiveSessionsView';
import { RecoveryCodeManager } from './RecoveryCodeManager';
import { ConfirmModal } from './ConfirmModal';
import {
  Fingerprint,
  QrCode,
  KeyRound
} from 'lucide-react';

interface UserProfileDashboardProps {
  currentUser: UserProfile;
  centralToken: string;
  onLogout: () => void;
}

// In-memory cache for authorized apps so navigating back in browser never reloads/flashes connected apps
let cachedApps: ClientApp[] | null = null;

export const UserProfileDashboard: React.FC<UserProfileDashboardProps> = ({
  currentUser,
  centralToken,
  onLogout,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedTab, setSelectedTab] = useState<'connected-apps' | 'email-settings' | 'passkeys' | 'active-sessions' | 'recovery-code'>(
    location.pathname.includes('/email') ? 'email-settings' : 'connected-apps'
  );

  const activeView = selectedTab;

  const setActiveView = (tab: 'connected-apps' | 'email-settings' | 'passkeys' | 'active-sessions' | 'recovery-code') => {
    setSelectedTab(tab);
    if (tab === 'email-settings') {
      if (!location.pathname.includes('/email')) {
        navigate('/profile/email');
      }
    } else {
      if (location.pathname.includes('/email')) {
        navigate('/profile');
      }
    }
  };

  const [authorizedApps, setAuthorizedApps] = useState<ClientApp[]>(cachedApps || []);
  const [loadingApps, setLoadingApps] = useState(!cachedApps);
  const [appsLoaded, setAppsLoaded] = useState(!!cachedApps);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Confirmation Modals State
  const [pendingRevokeApp, setPendingRevokeApp] = useState<{ id: string; name: string } | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Sidebar Drawer state
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState<boolean>(!!currentUser.isEmailVerified);

  // Prevent background page body scrolling when sidebar drawer modal is open
  useEffect(() => {
    if (isSidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isSidebarOpen]);

  // Clean username calculation without 'SSO' or 'sasso' additions or suffixes anywhere
  const cleanString = (str: string) =>
    str
      .replace(/sso/gi, '')
      .replace(/sasso/gi, '')
      .replace(/[._\-\s]+/g, ' ')
      .trim();

  const rawFirstName = cleanString(currentUser.firstName || '');
  const rawLastName = cleanString(currentUser.lastName || '');
  const rawDisplayName = [rawFirstName, rawLastName].filter(Boolean).join(' ');

  const username =
    cleanString(currentUser.username || '') ||
    rawDisplayName ||
    (currentUser.email ? cleanString(currentUser.email.split('@')[0]) : 'User') ||
    'User';

  // Load authorized apps (uses cached data if available)
  const fetchAuthorizedApps = async (forceRefresh = false) => {
    if (cachedApps && !forceRefresh) {
      setAuthorizedApps(cachedApps);
      setAppsLoaded(true);
      setLoadingApps(false);
      return;
    }

    setLoadingApps(true);

    try {
      const res = await fetch('/api/user/authorized-apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: centralToken }),
      });
      const data = await res.json();
      if (res.ok && data.apps) {
        cachedApps = data.apps;
        setAuthorizedApps(data.apps);
        setAppsLoaded(true);
      }
    } catch (err) {
      console.error('Failed to load user authorized apps:', err);
    } finally {
      setLoadingApps(false);
    }
  };

  useEffect(() => {
    fetchAuthorizedApps();
  }, [centralToken]);

  const promptRevokeApp = (appId: string, appName: string) => {
    setPendingRevokeApp({ id: appId, name: appName });
  };

  const confirmRevokeApp = async () => {
    if (!pendingRevokeApp) return;
    const { id: appId, name: appName } = pendingRevokeApp;

    setRevokingId(appId);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/user/revoke-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: centralToken, clientId: appId }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to revoke app authorization');
      }

      const updatedApps = data.apps || [];
      cachedApps = updatedApps;
      setAuthorizedApps(updatedApps);
      setSuccessMsg(`Revoked access for "${appName}".`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Revoke failed');
    } finally {
      setRevokingId(null);
      setPendingRevokeApp(null);
    }
  };

  const handleUserUpdated = (updatedUser: Partial<UserProfile>) => {
    if (updatedUser.email) currentUser.email = updatedUser.email;
    if (updatedUser.isEmailVerified !== undefined) {
      currentUser.isEmailVerified = updatedUser.isEmailVerified;
      setIsEmailVerified(updatedUser.isEmailVerified);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-gray-900 antialiased pb-16">
      {/* Responsive Navigation Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 px-4 sm:px-6 py-3 flex items-center justify-between shadow-xs">
        {/* Logo & Brand Name */}
        <div
          onClick={() => setActiveView('connected-apps')}
          className="flex items-center gap-2.5 cursor-pointer select-none"
        >
          <div className="w-8 h-8 sm:w-9 sm:h-9 bg-indigo-600 text-white rounded-xl font-black text-sm shadow-sm flex items-center justify-center shrink-0">
            sa
          </div>
          <h1 className="text-base sm:text-lg font-black tracking-tight text-gray-900">
            sasso
          </h1>
        </div>

        {/* Profile Avatar Icon (Triggers Full-Screen Sidebar Drawer) */}
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="relative group p-0.5 rounded-full ring-2 ring-indigo-500/20 hover:ring-indigo-600 transition-all cursor-pointer focus:outline-none shrink-0"
          title="Open Profile Drawer"
        >
          <img
            src={currentUser.avatarUrl}
            alt="User Avatar"
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
          {!isEmailVerified && (
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-amber-500 border-2 border-white rounded-full animate-ping" />
          )}
        </button>
      </header>

      {/* Main Content Area */}
      <main className="max-w-4xl mx-auto p-4 sm:p-6 md:p-8 space-y-6">
        
        {/* Global Toast Messages */}
        {successMsg && (
          <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs sm:text-sm rounded-2xl p-3.5 flex items-center gap-2.5 shadow-sm animate-fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <div className="font-semibold break-words">{successMsg}</div>
          </div>
        )}

        {errorMsg && (
          <div className="bg-red-50 text-red-800 border border-red-200 text-xs sm:text-sm rounded-2xl p-3.5 flex items-center gap-2.5 shadow-sm animate-fade-in">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <div className="font-semibold break-words">{errorMsg}</div>
          </div>
        )}

        {/* VIEW 1: Email Settings Component */}
        {activeView === 'email-settings' ? (
          <EmailVerificationView
            currentUser={currentUser}
            centralToken={centralToken}
            onBack={() => setActiveView('connected-apps')}
            onUserUpdated={handleUserUpdated}
          />
        ) : activeView === 'passkeys' ? (
          /* VIEW 2: Registered Passkeys & YubiKeys Manager */
          <div className="bg-white p-3.5 sm:p-6 rounded-3xl border border-gray-200 shadow-xs">
            <PasskeyManager
              currentUser={currentUser}
              centralToken={centralToken}
              onBack={() => setActiveView('connected-apps')}
            />
          </div>
        ) : activeView === 'active-sessions' ? (
          /* VIEW 3: Active Sessions & QR Code Logins */
          <div className="bg-white p-3.5 sm:p-6 rounded-3xl border border-gray-200 shadow-xs">
            <ActiveSessionsView
              currentUser={currentUser}
              centralToken={centralToken}
              onBack={() => setActiveView('connected-apps')}
            />
          </div>
        ) : activeView === 'recovery-code' ? (
          /* VIEW 4: Dedicated Recovery Code Manager Component */
          <div className="bg-white p-3.5 sm:p-6 rounded-3xl border border-gray-200 shadow-xs">
            <RecoveryCodeManager
              currentUser={currentUser}
              centralToken={centralToken}
              onBack={() => setActiveView('connected-apps')}
            />
          </div>
        ) : (
          /* VIEW 5: Connected Applications Main Dashboard */
          <div className="space-y-6">
            {/* Unverified Account Warning Banner - ONLY displayed on Connected Apps */}
            {!isEmailVerified && (
              <div className="bg-amber-50 text-amber-900 border border-amber-200 text-xs sm:text-sm rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-start sm:items-center gap-3">
                  <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
                  <div>
                    <span className="font-bold">Email Unverified:</span> Please verify your email address. Unverified accounts will be automatically deleted in{' '}
                    <span className="font-extrabold underline decoration-amber-400">
                      {currentUser.verificationDeadline
                        ? `${Math.max(1, Math.ceil((new Date(currentUser.verificationDeadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))} days`
                        : '7 days'}
                    </span>.
                  </div>
                </div>
                <button
                  onClick={() => setActiveView('email-settings')}
                  className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl transition-all shrink-0 self-start sm:self-auto cursor-pointer shadow-xs"
                >
                  Verify Now
                </button>
              </div>
            )}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg sm:text-xl font-black text-gray-900 flex items-center gap-2.5">
                  <AppWindow className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600 shrink-0" />
                  <span>Connected Applications</span>
                </h2>
                <p className="text-xs sm:text-sm text-gray-500 mt-1">
                  Websites and applications where you have signed in using your sasso account
                </p>
              </div>

              <button
                onClick={() => fetchAuthorizedApps(true)}
                className="p-2 text-gray-500 hover:text-gray-800 bg-white border border-gray-200 rounded-xl transition-colors self-start sm:self-auto shrink-0 shadow-xs cursor-pointer flex items-center gap-1.5 text-xs font-bold"
                title="Refresh Connected Apps"
              >
                <RefreshCw className={`w-4 h-4 ${loadingApps ? 'animate-spin text-indigo-600' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>

            {loadingApps && !appsLoaded ? (
              <div className="bg-white rounded-3xl border border-gray-200/80 p-10 text-center text-gray-400 text-xs font-semibold">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-indigo-600" />
                Loading connected applications...
              </div>
            ) : authorizedApps.length === 0 ? (
              <div className="bg-white rounded-3xl border border-gray-200 p-8 sm:p-12 text-center space-y-4 shadow-xs">
                <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto shrink-0">
                  <Lock className="w-7 h-7" />
                </div>
                <div className="space-y-1.5 max-w-md mx-auto">
                  <h3 className="text-base font-extrabold text-gray-900">No Connected Applications</h3>
                  <p className="text-xs sm:text-sm text-gray-500 leading-relaxed">
                    When you use "Sign in with sasso" on third-party websites or applications, they will appear here so you can view or manage access permissions.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {authorizedApps.map((app) => (
                  <div
                    key={app.id}
                    className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex flex-col justify-between space-y-4 hover:shadow-md transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="w-10 h-10 rounded-xl text-white font-bold text-sm flex items-center justify-center shrink-0 shadow-xs"
                          style={{ backgroundColor: app.accentColor || '#4F46E5' }}
                        >
                          {app.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-extrabold text-gray-900 text-sm truncate">{app.name}</h4>
                          <p className="text-xs text-gray-500 line-clamp-2 break-words mt-0.5">{app.description}</p>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-gray-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                      <span className="text-[10px] text-gray-400 font-mono truncate max-w-[180px]">ID: {app.id}</span>
                      <button
                        onClick={() => promptRevokeApp(app.id, app.name)}
                        disabled={revokingId === app.id}
                        className="px-3.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-extrabold transition-colors flex items-center gap-1.5 border border-red-100 disabled:opacity-50 shrink-0 w-full sm:w-auto justify-center cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        <span>{revokingId === app.id ? 'Revoking...' : 'Remove Access'}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* FULL-SCREEN SLIDE-OVER SIDEBAR DRAWER */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-50 flex justify-end overflow-hidden animate-fade-in">
          {/* Overlay Backdrop */}
          <div
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
          />

          {/* Sidebar Drawer Panel - Uses exact dynamic viewport height (100dvh) */}
          <div className="relative w-full max-w-sm bg-white h-[100dvh] max-h-[100dvh] shadow-2xl flex flex-col z-10 overflow-hidden">
            {/* Drawer Top Header (Fixed at top) */}
            <div className="p-4 sm:p-5 flex items-center justify-between border-b border-gray-100 bg-white shrink-0 z-10">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-indigo-600 text-white rounded-lg font-black text-xs flex items-center justify-center">
                  sa
                </div>
                <span className="font-extrabold text-gray-900 text-sm">sasso</span>
              </div>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Middle Body (min-h-0 enables scroll in flex column) */}
            <div className="p-4 sm:p-6 space-y-5 overflow-y-auto flex-1 min-h-0 overscroll-contain">
              {/* User Avatar & Username & User ID Status Card */}
              <div className="bg-slate-50 border border-gray-200 rounded-2xl p-4 text-center space-y-3">
                <img
                  src={currentUser.avatarUrl}
                  alt="User Avatar"
                  className="w-16 h-16 rounded-full object-cover border-2 border-indigo-100 mx-auto shadow-xs"
                  referrerPolicy="no-referrer"
                />
                <div className="space-y-1.5">
                  {/* Username Display */}
                  <div className="font-black text-gray-900 text-lg tracking-tight">
                    {username}
                  </div>
                  {/* User ID Display */}
                  <div>
                    <span className="text-[11px] font-bold text-indigo-700 bg-indigo-100/80 border border-indigo-200 rounded-lg px-2.5 py-1 inline-block font-mono max-w-full break-all">
                      User ID: {currentUser.uid || 'user'}
                    </span>
                  </div>
                  {/* Email Display */}
                  <div className="text-xs text-gray-500 font-medium break-all px-2 pt-1">
                    {currentUser.email || 'No email address linked'}
                  </div>
                  {/* Account Creation Date */}
                  <div className="text-[11px] text-gray-500 font-semibold flex items-center justify-center gap-1.5 pt-1">
                    <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span>Created: {currentUser.createdAt ? new Date(currentUser.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Recently'}</span>
                  </div>
                </div>

                <div className="pt-2 flex justify-center">
                  {isEmailVerified ? (
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-black rounded-full flex items-center gap-1.5 border border-emerald-200">
                      <BadgeCheck className="w-4 h-4 text-emerald-600" />
                      Email Verified
                    </span>
                  ) : (
                    <span className="px-3 py-1 bg-amber-100 text-amber-800 text-xs font-black rounded-full flex items-center gap-1.5 border border-amber-200 animate-pulse">
                      <ShieldAlert className="w-4 h-4 text-amber-600" />
                      Email Unverified
                    </span>
                  )}
                </div>
              </div>

              {/* Drawer Navigation Links */}
              <div className="space-y-2 pt-1">
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider px-2">Navigation</div>

                <button
                  onClick={() => {
                    setActiveView('connected-apps');
                    setIsSidebarOpen(false);
                  }}
                  className={`w-full p-3 rounded-xl text-xs font-bold flex items-center justify-between transition-all cursor-pointer ${
                    activeView === 'connected-apps'
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <AppWindow className="w-4 h-4 text-indigo-600" />
                    <span>Connected Applications</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>

                <button
                  onClick={() => {
                    setActiveView('passkeys');
                    setIsSidebarOpen(false);
                  }}
                  className={`w-full p-3 rounded-xl text-xs font-bold flex items-center justify-between transition-all cursor-pointer ${
                    activeView === 'passkeys'
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Fingerprint className="w-4 h-4 text-indigo-600" />
                    <span>Passkeys & YubiKeys</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>

                <button
                  onClick={() => {
                    setActiveView('active-sessions');
                    setIsSidebarOpen(false);
                  }}
                  className={`w-full p-3 rounded-xl text-xs font-bold flex items-center justify-between transition-all cursor-pointer ${
                    activeView === 'active-sessions'
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <QrCode className="w-4 h-4 text-indigo-600" />
                    <span>Active Sessions & QR Logins</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>

                <button
                  onClick={() => {
                    setActiveView('recovery-code');
                    setIsSidebarOpen(false);
                  }}
                  className={`w-full p-3 rounded-xl text-xs font-bold flex items-center justify-between transition-all cursor-pointer ${
                    activeView === 'recovery-code'
                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <KeyRound className="w-4 h-4 text-amber-600" />
                    <span>Master Recovery Code</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>

                <button
                  onClick={() => {
                    setActiveView('email-settings');
                    setIsSidebarOpen(false);
                  }}
                  className={`w-full p-3 rounded-xl text-xs font-bold flex items-center justify-between transition-all cursor-pointer ${
                    activeView === 'email-settings'
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-indigo-600" />
                    <span>Verify / Change Email</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>

                <button
                  onClick={() => {
                    navigate('/developer');
                    setIsSidebarOpen(false);
                  }}
                  className="w-full p-3 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-100 flex items-center justify-between transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Terminal className="w-4 h-4 text-indigo-600" />
                    <span>Developer Console</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>

            {/* Drawer Bottom Action: Logout (Always pinned at bottom visible screen) */}
            <div className="p-4 sm:p-5 border-t border-gray-100 bg-slate-50 shrink-0 z-10">
              <button
                onClick={() => {
                  setIsSidebarOpen(false);
                  setShowLogoutConfirm(true);
                }}
                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-extrabold rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Revoke App Modal */}
      <ConfirmModal
        isOpen={!!pendingRevokeApp}
        title="Revoke Connected Application"
        message={`Are you sure you want to revoke access for "${pendingRevokeApp?.name}"? It will no longer be able to authenticate with your sasso account.`}
        confirmLabel="Revoke Access"
        cancelLabel="Keep Access"
        variant="danger"
        isLoading={!!revokingId}
        onConfirm={confirmRevokeApp}
        onCancel={() => setPendingRevokeApp(null)}
      />

      {/* Confirm Logout Modal */}
      <ConfirmModal
        isOpen={showLogoutConfirm}
        title="Sign Out Confirmation"
        message="Are you sure you want to sign out of your sasso central SSO session?"
        confirmLabel="Sign Out"
        cancelLabel="Cancel"
        variant="warning"
        onConfirm={() => {
          setShowLogoutConfirm(false);
          onLogout();
        }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </div>
  );
};
