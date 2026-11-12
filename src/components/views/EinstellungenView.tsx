import React, { useEffect, useState } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { GoogleSignInButton } from '../common/GoogleSignInButton.tsx';
import { PWAInstallCard } from '../common/PWAInstallCard.tsx';
import {
  HAFNER_LOGO_URL,
  ISSUER_BANK_NAME,
  ISSUER_BIC,
  ISSUER_CITY,
  ISSUER_COURT,
  ISSUER_EMAIL,
  ISSUER_IBAN,
  ISSUER_NAME,
  ISSUER_PHONE,
  ISSUER_STREET,
  ISSUER_TAX_NR
} from '../../utils/invoicePdf.ts';
import {
  googleSignIn,
  logoutGmail,
  subscribeGmailAuth
} from '../../services/gmailService.ts';
import { useSmartphoneWeather } from '../../services/weatherService.ts';
import { useApp } from '../../context/AppContext.tsx';
import {
  NativeMcpSyncStatus,
  copyTextRobustly,
  getNativeMcpSyncStatus,
  getRevealedNativeMcpToken,
  isNativeAndroidApp,
  pairNativeMcpWithCode,
  resolveMcpAdminEndpoint,
  subscribeNativeMcpStatus,
  triggerNativeMcpSyncNow
} from '../../services/nativeBridge.ts';
import {
  ChevronRight,
  ChevronDown,
  Calendar,
  CloudSun,
  Bot,
  Trash2,
  CheckCircle,
  Mail,
  LogOut,
  Copy,
  Check,
  RefreshCw,
  ShieldCheck,
  Eye,
  EyeOff,
  WifiOff,
  AlertCircle
} from 'lucide-react';

interface McpClientConfigInfo {
  requireToken: boolean;
  tokenSource: 'env' | 'file';
  maskedToken: string;
  adminToken?: string;
  oauthEnabled: boolean;
  activeOAuthGrants: number;
  pairedAndroidDevices: number;
  activePairingCodes?: number;
  androidTelemetry: {
    lastSyncAt: string | null;
    lastDeviceModel: string | null;
    lastDirection: string | null;
  };
  persistence?: {
    atomicDiskActive: boolean;
    firestoreConfigured: boolean;
    firestoreCloudActive: boolean;
  };
  lastAccessAt: string | null;
  lastOperation: string | null;
  totalCalls: number;
  revision: number;
  toolCount: number;
  isPreviewEnvironment: boolean;
  endpoints: {
    baseUrl: string;
    mcpHeaderUrl: string;
    mcpSseHeaderUrl: string;
    oauthProtectedResourceUrl: string;
    oauthAuthServerUrl: string;
  };
}

export const EinstellungenView: React.FC = () => {
  const { appSyncStatus, flushPendingAppSync, refreshFromServer } = useApp();
  const { weather, refreshWeather } = useSmartphoneWeather();
  const [gmailUser, setGmailUser] = useState<FirebaseUser | null>(null);
  const [gmailHasToken, setGmailHasToken] = useState(false);
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailAuthError, setGmailAuthError] = useState<string | null>(null);

  const isNativeAndroid = isNativeAndroidApp();

  // Gemeinsamer Cloud- & MCP-Server-Status (identisch in Web-App und Android-App)
  const [mcpInfo, setMcpInfo] = useState<McpClientConfigInfo | null>(null);
  const [revealedAdminToken, setRevealedAdminToken] = useState<string | null>(() =>
    getRevealedNativeMcpToken()
  );
  const [showSecretToken, setShowSecretToken] = useState(false);
  const [resetInProgress, setResetInProgress] = useState(false);
  const [resetDoneBanner, setResetDoneBanner] = useState(false);

  // Native Pixel 10 Pro Keystore & Sync Status
  const [nativeSyncStatus, setNativeSyncStatus] = useState<NativeMcpSyncStatus | null>(() =>
    getNativeMcpSyncStatus()
  );
  const [nativeBaseUrlInput, setNativeBaseUrlInput] = useState<string>(
    () => getNativeMcpSyncStatus()?.baseUrl || 'https://hafner-gruenraum.ai.studio'
  );

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [rotatingToken, setRotatingToken] = useState(false);

  const fetchRevealedToken = async (overrideBaseUrl?: string): Promise<string | null> => {
    if (!isNativeAndroid) {
      return null;
    }
    try {
      const endpoint = resolveMcpAdminEndpoint(
        '/api/internal/reveal-token',
        overrideBaseUrl || nativeBaseUrlInput
      );
      const res = await fetch(endpoint.url, {
        method: 'POST',
        credentials: 'omit',
        headers: endpoint.headers
      });
      if (res.ok) {
        const data = (await res.json()) as { adminToken?: string };
        if (data.adminToken && data.adminToken.trim().length >= 16) {
          const clean = data.adminToken.trim();
          setRevealedAdminToken(clean);
          return clean;
        }
      }
    } catch {
      // Ignore network error and fall back to local keystore token
    }

    const nativeFallback =
      getRevealedNativeMcpToken() ||
      nativeSyncStatus?.revealedToken?.trim() ||
      nativeSyncStatus?.deviceToken?.trim() ||
      null;
    if (nativeFallback) {
      setRevealedAdminToken(nativeFallback);
      return nativeFallback;
    }
    return revealedAdminToken;
  };

  const loadMcpInfo = async (customBaseUrl?: string) => {
    if (!isNativeAndroid) {
      return;
    }

    const latest = getNativeMcpSyncStatus();
    setNativeSyncStatus(latest);
    if (latest?.baseUrl) {
      setNativeBaseUrlInput(latest.baseUrl);
    }
    const immediateNativeToken =
      getRevealedNativeMcpToken() ||
      latest?.revealedToken?.trim() ||
      latest?.deviceToken?.trim();
    if (immediateNativeToken) {
      setRevealedAdminToken((prev) => prev || immediateNativeToken);
    }
    // Falls noch kein Token im Keystore liegt, automatisch ohne Einmal-Code verbinden
    if (latest && !latest.configured && latest.state !== 'reconnecting') {
      const autoUpdated = pairNativeMcpWithCode(
        latest.baseUrl || 'https://hafner-gruenraum.ai.studio',
        'AUTO'
      );
      if (autoUpdated) {
        setNativeSyncStatus(autoUpdated);
      }
    }

    try {
      const endpoint = resolveMcpAdminEndpoint(
        '/api/internal/mcp-config',
        customBaseUrl || nativeBaseUrlInput
      );
      const res = await fetch(endpoint.url, {
        headers: endpoint.headers,
        credentials: 'omit'
      });
      if (res.ok) {
        const data = (await res.json()) as McpClientConfigInfo;
        setMcpInfo(data);
        if (data.adminToken && data.adminToken.trim().length >= 16) {
          setRevealedAdminToken(data.adminToken.trim());
          return;
        }
      }
    } catch {
      // Offline tolerance
    }

    void fetchRevealedToken(customBaseUrl);
  };

  useEffect(() => {
    if (!isNativeAndroid) {
      return;
    }

    const unsubGmail = subscribeGmailAuth(({ user, hasToken, error }) => {
      setGmailUser(user);
      setGmailHasToken(hasToken);
      if (error) {
        setGmailAuthError(error);
      }
    });

    const unsubNativeStatus = subscribeNativeMcpStatus((status) => {
      setNativeSyncStatus(status);
      if (status.baseUrl) {
        setNativeBaseUrlInput(status.baseUrl);
      }
      const nextToken = status.revealedToken?.trim() || status.deviceToken?.trim();
      if (nextToken && nextToken.length >= 16) {
        setRevealedAdminToken((prev) => prev || nextToken);
      }
    });

    void loadMcpInfo();

    return () => {
      unsubGmail();
      unsubNativeStatus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNativeAndroid]);

  const [arbeitsvorgabenOpen, setArbeitsvorgabenOpen] = useState(false);
  const [rechnungsdatenOpen, setRechnungsdatenOpen] = useState(false);
  const [verbindungenOpen, setVerbindungenOpen] = useState(true);
  const [speicherOpen, setSpeicherOpen] = useState(false);

  const [hourlyRate, setHourlyRate] = useState('50');
  const [paymentTarget, setPaymentTarget] = useState('14 Tage ohne Abzug');
  const [numberPrefix, setNumberPrefix] = useState('RE');
  const [statusCheckRunning, setStatusCheckRunning] = useState(false);
  const [statusChecked, setStatusChecked] = useState(false);
  const [storageCleaned, setStorageCleaned] = useState(false);

  const handleCopyText = async (key: string, value: string, label = 'MCP') => {
    const ok = await copyTextRobustly(label, value);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2500);
    }
  };

  const resolveCurrentFullTokenSync = (): string | null => {
    return (
      revealedAdminToken?.trim() ||
      mcpInfo?.adminToken?.trim() ||
      getRevealedNativeMcpToken() ||
      nativeSyncStatus?.revealedToken?.trim() ||
      nativeSyncStatus?.deviceToken?.trim() ||
      null
    );
  };

  const handleToggleShowSecret = async () => {
    if (showSecretToken) {
      setShowSecretToken(false);
      return;
    }
    setShowSecretToken(true);
    const immediate = resolveCurrentFullTokenSync();
    if (immediate) {
      setRevealedAdminToken(immediate);
    }
    const fetched = await fetchRevealedToken();
    if (fetched) {
      setRevealedAdminToken(fetched);
    }
  };

  const handleCopyAdminToken = async () => {
    const immediate = resolveCurrentFullTokenSync();
    if (immediate) {
      setRevealedAdminToken(immediate);
      await handleCopyText('mcp_token', immediate, 'MCP-Zugangsschlüssel');
      return;
    }
    const fetched = await fetchRevealedToken();
    if (fetched) {
      await handleCopyText('mcp_token', fetched, 'MCP-Zugangsschlüssel');
    }
  };

  const handleRotateMcpToken = async () => {
    setRotatingToken(true);
    try {
      const endpoint = resolveMcpAdminEndpoint('/api/internal/mcp-config', nativeBaseUrlInput);
      const res = await fetch(endpoint.url, {
        method: 'POST',
        credentials: isNativeAndroid ? 'omit' : 'include',
        headers: {
          'Content-Type': 'application/json',
          ...endpoint.headers
        },
        body: JSON.stringify({ rotate: true })
      });
      if (res.ok) {
        setRevealedAdminToken(null);
        setShowSecretToken(false);
        await loadMcpInfo();
      }
    } finally {
      setRotatingToken(false);
    }
  };

  const handleOneClickReconnectReset = async () => {
    setResetInProgress(true);
    try {
      if (isNativeAndroid) {
        const targetUrl = nativeBaseUrlInput.trim() || 'https://hafner-gruenraum.ai.studio';
        const updated = pairNativeMcpWithCode(targetUrl, 'AUTO');
        if (updated) {
          setNativeSyncStatus(updated);
        }
        triggerNativeMcpSyncNow();
      } else {
        await refreshFromServer();
      }
      await loadMcpInfo();
      setResetDoneBanner(true);
      setTimeout(() => setResetDoneBanner(false), 3000);
    } finally {
      setResetInProgress(false);
    }
  };

  const handleStatusCheck = async () => {
    setStatusCheckRunning(true);
    try {
      if (isNativeAndroid) {
        triggerNativeMcpSyncNow();
      } else {
        await refreshFromServer();
      }
      const endpoint = resolveMcpAdminEndpoint('/api/internal/mcp-health', nativeBaseUrlInput);
      const res = await fetch(endpoint.url, {
        headers: endpoint.headers,
        credentials: isNativeAndroid ? 'omit' : 'include'
      });
      await loadMcpInfo();
      if (res.ok || isNativeAndroid) {
        setStatusChecked(true);
        setTimeout(() => setStatusChecked(false), 4000);
      }
    } catch {
      // Ignore
    } finally {
      setStatusCheckRunning(false);
    }
  };

  const handleCleanStorage = () => {
    setStorageCleaned(true);
    setTimeout(() => setStorageCleaned(false), 3000);
  };

  const effectivePendingCount = isNativeAndroid
    ? nativeSyncStatus?.pendingSyncCount ?? 0
    : appSyncStatus.pendingSyncCount;
  const effectiveRevision = isNativeAndroid
    ? nativeSyncStatus?.revision ?? mcpInfo?.revision ?? appSyncStatus.revision
    : mcpInfo?.revision ?? appSyncStatus.revision;
  const effectiveMcpUrl =
    mcpInfo?.endpoints.mcpHeaderUrl ||
    nativeSyncStatus?.mcpEndpointUrl ||
    'https://hafner-gruenraum.ai.studio/mcp';
  const effectiveMaskedToken =
    mcpInfo?.maskedToken ||
    nativeSyncStatus?.maskedToken ||
    'hgh_mcp_••••••••••••••••••••';
  const effectiveLastSyncIso = isNativeAndroid
    ? nativeSyncStatus?.lastSyncAt || mcpInfo?.androidTelemetry.lastSyncAt || null
    : mcpInfo?.androidTelemetry.lastSyncAt || appSyncStatus.lastSyncAt || null;
  const effectiveTotalCalls = mcpInfo?.totalCalls ?? nativeSyncStatus?.totalMcpCalls ?? 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
      <Header title="Einstellungen" subtitle="App" showBack />

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3.5 text-xs text-slate-700 overscroll-contain">
        {/* GRUPPE 1: Arbeitsvorgaben */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
          <button
            onClick={() => setArbeitsvorgabenOpen(!arbeitsvorgabenOpen)}
            className="w-full min-h-[48px] p-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
          >
            <div>
              <span className="text-xs font-bold text-slate-900 block leading-tight">
                Arbeitsvorgaben
              </span>
              <span className="text-[11px] text-slate-500">
                Stundensatz · Abrechnungstakt · Standardwerte
              </span>
            </div>
            {arbeitsvorgabenOpen ? (
              <ChevronDown size={16} className="text-slate-400" />
            ) : (
              <ChevronRight size={16} className="text-slate-400" />
            )}
          </button>

          {arbeitsvorgabenOpen && (
            <div className="p-3.5 bg-slate-50 border-t border-slate-100 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Richtwert-Stundensatz (€)
                  </label>
                  <input
                    type="number"
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(e.target.value)}
                    className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Abrechnungstakt
                  </label>
                  <div className="h-10 px-3 bg-white border border-slate-200 rounded-xl flex items-center font-semibold text-slate-800">
                    15 Minuten
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* GRUPPE 2: Rechnungsdaten & Original-Design */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
          <button
            onClick={() => setRechnungsdatenOpen(!rechnungsdatenOpen)}
            className="w-full min-h-[48px] p-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
          >
            <div className="flex items-center gap-2.5">
              <img
                src={HAFNER_LOGO_URL}
                alt="Hafner Grünraum Handwerk"
                className="w-8 h-8 object-contain shrink-0"
              />
              <div>
                <span className="text-xs font-bold text-slate-900 block leading-tight">
                  Rechnungsdaten & Logo
                </span>
                <span className="text-[11px] text-slate-500">
                  Hafner Grünraum Handwerk · Format {numberPrefix}-75/2026
                </span>
              </div>
            </div>
            {rechnungsdatenOpen ? (
              <ChevronDown size={16} className="text-slate-400" />
            ) : (
              <ChevronRight size={16} className="text-slate-400" />
            )}
          </button>

          {rechnungsdatenOpen && (
            <div className="p-3.5 bg-slate-50 border-t border-slate-100 space-y-3">
              <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3">
                <div className="space-y-0.5 text-[11px] text-slate-600">
                  <span className="font-bold text-slate-900 block text-xs">
                    {ISSUER_NAME} · Grünraum Handwerk
                  </span>
                  <span className="block">
                    {ISSUER_STREET}, {ISSUER_CITY}
                  </span>
                  <span className="block">
                    Tel. {ISSUER_PHONE} · {ISSUER_EMAIL}
                  </span>
                  <span className="block">
                    {ISSUER_COURT} · Steuer-Nr. {ISSUER_TAX_NR}
                  </span>
                </div>
                <img
                  src={HAFNER_LOGO_URL}
                  alt="Hafner Logo"
                  className="w-16 h-16 object-contain shrink-0"
                />
              </div>

              <div className="p-2.5 bg-white border border-slate-200 rounded-xl text-[11px] text-slate-600">
                <span className="font-semibold text-slate-800 block text-xs">Bankverbindung</span>
                <span>
                  {ISSUER_BANK_NAME} · IBAN {ISSUER_IBAN} · BIC {ISSUER_BIC}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Nummernkreis Präfix
                  </label>
                  <input
                    type="text"
                    value={numberPrefix}
                    onChange={(e) => setNumberPrefix(e.target.value)}
                    className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Zahlungsziel
                  </label>
                  <input
                    type="text"
                    value={paymentTarget}
                    onChange={(e) => setPaymentTarget(e.target.value)}
                    className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-900"
                  />
                </div>
              </div>

              <div className="p-2.5 bg-white border border-slate-200 rounded-xl">
                <span className="font-semibold text-slate-800 block text-xs">Steuerregelung</span>
                <span className="text-[11px] text-slate-500">
                  Der Rechnungsbetrag enthält gem. §6 Abs. 1 Z 27 UStG 1994 keine Umsatzsteuer.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* GRUPPE 3: Verbindungen & MCP – ausschließlich in der primären Android-App (Pixel 10 Pro) */}
        {isNativeAndroid && (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
            <button
              onClick={() => setVerbindungenOpen(!verbindungenOpen)}
              className="w-full min-h-[48px] p-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
            >
            <div>
              <span className="text-xs font-bold text-slate-900 block leading-tight">
                Verbindungen
              </span>
              <span className="text-[11px] text-slate-500">
                Kalender, Wetter und privates ChatGPT-MCP-Plugin
              </span>
            </div>
            {verbindungenOpen ? (
              <ChevronDown size={16} className="text-slate-400" />
            ) : (
              <ChevronRight size={16} className="text-slate-400" />
            )}
          </button>

          {verbindungenOpen && (
            <div className="p-3.5 bg-slate-50 border-t border-slate-100 space-y-2.5">
              {/* Gmail Automatisierter PDF-Rechnungsversand */}
              <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Mail size={17} className="text-red-600 shrink-0" />
                    <div className="min-w-0">
                      <span className="font-bold text-slate-800 block text-xs">
                        Gmail (PDF-Rechnungsversand)
                      </span>
                      <span className="text-[10px] text-slate-500 block truncate">
                        {gmailHasToken && gmailUser
                          ? `Aktiv: ${gmailUser.email}`
                          : isNativeAndroid
                            ? 'Direktübergabe inkl. PDF an deine Pixel Gmail-App'
                            : 'Rechnungen automatisch als PDF per Gmail senden'}
                      </span>
                    </div>
                  </div>
                  {gmailHasToken && gmailUser ? (
                    <button
                      type="button"
                      onClick={() => logoutGmail()}
                      className="text-[10px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-md flex items-center gap-1 shrink-0"
                    >
                      <LogOut size={11} />
                      <span>Trennen</span>
                    </button>
                  ) : isNativeAndroid ? (
                    <span className="text-[10px] font-bold text-[#2C7738] bg-emerald-50 px-2 py-0.5 rounded-md shrink-0">
                      Nativ bereit
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md shrink-0">
                      Nicht angemeldet
                    </span>
                  )}
                </div>

                {!gmailHasToken && !isNativeAndroid && (
                  <div className="space-y-1.5">
                    <GoogleSignInButton
                      onClick={async () => {
                        setGmailConnecting(true);
                        setGmailAuthError(null);
                        try {
                          await googleSignIn('M13_EINSTELLUNGEN');
                        } catch (err: unknown) {
                          setGmailAuthError(
                            err instanceof Error ? err.message : 'Google-Anmeldung fehlgeschlagen.'
                          );
                        } finally {
                          setGmailConnecting(false);
                        }
                      }}
                      disabled={gmailConnecting}
                      label={gmailConnecting ? 'Verbinde...' : 'Sign in with Google'}
                    />
                    {gmailAuthError && (
                      <p className="text-[10px] text-[#B42318] font-medium leading-snug">
                        {gmailAuthError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Google Kalender */}
              <div className="p-2.5 bg-white border border-slate-200 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Calendar size={17} className="text-[#0B8043] shrink-0" />
                  <div className="min-w-0">
                    <span className="font-bold text-slate-800 block text-xs">
                      Google Kalender (Planung)
                    </span>
                    <span className="text-[10px] text-slate-500 block truncate">
                      {gmailHasToken && gmailUser
                        ? `Synchronisiert mit ${gmailUser.email}`
                        : isNativeAndroid
                          ? 'Direktzugriff auf den System-Kalender deines Pixel 10 Pro'
                          : 'Über Google-Anmeldung oben verbinden'}
                    </span>
                  </div>
                </div>
                {(gmailHasToken && gmailUser) || isNativeAndroid ? (
                  <span className="text-[10px] font-bold text-[#2C7738] bg-emerald-50 px-2 py-0.5 rounded-md shrink-0">
                    Verbunden
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md shrink-0">
                    Bereit
                  </span>
                )}
              </div>

              {/* Wetter (Open-Meteo · Smartphone-Standort) */}
              <div className="p-2.5 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CloudSun size={17} className="text-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <span className="font-bold text-slate-800 block text-xs">
                      Wetter (Open-Meteo · Smartphone-Standort)
                    </span>
                    <span className="text-[10px] text-slate-500 block truncate">
                      {weather.data
                        ? `${weather.data.temperatureC}°C · ${weather.data.conditionLabel}${
                            weather.data.tempMaxC !== null && weather.data.tempMinC !== null
                              ? ` (H: ${weather.data.tempMaxC}° / T: ${weather.data.tempMinC}°)`
                              : ''
                          }${
                            weather.data.precipProbabilityMax !== null
                              ? ` · Regen ${weather.data.precipProbabilityMax}%`
                              : ''
                          }`
                        : weather.status === 'loading'
                          ? 'Smartphone-Standort & Live-Wetter werden abgerufen…'
                          : weather.errorMessage || 'Standortfreigabe am Smartphone erforderlich'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {weather.status === 'live' ? (
                    <span className="text-[10px] font-bold text-[#2C7738] bg-emerald-50 px-2 py-0.5 rounded-md">
                      Live
                    </span>
                  ) : weather.status === 'cached' ? (
                    <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                      Cache
                    </span>
                  ) : weather.status === 'loading' ? (
                    <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                      Lädt…
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void refreshWeather(true)}
                      className="text-[10px] font-bold text-[#3138A0] bg-indigo-50 px-2 py-1 rounded-md active:bg-indigo-100"
                    >
                      Freigeben
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void refreshWeather(true)}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-700 active:bg-slate-100"
                    title="Wetter neu laden"
                  >
                    <RefreshCw
                      size={13}
                      className={weather.status === 'loading' ? 'animate-spin' : ''}
                    />
                  </button>
                </div>
              </div>

              {/* Privates ChatGPT-MCP-Plugin über ausgehenden HTTPS-Tunnel (nur Android-App) */}
              <div className="p-3 bg-white border border-indigo-200/80 rounded-xl space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-[#3138A0] shrink-0">
                      <Bot size={17} />
                    </div>
                    <div className="min-w-0">
                      <span className="font-bold text-slate-900 block text-xs">
                        Privates ChatGPT-MCP-Plugin (HTTPS-Tunnel)
                      </span>
                      <span className="text-[10px] text-[#3138A0] font-semibold block leading-snug">
                        ChatGPT ↔ privater Tunnel ↔ Pixel-App ↔ lokale Datenbank
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-[#2C7738] bg-emerald-50 px-2 py-0.5 rounded-md shrink-0">
                    Tunnel warm
                  </span>
                </div>

                <div className="space-y-2 pt-1.5 border-t border-slate-100">
                  <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                    <div
                      className={`p-2 border rounded-lg ${
                        effectivePendingCount > 0
                          ? 'bg-amber-50 border-amber-200'
                          : 'bg-slate-50 border-slate-200/70'
                      }`}
                    >
                      <span className="text-slate-500 block">Lokale Datenbank</span>
                      <span
                        className={`font-bold ${
                          effectivePendingCount > 0 ? 'text-amber-800' : 'text-[#2C7738]'
                        }`}
                      >
                        {effectivePendingCount > 0
                          ? `${effectivePendingCount} ausstehend`
                          : `Offline-fähig (Rev. ${effectiveRevision})`}
                      </span>
                    </div>
                    <div className="p-2 bg-slate-50 border border-slate-200/70 rounded-lg">
                      <span className="text-slate-500 block">HTTPS-Tunnel</span>
                      <span className="font-bold text-[#2C7738] flex items-center gap-1">
                        <ShieldCheck size={11} className="shrink-0" />
                        <span>Keep-Alive aktiv</span>
                      </span>
                    </div>
                    <div className="p-2 bg-slate-50 border border-slate-200/70 rounded-lg">
                      <span className="text-slate-500 block">Tempo-Bündelung</span>
                      <span className="font-bold text-[#2C7738]">
                        {mcpInfo?.toolCount ?? 3} Kombi-Tools
                      </span>
                    </div>
                  </div>

                  <div className="p-2 bg-indigo-50/50 border border-indigo-100 rounded-lg text-[10px] text-slate-700 space-y-0.5 leading-snug">
                    <div>
                      <strong className="text-slate-900">Lokale Datenhaltung:</strong> App arbeitet auf dem Pixel 10 Pro auch ohne Internet.
                    </div>
                    <div>
                      <strong className="text-slate-900">Gezielter Zugriff:</strong> ChatGPT erhält nur die angeforderten Daten.
                    </div>
                    <div>
                      <strong className="text-slate-900">Gemeinsame Funktionen &amp; Tempo:</strong> Geprüfte App-Logik, warmgehaltener Tunnel &amp; gebündelte Werkzeugaufrufe (`pixel_abfrage`, `pixel_aktion`, `pixel_abrechnung`).
                    </div>
                  </div>

                  {effectivePendingCount > 0 && (
                    <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between gap-2 text-[10px] text-amber-900">
                      <span>
                        {effectivePendingCount} lokale Änderung(en) warten auf Übertragung.
                      </span>
                      <button
                        type="button"
                        onClick={() => void flushPendingAppSync()}
                        className="h-7 px-2.5 bg-amber-700 text-white font-semibold rounded-md shrink-0"
                      >
                        Jetzt senden
                      </button>
                    </div>
                  )}

                  {isNativeAndroid &&
                    (nativeSyncStatus?.state === 'offline' ||
                      nativeSyncStatus?.state === 'offline_queued') && (
                      <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-[10px] text-amber-900 flex items-center gap-1.5">
                        <WifiOff size={13} className="shrink-0" />
                        <span>
                          Offline-Modus: Änderungen lokal gesichert – automatische Übertragung sobald WLAN/5G verfügbar ist.
                        </span>
                      </div>
                    )}

                  {isNativeAndroid && nativeSyncStatus?.lastError && (
                    <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-[10px] text-red-800 flex items-center gap-1.5">
                      <AlertCircle size={13} className="shrink-0" />
                      <span>{nativeSyncStatus.lastError}</span>
                    </div>
                  )}

                  {/* 1. MCP-Server-Adresse (für ChatGPT) – Identisch in Web-App & Android-App */}
                  <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-lg space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold text-[#3138A0] uppercase tracking-tight">
                        1. MCP-Server-Adresse (für ChatGPT)
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopyText('mcp_url', effectiveMcpUrl, 'MCP-Server-Adresse')
                        }
                        className="h-7 px-2.5 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 text-white text-[10px] font-semibold rounded-md flex items-center gap-1 shrink-0 transition-all"
                      >
                        {copiedKey === 'mcp_url' ? <Check size={11} /> : <Copy size={11} />}
                        <span>{copiedKey === 'mcp_url' ? 'Kopiert' : 'URL kopieren'}</span>
                      </button>
                    </div>
                    <p className="text-[11px] font-mono text-slate-800 break-all leading-snug select-all bg-white border border-slate-200/80 rounded-md px-2 py-1.5">
                      {effectiveMcpUrl}
                    </p>
                    <span className="text-[10px] text-slate-500 block">
                      Verbindung in ChatGPT: <strong>OAuth (1-Klick-Freigabe ohne Passwort-Eingabe)</strong> oder{' '}
                      <strong>Bearer-Schlüssel</strong> unten kopieren
                    </span>
                  </div>

                  {/* 2. MCP-Zugangsschlüssel (direkt auslesbar & kopierbar in Web-App & Android-App) */}
                  <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-lg space-y-2">
                    <span className="text-[10px] font-bold text-slate-800 uppercase tracking-tight block">
                      2. MCP-Zugangsschlüssel (Bearer / API-Key)
                    </span>
                    <p className="text-[11px] font-mono text-slate-800 break-all leading-snug select-all bg-white border border-slate-200/80 rounded-md px-2 py-1.5">
                      {showSecretToken
                        ? resolveCurrentFullTokenSync() || effectiveMaskedToken
                        : effectiveMaskedToken}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void handleToggleShowSecret()}
                        className="h-8 px-2.5 bg-white hover:bg-slate-100 active:scale-98 border border-slate-300 text-slate-800 text-[11px] font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all"
                      >
                        {showSecretToken ? <EyeOff size={13} /> : <Eye size={13} />}
                        <span>{showSecretToken ? 'Verbergen' : 'Anzeigen'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopyAdminToken()}
                        className="h-8 px-2.5 bg-slate-900 hover:bg-slate-800 active:scale-98 text-white text-[11px] font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all"
                      >
                        {copiedKey === 'mcp_token' ? <Check size={13} /> : <Copy size={13} />}
                        <span>
                          {copiedKey === 'mcp_token' ? 'Kopiert!' : 'Schlüssel kopieren'}
                        </span>
                      </button>
                    </div>
                    {copiedKey === 'mcp_token' && (
                      <div className="px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-md text-[10px] font-semibold text-[#2C7738] flex items-center gap-1">
                        <Check size={11} className="shrink-0" />
                        <span>MCP-Zugangsschlüssel in die Zwischenablage kopiert.</span>
                      </div>
                    )}
                  </div>

                  {/* 3. Automatische Verbindung ohne Einmal-Code + 1-Klick-Reset */}
                  <div className="flex items-center justify-between gap-2 pt-0.5 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleOneClickReconnectReset()}
                        disabled={resetInProgress}
                        className="h-8 px-2.5 bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] text-[11px] font-semibold rounded-lg flex items-center gap-1 transition-colors"
                      >
                        <RefreshCw size={11} className={resetInProgress ? 'animate-spin' : ''} />
                        <span>
                          {resetDoneBanner
                            ? 'Verbindung frisch synchronisiert'
                            : '1-Klick-Reset / Jetzt abgleichen'}
                        </span>
                      </button>
                    </div>

                    {mcpInfo?.tokenSource !== 'env' && (
                      <button
                        type="button"
                        onClick={() => void handleRotateMcpToken()}
                        disabled={rotatingToken}
                        className="h-8 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold rounded-lg flex items-center gap-1 transition-colors"
                      >
                        <RefreshCw size={11} className={rotatingToken ? 'animate-spin' : ''} />
                        <span>Schlüssel erneuern</span>
                      </button>
                    )}
                  </div>

                  {(effectiveLastSyncIso || effectiveTotalCalls > 0) && (
                    <p className="text-[10px] text-slate-500">
                      {effectiveLastSyncIso ? (
                        <>
                          Letzter Abgleich:{' '}
                          <span className="font-semibold text-slate-700">
                            {new Date(effectiveLastSyncIso).toLocaleString('de-AT')}
                          </span>
                        </>
                      ) : null}
                      {effectiveTotalCalls > 0 ? ` · ChatGPT-Aufrufe: ${effectiveTotalCalls}` : ''}
                    </p>
                  )}
                </div>
              </div>

              {statusChecked && (
                <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-[#2C7738] font-semibold flex items-center gap-1.5 animate-fade-in">
                  <CheckCircle size={14} />
                  <span>
                    MCP-Verbindung, OAuth-2.1-Endpunkte und Hintergrund-Synchronisation geprüft.
                  </span>
                </div>
              )}

              <button
                onClick={() => void handleStatusCheck()}
                disabled={statusCheckRunning}
                className="w-full h-11 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-all"
              >
                <span>{statusCheckRunning ? 'Prüfe Verbindung…' : 'Verbindungsstatus prüfen'}</span>
              </button>
            </div>
          )}
          </div>
        )}

        {/* GRUPPE 4: Speicher und App */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
          <button
            onClick={() => setSpeicherOpen(!speicherOpen)}
            className="w-full min-h-[48px] p-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
          >
            <div>
              <span className="text-xs font-bold text-slate-900 block leading-tight">
                Speicher und App
              </span>
              <span className="text-[11px] text-slate-500">
                Startbildschirm-Icon · 128 MB insgesamt · Bereinigung
              </span>
            </div>
            {speicherOpen ? (
              <ChevronDown size={16} className="text-slate-400" />
            ) : (
              <ChevronRight size={16} className="text-slate-400" />
            )}
          </button>

          {speicherOpen && (
            <div className="p-3.5 bg-slate-50 border-t border-slate-100 space-y-3">
              <PWAInstallCard />

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2.5 bg-white border border-slate-200 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                    Fotos & Medien
                  </span>
                  <span className="text-sm font-bold text-slate-900 font-mono">112 MB</span>
                </div>
                <div className="p-2.5 bg-white border border-slate-200 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                    App-Daten
                  </span>
                  <span className="text-sm font-bold text-slate-900 font-mono">16 MB</span>
                </div>
              </div>

              {storageCleaned && (
                <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-[#2C7738] font-semibold flex items-center gap-1.5 animate-fade-in">
                  <CheckCircle size={14} />
                  <span>Temporäre Arbeitsdaten bereinigt. Geschützte Originale unverändert.</span>
                </div>
              )}

              <button
                onClick={handleCleanStorage}
                className="w-full h-11 bg-white hover:bg-slate-100 active:scale-98 border border-slate-200 text-slate-800 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-2xs"
              >
                <Trash2 size={14} className="text-[#3138A0]" />
                <span>Speicher bereinigen</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-md">
        <BottomActionBar />
        <BottomNav />
      </div>
    </div>
  );
};
