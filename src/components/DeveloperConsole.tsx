import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClientApp } from '../types';
import { 
  Shield, 
  Globe, 
  Key, 
  Copy, 
  Plus, 
  Trash2, 
  Terminal, 
  Info, 
  BookOpen, 
  Sparkles, 
  Check, 
  Lock, 
  Eye, 
  EyeOff,
  Code,
  ArrowRight,
  Server,
  User,
  ArrowLeft
} from 'lucide-react';

interface DeveloperConsoleProps {
  appsList: ClientApp[];
  onRefreshApps: () => void;
  currentUser: any;
  centralToken: string;
}

export function DeveloperConsole({ appsList, onRefreshApps, currentUser, centralToken }: DeveloperConsoleProps) {
  const navigate = useNavigate();
  const [activeSubTab, setActiveSubTab] = useState<'list' | 'register' | 'docs' | 'simulator'>('list');
  
  // Registration Form State
  const [appName, setAppName] = useState('');
  const [appDescription, setAppDescription] = useState('');
  const [appUrl, setAppUrl] = useState('');
  const [appRedirectUri, setAppRedirectUri] = useState('');
  const [appAccent, setAppAccent] = useState('#4F46E5');
  const [appIsFirstParty, setAppIsFirstParty] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [registeredCreds, setRegisteredCreds] = useState<{ clientId: string; clientSecret: string } | null>(null);

  // UI States
  const [showSecretMap, setShowSecretMap] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // OIDC Simulator State
  const [selectedSimAppId, setSelectedSimAppId] = useState(appsList[0]?.id || '');
  const [simStep, setSimStep] = useState<1 | 2 | 3>(1);
  const [simAuthCode, setSimAuthCode] = useState('');
  const [simTokenResponse, setSimTokenResponse] = useState<any>(null);
  const [simIsLoading, setSimIsLoading] = useState(false);
  const [simLog, setSimLog] = useState<string[]>([]);

  // Clipboard copy helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleSecret = (appId: string) => {
    setShowSecretMap(prev => ({ ...prev, [appId]: !prev[appId] }));
  };

  // Submit registration to real API
  const handleRegisterApp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setRegisteredCreds(null);

    if (!appName || !appUrl || !appRedirectUri) {
      setErrorMsg('Please fill in all required fields (Application Name, Homepage URL, Redirect URI).');
      return;
    }

    try {
      const res = await fetch('/api/sso/apps/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${centralToken}`
        },
        body: JSON.stringify({
          token: centralToken,
          name: appName,
          description: appDescription,
          url: appUrl,
          redirectUri: appRedirectUri,
          accentColor: appAccent,
          isFirstParty: appIsFirstParty,
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to register client application.');
      }

      setSuccessMsg(`"${data.app.name}" registered successfully as a secure OIDC client!`);
      setRegisteredCreds({
        clientId: data.app.id,
        clientSecret: data.app.clientSecret
      });
      
      // Reset form
      setAppName('');
      setAppDescription('');
      setAppUrl('');
      setAppRedirectUri('');
      setAppIsFirstParty(false);
      
      // Refresh list
      onRefreshApps();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  // Delete App from real API
  const handleDeleteApp = async (appId: string) => {
    if (!window.confirm('Are you sure you want to permanently delete this client application? Dynamic apps will be un-registered.')) {
      return;
    }

    try {
      const res = await fetch('/api/sso/apps/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${centralToken}`
        },
        body: JSON.stringify({ token: centralToken, id: appId })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete app.');
      }

      onRefreshApps();
      if (selectedSimAppId === appId) {
        setSelectedSimAppId(appsList[0]?.id || '');
        resetSimulator();
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // OIDC Simulator functions
  const resetSimulator = () => {
    setSimStep(1);
    setSimAuthCode('');
    setSimTokenResponse(null);
    setSimLog([]);
  };

  const addSimLog = (msg: string) => {
    setSimLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const handleSimStep1Authorize = async () => {
    setSimIsLoading(true);
    resetSimulator();
    
    const targetApp = appsList.find(app => app.id === selectedSimAppId);
    if (!targetApp) {
      addSimLog('Error: Selected application not found.');
      setSimIsLoading(false);
      return;
    }

    addSimLog(`Initiating OpenID Connect / OAuth 2.0 Authorization request for "${targetApp.name}"...`);
    addSimLog(`Client ID: ${targetApp.id}`);
    addSimLog(`Redirect URI: ${targetApp.redirectUri}`);
    addSimLog(`Requesting Scope: openid profile email`);

    // Retrieve central token from localStorage
    const centralToken = localStorage.getItem('sasso_central_token');
    if (!centralToken) {
      addSimLog('Error: User is not signed in with a central session! Please log in first.');
      setSimIsLoading(false);
      return;
    }

    try {
      // Step 1: POST to /api/sso/authorize (simulating the dynamic redirection authorization)
      const res = await fetch('/api/sso/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          centralToken,
          clientId: targetApp.id,
          redirectUri: targetApp.redirectUri
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authorization code request rejected.');
      }

      addSimLog(`✅ Authorization code issued by IDP: ${data.code}`);
      setSimAuthCode(data.code);
      setSimStep(2);
    } catch (err: any) {
      addSimLog(`❌ Authorization failed: ${err.message}`);
    } finally {
      setSimIsLoading(false);
    }
  };

  const handleSimStep2Exchange = async () => {
    setSimIsLoading(true);
    const targetApp = appsList.find(app => app.id === selectedSimAppId);
    if (!targetApp) return;

    addSimLog(`Exchanging authorization code for OIDC identity & session tokens...`);
    addSimLog(`POST /api/sso/token`);
    addSimLog(`Client ID: ${targetApp.id}`);
    addSimLog(`Client Secret: ${targetApp.clientSecret}`);

    try {
      const res = await fetch('/api/sso/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: simAuthCode,
          clientId: targetApp.id,
          clientSecret: targetApp.clientSecret
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Code exchange rejected by token endpoint.');
      }

      addSimLog(`✅ Token exchange successful! JWT Token and user profile issued.`);
      addSimLog(`App-Specific JWT Token: ${data.appToken.substring(0, 24)}...`);
      setSimTokenResponse(data);
      setSimStep(3);
    } catch (err: any) {
      addSimLog(`❌ Code exchange failed: ${err.message}`);
    } finally {
      setSimIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden animate-fade-in">
      {/* Dev Console Sub-Header */}
      <div className="bg-slate-900 text-white px-8 py-6 space-y-4">
        <div>
          <button
            onClick={() => navigate('/profile')}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 border border-slate-700 cursor-pointer"
            title="Go Back"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-indigo-500 text-white rounded-lg">
                <Terminal className="w-4 h-4" />
              </span>
              <h2 className="text-lg font-extrabold tracking-tight">OIDC Developer Console</h2>
            </div>
            <p className="text-slate-400 text-xs mt-1">
              Register custom external applications, manage Client IDs, Client Secrets, and test authentication handshakes.
            </p>
          </div>

          {/* Console Tab Toggles */}
          <div className="flex flex-wrap gap-1 bg-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setActiveSubTab('list')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeSubTab === 'list' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Registered Apps ({appsList.length})
            </button>
            <button
              onClick={() => setActiveSubTab('register')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeSubTab === 'register' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Register Custom App
            </button>
            <button
              onClick={() => setActiveSubTab('docs')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeSubTab === 'docs' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Integration Guide
            </button>
            <button
              onClick={() => {
                setActiveSubTab('simulator');
                if (appsList.length > 0 && !selectedSimAppId) {
                  setSelectedSimAppId(appsList[0].id);
                }
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeSubTab === 'simulator' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              OIDC Sandbox Simulator
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 md:p-8">
        
        {/* TAB 1: REGISTERED CLIENT APPLICATIONS LIST */}
        {activeSubTab === 'list' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-sm">Active OpenID Connect Client Profiles</h3>
              <button
                onClick={() => setActiveSubTab('register')}
                className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl text-xs font-bold border border-indigo-100 transition-colors flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Register Custom App</span>
              </button>
            </div>

            {appsList.length === 0 ? (
              <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-gray-200">
                <Shield className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm font-semibold text-gray-600">No applications registered yet.</p>
                <p className="text-xs text-gray-400 mt-1">Register your first client application to obtain dynamic OAuth client credentials.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {appsList.map(app => (
                  <div key={app.id} className="bg-slate-50 border border-gray-200 rounded-2xl p-5 hover:border-gray-300 transition-all">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-sm"
                          style={{ backgroundColor: app.accentColor }}
                        >
                          {app.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-gray-900 text-sm">{app.name}</h4>
                            {app.isFirstParty ? (
                              <span className="text-[9px] px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-full font-bold uppercase tracking-wider">
                                First Party (Auto-Approve)
                              </span>
                            ) : (
                              <span className="text-[9px] px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-full font-medium">
                                Third Party
                              </span>
                            )}
                            {['sales', 'hr'].includes(app.id) && (
                              <span className="text-[9px] px-2 py-0.5 bg-slate-200 text-slate-700 rounded-full font-bold uppercase tracking-wider">
                                Demo System App
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{app.description}</p>
                        </div>
                      </div>

                      {/* App Management Options */}
                      {!['sales', 'hr'].includes(app.id) && (
                        <button
                          onClick={() => handleDeleteApp(app.id)}
                          className="p-1.5 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded-lg transition-colors"
                          title="Delete Application"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* App Credentials and URIs block */}
                    <div className="mt-5 pt-4 border-t border-gray-200/60 grid grid-cols-1 md:grid-cols-2 gap-4">
                      
                      {/* Left: OIDC Credentials */}
                      <div className="space-y-2.5">
                        <h5 className="text-[10px] uppercase tracking-wider font-extrabold text-gray-400 flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          <span>Dynamic OIDC Client Credentials</span>
                        </h5>
                        
                        {/* Client ID */}
                        <div className="bg-white px-3 py-2 rounded-xl border border-gray-200 flex items-center justify-between text-xs font-mono">
                          <div className="truncate pr-2">
                            <span className="text-gray-400 select-none mr-2">Client ID:</span>
                            <span className="text-gray-800 font-bold select-all">{app.id}</span>
                          </div>
                          <button
                            onClick={() => handleCopy(app.id, app.id + '_id')}
                            className="p-1 hover:bg-slate-100 rounded text-gray-400 hover:text-indigo-600 transition-colors"
                          >
                            {copiedId === app.id + '_id' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>

                        {/* Client Secret */}
                        <div className="bg-white px-3 py-2 rounded-xl border border-gray-200 flex items-center justify-between text-xs font-mono">
                          <div className="truncate pr-2 flex-1">
                            <span className="text-gray-400 select-none mr-2">Client Secret:</span>
                            <span className="text-gray-800 select-all font-bold">
                              {showSecretMap[app.id] ? app.clientSecret : '••••••••••••••••••••••••••••••'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 select-none">
                            <button
                              onClick={() => toggleSecret(app.id)}
                              className="p-1 hover:bg-slate-100 rounded text-gray-400 hover:text-indigo-600 transition-colors"
                            >
                              {showSecretMap[app.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => handleCopy(app.clientSecret, app.id + '_sec')}
                              className="p-1 hover:bg-slate-100 rounded text-gray-400 hover:text-indigo-600 transition-colors"
                            >
                              {copiedId === app.id + '_sec' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Right: Endpoint Redirect Targets */}
                      <div className="space-y-2.5">
                        <h5 className="text-[10px] uppercase tracking-wider font-extrabold text-gray-400 flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          <span>Approved OIDC Redirect Limits</span>
                        </h5>

                        {/* Homepage URL */}
                        <div className="bg-white px-3 py-2 rounded-xl border border-gray-200 flex items-center justify-between text-xs">
                          <div className="truncate pr-2">
                            <span className="text-gray-400 mr-2">Homepage URL:</span>
                            <a href={app.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline font-mono font-medium">{app.url}</a>
                          </div>
                        </div>

                        {/* Redirect Callback URI */}
                        <div className="bg-white px-3 py-2 rounded-xl border border-gray-200 flex items-center justify-between text-xs">
                          <div className="truncate pr-2">
                            <span className="text-gray-400 mr-2">Redirect URI:</span>
                            <span className="text-gray-700 font-mono font-medium select-all">{app.redirectUri}</span>
                          </div>
                          <button
                            onClick={() => handleCopy(app.redirectUri, app.id + '_uri')}
                            className="p-1 hover:bg-slate-100 rounded text-gray-400 hover:text-indigo-600 transition-colors"
                          >
                            {copiedId === app.id + '_uri' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: REGISTER NEW OIDC CLIENT */}
        {activeSubTab === 'register' && (
          <div className="max-w-2xl">
            <h3 className="font-extrabold text-gray-900 text-base mb-1">Register New Application client</h3>
            <p className="text-gray-500 text-xs mb-6">
              Create a secure profile for any custom website, application, or script. Sasso dynamic engine will immediately provision a functional Client ID and a strong OIDC Client Secret.
            </p>

            <form onSubmit={handleRegisterApp} className="space-y-4">
              {errorMsg && (
                <div className="p-3.5 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs font-semibold">
                  {errorMsg}
                </div>
              )}

              {successMsg && (
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl space-y-3">
                  <p className="text-emerald-700 text-xs font-bold flex items-center gap-1.5">
                    <Check className="w-4 h-4" />
                    <span>{successMsg}</span>
                  </p>
                  
                  {registeredCreds && (
                    <div className="p-3 bg-white border border-emerald-200 rounded-xl space-y-2 text-xs font-mono">
                      <div>
                        <span className="text-gray-400 select-none">Client ID:</span>{' '}
                        <span className="text-gray-800 font-bold select-all">{registeredCreds.clientId}</span>
                      </div>
                      <div>
                        <span className="text-gray-400 select-none">Client Secret:</span>{' '}
                        <span className="text-gray-800 font-bold select-all">{registeredCreds.clientSecret}</span>
                      </div>
                      <p className="text-[10px] text-amber-600 font-sans font-semibold pt-1">
                        ⚠️ Copy this client secret now! For security reasons, it cannot be recovered or displayed again.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Form Input fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">
                    Application Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                    placeholder="e.g. My External React App"
                    className="w-full px-3.5 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">
                    Brand Accent Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={appAccent}
                      onChange={(e) => setAppAccent(e.target.value)}
                      className="w-9 h-9 border border-gray-300 rounded-xl cursor-pointer p-0.5 bg-white"
                    />
                    <input
                      type="text"
                      value={appAccent}
                      onChange={(e) => setAppAccent(e.target.value)}
                      placeholder="#4F46E5"
                      className="flex-1 px-3.5 py-2 border border-gray-300 rounded-xl text-xs font-mono outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  Short Description
                </label>
                <input
                  type="text"
                  value={appDescription}
                  onChange={(e) => setAppDescription(e.target.value)}
                  placeholder="e.g. Internal telemetry panel and user metrics console"
                  className="w-full px-3.5 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono">
                <div>
                  <label className="block text-xs font-sans font-bold text-gray-700 mb-1.5">
                    Homepage URL <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="url"
                    required
                    value={appUrl}
                    onChange={(e) => setAppUrl(e.target.value)}
                    placeholder="http://localhost:3001"
                    className="w-full px-3.5 py-2 border border-gray-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-sans font-bold text-gray-700 mb-1.5">
                    Allowed Redirect URI <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={appRedirectUri}
                    onChange={(e) => setAppRedirectUri(e.target.value)}
                    placeholder="http://localhost:3001/auth/callback"
                    className="w-full px-3.5 py-2 border border-gray-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <p className="text-[10px] text-gray-400 font-sans mt-1">
                    The exact callback endpoint on your client backend where sasso OIDC will post authorization codes.
                  </p>
                </div>
              </div>

              {/* First Party Option */}
              <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4 flex items-start gap-3">
                <input
                  type="checkbox"
                  id="isFirstPartyCheck"
                  checked={appIsFirstParty}
                  onChange={(e) => setAppIsFirstParty(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="isFirstPartyCheck" className="text-xs cursor-pointer select-none">
                  <span className="font-extrabold text-indigo-950 block">First-Party Application (Auto-Approve Consent)</span>
                  <span className="text-indigo-700/80 text-[11px] block mt-0.5">
                    If checked, users won't be prompted with an authorization/consent screen during "Sign in with SASSO" and will be logged in automatically.
                  </span>
                </label>
              </div>

              <div className="pt-3">
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Register Application</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 3: INTEGRATION DOCUMENTATION */}
        {activeSubTab === 'docs' && (
          <div className="space-y-8 max-w-4xl">
            <div>
              <h3 className="font-extrabold text-gray-900 text-base mb-1">OpenID Connect & OAuth2 Integration Specification</h3>
              <p className="text-gray-500 text-xs">
                Sasso complies with standard RFC-based OAuth 2.0 and OpenID Connect flows. Integrate your dynamically registered client app instantly with the endpoints below.
              </p>
            </div>

            {/* OIDC Config Endpoints */}
            <div className="bg-slate-900 text-slate-100 rounded-2xl p-5 font-mono text-xs space-y-3.5 border border-slate-800">
              <h4 className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5" />
                <span>OIDC Provider Endpoint Configurations</span>
              </h4>

              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 border-b border-slate-800 pb-2">
                  <span className="text-slate-400 w-44 shrink-0 font-bold">Issuer / Host:</span>
                  <span className="text-emerald-400 truncate">{window.location.origin}</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 border-b border-slate-800 pb-2">
                  <span className="text-slate-400 w-44 shrink-0 font-bold">1. Authorization URL:</span>
                  <span className="text-emerald-400 font-bold truncate">{window.location.origin}/api/sso/authorize</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 border-b border-slate-800 pb-2">
                  <span className="text-slate-400 w-44 shrink-0 font-bold">2. Token Endpoint:</span>
                  <span className="text-emerald-400 font-bold truncate">{window.location.origin}/api/sso/token</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 border-b border-slate-800 pb-2">
                  <span className="text-slate-400 w-44 shrink-0 font-bold">3. Token Verify / Profile:</span>
                  <span className="text-emerald-400 font-bold truncate">{window.location.origin}/api/sso/verify-app-token</span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-1">
                  <span className="text-slate-400 w-44 shrink-0 font-bold">4. Single Logout (SLO):</span>
                  <span className="text-emerald-400 font-bold truncate">{window.location.origin}/api/sso/logout-slo</span>
                </div>
              </div>
            </div>

            {/* Steps Guide */}
            <div className="space-y-6">
              <h4 className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                <Code className="w-4 h-4 text-indigo-600" />
                <span>Standard Two-Step Handshake Integration</span>
              </h4>

              <div className="space-y-4 text-xs leading-relaxed text-gray-600">
                {/* Step 1 */}
                <div className="bg-slate-50 rounded-2xl border border-gray-200 p-5 space-y-3">
                  <p className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold text-[10px]">1</span>
                    <span>Redirect User to IDP Authorization Page (Request Offline Access for Refresh Tokens)</span>
                  </p>
                  <p>
                    When a user clicks "Login with Sasso" in your application, redirect their browser window to the authorization URL. 
                    <span className="font-extrabold text-amber-700 bg-amber-50 px-1 py-0.5 rounded border border-amber-200 ml-1">
                      ⚠️ OIDC / PKCE SECURITY:
                    </span> Pass <code className="bg-amber-100 px-1 py-0.5 rounded text-amber-900 font-mono font-bold">state</code> for CSRF protection, <code className="bg-amber-100 px-1 py-0.5 rounded text-amber-900 font-mono font-bold">nonce</code> for replay attack prevention, and <code className="bg-amber-100 px-1 py-0.5 rounded text-amber-900 font-mono font-bold">code_challenge</code> / <code className="bg-amber-100 px-1 py-0.5 rounded text-amber-900 font-mono font-bold">code_challenge_method=S256</code> (PKCE) to prevent code interception! Code expires strictly in <strong>2 minutes</strong>.
                  </p>
                  
                  <div className="bg-slate-900 text-indigo-300 p-3.5 rounded-xl font-mono text-[11px] overflow-x-auto">
                    {`// Redirection URL structure (With PKCE, state, nonce & offline access)
window.location.href = "${window.location.origin}/api/sso/authorize" + 
  "?clientId=YOUR_CLIENT_ID" + 
  "&redirectUri=YOUR_APPROVED_REDIRECT_URI" +
  "&access_type=offline" +
  "&state=" + encodeURIComponent(state) +
  "&nonce=" + encodeURIComponent(nonce) +
  "&code_challenge=" + encodeURIComponent(codeChallenge) +
  "&code_challenge_method=S256";`}
                  </div>
                </div>

                {/* Step 2 */}
                <div className="bg-slate-50 rounded-2xl border border-gray-200 p-5 space-y-3">
                  <p className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold text-[10px]">2</span>
                    <span>Exchange Authorization Code on Your Backend</span>
                  </p>
                  <p>
                    After approval, sasso redirects the user back to your <code className="bg-gray-100 px-1 py-0.5 rounded text-red-500 font-mono font-medium">redirectUri</code> with an authorization <code className="bg-gray-100 px-1 py-0.5 rounded text-red-500 font-mono font-medium">code</code> query parameter. Your server backend exchanges this code for an Access Token and a Refresh Token:
                  </p>

                  <div className="bg-slate-900 text-indigo-300 p-3.5 rounded-xl font-mono text-[11px] overflow-x-auto">
                    {`// Node.js/Express Backend code exchange
app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;

  const response = await fetch('${window.location.origin}/api/sso/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: code,
      clientId: 'YOUR_CLIENT_ID',
      clientSecret: 'YOUR_CLIENT_SECRET'
    })
  });

  const data = await response.json();
  if (response.ok) {
    // data.access_token / data.appToken -> Short-lived JWT (2 hours)
    // data.refresh_token -> Long-lived Refresh Token (30 days, present if access_type=offline was passed)
    // data.user -> User details (firstName, lastName, email, avatarUrl)
    req.session.token = data.access_token;
    req.session.refreshToken = data.refresh_token; // 👈 Save Refresh Token securely!
    req.session.user = data.user;
    res.redirect('/dashboard');
  } else {
    res.status(400).send("Authentication failed: " + data.error);
  }
});`}
                  </div>
                </div>

                {/* Step 3 */}
                <div className="bg-slate-50 rounded-2xl border border-gray-200 p-5 space-y-3">
                  <p className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold text-[10px]">3</span>
                    <span>Verify Token Validity and Authenticity</span>
                  </p>
                  <p>
                    On any subsequent request from your frontend client, your app server can securely verify the JWT signature using sasso verification endpoint without decoding locally.
                  </p>

                  <div className="bg-slate-900 text-indigo-300 p-3.5 rounded-xl font-mono text-[11px] overflow-x-auto">
                    {`// Secure Session / JWT Verification
const verifyRes = await fetch('${window.location.origin}/api/sso/verify-app-token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    token: req.session.token,
    clientId: 'YOUR_CLIENT_ID'
  })
});
const verification = await verifyRes.json();
if (verification.valid) {
  console.log("Verified OIDC User: " + verification.decoded.email);
}`}
                  </div>
                </div>

                {/* Step 4: Refresh Token Grant */}
                <div className="bg-indigo-50/70 rounded-2xl border border-indigo-200 p-5 space-y-3">
                  <p className="font-bold text-indigo-950 text-xs flex items-center gap-1.5">
                    <span className="w-5 h-5 bg-indigo-700 text-white rounded-full flex items-center justify-center font-bold text-[10px]">4</span>
                    <span>Refresh Expired Access Tokens (Refresh Token Grant)</span>
                  </p>
                  <p className="text-indigo-900/90">
                    When an access token expires after 2 hours, your client app backend can request a new access token using the saved <code className="bg-indigo-100 px-1 py-0.5 rounded text-indigo-950 font-mono font-bold">refresh_token</code> without asking the user to log in again:
                  </p>

                  <div className="bg-slate-900 text-indigo-300 p-3.5 rounded-xl font-mono text-[11px] overflow-x-auto">
                    {`// Refreshing expired Access Token via Refresh Token Grant
app.post('/api/refresh-session', async (req, res) => {
  const storedRefreshToken = req.session.refreshToken;
  if (!storedRefreshToken) {
    return res.status(401).json({ error: "No refresh token found. Please re-authenticate." });
  }

  const response = await fetch('${window.location.origin}/api/sso/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: storedRefreshToken,
      clientId: 'YOUR_CLIENT_ID',
      clientSecret: 'YOUR_CLIENT_SECRET'
    })
  });

  const data = await response.json();
  if (response.ok) {
    // data.access_token -> Fresh 2-hour Access Token
    // data.refresh_token -> Rotated new Refresh Token (30 days)
    req.session.token = data.access_token;
    req.session.refreshToken = data.refresh_token; // Always save the rotated new refresh token!
    res.json({ success: true, token: data.access_token });
  } else {
    res.status(401).json({ error: "Refresh failed: " + data.error });
  }
});`}
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}

        {/* TAB 4: OIDC SANDBOX SIMULATOR */}
        {activeSubTab === 'simulator' && (
          <div className="space-y-6 max-w-4xl">
            <div>
              <h3 className="font-extrabold text-gray-900 text-base mb-1">Interactive OIDC Handshake Sandbox</h3>
              <p className="text-gray-500 text-xs">
                Simulate standard OpenID Connect/OAuth 2.0 message exchanges dynamically between your client application and sasso IDP server in real-time.
              </p>
            </div>

            {appsList.length === 0 ? (
              <div className="p-6 bg-amber-50 border border-amber-100 text-amber-800 rounded-2xl text-xs font-semibold">
                Please register a client application first to simulate OIDC handshakes.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Sandbox Control Controls Panel */}
                <div className="lg:col-span-1 bg-slate-50 border border-gray-200 rounded-2xl p-5 space-y-5">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-extrabold text-gray-700">Select Simulator Target</label>
                    <select
                      value={selectedSimAppId}
                      onChange={(e) => {
                        setSelectedSimAppId(e.target.value);
                        resetSimulator();
                      }}
                      className="w-full px-3 py-2 border border-gray-300 bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      {appsList.map(app => (
                        <option key={app.id} value={app.id}>{app.name} ({app.id})</option>
                      ))}
                    </select>
                  </div>

                  {/* Step Progress indicators */}
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs select-none ${
                        simStep >= 1 ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'
                      }`}>
                        1
                      </div>
                      <span className={`text-xs font-bold ${simStep >= 1 ? 'text-gray-900' : 'text-gray-400'}`}>Authorize Redirect</span>
                    </div>

                    <div className="h-4 w-0.5 bg-gray-200 ml-3"></div>

                    <div className="flex items-center gap-2.5">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs select-none ${
                        simStep >= 2 ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'
                      }`}>
                        2
                      </div>
                      <span className={`text-xs font-bold ${simStep >= 2 ? 'text-gray-900' : 'text-gray-400'}`}>Exchange Auth Code</span>
                    </div>

                    <div className="h-4 w-0.5 bg-gray-200 ml-3"></div>

                    <div className="flex items-center gap-2.5">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs select-none ${
                        simStep >= 3 ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-500'
                      }`}>
                        3
                      </div>
                      <span className={`text-xs font-bold ${simStep >= 3 ? 'text-emerald-600' : 'text-gray-400'}`}>Verify Session & Profile</span>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-200 flex flex-col gap-2">
                    {simStep === 1 && (
                      <button
                        onClick={handleSimStep1Authorize}
                        disabled={simIsLoading}
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl text-xs font-extrabold shadow-sm transition-all flex items-center justify-center gap-1"
                      >
                        <span>Request Auth Code</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {simStep === 2 && (
                      <button
                        onClick={handleSimStep2Exchange}
                        disabled={simIsLoading}
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-xl text-xs font-extrabold shadow-sm transition-all flex items-center justify-center gap-1"
                      >
                        <span>Exchange Code for Token</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      onClick={resetSimulator}
                      className="w-full py-2 text-gray-500 hover:text-gray-800 rounded-xl text-xs font-bold transition-all hover:bg-gray-100"
                    >
                      Reset Simulator
                    </button>
                  </div>
                </div>

                {/* Simulator Console Trace Terminal Output */}
                <div className="lg:col-span-2 flex flex-col gap-4">
                  
                  {/* Realtime logs */}
                  <div className="flex-1 bg-slate-900 text-slate-100 rounded-2xl p-5 font-mono text-[11px] space-y-2 border border-slate-800 min-h-[220px] flex flex-col justify-between">
                    <div className="space-y-1 overflow-y-auto max-h-[190px]">
                      <div className="text-slate-400 border-b border-slate-800 pb-1.5 mb-1.5 flex items-center justify-between">
                        <span>SSO OIDC TRAFFIC LOGS ANALYZER</span>
                        <span className="animate-pulse text-[9px] text-emerald-400 font-sans font-bold">● SIMULATOR ACTIVE</span>
                      </div>
                      {simLog.length === 0 ? (
                        <p className="text-slate-500 italic">Click "Request Auth Code" to initiate standard OIDC handshake trace.</p>
                      ) : (
                        simLog.map((log, idx) => (
                          <div key={idx} className="whitespace-pre-wrap leading-relaxed">{log}</div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Issued Identity Profile Preview */}
                  {simStep === 3 && simTokenResponse && (
                    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 space-y-3 animate-fade-in">
                      <div className="flex items-center gap-2 text-emerald-800">
                        <Sparkles className="w-4 h-4" />
                        <h4 className="font-extrabold text-xs">Dynamic Session Verified (JWT Decoded Profile)</h4>
                      </div>

                      <div className="flex items-center gap-3 bg-white p-3.5 rounded-xl border border-emerald-100">
                        <img 
                          src={simTokenResponse.user.avatarUrl} 
                          alt="Sim User" 
                          className="w-10 h-10 rounded-full border border-gray-200"
                          referrerPolicy="no-referrer"
                        />
                        <div className="text-xs">
                          <p className="font-bold text-gray-900">{simTokenResponse.user.firstName} {simTokenResponse.user.lastName}</p>
                          <p className="text-gray-500 font-mono text-[10px]">{simTokenResponse.user.email}</p>
                        </div>
                      </div>

                      <div className="bg-slate-900 text-indigo-300 p-3.5 rounded-xl font-mono text-[10px] overflow-x-auto leading-relaxed max-h-[160px] overflow-y-auto">
                        <p className="text-slate-400 border-b border-slate-800 pb-1.5 mb-1.5 font-bold uppercase tracking-wider text-[9px]">Verified JWT Header & Payload</p>
                        {JSON.stringify({
                          header: { alg: "HS256", typ: "JWT" },
                          payload: {
                            uid: simTokenResponse.user.uid,
                            email: simTokenResponse.user.email,
                            clientId: selectedSimAppId,
                            type: `app_session_${selectedSimAppId}`,
                            exp: Math.floor(Date.now() / 1000) + 7200
                          }
                        }, null, 2)}
                      </div>
                    </div>
                  )}

                </div>

              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
