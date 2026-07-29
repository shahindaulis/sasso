import React, { useState, useEffect, useRef } from 'react';
import { ClientApp, UserProfile } from '../types';
import { Shield, ShieldCheck, ArrowRight, AlertTriangle } from 'lucide-react';

interface OAuthConsentProps {
  centralToken: string;
  currentUser: UserProfile;
  oauthRequest: {
    clientId: string;
    redirectUri: string;
    state?: string;
    responseType?: string;
    accessType?: string;
  };
  appsList: ClientApp[];
  onApproveOAuth: (code: string) => void;
  onCancelOAuth: () => void;
}

export const OAuthConsent: React.FC<OAuthConsentProps> = ({
  centralToken,
  currentUser,
  oauthRequest,
  appsList,
  onApproveOAuth,
  onCancelOAuth,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedApp, setFetchedApp] = useState<ClientApp | null>(null);
  const hasAutoExecutedRef = useRef(false);

  const matchedApp = appsList.find((app) => app.id === oauthRequest.clientId);
  const targetApp = matchedApp || fetchedApp || {
    id: oauthRequest.clientId,
    name: 'External Application',
    description: 'Third-party client application',
    accentColor: '#4F46E5',
    url: oauthRequest.redirectUri,
    redirectUri: oauthRequest.redirectUri,
    clientSecret: '',
    isFirstParty: false,
  };

  // Fetch public info if targetApp was not in appsList
  useEffect(() => {
    if (!matchedApp && oauthRequest.clientId) {
      fetch(`/api/sso/apps/public-info?clientId=${oauthRequest.clientId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.id) {
            setFetchedApp(data);
          }
        })
        .catch(() => {});
    }
  }, [matchedApp, oauthRequest.clientId]);

  const handleAuthorize = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sso/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          centralToken,
          clientId: oauthRequest.clientId,
          redirectUri: oauthRequest.redirectUri,
          accessType: oauthRequest.accessType,
          access_type: oauthRequest.accessType,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.code) {
        throw new Error(data.error || 'Authorization failed');
      }
      onApproveOAuth(data.code);
    } catch (err: any) {
      setError(err.message || 'Authorization failed');
    } finally {
      setLoading(false);
    }
  };

  // Auto-approve if the application is marked as First-Party
  useEffect(() => {
    if (targetApp.isFirstParty && !hasAutoExecutedRef.current && !loading && !error) {
      hasAutoExecutedRef.current = true;
      handleAuthorize();
    }
  }, [targetApp.isFirstParty]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6 font-sans text-gray-900">
      <div className="w-full max-w-md bg-white rounded-3xl border border-gray-200/80 shadow-xl overflow-hidden p-6 sm:p-8 space-y-6 mx-auto">
        <div className="flex items-center justify-center gap-3">
          <div
            className="w-12 h-12 rounded-2xl text-white font-bold text-lg flex items-center justify-center shadow-sm shrink-0"
            style={{ backgroundColor: targetApp.accentColor || '#4F46E5' }}
          >
            {targetApp.name.substring(0, 2).toUpperCase()}
          </div>
          <ArrowRight className="w-4 h-4 text-gray-400 shrink-0" />
          <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center font-black text-sm shadow-sm shrink-0">
            sa
          </div>
        </div>

        <div className="text-center space-y-1">
          <h2 className="text-lg sm:text-xl font-extrabold text-gray-900 break-words">
            Authorize {targetApp.name}
          </h2>
          <p className="text-xs text-gray-500">
            wants access to your sasso account profile
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 border border-red-200 text-xs rounded-2xl p-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            <div className="break-words">{error}</div>
          </div>
        )}

        <div className="bg-slate-50 p-4 rounded-2xl border border-gray-200 space-y-3">
          <div className="flex items-center gap-3">
            <img
              src={currentUser.avatarUrl}
              alt="User"
              className="w-10 h-10 rounded-full border border-gray-200 object-cover shrink-0"
              referrerPolicy="no-referrer"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-gray-900 truncate">
                {currentUser.firstName} {currentUser.lastName}
              </div>
              <div className="text-[10px] text-gray-500 truncate">{currentUser.email}</div>
            </div>
          </div>

          <div className="pt-2 border-t border-gray-200/60 text-[11px] text-gray-600 space-y-1">
            <p className="font-bold text-gray-700">Permissions requested:</p>
            <ul className="list-disc list-inside text-gray-500 space-y-0.5">
              <li>Read your basic profile (Name, Email, Avatar)</li>
              <li>Verify your identity via OpenID Connect (OIDC)</li>
            </ul>
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleAuthorize}
            disabled={loading}
            className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-2xl text-xs sm:text-sm font-extrabold shadow-lg shadow-indigo-200/80 transition-all flex items-center justify-center gap-2.5 disabled:opacity-50 min-h-[48px] text-center"
          >
            {loading ? (
              <span className="inline-block animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full shrink-0" />
            ) : (
              <ShieldCheck className="w-4.5 h-4.5 shrink-0 text-white" />
            )}
            <span className="leading-snug break-words">
              {loading ? 'Authorizing...' : `Authorize & Continue to ${targetApp.name}`}
            </span>
          </button>

          <button
            onClick={onCancelOAuth}
            className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 rounded-2xl text-xs sm:text-sm font-bold transition-all min-h-[44px] text-center"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
