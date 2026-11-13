import React, { useEffect, useState } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { CollapsibleCard } from '../common/CollapsibleCard.tsx';
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
  OWNER_EMAIL,
  getOwnerSessionState,
  googleSignIn,
  logoutGmail,
  subscribeGmailAuth,
  subscribeOwnerSession
} from '../../services/gmailService.ts';
import { useSmartphoneWeather } from '../../services/weatherService.ts';
import { useApp } from '../../context/AppContext.tsx';
import {
  DEFAULT_INFINITY_CLOUD_URL,
  NativeMcpSyncStatus,
  NativePixelTunnelStatus,
  configureNativeMcpSync,
  getNativeMcpSyncStatus,
  getNativePixelTunnelStatus,
  isNativeAndroidApp,
  openNativePixelTunnelSetup,
  setNativePixelTunnelEnabled,
  setNativePixelTunnelWriteEnabled,
  subscribeNativeMcpStatus,
  subscribeNativePixelTunnelStatus,
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
  RefreshCw,
  ShieldCheck,
  Smartphone,
  WifiOff,
  AlertCircle,
  Sliders,
  HardDrive
} from 'lucide-react';

function formatSyncTimeShort(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('de-AT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export const EinstellungenView: React.FC = () => {
  const { appSyncStatus, flushPendingAppSync, refreshFromServer } = useApp();
  const { weather, refreshWeather } = useSmartphoneWeather();
  const [gmailUser, setGmailUser] = useState<FirebaseUser | null>(null);
  const [gmailHasToken, setGmailHasToken] = useState(false);
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailAuthError, setGmailAuthError] = useState<string | null>(null);
  const [ownerSession, setOwnerSession] = useState(() => getOwnerSessionState());

  const isNativeAndroid = isNativeAndroidApp();

  // Native Pixel 10 Pro Hintergrund-Synchronisation & Direkter Pixel-Tunnel
  const [nativeSyncStatus, setNativeSyncStatus] = useState<NativeMcpSyncStatus | null>(() =>
    getNativeMcpSyncStatus()
  );
  const [pixelTunnelStatus, setPixelTunnelStatus] = useState<NativePixelTunnelStatus | null>(() =>
    getNativePixelTunnelStatus()
  );
  const [syncInProgress, setSyncInProgress] = useState(false);

  useEffect(() => {
    const unsubGmail = subscribeGmailAuth(({ user, hasToken, error }) => {
      setGmailUser(user);
      setGmailHasToken(hasToken);
      if (error) {
        setGmailAuthError(error);
      }
    });
    const unsubOwner = subscribeOwnerSession((state) => {
      setOwnerSession(state);
    });

    if (!isNativeAndroid) {
      return () => {
        unsubGmail();
        unsubOwner();
      };
    }

    configureNativeMcpSync(DEFAULT_INFINITY_CLOUD_URL, '');
    setNativeSyncStatus(getNativeMcpSyncStatus());
    const latestTunnel = getNativePixelTunnelStatus();
    if (latestTunnel) {
      setPixelTunnelStatus(latestTunnel);
    }

    const unsubNativeStatus = subscribeNativeMcpStatus((status) => {
      setNativeSyncStatus(status);
    });

    const unsubTunnelStatus = subscribeNativePixelTunnelStatus((tStatus) => {
      setPixelTunnelStatus(tStatus);
    });

    return () => {
      unsubGmail();
      unsubOwner();
      unsubNativeStatus();
      unsubTunnelStatus();
    };
  }, [isNativeAndroid]);

  const [arbeitsvorgabenOpen, setArbeitsvorgabenOpen] = useState(false);
  const [rechnungsdatenOpen, setRechnungsdatenOpen] = useState(false);
  const [verbindungenOpen, setVerbindungenOpen] = useState(true);
  const [speicherOpen, setSpeicherOpen] = useState(false);

  const [hourlyRate, setHourlyRate] = useState('50');
  const [paymentTarget, setPaymentTarget] = useState('14 Tage ohne Abzug');
  const [numberPrefix, setNumberPrefix] = useState('RE');
  const [storageCleaned, setStorageCleaned] = useState(false);

  const handleManualSync = async () => {
    setSyncInProgress(true);
    try {
      if (isNativeAndroid) {
        triggerNativeMcpSyncNow();
      }
      await refreshFromServer();
    } finally {
      setTimeout(() => setSyncInProgress(false), 600);
    }
  };

  const handleTogglePixelTunnelEnabled = () => {
    if (!isNativeAndroid) return;
    const nextVal = !pixelTunnelStatus?.enabled;
    const updated = setNativePixelTunnelEnabled(nextVal);
    if (updated) {
      setPixelTunnelStatus(updated);
    }
  };

  const handleTogglePixelTunnelWrite = () => {
    if (!isNativeAndroid) return;
    const nextVal = !pixelTunnelStatus?.write_enabled;
    const updated = setNativePixelTunnelWriteEnabled(nextVal);
    if (updated) {
      setPixelTunnelStatus(updated);
    }
  };

  const handleOpenPixelTunnelSetup = () => {
    if (!isNativeAndroid) return;
    openNativePixelTunnelSetup();
  };

  const handleCleanStorage = () => {
    setStorageCleaned(true);
    setTimeout(() => setStorageCleaned(false), 3000);
  };

  const effectivePendingCount = isNativeAndroid
    ? nativeSyncStatus?.pendingSyncCount ?? 0
    : appSyncStatus.pendingSyncCount;
  const effectiveRevision = isNativeAndroid
    ? pixelTunnelStatus?.local_revision ??
      nativeSyncStatus?.revision ??
      appSyncStatus.revision
    : appSyncStatus.revision;
  const isSyncBusy =
    syncInProgress ||
    (isNativeAndroid ? Boolean(nativeSyncStatus?.syncInFlight) : appSyncStatus.syncInFlight);
  const lastSyncFormatted = formatSyncTimeShort(
    isNativeAndroid
      ? nativeSyncStatus?.lastSyncAt
      : appSyncStatus.lastAndroidSyncAt || appSyncStatus.lastSyncAt
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
      <Header title="Einstellungen" subtitle="App" showBack />

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3.5 text-xs text-slate-700 overscroll-contain">
        {/* GRUPPE 1: Arbeitsvorgaben */}
        <CollapsibleCard
          title="Arbeitsvorgaben"
          subtitle="Stundensatz · Abrechnungstakt · Standardwerte"
          icon={<Sliders size={16} />}
          iconBgClassName="bg-indigo-50 text-[#3138A0] border-indigo-100"
          open={arbeitsvorgabenOpen}
          onToggle={() => setArbeitsvorgabenOpen(!arbeitsvorgabenOpen)}
        >
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
        </CollapsibleCard>

        {/* GRUPPE 2: Rechnungsdaten & Original-Design */}
        <CollapsibleCard
          title="Rechnungsdaten & Logo"
          subtitle={`Hafner Grünraum Handwerk · Format ${numberPrefix}-75/2026`}
          icon={
            <img
              src={HAFNER_LOGO_URL}
              alt="Hafner Grünraum Handwerk"
              className="w-6 h-6 object-contain"
            />
          }
          iconBgClassName="bg-white border-slate-200"
          open={rechnungsdatenOpen}
          onToggle={() => setRechnungsdatenOpen(!rechnungsdatenOpen)}
        >
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
        </CollapsibleCard>

        {/* GRUPPE 3: Verbindungen & Hintergrund-Synchronisation */}
        <CollapsibleCard
          title="Verbindungen & Hintergrund-Sync"
          subtitle={
            isNativeAndroid
              ? 'Primärquelle Pixel 10 Pro, ChatGPT-Tunnel, Kalender & Wetter'
              : 'Parallel-Abgleich mit Pixel 10 Pro, Gmail, Kalender & Wetter'
          }
          icon={<Smartphone size={16} />}
          iconBgClassName="bg-indigo-50 text-[#3138A0] border-indigo-100"
          open={verbindungenOpen}
          onToggle={() => setVerbindungenOpen(!verbindungenOpen)}
        >
          {/* ROTER BEREICH AUS HEUTE: Hintergrund-Synchronisation & Primärquelle passend in Einstellungen */}
          <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 text-[#3138A0] flex items-center justify-center shrink-0">
                  <Smartphone size={16} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-slate-900">
                      {isNativeAndroid
                        ? 'Primärquelle: Pixel 10 Pro'
                        : 'Parallel-Datenstand mit Pixel 10 Pro'}
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-700 tabular-nums">
                      · Rev. #{effectiveRevision}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 truncate">
                    {lastSyncFormatted
                      ? `Letzter Hintergrund-Abgleich: ${lastSyncFormatted}`
                      : 'Automatische Hintergrund-Synchronisation aktiv'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleManualSync()}
                disabled={isSyncBusy}
                className="p-2 rounded-xl bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-[#3138A0] active:scale-95 transition-all shrink-0 disabled:opacity-50"
                title="Datenstand jetzt im Hintergrund abgleichen"
              >
                <RefreshCw
                  size={15}
                  className={isSyncBusy ? 'animate-spin text-[#3138A0]' : ''}
                />
              </button>
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
          </div>

          {/* Direkter privater OpenAI-Pixel-Tunnel (nur Android-App) */}
          {isNativeAndroid && (
            <div className="p-3 bg-white border border-indigo-200/90 rounded-xl space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-[#3138A0] shrink-0">
                    <Bot size={17} />
                  </div>
                  <div className="min-w-0">
                    <span className="font-bold text-slate-900 block text-xs">
                      Direkter ChatGPT Pixel-Tunnel (OpenAI HTTPS)
                    </span>
                    <span className="text-[10px] text-[#3138A0] font-semibold block leading-snug">
                      {pixelTunnelStatus?.label || 'Noch nicht eingerichtet'}
                    </span>
                  </div>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 ${
                    pixelTunnelStatus?.transport_confirmed
                      ? 'text-[#2C7738] bg-emerald-50'
                      : pixelTunnelStatus?.enabled
                        ? 'text-amber-700 bg-amber-50'
                        : 'text-slate-600 bg-slate-100'
                  }`}
                >
                  {pixelTunnelStatus?.transport_confirmed
                    ? 'Verbunden'
                    : pixelTunnelStatus?.enabled
                      ? 'Aktiv'
                      : 'Aus'}
                </span>
              </div>

              <div className="p-2 bg-slate-50 border border-slate-200/80 rounded-lg text-[10px] text-slate-700 space-y-1">
                <div className="font-semibold text-slate-900">
                  {pixelTunnelStatus?.detail ||
                    'Eigener ChatGPT-Tunnel direkt zum Pixel 10 Pro (api.openai.com).'}
                </div>
                {pixelTunnelStatus?.tunnel_id_masked ? (
                  <div className="font-mono text-slate-600">
                    Tunnel-ID: {pixelTunnelStatus.tunnel_id_masked}
                    {pixelTunnelStatus.organization
                      ? ` · Org: ${pixelTunnelStatus.organization}`
                      : ''}
                  </div>
                ) : null}
                <div className="text-slate-500">
                  Letzter Kontakt:{' '}
                  <span className="font-semibold text-slate-700">
                    {pixelTunnelStatus?.last_contact_at
                      ? new Date(pixelTunnelStatus.last_contact_at).toLocaleString('de-AT')
                      : 'Noch kein Kontakt'}
                  </span>
                  {' · '}Letzte Antwort:{' '}
                  <span className="font-semibold text-slate-700">
                    {pixelTunnelStatus?.last_response_at
                      ? new Date(pixelTunnelStatus.last_response_at).toLocaleString('de-AT')
                      : 'Keine'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleTogglePixelTunnelEnabled}
                  className={`h-9 px-2.5 rounded-lg text-[11px] font-semibold flex items-center justify-between border transition-all ${
                    pixelTunnelStatus?.enabled
                      ? 'bg-emerald-50 border-emerald-300 text-[#166534]'
                      : 'bg-white border-slate-300 text-slate-700'
                  }`}
                >
                  <span>Pixel-Tunnel</span>
                  <span className="font-bold">
                    {pixelTunnelStatus?.enabled ? 'EIN' : 'AUS'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleTogglePixelTunnelWrite}
                  className={`h-9 px-2.5 rounded-lg text-[11px] font-semibold flex items-center justify-between border transition-all ${
                    pixelTunnelStatus?.write_enabled
                      ? 'bg-indigo-50 border-indigo-300 text-[#3138A0]'
                      : 'bg-white border-slate-300 text-slate-700'
                  }`}
                >
                  <span>Schreibfreigabe</span>
                  <span className="font-bold">
                    {pixelTunnelStatus?.write_enabled ? 'EIN' : 'AUS'}
                  </span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleOpenPixelTunnelSetup}
                className="w-full h-9 px-3 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 text-white text-[11px] font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-all"
              >
                <ShieldCheck size={13} />
                <span>
                  {pixelTunnelStatus?.configured
                    ? 'Tunnel-Einrichtung & Diagnose öffnen'
                    : 'Eigenen ChatGPT-Tunnel jetzt einrichten'}
                </span>
              </button>
            </div>
          )}

          {!isNativeAndroid && (
            <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <ShieldCheck size={17} className="text-[#2C7738] shrink-0" />
                <div className="min-w-0">
                  <span className="font-bold text-slate-800 block text-xs">
                    Google-Konto (Infinity Web)
                  </span>
                  <span className="text-[10px] text-slate-500 block truncate">
                    Angemeldet als {ownerSession.email || OWNER_EMAIL}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void logoutGmail()}
                className="text-[10px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-md flex items-center gap-1 shrink-0"
              >
                <LogOut size={11} />
                <span>Abmelden</span>
              </button>
            </div>
          )}

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
        </CollapsibleCard>

        {/* GRUPPE 4: Speicher und App */}
        <CollapsibleCard
          title="Speicher und App"
          subtitle={
            isNativeAndroid
              ? 'Startbildschirm-Icon · 128 MB insgesamt · Bereinigung'
              : 'Lokaler Browser-Cache & App-Installation'
          }
          icon={<HardDrive size={16} />}
          iconBgClassName="bg-slate-100 text-slate-700 border-slate-200"
          open={speicherOpen}
          onToggle={() => setSpeicherOpen(!speicherOpen)}
        >
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
        </CollapsibleCard>
      </div>

      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-md">
        <BottomActionBar />
        <BottomNav />
      </div>
    </div>
  );
};
