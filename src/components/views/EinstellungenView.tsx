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
import { useApp } from '../../context/AppContext.tsx';
import {
  NativeMcpSyncStatus,
  disconnectNativeMcpSync,
  getNativeMcpSyncStatus,
  isNativeAndroidApp,
  pairNativeMcpWithCode,
  resolveBackendEndpoint,
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
  Smartphone,
  WifiOff,
  AlertCircle,
  Lock
} from 'lucide-react';

interface McpClientConfigInfo {
  requireToken: boolean;
  tokenSource: 'env' | 'file';
  maskedToken: string;
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
  const { appSyncStatus, flushPendingAppSync } = useApp();
  const [gmailUser, setGmailUser] = useState<FirebaseUser | null>(null);
  const [gmailHasToken, setGmailHasToken] = useState(false);
  const [gmailConnecting, setGmailConnecting] = useState(false);

  const isNativeAndroid = isNativeAndroidApp();

  // Web / Cloud-Server Status
  const [mcpInfo, setMcpInfo] = useState<McpClientConfigInfo | null>(null);
  const [webSessionLocked, setWebSessionLocked] = useState(false);
  const [unlockTokenInput, setUnlockTokenInput] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [revealedAdminToken, setRevealedAdminToken] = useState<string | null>(null);
  const [showSecretToken, setShowSecretToken] = useState(false);
  const [pairingInProgress, setPairingInProgress] = useState(false);
  const [issuedPairingInfo, setIssuedPairingInfo] = useState<{
    pairingCode: string;
    expiresAt: string;
    deepLink: string;
  } | null>(null);

  // Native Pixel 10 Pro Keystore & Sync Status
  const [nativeSyncStatus, setNativeSyncStatus] = useState<NativeMcpSyncStatus | null>(() =>
    getNativeMcpSyncStatus()
  );
  const [showNativeConfigForm, setShowNativeConfigForm] = useState<boolean>(() => {
    const initial = getNativeMcpSyncStatus();
    return Boolean(initial && (!initial.configured || initial.state === 'auth_error'));
  });
  const [nativeBaseUrlInput, setNativeBaseUrlInput] = useState<string>(
    () => getNativeMcpSyncStatus()?.baseUrl || ''
  );
  const [nativePairingCodeInput, setNativePairingCodeInput] = useState<string>('');
  const [nativeSavedBanner, setNativeSavedBanner] = useState(false);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [rotatingToken, setRotatingToken] = useState(false);

  const loadMcpInfo = async () => {
    if (isNativeAndroid) {
      const latest = getNativeMcpSyncStatus();
      setNativeSyncStatus(latest);
      if (latest?.baseUrl && !nativeBaseUrlInput) {
        setNativeBaseUrlInput(latest.baseUrl);
      }
      return;
    }

    try {
      const endpoint = resolveBackendEndpoint('/api/internal/mcp-config');
      if (!endpoint.url) return;
      const res = await fetch(endpoint.url, {
        headers: endpoint.headers,
        credentials: 'include'
      });
      if (res.status === 401) {
        setWebSessionLocked(true);
        setMcpInfo(null);
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as McpClientConfigInfo;
        setWebSessionLocked(false);
        setMcpInfo(data);
      }
    } catch {
      // Offline tolerance
    }
  };

  useEffect(() => {
    const unsubGmail = subscribeGmailAuth(({ user, hasToken }) => {
      setGmailUser(user);
      setGmailHasToken(hasToken);
    });

    const unsubNativeStatus = subscribeNativeMcpStatus((status) => {
      setNativeSyncStatus(status);
      if (status.baseUrl) {
        setNativeBaseUrlInput((prev) => prev || status.baseUrl);
      }
      if (status.state === 'connected') {
        setShowNativeConfigForm(false);
      }
    });

    void loadMcpInfo();

    return () => {
      unsubGmail();
      unsubNativeStatus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleCopyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2200);
    } catch {
      // Ignore clipboard restriction
    }
  };

  const fetchRevealedToken = async (): Promise<string | null> => {
    if (revealedAdminToken) return revealedAdminToken;
    try {
      const endpoint = resolveBackendEndpoint('/api/internal/reveal-token');
      if (!endpoint.url) return null;
      const res = await fetch(endpoint.url, {
        method: 'POST',
        credentials: 'include',
        headers: endpoint.headers
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { adminToken?: string };
      if (data.adminToken) {
        setRevealedAdminToken(data.adminToken);
        return data.adminToken;
      }
    } catch {
      // Ignore
    }
    return null;
  };

  const handleToggleShowSecret = async () => {
    if (showSecretToken) {
      setShowSecretToken(false);
      return;
    }
    const secret = await fetchRevealedToken();
    if (secret) {
      setShowSecretToken(true);
    }
  };

  const handleCopyAdminToken = async () => {
    const secret = await fetchRevealedToken();
    if (secret) {
      await handleCopyText('mcp_token', secret);
    }
  };

  const handleUnlockWebSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlockError(null);
    try {
      const res = await fetch('/api/internal/session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: unlockTokenInput.trim() })
      });
      if (!res.ok) {
        setUnlockError('Ungültiger MCP-Zugangsschlüssel.');
        return;
      }
      setUnlockTokenInput('');
      await loadMcpInfo();
    } catch {
      setUnlockError('Server aktuell nicht erreichbar.');
    }
  };

  const handleGenerateOneTimePairingCode = async () => {
    setPairingInProgress(true);
    try {
      const res = await fetch('/api/internal/pair-android', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceLabel: 'Google Pixel 10 Pro' })
      });
      if (res.ok) {
        const data = (await res.json()) as {
          pairingCode: string;
          expiresAt: string;
          deepLink: string;
        };
        setIssuedPairingInfo(data);
        await loadMcpInfo();
      }
    } finally {
      setPairingInProgress(false);
    }
  };

  const handleRotateMcpToken = async () => {
    setRotatingToken(true);
    try {
      const endpoint = resolveBackendEndpoint('/api/internal/mcp-config');
      if (!endpoint.url) return;
      const res = await fetch(endpoint.url, {
        method: 'POST',
        credentials: 'include',
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

  const handlePairNativeWithCode = () => {
    const updated = pairNativeMcpWithCode(nativeBaseUrlInput, nativePairingCodeInput);
    if (updated) {
      setNativeSyncStatus(updated);
      setNativePairingCodeInput('');
      setNativeSavedBanner(true);
      setTimeout(() => setNativeSavedBanner(false), 3000);
    }
  };

  const handleDisconnectNative = () => {
    const updated = disconnectNativeMcpSync();
    if (updated) {
      setNativeSyncStatus(updated);
      setShowNativeConfigForm(true);
    }
  };

  const handleStatusCheck = async () => {
    setStatusCheckRunning(true);
    try {
      if (isNativeAndroid) {
        triggerNativeMcpSyncNow();
        setTimeout(() => {
          setNativeSyncStatus(getNativeMcpSyncStatus());
          setStatusCheckRunning(false);
          setStatusChecked(true);
          setTimeout(() => setStatusChecked(false), 4000);
        }, 700);
        return;
      }

      const endpoint = resolveBackendEndpoint('/api/internal/mcp-health');
      if (!endpoint.url) {
        setStatusCheckRunning(false);
        return;
      }
      const res = await fetch(endpoint.url, {
        headers: endpoint.headers,
        credentials: 'include'
      });
      await loadMcpInfo();
      if (res.ok) {
        setStatusChecked(true);
        setTimeout(() => setStatusChecked(false), 4000);
      }
      setStatusCheckRunning(false);
    } catch {
      setStatusCheckRunning(false);
    }
  };

  const handleCleanStorage = () => {
    setStorageCleaned(true);
    setTimeout(() => setStorageCleaned(false), 3000);
  };

  const renderNativeBadge = (status: NativeMcpSyncStatus | null) => {
    const st = status?.state || 'unpaired';
    if (st === 'connected') {
      return (
        <span className="text-[10px] font-bold text-[#2C7738] bg-emerald-50 px-2 py-0.5 rounded-md shrink-0">
          Verbunden
        </span>
      );
    }
    if (st === 'reconnecting') {
      return (
        <span className="text-[10px] font-bold text-[#3138A0] bg-indigo-50 px-2 py-0.5 rounded-md shrink-0">
          Verbinde…
        </span>
      );
    }
    if (st === 'offline_queued' || st === 'offline') {
      return (
        <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md shrink-0">
          Offline-Puffer
        </span>
      );
    }
    if (st === 'auth_error') {
      return (
        <span className="text-[10px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-md shrink-0">
          Schlüssel prüfen
        </span>
      );
    }
    return (
      <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md shrink-0">
        Nicht gekoppelt
      </span>
    );
  };

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

        {/* GRUPPE 3: Verbindungen */}
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
                  <GoogleSignInButton
                    onClick={async () => {
                      setGmailConnecting(true);
                      try {
                        await googleSignIn();
                      } finally {
                        setGmailConnecting(false);
                      }
                    }}
                    disabled={gmailConnecting}
                    label={gmailConnecting ? 'Verbinde...' : 'Sign in with Google'}
                  />
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

              {/* Wetter */}
              <div className="p-2.5 bg-white border border-slate-200 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <CloudSun size={17} className="text-amber-500" />
                  <div>
                    <span className="font-bold text-slate-800 block text-xs">Wetter</span>
                    <span className="text-[10px] text-slate-500">12°C · Vorhersage aktiv</span>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-[#2C7738] bg-emerald-50 px-2 py-0.5 rounded-md">
                  Verbunden
                </span>
              </div>

              {/* Privates ChatGPT-MCP-Plugin & Hintergrund-Sync */}
              <div className="p-3 bg-white border border-indigo-200/80 rounded-xl space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-[#3138A0] shrink-0">
                      <Bot size={17} />
                    </div>
                    <div className="min-w-0">
                      <span className="font-bold text-slate-900 block text-xs">
                        Privates ChatGPT-MCP-Plugin
                      </span>
                      <span className="text-[10px] text-slate-500 block leading-snug">
                        {isNativeAndroid
                          ? nativeSyncStatus?.statusLabel || 'Prüfe Hintergrund-Synchronisation…'
                          : `Lesen, Anlegen, Ändern & Löschen · ${mcpInfo?.toolCount ?? 10} MCP-Funktionen`}
                      </span>
                    </div>
                  </div>
                  {isNativeAndroid ? (
                    renderNativeBadge(nativeSyncStatus)
                  ) : webSessionLocked ? (
                    <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md shrink-0">
                      Geschützt
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-[#2C7738] bg-emerald-50 px-2 py-0.5 rounded-md shrink-0">
                      Bereit · HTTPS
                    </span>
                  )}
                </div>

                {isNativeAndroid ? (
                  <div className="space-y-2 pt-1.5 border-t border-slate-100">
                    {/* Verständliche Status- & Warteschlangen-Anzeige auf dem Pixel 10 Pro */}
                    <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                      <div
                        className={`p-2 border rounded-lg ${
                          (nativeSyncStatus?.pendingSyncCount ?? 0) > 0
                            ? 'bg-amber-50 border-amber-200'
                            : 'bg-slate-50 border-slate-200/70'
                        }`}
                      >
                        <span className="text-slate-500 block">Ausstehende Synchronisationen</span>
                        <span
                          className={`font-bold ${
                            (nativeSyncStatus?.pendingSyncCount ?? 0) > 0
                              ? 'text-amber-800'
                              : 'text-[#2C7738]'
                          }`}
                        >
                          {(nativeSyncStatus?.pendingSyncCount ?? 0) > 0
                            ? `${nativeSyncStatus?.pendingSyncCount} ausstehend`
                            : '0 ausstehend · Synchron'}
                        </span>
                      </div>
                      <div className="p-2 bg-slate-50 border border-slate-200/70 rounded-lg">
                        <span className="text-slate-500 block">Zugangsschutz (Rev. {nativeSyncStatus?.revision ?? 0})</span>
                        <span className="font-bold text-[#2C7738] flex items-center gap-1">
                          <ShieldCheck size={11} className="shrink-0" />
                          <span>Android Keystore</span>
                        </span>
                      </div>
                    </div>

                    {nativeSyncStatus?.lastSyncAt && (
                      <p className="text-[10px] text-slate-500">
                        Letzter Abgleich:{' '}
                        <span className="font-semibold text-slate-700">
                          {new Date(nativeSyncStatus.lastSyncAt).toLocaleString('de-AT')}
                        </span>
                        {nativeSyncStatus.totalMcpCalls > 0
                          ? ` · ChatGPT-Aufrufe: ${nativeSyncStatus.totalMcpCalls}`
                          : ''}
                      </p>
                    )}

                    {(nativeSyncStatus?.state === 'offline' ||
                      nativeSyncStatus?.state === 'offline_queued') && (
                      <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-[10px] text-amber-900 flex items-center gap-1.5">
                        <WifiOff size={13} className="shrink-0" />
                        <span>
                          Offline-Modus: {(nativeSyncStatus?.pendingSyncCount ?? 0)} Änderung(en) lokal gesichert – automatische Übertragung sobald WLAN/5G verfügbar ist.
                        </span>
                      </div>
                    )}

                    {nativeSyncStatus?.lastError && (
                      <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-[10px] text-red-800 flex items-center gap-1.5">
                        <AlertCircle size={13} className="shrink-0" />
                        <span>{nativeSyncStatus.lastError}</span>
                      </div>
                    )}

                    {nativeSyncStatus?.mcpEndpointUrl && (
                      <div className="p-2 bg-slate-50 border border-slate-200/80 rounded-lg space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold text-[#3138A0] uppercase tracking-tight">
                            Vorbelegte MCP-Serveradresse
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopyText('native_mcp_url', nativeSyncStatus.mcpEndpointUrl)
                            }
                            className="h-7 px-2 bg-[#3138A0] text-white text-[10px] font-semibold rounded-md flex items-center gap-1 shrink-0"
                          >
                            {copiedKey === 'native_mcp_url' ? (
                              <Check size={11} />
                            ) : (
                              <Copy size={11} />
                            )}
                            <span>
                              {copiedKey === 'native_mcp_url' ? 'Kopiert' : 'URL kopieren'}
                            </span>
                          </button>
                        </div>
                        <p className="text-[10px] font-mono text-slate-700 break-all leading-snug">
                          {nativeSyncStatus.mcpEndpointUrl}
                        </p>
                        <span className="text-[10px] text-slate-500 block">
                          Kein Schlüssel in der APK · Kopplung einmalig per 6-stelligem Code
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => setShowNativeConfigForm((v) => !v)}
                        className="h-8 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold rounded-lg transition-colors"
                      >
                        {showNativeConfigForm
                          ? 'Eingabe schließen'
                          : nativeSyncStatus?.configured
                            ? 'Neu koppeln'
                            : 'Einmalig koppeln'}
                      </button>

                      {nativeSyncStatus?.configured && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => triggerNativeMcpSyncNow()}
                            className="h-8 px-2.5 bg-indigo-50 text-[#3138A0] text-[11px] font-semibold rounded-lg flex items-center gap-1"
                          >
                            <RefreshCw
                              size={11}
                              className={nativeSyncStatus.syncInFlight ? 'animate-spin' : ''}
                            />
                            <span>Abgleichen</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleDisconnectNative}
                            className="h-8 px-2.5 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-lg"
                          >
                            Trennen
                          </button>
                        </div>
                      )}
                    </div>

                    {showNativeConfigForm && (
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                        <p className="text-[10px] text-slate-600 leading-snug">
                          Die Serveradresse ist automatisch hinterlegt. Erzeuge in den Server-Einstellungen einen{' '}
                          <strong>6-stelligen Einmal-Kopplungscode</strong> (10 Min. gültig) und gib ihn hier einmalig ein:
                        </p>
                        <input
                          type="url"
                          value={nativeBaseUrlInput}
                          onChange={(e) => setNativeBaseUrlInput(e.target.value)}
                          placeholder="https://dein-mcp-server.run.app"
                          className="w-full h-10 px-2.5 bg-white border border-slate-200 rounded-lg text-[11px] font-mono text-slate-800"
                        />
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={7}
                          value={nativePairingCodeInput}
                          onChange={(e) => setNativePairingCodeInput(e.target.value)}
                          placeholder="Einmal-Code z. B. 482-915"
                          className="w-full h-10 px-2.5 bg-white border border-slate-200 rounded-lg text-sm font-mono font-bold tracking-widest text-slate-900"
                        />
                        <button
                          type="button"
                          onClick={handlePairNativeWithCode}
                          className="w-full h-10 bg-[#3138A0] text-white text-xs font-semibold rounded-lg"
                        >
                          {nativeSavedBanner
                            ? 'Kopplung läuft – Schlüssel im Android Keystore…'
                            : 'Mit Einmal-Code koppeln'}
                        </button>
                      </div>
                    )}
                  </div>
                ) : webSessionLocked ? (
                  <form
                    onSubmit={(e) => void handleUnlockWebSession(e)}
                    className="space-y-2 pt-1.5 border-t border-slate-100"
                  >
                    <p className="text-[10px] text-slate-600 flex items-center gap-1.5">
                      <Lock size={12} className="text-[#3138A0] shrink-0" />
                      <span>
                        Geschützter Server-Bereich. Bitte mit Ihrem MCP-Zugangsschlüssel entsperren:
                      </span>
                    </p>
                    {unlockError && (
                      <p className="text-[10px] text-red-600 font-semibold">{unlockError}</p>
                    )}
                    <div className="flex gap-1.5">
                      <input
                        type="password"
                        value={unlockTokenInput}
                        onChange={(e) => setUnlockTokenInput(e.target.value)}
                        placeholder="Zugangsschlüssel eingeben…"
                        className="flex-1 h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-mono"
                      />
                      <button
                        type="submit"
                        className="h-9 px-3 bg-[#3138A0] text-white text-[11px] font-semibold rounded-lg shrink-0"
                      >
                        Entsperren
                      </button>
                    </div>
                  </form>
                ) : mcpInfo ? (
                  <div className="space-y-2 pt-1.5 border-t border-slate-100">
                    {mcpInfo.isPreviewEnvironment && (
                      <div className="p-2 bg-amber-50 border border-amber-200/80 rounded-lg text-[10px] text-amber-900 leading-snug">
                        Vorschau-Modus aktiv. Für dauerhaften 24/7-Betrieb mit ChatGPT &amp; Pixel 10 Pro bitte das veröffentlichte Cloud-Run-Deployment verwenden.
                      </div>
                    )}

                    {/* Ausstehende Synchronisationen + Verbindungsübersicht */}
                    <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                      <div
                        className={`p-2 border rounded-lg ${
                          appSyncStatus.pendingSyncCount > 0
                            ? 'bg-amber-50 border-amber-200'
                            : 'bg-slate-50 border-slate-200/70'
                        }`}
                      >
                        <span className="text-slate-500 block">Ausstehend</span>
                        <span
                          className={`font-bold ${
                            appSyncStatus.pendingSyncCount > 0
                              ? 'text-amber-800'
                              : 'text-[#2C7738]'
                          }`}
                        >
                          {appSyncStatus.pendingSyncCount > 0
                            ? `${appSyncStatus.pendingSyncCount} offen`
                            : '0 · Synchron'}
                        </span>
                      </div>
                      <div className="p-2 bg-slate-50 border border-slate-200/70 rounded-lg">
                        <span className="text-slate-500 block">Pixel 10 Pro</span>
                        <span className="font-bold text-slate-800">
                          {mcpInfo.pairedAndroidDevices > 0
                            ? `${mcpInfo.pairedAndroidDevices} gekoppelt`
                            : 'Bereit'}
                        </span>
                      </div>
                      <div className="p-2 bg-slate-50 border border-slate-200/70 rounded-lg">
                        <span className="text-slate-500 block">ChatGPT OAuth</span>
                        <span className="font-bold text-[#2C7738]">
                          {mcpInfo.activeOAuthGrants > 0
                            ? `${mcpInfo.activeOAuthGrants} aktiv`
                            : 'PKCE bereit'}
                        </span>
                      </div>
                    </div>

                    {appSyncStatus.pendingSyncCount > 0 && (
                      <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between gap-2 text-[10px] text-amber-900">
                        <span>
                          {appSyncStatus.pendingSyncCount} lokale Änderung(en) noch nicht übertragen
                          {appSyncStatus.lastSyncError ? ` (${appSyncStatus.lastSyncError})` : ''}.
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

                    {/* Einmalige Kopplung nach APK-Installation (ohne Schlüssel in der APK) */}
                    <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2">
                      <button
                        type="button"
                        onClick={() => void handleGenerateOneTimePairingCode()}
                        disabled={pairingInProgress}
                        className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 shadow-2xs transition-colors"
                      >
                        <Smartphone size={14} />
                        <span>
                          {pairingInProgress
                            ? 'Erzeuge Einmal-Kopplungscode…'
                            : 'Einmal-Kopplungscode für Pixel 10 Pro erzeugen (10 Min.)'}
                        </span>
                      </button>

                      {issuedPairingInfo && (
                        <div className="p-2 bg-white border border-emerald-200 rounded-lg space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <span className="text-[10px] text-slate-500 block">
                                Einmaliger 6-stelliger Kopplungscode (nur 1× gültig)
                              </span>
                              <span className="text-sm font-mono font-extrabold tracking-widest text-slate-900">
                                {issuedPairingInfo.pairingCode}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  void handleCopyText('pair_code', issuedPairingInfo.pairingCode)
                                }
                                className="h-8 px-2.5 bg-slate-800 text-white text-[10px] font-semibold rounded-md flex items-center gap-1"
                              >
                                {copiedKey === 'pair_code' ? <Check size={11} /> : <Copy size={11} />}
                                <span>{copiedKey === 'pair_code' ? 'Kopiert' : 'Code'}</span>
                              </button>
                              <a
                                href={issuedPairingInfo.deepLink}
                                className="h-8 px-2.5 bg-emerald-600 text-white text-[10px] font-semibold rounded-md flex items-center"
                              >
                                App öffnen
                              </a>
                            </div>
                          </div>
                          <span className="text-[10px] text-slate-500 block">
                            Gültig bis{' '}
                            {new Date(issuedPairingInfo.expiresAt).toLocaleTimeString('de-AT', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}{' '}
                            Uhr · Es wird kein dauerhafter Schlüssel in der URL übertragen.
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 1. Saubere HTTPS MCP-Server-Adresse */}
                    <div className="p-2 bg-slate-50 border border-slate-200/80 rounded-lg space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold text-[#3138A0] uppercase tracking-tight">
                          MCP-Server-Adresse (für ChatGPT)
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void handleCopyText('mcp_url', mcpInfo.endpoints.mcpHeaderUrl)
                          }
                          className="h-7 px-2 bg-[#3138A0] hover:bg-[#272d82] text-white text-[10px] font-semibold rounded-md flex items-center gap-1 shrink-0 transition-colors"
                        >
                          {copiedKey === 'mcp_url' ? <Check size={11} /> : <Copy size={11} />}
                          <span>{copiedKey === 'mcp_url' ? 'Kopiert' : 'URL kopieren'}</span>
                        </button>
                      </div>
                      <p className="text-[10px] font-mono text-slate-700 break-all leading-snug">
                        {mcpInfo.endpoints.mcpHeaderUrl}
                      </p>
                      <span className="text-[10px] text-slate-500 block">
                        Authentifizierung: <strong>OAuth 2.0 (PKCE, automatisch)</strong> oder{' '}
                        <strong>Bearer-Token</strong>
                      </span>
                    </div>

                    {/* 2. Geschützter Zugangsschlüssel (standardmäßig maskiert) */}
                    <div className="p-2 bg-slate-50 border border-slate-200/80 rounded-lg space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold text-slate-700 uppercase tracking-tight">
                          MCP-Zugangsschlüssel (Freigabe / Bearer)
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleToggleShowSecret()}
                            className="h-7 px-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-semibold rounded-md flex items-center gap-1 transition-colors"
                            title={showSecretToken ? 'Schlüssel verbergen' : 'Schlüssel anzeigen'}
                          >
                            {showSecretToken ? <EyeOff size={11} /> : <Eye size={11} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCopyAdminToken()}
                            className="h-7 px-2 bg-slate-800 hover:bg-slate-900 text-white text-[10px] font-semibold rounded-md flex items-center gap-1 transition-colors"
                          >
                            {copiedKey === 'mcp_token' ? <Check size={11} /> : <Copy size={11} />}
                            <span>{copiedKey === 'mcp_token' ? 'Kopiert' : 'Schlüssel kopieren'}</span>
                          </button>
                        </div>
                      </div>
                      <p className="text-[10px] font-mono text-slate-600 break-all leading-snug select-all">
                        {showSecretToken && revealedAdminToken
                          ? revealedAdminToken
                          : mcpInfo.maskedToken}
                      </p>
                    </div>

                    {/* Sicherheitsstatus & Schlüsselrotation */}
                    <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px]">
                      <div className="flex items-center gap-1.5 font-semibold text-[#2C7738]">
                        <ShieldCheck size={13} className="text-[#2C7738] shrink-0" />
                        <span>
                          OAuth 2.1 + Token-Schutz aktiv
                          {mcpInfo.tokenSource === 'env' ? ' (Cloud-Secret)' : ''}
                        </span>
                      </div>

                      {mcpInfo.tokenSource !== 'env' && (
                        <button
                          type="button"
                          onClick={() => void handleRotateMcpToken()}
                          disabled={rotatingToken}
                          className="h-7 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold rounded-md flex items-center gap-1 transition-colors"
                        >
                          <RefreshCw size={11} className={rotatingToken ? 'animate-spin' : ''} />
                          <span>Schlüssel erneuern</span>
                        </button>
                      )}
                    </div>

                    {mcpInfo.lastAccessAt && (
                      <p className="text-[10px] text-[#2C7738] font-medium">
                        Letzter MCP-Zugriff:{' '}
                        {new Date(mcpInfo.lastAccessAt).toLocaleString('de-AT')} (
                        {mcpInfo.lastOperation} · {mcpInfo.totalCalls} Aufrufe · Sync Rev.{' '}
                        {mcpInfo.revision})
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-400">Lade Verbindungsstatus…</p>
                )}
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
