import React, { useEffect, useMemo, useState } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { useApp } from '../../context/AppContext.tsx';
import { InvoicePaperPreview } from '../common/InvoicePaperPreview.tsx';
import { GoogleSignInButton } from '../common/GoogleSignInButton.tsx';
import {
  HAFNER_LOGO_URL,
  ISSUER_BANK_NAME,
  ISSUER_BIC,
  ISSUER_CITY,
  ISSUER_COMPANY,
  ISSUER_CONTACT_PERSON,
  ISSUER_IBAN,
  ISSUER_PHONE,
  ISSUER_STREET,
  buildInvoiceFilename,
  detectRecipientSalutation,
  formatEuro,
  generateInvoicePdfAsync,
  resolveInvoiceDisplayData
} from '../../utils/invoicePdf.ts';
import {
  OWNER_EMAIL,
  getAccessToken,
  googleSignIn,
  logoutGmail,
  sendInvoicePdfViaGmail,
  subscribeGmailAuth
} from '../../services/gmailService.ts';
import {
  downloadOrSaveBlob,
  getNativeGmailConfig,
  isNativeAndroidApp,
  notifyMailSentNatively,
  openExternalUrlNatively,
  pasteNativeGmailAppPasswordFromClipboard,
  saveNativeGmailAppPassword,
  sendInvoiceEmailAutomaticallyNatively,
  shareDocumentNatively,
  subscribeNativeGmailConfig
} from '../../services/nativeBridge.ts';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Download,
  ExternalLink,
  Eye,
  FileText,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Send,
  X
} from 'lucide-react';

type SendChannel = 'gmail' | 'whatsapp' | 'sms';

function normalizePhoneInternational(raw: string): { e164: string; waDigits: string } {
  const stripped = raw.replace(/[\s\-()/]/g, '');
  if (!stripped) return { e164: '', waDigits: '' };

  let e164 = stripped;
  if (e164.startsWith('00')) {
    e164 = `+${e164.slice(2)}`;
  } else if (e164.startsWith('0') && !e164.startsWith('00')) {
    // Österreichische Standardvorwahl (+43)
    e164 = `+43${e164.slice(1)}`;
  } else if (!e164.startsWith('+')) {
    e164 = `+${e164}`;
  }

  const waDigits = e164.replace(/\D/g, '');
  return { e164, waDigits };
}

export const RechnungVersendenModal: React.FC = () => {
  const {
    sendingInvoiceId,
    setSendingInvoiceId,
    invoices,
    customers,
    workRecords,
    updateInvoice,
    updateCustomer,
    setUndoToast
  } = useApp();

  const invoice = invoices.find((i) => i.id === sendingInvoiceId) || null;
  const customer = customers.find((c) => c.id === invoice?.customer_id) || null;

  const [channel, setChannel] = useState<SendChannel>('gmail');

  const [gmailUser, setGmailUser] = useState<FirebaseUser | null>(null);
  const [hasToken, setHasToken] = useState<boolean>(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [whatsappBody, setWhatsappBody] = useState('');
  const [smsBody, setSmsBody] = useState('');

  const [customizeMailOpen, setCustomizeMailOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Direkt-Versand ohne zweiten Bestätigungsdialog (dieses Sheet ist die letzte Bestätigung)
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Nativer Gmail-Direktversand auf dem Pixel 10 Pro (Titan M2 Keystore)
  const [nativeGmailCfg, setNativeGmailCfg] = useState(() => getNativeGmailConfig());
  const [showAppPasswordBox, setShowAppPasswordBox] = useState(false);
  const [senderEmailDraft, setSenderEmailDraft] = useState(
    () => getNativeGmailConfig()?.senderEmail || OWNER_EMAIL
  );
  const [appPasswordDraft, setAppPasswordDraft] = useState('');

  const [pdfArtifact, setPdfArtifact] = useState<{
    blob: Blob;
    file: File;
    filename: string;
  } | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeGmailAuth(({ user, hasToken: tokenReady }) => {
      setGmailUser(user);
      setHasToken(tokenReady);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeNativeGmailConfig((cfg, autoDetected) => {
      setNativeGmailCfg(cfg);
      if (cfg.hasAppPassword || cfg.hasOAuthToken) {
        setShowAppPasswordBox(false);
        setErrorMessage(null);
        if (autoDetected) {
          setFeedbackMessage('Google-Code automatisch aus Zwischenablage übernommen');
        }
      }
    });
    return unsubscribe;
  }, []);

  const resolvedData = useMemo(() => {
    if (!invoice) return null;
    return resolveInvoiceDisplayData(invoice, customers, workRecords);
  }, [invoice, customers, workRecords]);

  // Asynchrones Erzeugen des PDFs inkl. garantiert eingebettetem Original-Logo
  useEffect(() => {
    let active = true;
    if (!resolvedData) {
      setPdfArtifact(null);
      return;
    }
    void generateInvoicePdfAsync(resolvedData).then((res) => {
      if (active) {
        setPdfArtifact(res);
      }
    });
    return () => {
      active = false;
    };
  }, [resolvedData]);

  useEffect(() => {
    if (invoice && resolvedData) {
      const docTitle = invoice.is_storno
        ? `Stornorechnung Nr. ${invoice.invoice_number}`
        : `Rechnungs Nr. ${invoice.invoice_number}`;

      const initEmail = customer?.email || '';
      const initPhone = customer?.phone || '';

      setRecipientEmail(initEmail);
      setRecipientPhone(initPhone);

      const latestNativeCfg = getNativeGmailConfig();
      setNativeGmailCfg(latestNativeCfg);
      setSenderEmailDraft(latestNativeCfg?.senderEmail || OWNER_EMAIL);
      setShowAppPasswordBox(
        isNativeAndroidApp() &&
          !latestNativeCfg?.hasAppPassword &&
          !latestNativeCfg?.hasOAuthToken
      );
      setAppPasswordDraft('');

      // Sinnvolle Kanal-Vorauswahl: Gmail wenn E-Mail hinterlegt oder Token aktiv, sonst WhatsApp bei vorhandener Telefonnummer
      if (!initEmail && initPhone && !hasToken && !isNativeAndroidApp()) {
        setChannel('whatsapp');
      } else {
        setChannel('gmail');
      }

      const detectedSalutation = detectRecipientSalutation(
        resolvedData.recipientName,
        customer
      ).salutationLine;

      setEmailSubject(`${docTitle} – ${ISSUER_COMPANY}`);
      setEmailBody(
        [
          detectedSalutation,
          '',
          `vielen Dank für Ihren Auftrag und das damit verbundene Vertrauen! Anbei erhalten Sie die ${docTitle} vom ${resolvedData.issueDateFormatted} als PDF-Dokument.`,
          '',
          `Leistungszeitraum: ${resolvedData.servicePeriod}`,
          `Gesamtbetrag brutto: ${formatEuro(resolvedData.totalAmount)}`,
          `Fällig bis zum: ${resolvedData.dueDateFormatted} (innerhalb von 14 Tagen ohne Abzüge)`,
          `Bankverbindung: ${ISSUER_BANK_NAME} · IBAN ${ISSUER_IBAN} · BIC ${ISSUER_BIC}`,
          '',
          'Mit freundlichen Grüßen',
          ISSUER_CONTACT_PERSON,
          `${ISSUER_STREET}, ${ISSUER_CITY}`,
          `Tel. ${ISSUER_PHONE}`
        ].join('\n')
      );

      setWhatsappBody(
        [
          'Guten Tag,',
          `anbei erhalten Sie die ${docTitle} vom ${resolvedData.issueDateFormatted} als PDF (${ISSUER_COMPANY}).`,
          '',
          `Betrag: ${formatEuro(resolvedData.totalAmount)}`,
          `Zahlbar bis: ${resolvedData.dueDateFormatted}`,
          `IBAN: ${ISSUER_IBAN} (${ISSUER_BANK_NAME})`,
          '',
          'Vielen Dank für Ihren Auftrag!',
          ISSUER_CONTACT_PERSON
        ].join('\n')
      );

      setSmsBody(
        `${ISSUER_COMPANY}: ${docTitle} vom ${resolvedData.issueDateFormatted} über ${formatEuro(
          resolvedData.totalAmount
        )} (fällig bis ${resolvedData.dueDateFormatted}). IBAN: ${ISSUER_IBAN} (${ISSUER_BIC}). PDF folgt / anbei. Vielen Dank, ${ISSUER_CONTACT_PERSON}`
      );

      setCustomizeMailOpen(false);
      setShowPreview(false);
      setIsSending(false);
      setErrorMessage(null);
      setFeedbackMessage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id, customer?.email, customer?.phone, resolvedData]);

  if (!invoice || !resolvedData) return null;

  const displayFilename =
    pdfArtifact?.filename ||
    buildInvoiceFilename(
      resolvedData.invoiceNumber,
      resolvedData.issueDateIso,
      resolvedData.isStorno
    );

  const { e164: normalizedPhoneE164, waDigits: normalizedWaDigits } =
    normalizePhoneInternational(recipientPhone);

  const whatsappChatHref = normalizedWaDigits
    ? `https://wa.me/${normalizedWaDigits}?text=${encodeURIComponent(whatsappBody)}`
    : `https://wa.me/?text=${encodeURIComponent(whatsappBody)}`;

  const smsHref = normalizedPhoneE164
    ? `sms:${normalizedPhoneE164}?body=${encodeURIComponent(smsBody)}`
    : `sms:?body=${encodeURIComponent(smsBody)}`;

  const persistPhoneIfChanged = () => {
    const clean = recipientPhone.trim();
    if (customer && clean && clean !== customer.phone) {
      updateCustomer(customer.id, { phone: clean });
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMessage(null);
    setIsLoggingIn(true);
    try {
      await googleSignIn('M04_ABRECHNUNG');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google-Anmeldung fehlgeschlagen.';
      setErrorMessage(msg);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    setErrorMessage(null);
    await logoutGmail();
  };

  const isNativeAndroid = isNativeAndroidApp();

  const finalizeSuccessfulMailSend = (cleanEmail: string) => {
    const todayIso = new Date().toISOString().slice(0, 10);
    updateInvoice(invoice.id, {
      sent_at: todayIso,
      sent_via: `Gmail PDF (${cleanEmail})`
    });

    if (customer && cleanEmail !== customer.email) {
      updateCustomer(customer.id, { email: cleanEmail });
    }

    // Kurze Benachrichtigung in der Android App (In-App Banner + Nativer Android Toast/Notification)
    notifyMailSentNatively(cleanEmail, invoice.invoice_number);
    setUndoToast({
      visible: true,
      message: `PDF-Rechnung ${invoice.invoice_number} an ${cleanEmail} versendet`
    });
    setSendingInvoiceId(null);
  };

  // Bei Aktivierung von „PDF per Gmail senden“ wird die E-Mail sofort automatisch versendet
  const handleSendGmailDirectly = async () => {
    setErrorMessage(null);
    const cleanEmail = recipientEmail.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Bitte eine gültige Empfänger-E-Mail-Adresse eingeben.');
      return;
    }

    if (!hasToken && !isNativeAndroid) {
      setErrorMessage('Bitte zuerst über „Sign in with Google“ mit Gmail verbinden.');
      return;
    }

    setIsSending(true);
    try {
      const freshPdf = pdfArtifact || (await generateInvoicePdfAsync(resolvedData));
      const cleanSubject = emailSubject.trim() || `Rechnungs Nr. ${invoice.invoice_number}`;

      // Falls der Nutzer gerade ein Google App-Passwort eingegeben hat, zuerst im Titan M2 Keystore sichern
      if (isNativeAndroid && appPasswordDraft.replace(/\s+/g, '').length >= 8) {
        const updatedCfg = saveNativeGmailAppPassword(
          senderEmailDraft.trim() || OWNER_EMAIL,
          appPasswordDraft
        );
        setNativeGmailCfg(updatedCfg);
        setAppPasswordDraft('');
        setShowAppPasswordBox(false);
      }

      if (isNativeAndroid) {
        const webToken = await getAccessToken();
        await sendInvoiceEmailAutomaticallyNatively({
          blob: freshPdf.blob,
          filename: freshPdf.filename,
          recipientEmail: cleanEmail,
          subject: cleanSubject,
          bodyText: emailBody,
          invoiceNumber: invoice.invoice_number,
          webAccessToken: webToken
        });
      } else {
        const token = await getAccessToken();
        if (!token) {
          setErrorMessage('Kein aktives Gmail-Zugriffstoken. Bitte erneut mit Google anmelden.');
          return;
        }

        await sendInvoicePdfViaGmail({
          accessToken: token,
          to: cleanEmail,
          subject: cleanSubject,
          bodyText: emailBody,
          pdfBlob: freshPdf.blob,
          filename: freshPdf.filename
        });
      }

      finalizeSuccessfulMailSend(cleanEmail);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'Fehler beim Gmail-Versand.';
      if (rawMsg.startsWith('APP_PASSWORD_REQUIRED:')) {
        setShowAppPasswordBox(true);
        setErrorMessage(null);
      } else {
        setErrorMessage(rawMsg);
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleOpenPixelGmailAppFallback = async () => {
    setErrorMessage(null);
    const cleanEmail = recipientEmail.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Bitte eine gültige Empfänger-E-Mail-Adresse eingeben.');
      return;
    }
    setIsSending(true);
    try {
      const freshPdf = pdfArtifact || (await generateInvoicePdfAsync(resolvedData));
      const cleanSubject = emailSubject.trim() || `Rechnungs Nr. ${invoice.invoice_number}`;
      const opened = await shareDocumentNatively({
        blob: freshPdf.blob,
        filename: freshPdf.filename,
        mimeType: 'application/pdf',
        subject: cleanSubject,
        bodyText: emailBody,
        channel: 'gmail',
        recipientEmail: cleanEmail
      });
      if (!opened) {
        throw new Error('Gmail-App konnte auf dem Gerät nicht geöffnet werden.');
      }
      finalizeSuccessfulMailSend(cleanEmail);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Fehler beim Öffnen der Gmail-App.');
    } finally {
      setIsSending(false);
    }
  };

  const triggerPdfDownload = async () => {
    const freshPdf = pdfArtifact || (await generateInvoicePdfAsync(resolvedData));
    await downloadOrSaveBlob(freshPdf.blob, freshPdf.filename, 'application/pdf');
    return freshPdf;
  };

  // Teilt die echte PDF-Datei + Begleittext direkt über Android Share / Kotlin FileProvider an WhatsApp oder Google Nachrichten/RCS
  const handleSharePdfWithText = async (viaLabel: 'WhatsApp' | 'SMS / RCS', messageText: string) => {
    setErrorMessage(null);
    persistPhoneIfChanged();
    const freshPdf = pdfArtifact || (await generateInvoicePdfAsync(resolvedData));

    try {
      if (isNativeAndroid) {
        const shared = await shareDocumentNatively({
          blob: freshPdf.blob,
          filename: freshPdf.filename,
          mimeType: 'application/pdf',
          subject: emailSubject,
          bodyText: messageText,
          channel: viaLabel === 'WhatsApp' ? 'whatsapp' : 'sms'
        });
        if (shared) {
          const phoneSuffix = recipientPhone.trim() ? ` (${recipientPhone.trim()})` : '';
          updateInvoice(invoice.id, {
            sent_at: new Date().toISOString().slice(0, 10),
            sent_via: `${viaLabel} PDF${phoneSuffix}`
          });
          setUndoToast({
            visible: true,
            message: `PDF-Rechnung ${invoice.invoice_number} über ${viaLabel} übergeben`
          });
          setSendingInvoiceId(null);
          return;
        }
      }

      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [freshPdf.file] })
      ) {
        await navigator.share({
          title: emailSubject,
          text: messageText,
          files: [freshPdf.file]
        });
        const phoneSuffix = recipientPhone.trim() ? ` (${recipientPhone.trim()})` : '';
        updateInvoice(invoice.id, {
          sent_at: new Date().toISOString().slice(0, 10),
          sent_via: `${viaLabel} PDF${phoneSuffix}`
        });
        setUndoToast({
          visible: true,
          message: `PDF-Rechnung ${invoice.invoice_number} über ${viaLabel} gesendet`
        });
        setSendingInvoiceId(null);
        return;
      }

      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({
          title: emailSubject,
          text: messageText
        });
        const phoneSuffix = recipientPhone.trim() ? ` (${recipientPhone.trim()})` : '';
        updateInvoice(invoice.id, {
          sent_at: new Date().toISOString().slice(0, 10),
          sent_via: `${viaLabel}${phoneSuffix}`
        });
        setUndoToast({
          visible: true,
          message: `Rechnung ${invoice.invoice_number} über ${viaLabel} geteilt`
        });
        setSendingInvoiceId(null);
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
    }

    setErrorMessage(
      `Direktes Datei-Teilen wird in dieser Browser-Vorschau blockiert (auf dem Pixel 10 Pro direkt verfügbar). Nutzen Sie alternativ „Direkt öffnen“.`
    );
  };

  const handleDirectAppLinkClick = (viaLabel: 'WhatsApp' | 'SMS') => {
    setErrorMessage(null);
    persistPhoneIfChanged();
    const phoneSuffix = recipientPhone.trim() ? ` (${recipientPhone.trim()})` : '';
    updateInvoice(invoice.id, {
      sent_at: new Date().toISOString().slice(0, 10),
      sent_via: `${viaLabel}${phoneSuffix}`
    });
    setFeedbackMessage(`${viaLabel} geöffnet`);
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/45 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
      <div className="flex-1" onClick={() => !isSending && setSendingInvoiceId(null)} />

      <div className="bg-[#F8F9FA] rounded-t-3xl border-t border-slate-200 shadow-2xl px-4 pt-2.5 pb-4 max-h-[92%] flex flex-col animate-slide-up relative">
        {/* Android Bottom Sheet Handle */}
        <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto mb-2.5 shrink-0" />

        {/* Header mit Original-Logo */}
        <div className="flex items-center justify-between pb-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={HAFNER_LOGO_URL}
              alt="Hafner Grünraum Handwerk"
              className="w-9 h-9 object-contain shrink-0"
            />
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 leading-tight truncate">
                PDF-Rechnung versenden
              </h2>
              <p className="text-[11px] text-slate-500 truncate">
                Gmail · WhatsApp · SMS (inkl. Original-Logo)
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSending}
            onClick={() => setSendingInvoiceId(null)}
            className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors shrink-0"
            aria-label="Schließen"
          >
            <X size={18} />
          </button>
        </div>

        {/* Kanal-Umschalter: Gmail | WhatsApp | SMS */}
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-200/70 rounded-2xl mb-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setChannel('gmail');
              setErrorMessage(null);
              setFeedbackMessage(null);
            }}
            className={`h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              channel === 'gmail'
                ? 'bg-white text-[#3138A0] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Mail size={14} className={channel === 'gmail' ? 'text-red-600' : ''} />
            <span>Gmail</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setChannel('whatsapp');
              setErrorMessage(null);
              setFeedbackMessage(null);
            }}
            className={`h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              channel === 'whatsapp'
                ? 'bg-[#128C7E] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MessageCircle size={14} />
            <span>WhatsApp</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setChannel('sms');
              setErrorMessage(null);
              setFeedbackMessage(null);
            }}
            className={`h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
              channel === 'sms'
                ? 'bg-[#0B57D0] text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MessageSquare size={14} />
            <span>SMS</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 py-1 overscroll-contain">
          {/* Fest angehängtes PDF-Dokument + Schnell-Speichern / Vorschau */}
          <div className="p-3 bg-white border border-slate-200 rounded-2xl shadow-2xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center text-[#B42318] shrink-0">
                <FileText size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 truncate">{displayFilename}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-[#2C7738] text-[9px] font-bold">
                    PDF bereit
                  </span>
                  <span className="text-[11px] font-semibold text-slate-600 truncate">
                    {formatEuro(resolvedData.totalAmount)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  await triggerPdfDownload();
                  setFeedbackMessage(`${displayFilename} gespeichert`);
                }}
                title="PDF speichern"
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-colors"
              >
                <Download size={14} />
              </button>
              <button
                type="button"
                onClick={() => setShowPreview((p) => !p)}
                className="px-2.5 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-semibold flex items-center gap-1 transition-colors"
              >
                <Eye size={13} className="text-[#3138A0]" />
                <span>{showPreview ? 'Aus' : 'Vorschau'}</span>
              </button>
            </div>
          </div>

          {showPreview && (
            <div className="animate-fade-in">
              <InvoicePaperPreview data={resolvedData} />
            </div>
          )}

          {/* ==================== KANAL 1: GMAIL ==================== */}
          {channel === 'gmail' && (
            <>
              <div className="p-3 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mail size={15} className="text-red-600" />
                    <span className="font-bold text-slate-900">Absender (Gmail)</span>
                  </div>
                  {hasToken && gmailUser ? (
                    <button
                      type="button"
                      onClick={handleGoogleLogout}
                      className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"
                    >
                      <LogOut size={12} />
                      <span>Trennen</span>
                    </button>
                  ) : isNativeAndroid ? (
                    <button
                      type="button"
                      onClick={() => setShowAppPasswordBox((prev) => !prev)}
                      className="text-[10px] font-semibold text-[#2C7738] bg-emerald-50 px-2 py-0.5 rounded-md flex items-center gap-1"
                    >
                      <span>Automatischer Direktversand</span>
                    </button>
                  ) : (
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                      Anmeldung erforderlich
                    </span>
                  )}
                </div>

                {hasToken && gmailUser ? (
                  <div className="px-2.5 py-2 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#2C7738] truncate">
                      Verbunden: {gmailUser.email}
                    </span>
                    <Check size={14} className="text-[#2C7738] shrink-0" />
                  </div>
                ) : isNativeAndroid ? (
                  <div className="space-y-2">
                    <div className="px-2.5 py-2 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#2C7738] truncate">
                        {nativeGmailCfg?.hasAppPassword || nativeGmailCfg?.hasOAuthToken
                          ? `Automatischer Hintergrund-Versand (${nativeGmailCfg.senderEmail})`
                          : 'Automatischer Gmail-Versand inkl. PDF bei Aktivierung'}
                      </span>
                      <Check size={14} className="text-[#2C7738] shrink-0" />
                    </div>

                    {showAppPasswordBox && (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 animate-fade-in">
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                            <KeyRound size={14} className="text-[#3138A0]" />
                            <span>Einmalig Gmail verknüpfen (Titan M2)</span>
                          </div>
                          <span className="text-[10px] font-semibold text-slate-500">
                            Nur 1× nötig
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-600 leading-snug">
                          Tippe auf Schritt 1, kopiere den angezeigten 16-stelligen Google-Code und kehre hierher zurück – die App übernimmt ihn automatisch.
                        </p>

                        <button
                          type="button"
                          onClick={() => {
                            setErrorMessage(null);
                            const url = 'https://myaccount.google.com/apppasswords';
                            if (!openExternalUrlNatively(url)) {
                              window.location.href = url;
                            }
                          }}
                          className="w-full h-10 px-3 rounded-xl bg-white hover:bg-slate-100 border border-[#3138A0]/30 text-[#3138A0] text-xs font-bold flex items-center justify-between shadow-2xs transition-colors"
                        >
                          <span>1. Google-Code öffnen & kopieren</span>
                          <ExternalLink size={14} className="shrink-0" />
                        </button>

                        <button
                          type="button"
                          disabled={isSending}
                          onClick={async () => {
                            setErrorMessage(null);
                            const updated = pasteNativeGmailAppPasswordFromClipboard(
                              senderEmailDraft.trim() || OWNER_EMAIL
                            );
                            if (updated?.hasAppPassword) {
                              setNativeGmailCfg(updated);
                              setShowAppPasswordBox(false);
                              void handleSendGmailDirectly();
                              return;
                            }
                            try {
                              if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
                                const clip = (await navigator.clipboard.readText()).replace(/\s+/g, '');
                                if (clip.length >= 8) {
                                  const saved = saveNativeGmailAppPassword(
                                    senderEmailDraft.trim() || OWNER_EMAIL,
                                    clip
                                  );
                                  setNativeGmailCfg(saved);
                                  setShowAppPasswordBox(false);
                                  void handleSendGmailDirectly();
                                  return;
                                }
                              }
                            } catch {
                              // Fallback to manual input below
                            }
                            setErrorMessage(
                              'Noch kein 16-stelliger Code in der Zwischenablage gefunden. Bitte erst in Schritt 1 kopieren oder unten einfügen.'
                            );
                          }}
                          className="w-full h-10 px-3 rounded-xl bg-[#2C7738] hover:bg-[#23602d] text-white text-xs font-bold flex items-center justify-center gap-2 shadow-2xs transition-colors disabled:opacity-50"
                        >
                          <ClipboardPaste size={14} />
                          <span>2. Kopierten Code automatisch einfügen & Senden</span>
                        </button>

                        <div className="pt-1 border-t border-slate-200/80 flex items-center gap-1.5">
                          <input
                            type="text"
                            value={appPasswordDraft}
                            onChange={(e) => setAppPasswordDraft(e.target.value)}
                            placeholder="Oder 16-stelligen Code hier einfügen"
                            className="flex-1 h-9 px-2.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (appPasswordDraft.replace(/\s+/g, '').length >= 8) {
                                const updated = saveNativeGmailAppPassword(
                                  senderEmailDraft.trim() || OWNER_EMAIL,
                                  appPasswordDraft
                                );
                                setNativeGmailCfg(updated);
                                setAppPasswordDraft('');
                                setShowAppPasswordBox(false);
                                setErrorMessage(null);
                                void handleSendGmailDirectly();
                              }
                            }}
                            disabled={appPasswordDraft.replace(/\s+/g, '').length < 8 || isSending}
                            className="px-3 h-9 rounded-lg bg-[#3138A0] text-white text-[11px] font-bold disabled:opacity-40 shrink-0"
                          >
                            Speichern
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={handleOpenPixelGmailAppFallback}
                          disabled={isSending}
                          className="w-full h-9 rounded-lg bg-slate-200/70 hover:bg-slate-200 text-slate-800 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Mail size={13} className="text-red-600" />
                          <span>Ohne Code direkt über Pixel Gmail-App senden</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-slate-500">
                      Einmalig anmelden, um Rechnungen direkt als PDF über Gmail zu versenden:
                    </p>
                    <GoogleSignInButton
                      onClick={handleGoogleLogin}
                      disabled={isLoggingIn}
                      label={isLoggingIn ? 'Verbinde mit Google...' : 'Sign in with Google'}
                    />
                  </div>
                )}
              </div>

              <div className="p-3 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2.5 text-xs">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Empfänger E-Mail ({resolvedData.recipientName})
                  </label>
                  <input
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="kunde@beispiel.at"
                    className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 font-semibold"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setCustomizeMailOpen((p) => !p)}
                  className="w-full pt-1 flex items-center justify-between text-[11px] font-semibold text-[#3138A0]"
                >
                  <span>Betreff & Begleittext prüfen / anpassen</span>
                  {customizeMailOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {customizeMailOpen && (
                  <div className="space-y-2 pt-1 border-t border-slate-100">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                        Betreff
                      </label>
                      <input
                        type="text"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        className="w-full h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                        Nachrichtentext
                      </label>
                      <textarea
                        rows={5}
                        value={emailBody}
                        onChange={(e) => setEmailBody(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 resize-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ==================== KANAL 2: WHATSAPP ==================== */}
          {channel === 'whatsapp' && (
            <div className="p-3 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Phone size={13} className="text-[#128C7E]" />
                    <span>WhatsApp-Nummer ({resolvedData.recipientName})</span>
                  </span>
                  {normalizedPhoneE164 && (
                    <span className="text-[10px] font-mono text-slate-400">
                      {normalizedPhoneE164}
                    </span>
                  )}
                </label>
                <input
                  type="tel"
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  placeholder="z.B. 0664 1234567"
                  className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#128C7E] outline-hidden text-xs text-slate-900 font-semibold"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Begleittext zur PDF-Rechnung
                </label>
                <textarea
                  rows={5}
                  value={whatsappBody}
                  onChange={(e) => setWhatsappBody(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 resize-none focus:bg-white focus:border-[#128C7E] outline-hidden"
                />
              </div>

              <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500 leading-snug">
                  Direkt-Chat zur Rufnummer öffnen:
                </span>
                <a
                  href={whatsappChatHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => handleDirectAppLinkClick('WhatsApp')}
                  className="px-3 h-9 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-[#128C7E] font-bold text-[11px] flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  <MessageCircle size={13} />
                  <span>Chat öffnen</span>
                </a>
              </div>
            </div>
          )}

          {/* ==================== KANAL 3: SMS / NACHRICHTEN ==================== */}
          {channel === 'sms' && (
            <div className="p-3 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Phone size={13} className="text-[#0B57D0]" />
                    <span>Mobilnummer ({resolvedData.recipientName})</span>
                  </span>
                  {normalizedPhoneE164 && (
                    <span className="text-[10px] font-mono text-slate-400">
                      {normalizedPhoneE164}
                    </span>
                  )}
                </label>
                <input
                  type="tel"
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  placeholder="z.B. 0664 1234567"
                  className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#0B57D0] outline-hidden text-xs text-slate-900 font-semibold"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  SMS- / RCS-Rechnungstext (inkl. Zahlungsdaten)
                </label>
                <textarea
                  rows={4}
                  value={smsBody}
                  onChange={(e) => setSmsBody(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 resize-none focus:bg-white focus:border-[#0B57D0] outline-hidden"
                />
              </div>

              <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500 leading-snug">
                  Klassische SMS direkt an Nummer öffnen:
                </span>
                <a
                  href={smsHref}
                  onClick={() => handleDirectAppLinkClick('SMS')}
                  className="px-3 h-9 rounded-xl bg-blue-50 hover:bg-blue-100 text-[#0B57D0] font-bold text-[11px] flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  <MessageSquare size={13} />
                  <span>SMS öffnen</span>
                </a>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-[#B42318] flex items-start gap-2 animate-fade-in">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {feedbackMessage && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-[#2C7738] flex items-center justify-center gap-1.5 animate-fade-in text-center">
              <Check size={15} className="shrink-0" />
              <span>{feedbackMessage}</span>
            </div>
          )}
        </div>

        {/* Primäre Sende-Leiste in der Daumenzone (Pixel 10 Pro) – Letzte Bestätigung */}
        <div className="pt-3 border-t border-slate-200/80 flex items-center gap-2 mt-1">
          <button
            type="button"
            disabled={isSending}
            onClick={() => setSendingInvoiceId(null)}
            className="px-4 h-12 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors shrink-0"
          >
            Abbrechen
          </button>

          {channel === 'gmail' && (
            <button
              type="button"
              disabled={isSending || (!hasToken && !isNativeAndroid)}
              onClick={() => void handleSendGmailDirectly()}
              className="flex-1 h-12 bg-[#3138A0] hover:bg-[#272d82] disabled:opacity-50 active:scale-98 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 shadow-xs transition-all"
            >
              {isSending ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>Sende PDF automatisch...</span>
                </>
              ) : (
                <>
                  <Send size={15} />
                  <span>PDF per Gmail senden</span>
                </>
              )}
            </button>
          )}

          {channel === 'whatsapp' && (
            <button
              type="button"
              onClick={() => void handleSharePdfWithText('WhatsApp', whatsappBody)}
              className="flex-1 h-12 bg-[#128C7E] hover:bg-[#0e7266] active:scale-98 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 shadow-xs transition-all"
            >
              <MessageCircle size={16} />
              <span>PDF per WhatsApp senden</span>
            </button>
          )}

          {channel === 'sms' && (
            <button
              type="button"
              onClick={() => void handleSharePdfWithText('SMS / RCS', smsBody)}
              className="flex-1 h-12 bg-[#0B57D0] hover:bg-[#0842a0] active:scale-98 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 shadow-xs transition-all"
            >
              <MessageSquare size={16} />
              <span>PDF per SMS / RCS senden</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
