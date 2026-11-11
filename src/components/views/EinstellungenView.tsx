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
import {
  getRemoteSyncConfig,
  isNativeAndroidApp,
  resolveBackendEndpoint,
  setRemoteSyncConfig
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
  EyeOff
} from 'lucide-react';

interface McpClientConfigInfo {
  requireToken: boolean;
  tokenSource: 'env' | 'file';
  adminToken: string;
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
    mcpDirectTokenUrl: string;
  };
}

export const EinstellungenView: React.FC = () => {
  const [gmailUser, setGmailUser] = useState<FirebaseUser | null>(null);
  const [gmailHasToken, setGmailHasToken] = useState(false);
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [mcpInfo, setMcpInfo] = useState<McpClientConfigInfo | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [rotatingToken, setRotatingToken] = useState(false);
  const [showSecretToken, setShowSecretToken] = useState(false);

  const isNativeAndroid = isNativeAndroidApp();
  const [remoteBaseUrl, setRemoteBaseUrl] = useState(() => getRemoteSyncConfig().baseUrl);
  const [remoteToken, setRemoteToken] = useState(() => getRemoteSyncConfig().token);
  const [remoteSavedMsg, setRemoteSavedMsg] = useState(false);

  const loadMcpInfo = async () => {
    try {
      const endpoint = resolveBackendEndpoint('/api/internal/mcp-config');
      if (!endpoint.url) {
        setMcpInfo(null);
        return;
      }
      const res = await fetch(endpoint.url, { headers: endpoint.headers });
      if (res.ok) {
        const data = (await res.json()) as McpClientConfigInfo;
        setMcpInfo(data);
      }
    } catch {
      // ignore offline
    }
  };

  useEffect(() => {
    const unsub = subscribeGmailAuth(({ user, hasToken }) => {
      setGmailUser(user);
      setGmailHasToken(hasToken);
    });
    void loadMcpInfo();
    return unsub;
  }, []);

  const [arbeitsvorgabenOpen, setArbeitsvorgabenOpen] = useState(false);
  const [rechnungsdatenOpen, setRechnungsdatenOpen] = useState(false);
  const [verbindungenOpen, setVerbindungenOpen] = useState(true);
  const [speicherOpen, setSpeicherOpen] = useState(false);

  // Settings values
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
      // fallback ignore
    }
  };

  const handleRotateMcpToken = async () => {
    setRotatingToken(true);
    try {
      const endpoint = resolveBackendEndpoint('/api/internal/mcp-config');
      if (!endpoint.url) return;
      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...endpoint.headers
        },
        body: JSON.stringify({ rotate: true })
      });
      if (res.ok) {
        await loadMcpInfo();
      }
    } finally {
      setRotatingToken(false);
    }
  };

  const handleStatusCheck = async () => {
    setStatusCheckRunning(true);
    try {
      const endpoint = resolveBackendEndpoint('/api/internal/mcp-health');
      if (!endpoint.url) return;
      const res = await fetch(endpoint.url, { headers: endpoint.headers });
      await loadMcpInfo();
      if (res.ok) {
        setStatusChecked(true);
        setTimeout(() => setStatusChecked(false), 4000);
      }
    } finally {
      setStatusCheckRunning(false);
    }
  };

  const handleSaveRemoteMcpSync = async () => {
    setRemoteSyncConfig(remoteBaseUrl, remoteToken);
    setRemoteSavedMsg(true);
    await loadMcpInfo();
    setTimeout(() => setRemoteSavedMsg(false), 3000);
  };

  const handleCleanStorage = () => {
    setStorageCleaned(true);
    setTimeout(() => setStorageCleaned(false), 3000);
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
            {arbeitsvorgabenOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
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
            {rechnungsdatenOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
          </button>

          {rechnungsdatenOpen && (
            <div className="p-3.5 bg-slate-50 border-t border-slate-100 space-y-3">
              <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3">
                <div className="space-y-0.5 text-[11px] text-slate-600">
                  <span className="font-bold text-slate-900 block text-xs">
                    {ISSUER_NAME} · Grünraum Handwerk
                  </span>
                  <span className="block">{ISSUER_STREET}, {ISSUER_CITY}</span>
                  <span className="block">Tel. {ISSUER_PHONE} · {ISSUER_EMAIL}</span>
                  <span className="block">{ISSUER_COURT} · Steuer-Nr. {ISSUER_TAX_NR}</span>
                </div>
                <img
                  src={HAFNER_LOGO_URL}
                  alt="Hafner Logo"
                  className="w-16 h-16 object-contain shrink-0"
                />
              </div>

              <div className="p-2.5 bg-white border border-slate-200 rounded-xl text-[11px] text-slate-600">
                <span className="font-semibold text-slate-800 block text-xs">Bankverbindung</span>
                <span>{ISSUER_BANK_NAME} · IBAN {ISSUER_IBAN} · BIC {ISSUER_BIC}</span>
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

        {/* GRUPPE 3: Verbindungen (M14, ILL-014, WF-023) */}
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
                Kalender, Wetter und ChatGPT / Codex (MCP)
              </span>
            </div>
            {verbindungenOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
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

              {/* Direkter MCP-Zugang für privates ChatGPT-Plugin (Lesen & Schreiben) */}
              <div className="p-3 bg-white border border-indigo-200/80 rounded-xl space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-[#3138A0] shrink-0">
                      <Bot size={17} />
                    </div>
                    <div className="min-w-0">
                      <span className="font-bold text-slate-900 block text-xs">
                        Direkter MCP-Zugang (ChatGPT-Plugin)
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        Lesen & Schreiben · {mcpInfo?.toolCount ?? 12} MCP-Tools · Sync Rev. {mcpInfo?.revision ?? 0}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold text-[#2C7738] bg-emerald-50 px-2 py-0.5 rounded-md shrink-0">
                    HTTPS · Aktiv
                  </span>
                </div>

                {mcpInfo ? (
                  <div className="space-y-2 pt-1 border-t border-slate-100">
                    {mcpInfo.isPreviewEnvironment && (
                      <div className="p-2 bg-amber-50 border border-amber-200/80 rounded-lg text-[10px] text-amber-900 leading-snug">
                        Hinweis: Aktuell AI-Studio-Vorschau geöffnet. Nach dem Cloud-Run-Deployment zeigt diese Ansicht automatisch Ihre dauerhaft erreichbare HTTPS-Adresse.
                      </div>
                    )}

                    {/* 1. Saubere HTTPS MCP-Server-Adresse (ohne Schlüssel im Pfad) */}
                    <div className="p-2 bg-slate-50 border border-slate-200/80 rounded-lg space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold text-[#3138A0] uppercase tracking-tight">
                          MCP-Server-Adresse (HTTPS)
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
                    </div>

                    {/* 2. Geschützter Bearer-Schlüssel (standardmäßig maskiert gegen Screenshot-Leaks) */}
                    <div className="p-2 bg-slate-50 border border-slate-200/80 rounded-lg space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold text-slate-700 uppercase tracking-tight">
                          Geheimer MCP-Schlüssel (Bearer)
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setShowSecretToken((v) => !v)}
                            className="h-7 px-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-semibold rounded-md flex items-center gap-1 transition-colors"
                            title={showSecretToken ? 'Schlüssel verbergen' : 'Schlüssel anzeigen'}
                          >
                            {showSecretToken ? <EyeOff size={11} /> : <Eye size={11} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCopyText('mcp_token', mcpInfo.adminToken)}
                            className="h-7 px-2 bg-slate-800 hover:bg-slate-900 text-white text-[10px] font-semibold rounded-md flex items-center gap-1 transition-colors"
                          >
                            {copiedKey === 'mcp_token' ? <Check size={11} /> : <Copy size={11} />}
                            <span>{copiedKey === 'mcp_token' ? 'Kopiert' : 'Token kopieren'}</span>
                          </button>
                        </div>
                      </div>
                      <p className="text-[10px] font-mono text-slate-600 break-all leading-snug select-all">
                        {showSecretToken
                          ? mcpInfo.adminToken
                          : `${mcpInfo.adminToken.slice(0, 8)}••••••••••••••••••••••••••••••••`}
                      </p>
                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        <span className="text-[10px] text-slate-400">
                          Alternativ für Direkt-URL-Clients:
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void handleCopyText('mcp_direct', mcpInfo.endpoints.mcpDirectTokenUrl)
                          }
                          className="text-[10px] font-semibold text-[#3138A0] hover:underline flex items-center gap-1 shrink-0"
                        >
                          {copiedKey === 'mcp_direct' ? <Check size={10} /> : <Copy size={10} />}
                          <span>
                            {copiedKey === 'mcp_direct'
                              ? 'Direkt-URL kopiert'
                              : 'Geheime Direkt-URL kopieren'}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Sicherheitsstatus & Schlüsselrotation */}
                    <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px]">
                      <div className="flex items-center gap-1.5 font-semibold text-[#2C7738]">
                        <ShieldCheck size={13} className="text-[#2C7738] shrink-0" />
                        <span>
                          Token-Schutz aktiv
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
                        Letzter MCP-Zugriff: {new Date(mcpInfo.lastAccessAt).toLocaleString('de-AT')} ({mcpInfo.lastOperation} · {mcpInfo.totalCalls} Aufrufe)
                      </p>
                    )}
                  </div>
                ) : isNativeAndroid ? (
                  <div className="space-y-2 pt-1 border-t border-slate-100">
                    <p className="text-[10px] text-slate-500 leading-snug">
                      Die App arbeitet 100 % eigenständig offline auf deinem Pixel 10 Pro. Optional kannst du deinen Cloud-MCP-Server für Live-Abgleich mit ChatGPT hinterlegen:
                    </p>
                    <input
                      type="url"
                      value={remoteBaseUrl}
                      onChange={(e) => setRemoteBaseUrl(e.target.value)}
                      placeholder="https://dein-mcp-server.run.app"
                      className="w-full h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-mono text-slate-800"
                    />
                    <input
                      type="password"
                      value={remoteToken}
                      onChange={(e) => setRemoteToken(e.target.value)}
                      placeholder="MCP_ADMIN_TOKEN (Bearer)"
                      className="w-full h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-mono text-slate-800"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveRemoteMcpSync()}
                      className="w-full h-9 bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-semibold rounded-lg"
                    >
                      {remoteSavedMsg ? 'MCP-Sync gespeichert' : 'Cloud-MCP-Sync verbinden'}
                    </button>
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-400">Lade MCP-Verbindung…</p>
                )}
              </div>

              {statusChecked && (
                <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-[#2C7738] font-semibold flex items-center gap-1.5 animate-fade-in">
                  <CheckCircle size={14} />
                  <span>Direkter MCP-Server (HTTPS · Lesen & Schreiben · Token-Schutz) aktiv und geprüft.</span>
                </div>
              )}

              {/* Status prüfen Button (ILL-014, Page 44) */}
              <button
                onClick={handleStatusCheck}
                disabled={statusCheckRunning}
                className="w-full h-11 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-all"
              >
                <span>{statusCheckRunning ? 'Prüfe Status...' : 'Status prüfen'}</span>
              </button>
            </div>
          )}
        </div>

        {/* GRUPPE 4: Speicher und App (M15, WF-027) */}
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
            {speicherOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
          </button>

          {speicherOpen && (
            <div className="p-3.5 bg-slate-50 border-t border-slate-100 space-y-3">
              <PWAInstallCard />

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2.5 bg-white border border-slate-200 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Fotos & Medien</span>
                  <span className="text-sm font-bold text-slate-900 font-mono">112 MB</span>
                </div>
                <div className="p-2.5 bg-white border border-slate-200 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">App-Daten</span>
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
