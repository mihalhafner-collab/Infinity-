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
  formatEuro,
  generateInvoicePdfAsync,
  resolveInvoiceDisplayData
} from '../../utils/invoicePdf.ts';
import {
  getAccessToken,
  googleSignIn,
  logoutGmail,
  sendInvoicePdfViaGmail,
  subscribeGmailAuth
} from '../../services/gmailService.ts';
import {
  downloadOrSaveBlob,
  isNativeAndroidApp,
  shareDocumentNatively
} from '../../services/nativeBridge.ts';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  FileText,
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
    updateCustomer
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

  // Expliziter Bestätigungsdialog vor E-Mail-Versand über Gmail API
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

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

      // Sinnvolle Kanal-Vorauswahl: Gmail wenn E-Mail hinterlegt oder Token aktiv, sonst WhatsApp bei vorhandener Telefonnummer
      if (!initEmail && initPhone && !hasToken) {
        setChannel('whatsapp');
      } else {
        setChannel('gmail');
      }

      setEmailSubject(`${docTitle} – ${ISSUER_COMPANY}`);
      setEmailBody(
        [
          'Sehr geehrte Damen und Herren,',
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
      setConfirmSendOpen(false);
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
      await googleSignIn();
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

  const handleRequestGmailSend = () => {
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
    setConfirmSendOpen(true);
  };

  const handleConfirmAndSendGmail = async () => {
    setErrorMessage(null);
    setIsSending(true);
    try {
      const freshPdf = pdfArtifact || (await generateInvoicePdfAsync(resolvedData));
      const cleanEmail = recipientEmail.trim();
      const cleanSubject = emailSubject.trim() || `Rechnungs Nr. ${invoice.invoice_number}`;

      if (isNativeAndroid && !hasToken) {
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
      } else {
        const token = await getAccessToken();
        if (!token) {
          setConfirmSendOpen(false);
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

      const todayIso = new Date().toISOString().slice(0, 10);
      updateInvoice(invoice.id, {
        sent_at: todayIso,
        sent_via: `Gmail PDF (${cleanEmail})`
      });

      if (customer && cleanEmail !== customer.email) {
        updateCustomer(customer.id, { email: cleanEmail });
      }

      setConfirmSendOpen(false);
      setFeedbackMessage(`PDF-Rechnung per Gmail an ${cleanEmail} übergeben`);
      setTimeout(() => {
        setSendingInvoiceId(null);
      }, 1000);
    } catch (err) {
      setConfirmSendOpen(false);
      const msg = err instanceof Error ? err.message : 'Fehler beim Gmail-Versand.';
      setErrorMessage(msg);
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
          setFeedbackMessage(`PDF-Rechnung über ${viaLabel} übergeben`);
          setTimeout(() => setSendingInvoiceId(null), 900);
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
        setFeedbackMessage(`PDF-Rechnung über ${viaLabel} gesendet`);
        setTimeout(() => setSendingInvoiceId(null), 900);
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
        setFeedbackMessage(`Über ${viaLabel} geteilt`);
        setTimeout(() => setSendingInvoiceId(null), 900);
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
                    <span className="text-[10px] font-semibold text-[#2C7738] bg-emerald-50 px-2 py-0.5 rounded-md">
                      Pixel Gmail-App bereit
                    </span>
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
                  <div className="px-2.5 py-2 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#2C7738] truncate">
                      Übergabe inkl. PDF direkt an deine Pixel Gmail-App
                    </span>
                    <Check size={14} className="text-[#2C7738] shrink-0" />
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

        {/* Primäre Sende-Leiste in der Daumenzone (Pixel 10 Pro) */}
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
              onClick={handleRequestGmailSend}
              className="flex-1 h-12 bg-[#3138A0] hover:bg-[#272d82] disabled:opacity-50 active:scale-98 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 shadow-xs transition-all"
            >
              <Send size={15} />
              <span>PDF per Gmail senden</span>
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

        {/* Pflicht-Bestätigungsdialog vor E-Mail-Versand im Namen des Nutzers */}
        {confirmSendOpen && (
          <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-2xs rounded-t-3xl flex items-end p-4 animate-fade-in">
            <div className="w-full bg-white border border-slate-200 rounded-3xl p-4 shadow-2xl space-y-3 text-xs text-slate-700">
              <h3 className="text-sm font-bold text-slate-900">
                PDF-Rechnung jetzt über Gmail senden?
              </h3>
              <p className="text-slate-600">
                Folgende E-Mail wird mit angehängter PDF-Rechnung (inkl. Original-Logo) über Ihr Gmail-Konto versendet:
              </p>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-1.5 text-[11px]">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Von:</span>
                  <span className="font-semibold text-slate-900 truncate">
                    {gmailUser?.email || 'Gmail-Konto'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">An:</span>
                  <span className="font-bold text-slate-900 truncate">
                    {recipientEmail.trim()}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Betreff:</span>
                  <span className="font-semibold text-slate-900 truncate">
                    {emailSubject}
                  </span>
                </div>
                <div className="flex justify-between gap-2 pt-1 border-t border-slate-200">
                  <span className="text-slate-500">PDF-Anhang:</span>
                  <span className="font-bold text-[#2C7738] truncate">
                    {displayFilename} ({formatEuro(resolvedData.totalAmount)})
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={isSending}
                  onClick={() => setConfirmSendOpen(false)}
                  className="flex-1 h-11 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  disabled={isSending}
                  onClick={handleConfirmAndSendGmail}
                  className="flex-1 h-11 bg-[#3138A0] hover:bg-[#272d82] disabled:opacity-60 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors"
                >
                  {isSending ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Sende PDF...</span>
                    </>
                  ) : (
                    <>
                      <Send size={14} />
                      <span>Bestätigen & Senden</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
