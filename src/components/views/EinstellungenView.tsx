import React, { useEffect, useState } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { CollapsibleCard } from '../common/CollapsibleCard.tsx';
import { GoogleSignInButton } from '../common/GoogleSignInButton.tsx';
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
  NativeGmailConfig,
  NativePixelTunnelStatus,
  getNativeGmailConfig,
  getNativePixelTunnelStatus,
  isNativeAndroidApp,
  openNativePixelTunnelSetup,
  pasteNativeGmailAppPasswordFromClipboard,
  saveNativeGmailAppPassword,
  setNativePixelTunnelEnabled,
  setNativePixelTunnelWriteEnabled,
  subscribeNativeGmailConfig,
  subscribeNativePixelTunnelStatus
} from '../../services/nativeBridge.ts';
import {
  Calendar,
  ClipboardPaste,
  CloudSun,
  Bot,
  KeyRound,
  Mail,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sliders
} from 'lucide-react';

export const EinstellungenView: React.FC = () => {
  const { appSyncStatus } = useApp();
  const { weather, refreshWeather } = useSmartphoneWeather();
  const [gmailUser, setGmailUser] = useState<FirebaseUser | null>(null);
  const [gmailHasToken, setGmailHasToken] = useState(false);
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailAuthError, setGmailAuthError] = useState<string | null>(null);
  const [gmailAuthInfo, setGmailAuthInfo] = useState<string | null>(null);
  const [appPasswordInput, setAppPasswordInput] = useState('');
  const [ownerSession, setOwnerSession] = useState(() => getOwnerSessionState());

  const isNativeAndroid = isNativeAndroidApp();

  const [nativeGmailConfig, setNativeGmailConfig] = useState<NativeGmailConfig | null>(() =>
    getNativeGmailConfig()
  );

  // Direkter Pixel-Tunnel auf dem Pixel 10 Pro
  const [pixelTunnelStatus, setPixelTunnelStatus] = useState<NativePixelTunnelStatus | null>(() =>
    getNativePixelTunnelStatus()
  );

  useEffect(() => {
    const unsubGmail = subscribeGmailAuth(({ user, hasToken, error }) => {
      setGmailUser(user);
      setGmailHasToken(hasToken);
      if (error) {
        setGmailAuthError(error);
      }
      if (isNativeAndroid) {
        setNativeGmailConfig(getNativeGmailConfig());
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

    const latestTunnel = getNativePixelTunnelStatus();
    if (latestTunnel) {
      setPixelTunnelStatus(latestTunnel);
    }
    const latestGmail = getNativeGmailConfig();
    if (latestGmail) {
      setNativeGmailConfig(latestGmail);
    }

    const unsubTunnelStatus = subscribeNativePixelTunnelStatus((tStatus) => {
      setPixelTunnelStatus(tStatus);
    });
    const unsubNativeGmail = subscribeNativeGmailConfig((cfg) => {
      setNativeGmailConfig(cfg);
    });

    return () => {
      unsubGmail();
      unsubOwner();
      unsubTunnelStatus();
      unsubNativeGmail();
    };
  }, [isNativeAndroid]);

  const [arbeitsvorgabenOpen, setArbeitsvorgabenOpen] = useState(false);
  const [rechnungsdatenOpen, setRechnungsdatenOpen] = useState(false);
  const [verbindungenOpen, setVerbindungenOpen] = useState(true);

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

  const effectiveRevision = isNativeAndroid
    ? Math.max(pixelTunnelStatus?.local_revision ?? 0, appSyncStatus.revision ?? 0)
    : appSyncStatus.revision;

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
                Richtwert-Stundensatz
              </label>
              <div className="h-10 px-3 bg-white border border-slate-200 rounded-xl flex items-center font-bold text-slate-900">
                50,00 € / Std.
              </div>
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
          subtitle="Hafner Grünraum Handwerk · Format RE-75/2026"
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
              <div className="h-10 px-3 bg-white border border-slate-200 rounded-xl flex items-center font-bold text-slate-900">
                RE (z. B. RE-75/2026)
              </div>
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Zahlungsziel
              </label>
              <div className="h-10 px-3 bg-white border border-slate-200 rounded-xl flex items-center font-bold text-slate-900">
                14 Tage ohne Abzug
              </div>
            </div>
          </div>

          <div className="p-2.5 bg-white border border-slate-200 rounded-xl">
            <span className="font-semibold text-slate-800 block text-xs">Steuerregelung</span>
            <span className="text-[11px] text-slate-500">
              Der Rechnungsbetrag enthält gem. §6 Abs. 1 Z 27 UStG 1994 keine Umsatzsteuer.
            </span>
          </div>
        </CollapsibleCard>

        {/* GRUPPE 3: Verbindungen & Pixel-Tunnel */}
        <CollapsibleCard
          title="Verbindungen & Pixel-Tunnel"
          subtitle="ChatGPT Pixel-Tunnel, Gmail, Kalender & Wetter"
          icon={<Smartphone size={16} />}
          iconBgClassName="bg-indigo-50 text-[#3138A0] border-indigo-100"
          open={verbindungenOpen}
          onToggle={() => setVerbindungenOpen(!verbindungenOpen)}
        >
          {/* Direkter privater OpenAI-Pixel-Tunnel */}
          {isNativeAndroid && (
            <div className="p-3 bg-white border border-indigo-200/90 rounded-xl space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-[#3138A0] shrink-0">
                    <Bot size={17} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-slate-900 text-xs">
                        Direkter ChatGPT Pixel-Tunnel (OpenAI HTTPS)
                      </span>
                      <span className="text-[10px] font-semibold text-emerald-700 tabular-nums">
                        · Rev. #{effectiveRevision}
                      </span>
                    </div>
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
          {(() => {
            const hasNativeOAuth = Boolean(nativeGmailConfig?.hasOAuthToken);
            const hasNativeAppPwd = Boolean(nativeGmailConfig?.hasAppPassword);
            const isGmailConnected = gmailHasToken || hasNativeOAuth || hasNativeAppPwd;
            const activeEmail =
              gmailUser?.email || nativeGmailConfig?.senderEmail || OWNER_EMAIL;

            return (
              <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Mail size={17} className="text-red-600 shrink-0" />
                    <div className="min-w-0">
                      <span className="font-bold text-slate-800 block text-xs">
                        Gmail (PDF-Rechnungsversand & MCP)
                      </span>
                      <span className="text-[10px] text-slate-500 block truncate">
                        {isGmailConnected
                          ? `Aktiv: ${activeEmail} (${
                              hasNativeAppPwd && hasNativeOAuth
                                ? 'Google-Login + App-Passwort'
                                : hasNativeAppPwd
                                  ? 'Dauerhaftes App-Passwort'
                                  : 'Google OAuth-Login'
                            })`
                          : 'Einmalig anmelden für direkten PDF-Rechnungsversand'}
                      </span>
                    </div>
                  </div>
                  {isGmailConnected ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] font-bold text-[#2C7738] bg-emerald-50 px-2 py-0.5 rounded-md">
                        Bereit
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          setGmailAuthInfo(null);
                          setGmailAuthError(null);
                          await logoutGmail();
                          if (isNativeAndroid) {
                            setNativeGmailConfig(getNativeGmailConfig());
                          }
                        }}
                        className="text-[10px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-md flex items-center gap-1"
                      >
                        <LogOut size={11} />
                        <span>Trennen</span>
                      </button>
                    </div>
                  ) : (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md shrink-0">
                      Nicht angemeldet
                    </span>
                  )}
                </div>

                {(!gmailHasToken && !hasNativeOAuth) && (
                  <div className="space-y-1.5">
                    <GoogleSignInButton
                      onClick={async () => {
                        setGmailConnecting(true);
                        setGmailAuthError(null);
                        setGmailAuthInfo(null);
                        try {
                          await googleSignIn('M13_EINSTELLUNGEN');
                          if (isNativeAndroid) {
                            setNativeGmailConfig(getNativeGmailConfig());
                          }
                          setGmailAuthInfo('Google-Konto erfolgreich für Rechnungsversand verbunden.');
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
                  </div>
                )}

                {isNativeAndroid && (
                  <div className="pt-2 border-t border-slate-100 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-slate-600 flex items-center gap-1">
                        <KeyRound size={11} className="text-slate-500" />
                        <span>
                          Optional: 16-stelliges Google App-Passwort (läuft im Hintergrund nie ab)
                        </span>
                      </span>
                      {hasNativeAppPwd && (
                        <span className="text-[10px] font-bold text-[#2C7738]">
                          Hinterlegt ✓
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="password"
                        value={appPasswordInput}
                        onChange={(e) => setAppPasswordInput(e.target.value)}
                        placeholder={
                          hasNativeAppPwd
                            ? 'App-Passwort aktiv (neu eingeben zum Ändern)'
                            : '16-stelliges App-Passwort (z. B. abcd efgh ijkl mnop)'
                        }
                        className="flex-1 min-w-0 h-8 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3138A0]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setGmailAuthError(null);
                          setGmailAuthInfo(null);
                          const updated = pasteNativeGmailAppPasswordFromClipboard(OWNER_EMAIL);
                          if (updated) {
                            setNativeGmailConfig(updated);
                            if (updated.hasAppPassword) {
                              setAppPasswordInput('');
                              setGmailAuthInfo(
                                'App-Passwort aus Zwischenablage gespeichert (24/7 MCP-Versand bereit).'
                              );
                            } else {
                              setGmailAuthError(
                                'Kein 16-stelliges Google App-Passwort in der Zwischenablage gefunden.'
                              );
                            }
                          }
                        }}
                        className="h-8 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[10px] rounded-lg flex items-center gap-1 shrink-0"
                        title="App-Passwort aus Zwischenablage einfügen"
                      >
                        <ClipboardPaste size={12} />
                        <span>Einfügen</span>
                      </button>
                      <button
                        type="button"
                        disabled={appPasswordInput.replace(/\s+/g, '').length < 8}
                        onClick={() => {
                          setGmailAuthError(null);
                          setGmailAuthInfo(null);
                          const clean = appPasswordInput.replace(/\s+/g, '');
                          if (clean.length < 8) {
                            setGmailAuthError('Bitte mindestens 8 Zeichen eingeben.');
                            return;
                          }
                          const updated = saveNativeGmailAppPassword(OWNER_EMAIL, clean);
                          if (updated) {
                            setNativeGmailConfig(updated);
                            setAppPasswordInput('');
                            setGmailAuthInfo(
                              'Google App-Passwort dauerhaft gespeichert (24/7 MCP-Versand bereit).'
                            );
                          }
                        }}
                        className="h-8 px-2.5 bg-[#3138A0] disabled:bg-slate-200 text-white disabled:text-slate-400 font-bold text-[10px] rounded-lg shrink-0"
                      >
                        Speichern
                      </button>
                    </div>
                  </div>
                )}

                {gmailAuthError && (
                  <p className="text-[10px] text-[#B42318] font-medium leading-snug">
                    {gmailAuthError}
                  </p>
                )}
                {gmailAuthInfo && (
                  <p className="text-[10px] text-[#2C7738] font-medium leading-snug">
                    {gmailAuthInfo}
                  </p>
                )}
              </div>
            );
          })()}

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
      </div>

      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-md">
        <BottomActionBar />
        <BottomNav />
      </div>
    </div>
  );
};
