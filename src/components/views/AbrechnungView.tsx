import React, { useState, useEffect, useRef } from 'react';
import { useApp, usePixelBackLayer } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { UndoToast } from '../common/UndoToast.tsx';
import { SwipeToDeleteRow } from '../common/SwipeToDeleteRow.tsx';
import { InvoicePaperPreview } from '../common/InvoicePaperPreview.tsx';
import { CollapsibleCard } from '../common/CollapsibleCard.tsx';
import { GuvPanel } from './GuvPanel.tsx';
import {
  detectRecipientSalutation,
  formatDateDE,
  generateInvoicePdfAsync,
  getEffectiveBillingCustomerId,
  replaceIntroSalutation,
  resolveInvoiceDisplayData
} from '../../utils/invoicePdf.ts';
import { downloadOrSaveBlob } from '../../services/nativeBridge.ts';
import {
  Receipt,
  CheckCircle,
  CreditCard,
  Ban,
  Pencil,
  Trash2,
  Share2,
  Download,
  FileText,
  X
} from 'lucide-react';
import { Invoice, PaymentItem } from '../../types/index.ts';

function parseSignedDecimal(val: string): number {
  const trimmed = val.trim();
  if (!trimmed) return 0;
  const isNeg = trimmed.startsWith('-');
  const cleaned = trimmed.replace(',', '.').replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  if (Number.isNaN(parsed)) return 0;
  return isNeg ? -parsed : parsed;
}

export const AbrechnungView: React.FC = () => {
  const {
    invoices,
    workRecords,
    customers,
    selectedInvoiceId,
    setSelectedInvoiceId,
    setSelectedCustomerId,
    setSelectedWorkRecordId,
    setSendingInvoiceId,
    updateWorkRecord,
    updateInvoice,
    deleteInvoice,
    payInvoice,
    updatePayment,
    deletePayment,
    correctPayment,
    stornoInvoice,
    recordRefund,
    activeModal,
    setActiveModal
  } = useApp();

  const [mainTab, setMainTab] = useState<'rechnungen' | 'guv'>('rechnungen');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [mainTab, selectedInvoiceId]);

  useEffect(() => {
    if (activeModal === 'OPEN_GUV_TAB') {
      setSelectedInvoiceId(null);
      setMainTab('guv');
      setActiveModal(null);
    }
  }, [activeModal, setActiveModal, setSelectedInvoiceId]);
  const [docPreviewOpen, setDocPreviewOpen] = useState(true);
  const [stornoModalOpen, setStornoModalOpen] = useState(false);
  const [stornoReason, setStornoReason] = useState('Abrechnung korrigieren');
  const [partialPayModalOpen, setPartialPayModalOpen] = useState(false);
  const [partialAmount, setPartialAmount] = useState('100');
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('240');

  // Bearbeiten-Zustand für Belege / Abschlüsse (Buchungshistorie & Rechnungstext)
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editInvNumber, setEditInvNumber] = useState('');
  const [editCustomerId, setEditCustomerId] = useState('');
  const [editCustomerNumber, setEditCustomerNumber] = useState('');
  const [editBillingName, setEditBillingName] = useState('');
  const [editIssueDate, setEditIssueDate] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editServicePeriod, setEditServicePeriod] = useState('');
  const [editSubjectText, setEditSubjectText] = useState('');
  const [editIntroText, setEditIntroText] = useState('');
  const [editPaymentTermsText, setEditPaymentTermsText] = useState('');
  const [editClosingText, setEditClosingText] = useState('');
  const [editTotalAmountStr, setEditTotalAmountStr] = useState('');
  const [editStatus, setEditStatus] = useState<Invoice['status']>('unpaid');
  const [editStornoReason, setEditStornoReason] = useState('');

  // Bearbeiten-Zustand für einzelne Zahlungsbuchungen
  const [editingPayment, setEditingPayment] = useState<{
    invoiceId: string;
    payment: PaymentItem;
  } | null>(null);
  const [editPayDate, setEditPayDate] = useState('');
  const [editPayAmountStr, setEditPayAmountStr] = useState('');
  const [editPayNote, setEditPayNote] = useState('');

  usePixelBackLayer(mainTab === 'guv' && !selectedInvoiceId, () => setMainTab('rechnungen'));
  usePixelBackLayer(refundModalOpen, () => setRefundModalOpen(false));
  usePixelBackLayer(partialPayModalOpen, () => setPartialPayModalOpen(false));
  usePixelBackLayer(stornoModalOpen, () => setStornoModalOpen(false));
  usePixelBackLayer(Boolean(editingInvoice), () => setEditingInvoice(null));
  usePixelBackLayer(Boolean(editingPayment), () => setEditingPayment(null));

  // Offene Arbeitsaufzeichnungen je Rechnungsempfänger (inkl. Sub-Objekte, exkl. L.C.R.)
  const openWorkRecords = workRecords.filter((w) => !w.settlement_id && !w.is_lcr);

  const groupedOpenWork = customers
    .map((c) => {
      const records = openWorkRecords.filter(
        (w) => getEffectiveBillingCustomerId(w, customers) === c.id
      );
      const totalHours = Math.round(records.reduce((s, r) => s + r.hours, 0) * 100) / 100;
      const totalAmount = Math.round(
        records.reduce((s, r) => s + (r.accounting_amount || 0), 0) * 100
      ) / 100;
      const subCustomerNames = Array.from(
        new Set(
          records
            .filter((r) => r.customer_id !== c.id)
            .map((r) => customers.find((sc) => sc.id === r.customer_id)?.name)
            .filter((n): n is string => !!n)
        )
      );
      return {
        customer: c,
        records,
        totalHours,
        totalAmount,
        subCustomerNames
      };
    })
    .filter((g) => g.records.length > 0);

  // Kennzahlen live aus aktiven Rechnungen berechnet
  const activeInvoices = invoices.filter((i) => !i.is_storno && i.status !== 'cancelled');
  const issuedTotal = activeInvoices.reduce((s, i) => s + i.total_amount, 0);
  const paidTotal = activeInvoices.reduce(
    (s, i) => s + i.payments.reduce((ps, p) => ps + p.amount, 0),
    0
  );
  const openTotal = Math.max(0, issuedTotal - paidTotal);

  const openPaymentInvoices = invoices.filter(
    (i) => !i.is_storno && (i.status === 'unpaid' || i.status === 'partially_paid')
  );

  const selectedInvoice = invoices.find((i) => i.id === selectedInvoiceId);

  const openEditInvoiceModal = (inv: Invoice) => {
    const resolved = resolveInvoiceDisplayData(inv, customers, workRecords);
    setEditingInvoice(inv);
    setEditInvNumber(inv.invoice_number);
    setEditCustomerId(inv.customer_id);
    setEditCustomerNumber(resolved.customerNumber);
    setEditBillingName(inv.billing_customer_name);
    setEditIssueDate(inv.issue_date);
    setEditDueDate(inv.due_date);
    setEditServicePeriod(resolved.servicePeriod);
    setEditSubjectText(inv.subject_text || '');
    setEditIntroText(resolved.introText || '');
    setEditPaymentTermsText(resolved.paymentTermsText || '');
    setEditClosingText(resolved.closingText || '');
    setEditTotalAmountStr(String(inv.total_amount).replace('.', ','));
    setEditStatus(inv.status);
    setEditStornoReason(inv.storno_reason || '');
  };

  const handleSaveEditedInvoice = () => {
    if (!editingInvoice) return;
    const parsedAmount = parseSignedDecimal(editTotalAmountStr);
    const normalizedAmount = editingInvoice.is_storno
      ? -Math.abs(parsedAmount)
      : Math.abs(parsedAmount);

    updateInvoice(editingInvoice.id, {
      invoice_number: editInvNumber.trim() || editingInvoice.invoice_number,
      customer_id: editCustomerId || editingInvoice.customer_id,
      customer_number: editCustomerNumber.trim() || editingInvoice.customer_number,
      billing_customer_name: editBillingName.trim() || editingInvoice.billing_customer_name,
      issue_date: editIssueDate || editingInvoice.issue_date,
      due_date: editDueDate || editingInvoice.due_date,
      service_period: editServicePeriod.trim() || editingInvoice.service_period,
      subject_text: editSubjectText.trim() || undefined,
      intro_text: editIntroText.trim() || undefined,
      payment_terms_text: editPaymentTermsText.trim() || undefined,
      closing_text: editClosingText.trim() || undefined,
      total_amount: normalizedAmount,
      status: editingInvoice.is_storno ? 'cancelled' : editStatus,
      storno_reason: editingInvoice.is_storno ? editStornoReason.trim() : editingInvoice.storno_reason
    });

    setEditingInvoice(null);
  };

  const openEditPaymentModal = (invoiceId: string, payment: PaymentItem) => {
    setEditingPayment({ invoiceId, payment });
    setEditPayDate(payment.date);
    setEditPayAmountStr(String(payment.amount).replace('.', ','));
    setEditPayNote(payment.note);
  };

  const handleSaveEditedPayment = () => {
    if (!editingPayment) return;
    const amt = parseSignedDecimal(editPayAmountStr);
    updatePayment(editingPayment.invoiceId, editingPayment.payment.id, {
      date: editPayDate || editingPayment.payment.date,
      amount: amt,
      note: editPayNote.trim() || 'Zahlung'
    });
    setEditingPayment(null);
  };

  const handlePayFull = (inv: Invoice) => {
    payInvoice(inv.id);
  };

  const confirmStorno = () => {
    if (!selectedInvoice) return;
    stornoInvoice(selectedInvoice.id, stornoReason);
    setStornoModalOpen(false);
  };

  const confirmPartialPayment = () => {
    if (!selectedInvoice) return;
    const amt = parseSignedDecimal(partialAmount);
    if (amt > 0) {
      payInvoice(selectedInvoice.id, amt);
    }
    setPartialPayModalOpen(false);
  };

  const confirmRefund = () => {
    if (!selectedInvoice) return;
    const amt = parseSignedDecimal(refundAmount);
    if (amt > 0) {
      recordRefund(selectedInvoice.id, amt, 'Tatsächliche Rücküberweisung');
    }
    setRefundModalOpen(false);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
      <Header
        title={selectedInvoice ? `Beleg ${selectedInvoice.invoice_number}` : 'Abrechnung'}
        subtitle={
          selectedInvoice
            ? selectedInvoice.billing_customer_name
            : mainTab === 'guv'
              ? 'Gewinn & Verlust'
              : 'Rechnungsübersicht'
        }
        showBack={!!selectedInvoice}
      />

      <UndoToast />

      {/* BELEG-DETAILANSICHT */}
      {selectedInvoice ? (
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-xs text-slate-700 overscroll-contain"
        >
          {/* Header Card */}
          <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Empfänger
                </span>
                <h3 className="text-base font-bold text-slate-900 leading-tight">
                  {selectedInvoice.billing_customer_name}
                </h3>
                <span className="text-xs text-slate-500 font-mono">
                  {selectedInvoice.invoice_number}
                </span>
              </div>
              <div className="text-right">
                <span
                  className={`text-lg font-bold block ${
                    selectedInvoice.is_storno ? 'text-[#B42318]' : 'text-[#B4470B]'
                  }`}
                >
                  {selectedInvoice.total_amount.toLocaleString('de-DE', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}{' '}
                  €
                </span>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-md inline-block ${
                    selectedInvoice.status === 'paid'
                      ? 'bg-emerald-50 text-[#2C7738]'
                      : selectedInvoice.status === 'cancelled'
                        ? 'bg-slate-100 text-slate-500'
                        : 'bg-fuchsia-50 text-[#9A1B8D]'
                  }`}
                >
                  {selectedInvoice.status === 'paid'
                    ? 'Bezahlt'
                    : selectedInvoice.status === 'cancelled'
                      ? 'Storniert'
                      : selectedInvoice.status === 'partially_paid'
                        ? 'Teilbezahlt'
                        : 'Zahlung offen'}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
              <div>
                <span>Rechnungsdatum: </span>
                <span className="font-semibold text-slate-700">
                  {formatDateDE(selectedInvoice.issue_date)}
                </span>
              </div>
              <div>
                <span>Fällig bis (14 T.): </span>
                <span className="font-semibold text-slate-700">
                  {formatDateDE(selectedInvoice.due_date)}
                </span>
              </div>
            </div>

            {selectedInvoice.sent_via && (
              <div className="px-2.5 py-1.5 bg-indigo-50/70 border border-indigo-100 rounded-xl text-[11px] text-[#3138A0] font-semibold flex items-center justify-between">
                <span>Versendet ({selectedInvoice.sent_via})</span>
                {selectedInvoice.sent_at && (
                  <span className="text-[10px] text-slate-500">
                    {formatDateDE(selectedInvoice.sent_at)}
                  </span>
                )}
              </div>
            )}

            {selectedInvoice.storno_reason && (
              <div className="p-2 bg-slate-50 rounded-lg text-[11px] text-slate-600">
                <span className="font-semibold">Grund: </span>
                {selectedInvoice.storno_reason}
              </div>
            )}
          </div>

          {/* Original-Rechnungsbeleg im Design: Hafner Grünraum Handwerk */}
          <CollapsibleCard
            title="Rechnungsdokument (A4 Originaldesign)"
            subtitle="Hafner Grünraum Handwerk · inkl. Original-Logo"
            icon={<FileText size={16} />}
            iconBgClassName="bg-indigo-50 text-[#3138A0] border-indigo-100"
            open={docPreviewOpen}
            onToggle={() => setDocPreviewOpen((p) => !p)}
            bodyClassName="px-3 pb-3 pt-3 border-t border-slate-100 bg-slate-50/70"
          >
            <InvoicePaperPreview
              data={resolveInvoiceDisplayData(selectedInvoice, customers, workRecords)}
            />
          </CollapsibleCard>

          {/* Zahlungsstatus & Betragsaufstellung */}
          {!selectedInvoice.is_storno &&
            (() => {
              const paid = selectedInvoice.payments.reduce((s, p) => s + p.amount, 0);
              const remaining = Math.max(0, selectedInvoice.total_amount - paid);

              return (
                <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2">
                  <div className="flex items-center justify-between font-semibold">
                    <span>Rechnungsbetrag:</span>
                    <span>
                      {selectedInvoice.total_amount.toLocaleString('de-DE', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })}{' '}
                      €
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[#2C7738]">
                    <span>Bereits bezahlt:</span>
                    <span className="font-bold">
                      {paid.toLocaleString('de-DE', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })}{' '}
                      €
                    </span>
                  </div>
                  <div className="flex items-center justify-between font-bold text-sm text-[#B4470B] pt-1 border-t border-slate-100">
                    <span>Offener Restbetrag:</span>
                    <span>
                      {remaining.toLocaleString('de-DE', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })}{' '}
                      €
                    </span>
                  </div>

                  {selectedInvoice.open_refund_amount > 0 && (
                    <div className="p-2.5 bg-fuchsia-50 border border-fuchsia-200 rounded-xl text-xs space-y-1 mt-2">
                      <div className="flex justify-between font-bold text-[#9A1B8D]">
                        <span>Rückzahlung offen:</span>
                        <span>{selectedInvoice.open_refund_amount.toFixed(2)} €</span>
                      </div>
                      <p className="text-[10px] text-slate-600">
                        Rechnung wurde bezahlt und storniert. Tatsächliche Rückzahlung muss dokumentiert werden.
                      </p>
                      <button
                        onClick={() => {
                          setRefundAmount(selectedInvoice.open_refund_amount.toString());
                          setRefundModalOpen(true);
                        }}
                        className="w-full mt-1 py-1.5 bg-[#9A1B8D] hover:bg-[#801675] text-white font-semibold text-xs rounded-lg transition-colors"
                      >
                        Rückzahlung dokumentieren
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

          {/* Verknüpfte Arbeitsaufzeichnungen (Stunden ändern oder für Offene Stunden freigeben) */}
          {!selectedInvoice.is_storno &&
            (() => {
              const boundWorkRecords = workRecords.filter(
                (w) =>
                  w.settlement_id === selectedInvoice.id ||
                  selectedInvoice.work_record_ids.includes(w.id)
              );
              const customerOpenCandidateRecords = workRecords.filter(
                (w) =>
                  !w.settlement_id &&
                  !w.is_lcr &&
                  !selectedInvoice.work_record_ids.includes(w.id) &&
                  getEffectiveBillingCustomerId(w, customers) === selectedInvoice.customer_id
              );

              return (
                <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Arbeitsaufzeichnungen ({boundWorkRecords.length})
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Tippen zum Bearbeiten · Freigeben = zurück in Offene Std.
                    </span>
                  </div>

                  {boundWorkRecords.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">
                      Keine Arbeitsaufzeichnungen an diese Rechnung gebunden.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {boundWorkRecords.map((w) => (
                        <div
                          key={w.id}
                          className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2 text-xs"
                        >
                          <div
                            onClick={() => {
                              setSelectedWorkRecordId(w.id);
                              setActiveModal('ARBEIT_BEARBEITEN');
                            }}
                            className="min-w-0 flex-1 cursor-pointer"
                          >
                            <span className="font-bold text-slate-900 block truncate">
                              {w.title}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {formatDateDE(w.work_date)} ·{' '}
                              {(w.hours ?? 0).toLocaleString('de-DE', {
                                maximumFractionDigits: 2
                              })}{' '}
                              Std.
                              {w.hourly_rate ? ` × ${w.hourly_rate} €` : ''}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="font-bold text-[#B4470B] tabular-nums">
                              {(w.accounting_amount || 0).toLocaleString('de-DE', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                              })}{' '}
                              €
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedWorkRecordId(w.id);
                                setActiveModal('ARBEIT_BEARBEITEN');
                              }}
                              className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-[#3138A0] hover:bg-slate-100"
                              title="Arbeitsaufzeichnung bearbeiten"
                            >
                              <Pencil size={12} />
                            </button>
                            {selectedInvoice.status !== 'cancelled' && (
                              <button
                                type="button"
                                onClick={() => {
                                  updateWorkRecord(w.id, { settlement_id: null });
                                }}
                                className="px-2 h-8 text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition-colors"
                                title="Aus Rechnung lösen und zurück in Offene Stunden verschieben"
                              >
                                Freigeben
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedInvoice.status !== 'cancelled' &&
                    customerOpenCandidateRecords.length > 0 && (
                      <div className="pt-2 border-t border-slate-100 space-y-1.5">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                          Offene Stunden dieses Kunden ({customerOpenCandidateRecords.length})
                        </span>
                        {customerOpenCandidateRecords.map((w) => (
                          <div
                            key={w.id}
                            className="p-2 bg-amber-50/50 border border-amber-200/80 rounded-xl flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="font-semibold text-slate-800 block truncate">
                                {w.title}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                {formatDateDE(w.work_date)} · {w.hours} Std. ·{' '}
                                {(w.accounting_amount || 0).toFixed(2)} €
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                updateWorkRecord(w.id, {
                                  settlement_id: selectedInvoice.id,
                                  is_lcr: false
                                });
                              }}
                              className="px-2.5 h-7 bg-[#3138A0] text-white text-[10px] font-bold rounded-lg shrink-0"
                            >
                              + Zur Rechnung
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              );
            })()}

          {/* Buchungshistorie der Zahlungen (bearbeitbar + nach links wischen zum Löschen) */}
          <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Zahlungsverlauf ({selectedInvoice.payments.length})
              </span>
              {selectedInvoice.payments.length > 0 && (
                <span className="text-[10px] text-slate-400">Nach links wischen löscht</span>
              )}
            </div>

            {selectedInvoice.payments.length === 0 ? (
              <p className="text-xs text-slate-400 italic">Noch keine Zahlungen gebucht.</p>
            ) : (
              <div className="space-y-2">
                {selectedInvoice.payments.map((p) => (
                  <SwipeToDeleteRow
                    key={p.id}
                    onDelete={() => deletePayment(selectedInvoice.id, p.id)}
                    deleteLabel="Zahlung löschen"
                  >
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-800">{p.date}</span>
                          {p.is_reversal && (
                            <span className="px-1.5 py-0.5 bg-red-100 text-[#B42318] text-[9px] font-bold rounded">
                              Gegenbuchung
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 block truncate">{p.note}</span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`font-bold font-mono ${
                            p.amount < 0 ? 'text-[#B42318]' : 'text-[#2C7738]'
                          }`}
                        >
                          {p.amount > 0 ? `+${p.amount.toFixed(2)}` : p.amount.toFixed(2)} €
                        </span>

                        <button
                          type="button"
                          onClick={() => openEditPaymentModal(selectedInvoice.id, p)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-[#3138A0] hover:bg-slate-100 transition-colors"
                          title="Zahlung bearbeiten"
                        >
                          <Pencil size={12} />
                        </button>

                        {!p.is_reversal && selectedInvoice.status !== 'cancelled' && (
                          <button
                            type="button"
                            onClick={() =>
                              correctPayment(selectedInvoice.id, p.id, 'Falsch verbucht')
                            }
                            className="px-2 h-8 text-[10px] font-semibold text-[#B42318] bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                            title="Gegenbuchung"
                          >
                            Storno
                          </button>
                        )}
                      </div>
                    </div>
                  </SwipeToDeleteRow>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* HAUPTANSICHT ABRECHNUNG & GEWINN/VERLUST: Ansicht oben, Bedienung unten */
        <>
          {mainTab === 'guv' ? (
            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col overscroll-contain"
            >
              <GuvPanel />
            </div>
          ) : (
            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto p-3.5 flex flex-col gap-3 overscroll-contain"
            >
              {/* OBEN: Reine Übersichten (Kennzahlen, Unbezahlte Rechnungen, Alle Rechnungen) */}
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <div className="py-2.5 px-2.5 bg-white border border-slate-200 rounded-2xl shadow-2xs text-center">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-tight block">
                      Ausgestellt
                    </span>
                    <span className="text-base font-bold text-[#B4470B] block mt-0.5 font-mono tabular-nums">
                      {issuedTotal.toFixed(0)} €
                    </span>
                  </div>

                  <div className="py-2.5 px-2.5 bg-white border border-slate-200 rounded-2xl shadow-2xs text-center">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-tight block">
                      Bezahlt
                    </span>
                    <span className="text-base font-bold text-[#2C7738] block mt-0.5 font-mono tabular-nums">
                      {paidTotal.toFixed(0)} €
                    </span>
                  </div>

                  <div className="py-2.5 px-2.5 bg-white border border-slate-200 rounded-2xl shadow-2xs text-center">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-tight block">
                      Unbezahlt
                    </span>
                    <span className="text-base font-bold text-[#B4470B] block mt-0.5 font-mono tabular-nums">
                      {openTotal.toFixed(0)} €
                    </span>
                  </div>
                </div>

                {/* Unbezahlte Rechnungen */}
                <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs px-3.5 py-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-950">
                      Unbezahlte Rechnungen
                    </h3>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-lg ${
                        openPaymentInvoices.length > 0
                          ? 'bg-fuchsia-50 text-[#9A1B8D]'
                          : 'bg-emerald-50 text-[#2C7738]'
                      }`}
                    >
                      {openPaymentInvoices.length === 0
                        ? 'Alle bezahlt'
                        : `${openPaymentInvoices.length} offen`}
                    </span>
                  </div>

                  {openPaymentInvoices.length > 0 && (
                    <div className="space-y-2">
                      {openPaymentInvoices.map((inv) => {
                        const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
                        const openRest = Math.max(0, inv.total_amount - paid);
                        const custNo =
                          inv.customer_number ||
                          customers.find((c) => c.id === inv.customer_id)?.customer_number;
                        return (
                          <SwipeToDeleteRow
                            key={inv.id}
                            onDelete={() => deleteInvoice(inv.id)}
                            deleteLabel="Rechnung löschen"
                          >
                            <div
                              onClick={() => setSelectedInvoiceId(inv.id)}
                              className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2.5 cursor-pointer hover:border-[#3138A0] transition-colors"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="font-bold text-slate-950 block text-sm leading-snug truncate">
                                  {inv.billing_customer_name}
                                </span>
                                <div className="flex items-center gap-1.5 text-xs text-slate-600 mt-0.5 truncate">
                                  {custNo && (
                                    <span className="font-mono font-bold text-[#3138A0]">
                                      #{custNo}
                                    </span>
                                  )}
                                  {custNo && <span>·</span>}
                                  <span className="font-mono text-slate-500">
                                    {inv.invoice_number}
                                  </span>
                                  <span>·</span>
                                  <span className="text-[#9A1B8D] font-semibold">
                                    Fällig {formatDateDE(inv.due_date)}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-bold text-sm text-[#B4470B] tabular-nums whitespace-nowrap">
                                  {openRest.toLocaleString('de-DE', {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 2
                                  })}{' '}
                                  €
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSendingInvoiceId(inv.id);
                                  }}
                                  className="w-9 h-9 rounded-xl bg-white border border-slate-200 hover:bg-indigo-50 flex items-center justify-center text-[#3138A0] transition-colors"
                                  title="Rechnung versenden"
                                  aria-label="Rechnung versenden"
                                >
                                  <Share2 size={15} />
                                </button>
                              </div>
                            </div>
                          </SwipeToDeleteRow>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Alle Rechnungen */}
                <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs px-3.5 py-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-950">
                      Alle Rechnungen
                    </span>
                    <span className="text-xs font-semibold text-slate-500">{invoices.length} Belege</span>
                  </div>

                  {invoices.length === 0 ? (
                    <p className="text-sm text-slate-500 italic">
                      Noch keine Rechnungen erstellt.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {invoices.map((inv) => {
                        const custNo =
                          inv.customer_number ||
                          customers.find((c) => c.id === inv.customer_id)?.customer_number;
                        return (
                          <SwipeToDeleteRow
                            key={inv.id}
                            onDelete={() => deleteInvoice(inv.id)}
                            deleteLabel="Eintrag löschen"
                          >
                            <div
                              onClick={() => setSelectedInvoiceId(inv.id)}
                              className="p-3 bg-slate-50/80 hover:bg-slate-100 border border-slate-200/90 rounded-xl flex items-center justify-between gap-2 cursor-pointer transition-colors text-xs"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="font-bold text-slate-950 text-sm block truncate leading-snug">
                                  {inv.billing_customer_name}
                                </span>
                                <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5 truncate">
                                  {custNo && (
                                    <span className="font-mono font-bold text-[#3138A0]">
                                      #{custNo}
                                    </span>
                                  )}
                                  {custNo && <span>·</span>}
                                  <span className="font-mono">{inv.invoice_number}</span>
                                  <span>·</span>
                                  <span>{formatDateDE(inv.issue_date)}</span>
                                  {inv.is_pauschal && (
                                    <span className="text-[#B4470B] font-semibold">· Pauschal</span>
                                  )}
                                  {inv.is_storno && (
                                    <span className="text-[#B42318] font-semibold">· Storno</span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <div className="text-right pr-1">
                                  <span
                                    className={`font-bold text-sm block leading-tight tabular-nums whitespace-nowrap ${
                                      inv.is_storno ? 'text-[#B42318]' : 'text-slate-950'
                                    }`}
                                  >
                                    {inv.total_amount.toLocaleString('de-DE', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2
                                    })}{' '}
                                    €
                                  </span>
                                  <span
                                    className={`text-[11px] font-bold ${
                                      inv.status === 'paid'
                                        ? 'text-[#2C7738]'
                                        : inv.status === 'cancelled'
                                          ? 'text-slate-400'
                                          : 'text-[#B4470B]'
                                    }`}
                                  >
                                    {inv.status === 'paid'
                                      ? 'Bezahlt'
                                      : inv.status === 'cancelled'
                                        ? 'Storniert'
                                        : inv.status === 'partially_paid'
                                          ? 'Teilbezahlt'
                                          : 'Unbezahlt'}
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSendingInvoiceId(inv.id);
                                  }}
                                  className="w-9 h-9 rounded-xl bg-white border border-slate-200 hover:bg-indigo-50 flex items-center justify-center text-[#3138A0] transition-colors shrink-0"
                                  title="Rechnung versenden"
                                  aria-label="Rechnung versenden"
                                >
                                  <Share2 size={14} />
                                </button>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditInvoiceModal(inv);
                                  }}
                                  className="w-9 h-9 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-[#3138A0] transition-colors shrink-0"
                                  title="Buchung bearbeiten"
                                  aria-label="Buchung bearbeiten"
                                >
                                  <Pencil size={14} />
                                </button>
                              </div>
                            </div>
                          </SwipeToDeleteRow>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* UNTERER BEREICH: Aktions- & Abrechnungsbereich direkt in Daumenreichweite */}
              <div className="mt-auto pt-1">
                <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs px-3.5 py-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-950">
                      Arbeiten ohne Rechnung
                    </h3>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-lg ${
                        groupedOpenWork.length > 0
                          ? 'bg-orange-50 text-[#B4470B]'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {groupedOpenWork.length === 0
                        ? 'Keine'
                        : `${groupedOpenWork.length} ${groupedOpenWork.length === 1 ? 'Kunde' : 'Kunden'}`}
                    </span>
                  </div>

                  {groupedOpenWork.length > 0 && (
                    <div className="space-y-2">
                      {groupedOpenWork.map((g) => (
                        <div
                          key={g.customer.id}
                          onClick={() => {
                            setSelectedCustomerId(g.customer.id);
                            setActiveModal('RECHNUNG_VORBEREITEN');
                          }}
                          className="p-3 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-xl flex items-center justify-between gap-3 cursor-pointer transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="font-bold text-slate-950 block text-sm leading-snug truncate">
                              {g.customer.name}
                            </span>
                            <div className="flex items-center gap-1.5 text-xs text-slate-600 mt-0.5 truncate">
                              {g.customer.customer_number && (
                                <span className="font-bold font-mono text-[#3138A0]">
                                  #{g.customer.customer_number}
                                </span>
                              )}
                              {g.customer.customer_number && <span>·</span>}
                              <span>
                                {g.records.length} {g.records.length === 1 ? 'Arbeit' : 'Arbeiten'}
                              </span>
                              <span>·</span>
                              <span className="font-medium text-slate-700">
                                {g.totalHours.toLocaleString('de-DE', { maximumFractionDigits: 2 })} Std.
                              </span>
                            </div>
                            {g.subCustomerNames.length > 0 && (
                              <span className="text-[11px] text-[#3138A0] font-medium block truncate mt-0.5">
                                Sub: {g.subCustomerNames.join(', ')}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2.5 shrink-0">
                            <span className="font-bold text-sm text-[#B4470B] tabular-nums whitespace-nowrap">
                              {g.totalAmount.toLocaleString('de-DE', {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 2
                              })}{' '}
                              €
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCustomerId(g.customer.id);
                                setActiveModal('RECHNUNG_VORBEREITEN');
                              }}
                              className="px-3.5 h-9 bg-[#3138A0] hover:bg-[#272d82] active:scale-95 text-white text-xs font-bold rounded-xl shadow-2xs transition-all flex items-center justify-center"
                            >
                              Abrechnen
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* BELEG / BUCHUNG BEARBEITEN MODAL */}
      {editingInvoice && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
          <div className="flex-1" onClick={() => setEditingInvoice(null)} />
          <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[90%] flex flex-col animate-slide-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 leading-tight">
                  {editingInvoice.is_storno ? 'Stornobeleg bearbeiten' : 'Buchung / Rechnung bearbeiten'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Änderungen aktualisieren Beleg, Rechnungstext & Salden sofort
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingInvoice(null)}
                className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-3 text-xs text-slate-700">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="font-semibold block mb-1">Belegnummer</label>
                  <input
                    type="text"
                    value={editInvNumber}
                    onChange={(e) => setEditInvNumber(e.target.value)}
                    className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm font-semibold text-slate-900"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Kunden-Nr.</label>
                  <input
                    type="text"
                    value={editCustomerNumber}
                    onChange={(e) => setEditCustomerNumber(e.target.value)}
                    className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm font-bold font-mono text-[#3138A0]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="font-semibold block mb-1">Kunde</label>
                  <select
                    value={editCustomerId}
                    onChange={(e) => {
                      const cid = e.target.value;
                      setEditCustomerId(cid);
                      const found = customers.find((c) => c.id === cid);
                      if (found) {
                        setEditBillingName(found.name);
                        if (found.customer_number) {
                          setEditCustomerNumber(found.customer_number);
                        }
                        const nextSalutation = detectRecipientSalutation(found.name, found).salutationLine;
                        setEditIntroText((prev) => replaceIntroSalutation(prev, nextSalutation));
                      }
                    }}
                    className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs font-medium text-slate-900"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold block mb-1">Rechnungsempfänger</label>
                  <input
                    type="text"
                    value={editBillingName}
                    onChange={(e) => {
                      const nextName = e.target.value;
                      setEditBillingName(nextName);
                      const activeCust = customers.find((c) => c.id === editCustomerId);
                      const nextSalutation = detectRecipientSalutation(nextName, activeCust).salutationLine;
                      setEditIntroText((prev) => replaceIntroSalutation(prev, nextSalutation));
                    }}
                    className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs font-medium text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="font-semibold block mb-1">Ausstellungsdatum</label>
                  <input
                    type="date"
                    value={editIssueDate}
                    onChange={(e) => setEditIssueDate(e.target.value)}
                    className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Fälligkeit</label>
                  <input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="font-semibold block mb-1">Betrag (€)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={editTotalAmountStr}
                    onChange={(e) => setEditTotalAmountStr(e.target.value)}
                    className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm font-bold text-slate-900"
                  />
                </div>

                {!editingInvoice.is_storno ? (
                  <div>
                    <label className="font-semibold block mb-1">Zahlungsstatus</label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as Invoice['status'])}
                      className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs font-semibold text-slate-900"
                    >
                      <option value="unpaid">Offen</option>
                      <option value="partially_paid">Teilbezahlt</option>
                      <option value="paid">Bezahlt</option>
                      <option value="cancelled">Storniert</option>
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="font-semibold block mb-1">Stornogrund</label>
                    <input
                      type="text"
                      value={editStornoReason}
                      onChange={(e) => setEditStornoReason(e.target.value)}
                      placeholder="Grund..."
                      className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                    />
                  </div>
                )}
              </div>

              {!editingInvoice.is_storno && (
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      Arbeitsaufzeichnungen in Rechnung
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Abwählen = zurück in Offene Std.
                    </span>
                  </div>

                  {(() => {
                    const liveInv =
                      invoices.find((i) => i.id === editingInvoice.id) || editingInvoice;
                    const candidateRecords = workRecords.filter(
                      (w) =>
                        w.settlement_id === liveInv.id ||
                        liveInv.work_record_ids.includes(w.id) ||
                        (!w.settlement_id &&
                          !w.is_lcr &&
                          getEffectiveBillingCustomerId(w, customers) ===
                            (editCustomerId || liveInv.customer_id))
                    );

                    if (candidateRecords.length === 0) {
                      return (
                        <p className="text-[11px] text-slate-400 italic">
                          Keine Arbeitsaufzeichnungen für diesen Kunden vorhanden.
                        </p>
                      );
                    }

                    return (
                      <div className="space-y-2">
                        {candidateRecords.map((w) => {
                          const isBound =
                            w.settlement_id === liveInv.id ||
                            liveInv.work_record_ids.includes(w.id);

                          return (
                            <div
                              key={w.id}
                              className={`p-2.5 rounded-xl border space-y-2 ${
                                isBound
                                  ? 'bg-indigo-50/40 border-indigo-200'
                                  : 'bg-slate-50 border-slate-200 opacity-80'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={isBound}
                                    onChange={() => {
                                      const nextSettlement = isBound ? null : liveInv.id;
                                      updateWorkRecord(w.id, {
                                        settlement_id: nextSettlement,
                                        is_lcr: false
                                      });
                                      // Aktualisiere angezeigten Rechnungsbetrag im Formular
                                      const otherBoundSum = workRecords
                                        .filter(
                                          (r) =>
                                            r.id !== w.id &&
                                            (r.settlement_id === liveInv.id ||
                                              liveInv.work_record_ids.includes(r.id))
                                        )
                                        .reduce((s, r) => s + (r.accounting_amount || 0), 0);
                                      const nextSum =
                                        Math.round(
                                          (otherBoundSum +
                                            (nextSettlement ? w.accounting_amount || 0 : 0)) *
                                            100
                                        ) / 100;
                                      setEditTotalAmountStr(String(nextSum).replace('.', ','));
                                    }}
                                    className="w-4 h-4 accent-[#3138A0] rounded shrink-0"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <span className="font-bold text-slate-900 block truncate">
                                      {w.title}
                                    </span>
                                    <span className="text-[10px] text-slate-500">
                                      {formatDateDE(w.work_date)} ·{' '}
                                      {isBound ? 'In Rechnung' : 'Offene Stunden'}
                                    </span>
                                  </div>
                                </label>

                                <span className="font-bold text-xs text-[#B4470B] tabular-nums">
                                  {(w.accounting_amount || 0).toFixed(2)} €
                                </span>
                              </div>

                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">
                                    Stunden
                                  </label>
                                  <input
                                    type="number"
                                    step="0.25"
                                    min="0"
                                    value={w.hours ?? 0}
                                    onChange={(e) => {
                                      const nextH = Math.max(
                                        0,
                                        parseFloat(e.target.value.replace(',', '.')) || 0
                                      );
                                      const rate =
                                        w.hourly_rate && w.hourly_rate > 0 ? w.hourly_rate : 50;
                                      const nextAmt =
                                        Math.round(
                                          (nextH * rate + (w.material_cost || 0)) * 100
                                        ) / 100;
                                      updateWorkRecord(w.id, {
                                        hours: nextH,
                                        hourly_rate: rate,
                                        accounting_amount: nextAmt
                                      });
                                      if (isBound) {
                                        const otherBoundSum = workRecords
                                          .filter(
                                            (r) =>
                                              r.id !== w.id &&
                                              (r.settlement_id === liveInv.id ||
                                                liveInv.work_record_ids.includes(r.id))
                                          )
                                          .reduce((s, r) => s + (r.accounting_amount || 0), 0);
                                        const nextTotal =
                                          Math.round((otherBoundSum + nextAmt) * 100) / 100;
                                        setEditTotalAmountStr(
                                          String(nextTotal).replace('.', ',')
                                        );
                                      }
                                    }}
                                    className="w-full h-8 px-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-900 outline-hidden focus:border-[#3138A0]"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">
                                    Satz (€/h)
                                  </label>
                                  <input
                                    type="number"
                                    step="1"
                                    min="0"
                                    value={w.hourly_rate ?? 50}
                                    onChange={(e) => {
                                      const nextR = Math.max(
                                        0,
                                        parseFloat(e.target.value.replace(',', '.')) || 0
                                      );
                                      const h = w.hours ?? 0;
                                      const nextAmt =
                                        Math.round(
                                          (h * nextR + (w.material_cost || 0)) * 100
                                        ) / 100;
                                      updateWorkRecord(w.id, {
                                        hourly_rate: nextR,
                                        accounting_amount: nextAmt
                                      });
                                      if (isBound) {
                                        const otherBoundSum = workRecords
                                          .filter(
                                            (r) =>
                                              r.id !== w.id &&
                                              (r.settlement_id === liveInv.id ||
                                                liveInv.work_record_ids.includes(r.id))
                                          )
                                          .reduce((s, r) => s + (r.accounting_amount || 0), 0);
                                        const nextTotal =
                                          Math.round((otherBoundSum + nextAmt) * 100) / 100;
                                        setEditTotalAmountStr(
                                          String(nextTotal).replace('.', ',')
                                        );
                                      }
                                    }}
                                    className="w-full h-8 px-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-900 outline-hidden focus:border-[#3138A0]"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">
                                    Betrag (€)
                                  </label>
                                  <input
                                    type="number"
                                    step="1"
                                    min="0"
                                    value={w.accounting_amount ?? 0}
                                    onChange={(e) => {
                                      const nextAmt = Math.max(
                                        0,
                                        parseFloat(e.target.value.replace(',', '.')) || 0
                                      );
                                      const rate =
                                        w.hourly_rate && w.hourly_rate > 0 ? w.hourly_rate : 50;
                                      const nextH =
                                        rate > 0 && (!w.material_cost || w.material_cost === 0)
                                          ? Math.round((nextAmt / rate) * 100) / 100
                                          : w.hours;
                                      updateWorkRecord(w.id, {
                                        hours: nextH,
                                        hourly_rate: rate,
                                        accounting_amount: nextAmt
                                      });
                                      if (isBound) {
                                        const otherBoundSum = workRecords
                                          .filter(
                                            (r) =>
                                              r.id !== w.id &&
                                              (r.settlement_id === liveInv.id ||
                                                liveInv.work_record_ids.includes(r.id))
                                          )
                                          .reduce((s, r) => s + (r.accounting_amount || 0), 0);
                                        const nextTotal =
                                          Math.round((otherBoundSum + nextAmt) * 100) / 100;
                                        setEditTotalAmountStr(
                                          String(nextTotal).replace('.', ',')
                                        );
                                      }
                                    }}
                                    className="w-full h-8 px-2 bg-white border border-indigo-200 rounded-lg text-xs font-bold text-[#B4470B] outline-hidden focus:border-[#3138A0]"
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {!editingInvoice.is_storno && (
                <div className="pt-2 border-t border-slate-100 space-y-2.5">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    Rechnungstext direkt bearbeiten
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="font-semibold block mb-1">Leistungszeitraum</label>
                      <input
                        type="text"
                        value={editServicePeriod}
                        onChange={(e) => setEditServicePeriod(e.target.value)}
                        className="w-full h-10 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="font-semibold block mb-1">Betreff (optional)</label>
                      <input
                        type="text"
                        value={editSubjectText}
                        onChange={(e) => setEditSubjectText(e.target.value)}
                        placeholder="Standard Rechnungs-Nr."
                        className="w-full h-10 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="font-semibold block mb-1">Anschreiben / Einleitungstext</label>
                    <textarea
                      rows={2}
                      value={editIntroText}
                      onChange={(e) => setEditIntroText(e.target.value)}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 resize-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="font-semibold block mb-1">Zahlungsbedingungen</label>
                      <input
                        type="text"
                        value={editPaymentTermsText}
                        onChange={(e) => setEditPaymentTermsText(e.target.value)}
                        className="w-full h-10 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="font-semibold block mb-1">Schlusstext</label>
                      <input
                        type="text"
                        value={editClosingText}
                        onChange={(e) => setEditClosingText(e.target.value)}
                        className="w-full h-10 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditingInvoice(null)}
                className="flex-1 h-12 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm transition-colors"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleSaveEditedInvoice}
                className="flex-1 h-12 bg-[#3138A0] hover:bg-[#272d82] text-white font-semibold rounded-xl text-sm shadow-xs transition-colors"
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ZAHLUNGSEINTRAG BEARBEITEN MODAL */}
      {editingPayment && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-4 shadow-2xl border border-slate-200 space-y-3 text-xs text-slate-700">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Zahlungsbuchung bearbeiten</h3>
              <button
                type="button"
                onClick={() => setEditingPayment(null)}
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="font-semibold block mb-1">Buchungsdatum</label>
                <input
                  type="date"
                  value={editPayDate}
                  onChange={(e) => setEditPayDate(e.target.value)}
                  className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">Betrag (€)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editPayAmountStr}
                  onChange={(e) => setEditPayAmountStr(e.target.value)}
                  className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold block mb-1">Buchungstext / Notiz</label>
              <input
                type="text"
                value={editPayNote}
                onChange={(e) => setEditPayNote(e.target.value)}
                className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900"
              />
            </div>

            <div className="pt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditingPayment(null)}
                className="flex-1 h-11 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleSaveEditedPayment}
                className="flex-1 h-11 bg-[#3138A0] hover:bg-[#272d82] text-white font-semibold rounded-xl text-xs"
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STORNO CONFIRMATION MODAL (ILL-008) */}
      {stornoModalOpen && selectedInvoice && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-4 shadow-2xl border border-slate-200 space-y-3">
            <h3 className="text-base font-bold text-slate-900">Rechnung stornieren</h3>
            <p className="text-xs text-slate-600">
              Erzeugt einen Stornobeleg mit eigener Nummer über -{selectedInvoice.total_amount.toFixed(2)} €. Die ursprüngliche Rechnung und eventuelle Zahlungen bleiben im Verlauf erhalten.
            </p>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Stornogrund:</label>
              <input
                type="text"
                value={stornoReason}
                onChange={(e) => setStornoReason(e.target.value)}
                className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900"
              />
            </div>

            <div className="pt-2 flex items-center gap-2">
              <button
                onClick={() => setStornoModalOpen(false)}
                className="flex-1 h-11 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs"
              >
                Abbrechen
              </button>
              <button
                onClick={confirmStorno}
                className="flex-1 h-11 bg-[#B42318] hover:bg-red-700 text-white font-semibold rounded-xl text-xs"
              >
                Storno ausstellen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TEILZAHLUNG MODAL */}
      {partialPayModalOpen && selectedInvoice && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-4 shadow-2xl border border-slate-200 space-y-3">
            <h3 className="text-base font-bold text-slate-900">Teilzahlung erfassen</h3>
            <p className="text-xs text-slate-600">
              Erfassen Sie den tatsächlich eingegangenen Betrag für {selectedInvoice.invoice_number}.
            </p>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Betrag in Euro:</label>
              <input
                type="text"
                inputMode="decimal"
                value={partialAmount}
                onChange={(e) => setPartialAmount(e.target.value)}
                className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900"
              />
            </div>

            <div className="pt-2 flex items-center gap-2">
              <button
                onClick={() => setPartialPayModalOpen(false)}
                className="flex-1 h-11 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs"
              >
                Abbrechen
              </button>
              <button
                onClick={confirmPartialPayment}
                className="flex-1 h-11 bg-[#2C7738] hover:bg-[#235f2d] text-white font-semibold rounded-xl text-xs"
              >
                Zahlung buchen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RÜCKZAHLUNG MODAL */}
      {refundModalOpen && selectedInvoice && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-4 shadow-2xl border border-slate-200 space-y-3">
            <h3 className="text-base font-bold text-slate-900">Tatsächliche Rückzahlung dokumentieren</h3>
            <p className="text-xs text-slate-600">
              Dokumentieren Sie die Rücküberweisung des erstatteten Betrags.
            </p>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Erstatteter Betrag in Euro:</label>
              <input
                type="text"
                inputMode="decimal"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900"
              />
            </div>

            <div className="pt-2 flex items-center gap-2">
              <button
                onClick={() => setRefundModalOpen(false)}
                className="flex-1 h-11 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs"
              >
                Abbrechen
              </button>
              <button
                onClick={confirmRefund}
                className="flex-1 h-11 bg-[#9A1B8D] hover:bg-[#801675] text-white font-semibold rounded-xl text-xs"
              >
                Rückzahlung speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unterer Bedienbereich fixiert (Pixel 10 Pro Daumenzone) */}
      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-md">
        {selectedInvoice ? (
          /* Detailansicht Beleg: alle Aktionen & Eingabeoptionen kompakt im unteren Bereich */
          <div className="p-3 space-y-2">
            {!selectedInvoice.is_storno &&
              selectedInvoice.status !== 'paid' &&
              selectedInvoice.status !== 'cancelled' && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handlePayFull(selectedInvoice)}
                    className="h-12 bg-[#2C7738] hover:bg-[#235f2d] active:scale-98 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-all"
                  >
                    <CheckCircle size={16} />
                    <span>Bezahlt (5s Undo)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPartialPayModalOpen(true)}
                    className="h-12 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-900 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all"
                  >
                    <CreditCard size={16} className="text-[#3138A0]" />
                    <span>Teilzahlung</span>
                  </button>
                </div>
              )}

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSendingInvoiceId(selectedInvoice.id)}
                className="flex-1 h-12 px-3 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-2xs transition-all"
              >
                <Share2 size={16} />
                <span>Senden</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  const resolved = resolveInvoiceDisplayData(
                    selectedInvoice,
                    customers,
                    workRecords
                  );
                  const { blob, filename } = await generateInvoicePdfAsync(resolved);
                  await downloadOrSaveBlob(blob, filename, 'application/pdf');
                }}
                className="h-12 px-3 bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold rounded-xl text-xs flex items-center justify-center gap-1 transition-colors shrink-0"
                title="Als PDF herunterladen"
              >
                <Download size={16} className="text-[#3138A0]" />
                <span>PDF</span>
              </button>

              <button
                type="button"
                onClick={() => openEditInvoiceModal(selectedInvoice)}
                className="h-12 px-3 bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold rounded-xl text-xs flex items-center justify-center gap-1 transition-colors shrink-0"
                title="Beleg bearbeiten"
              >
                <Pencil size={16} className="text-[#3138A0]" />
                <span>Ändern</span>
              </button>

              {!selectedInvoice.is_storno && selectedInvoice.status !== 'cancelled' && (
                <button
                  type="button"
                  onClick={() => setStornoModalOpen(true)}
                  className="h-12 px-3 bg-amber-50 hover:bg-amber-100 text-[#B4470B] font-bold rounded-xl text-xs flex items-center justify-center gap-1 transition-colors shrink-0"
                  title="Rechnung stornieren"
                >
                  <Ban size={16} />
                  <span>Storno</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => deleteInvoice(selectedInvoice.id)}
                className="w-12 h-12 bg-red-50 hover:bg-red-100 text-[#B42318] font-bold rounded-xl flex items-center justify-center transition-colors shrink-0"
                title="Beleg löschen"
                aria-label="Beleg löschen"
              >
                <Trash2 size={17} />
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Schlanke untere Bedienzeile */}
            <BottomActionBar>
              <div className="w-full flex items-center p-1 bg-slate-100 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setMainTab('rechnungen')}
                  className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                    mainTab === 'rechnungen'
                      ? 'bg-white text-[#3138A0] shadow-xs'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  Rechnungen
                </button>
                <button
                  type="button"
                  onClick={() => setMainTab('guv')}
                  className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                    mainTab === 'guv'
                      ? 'bg-white text-[#2C7738] shadow-xs'
                      : 'text-slate-600 hover:text-slate-950'
                  }`}
                >
                  Gewinn & Verlust
                </button>
              </div>
            </BottomActionBar>
            <BottomNav />
          </>
        )}
      </div>
    </div>
  );
};
