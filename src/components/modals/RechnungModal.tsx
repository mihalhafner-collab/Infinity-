import React, { useEffect, useMemo, useState } from 'react';
import { InvoiceLineItem, useApp } from '../../context/AppContext.tsx';
import { InvoicePaperPreview } from '../common/InvoicePaperPreview.tsx';
import {
  HAFNER_LOGO_URL,
  ISSUER_CONTACT_PERSON,
  ResolvedInvoiceData,
  addDaysIso,
  buildLineItemsFromRecords,
  buildPaymentTermsClause,
  computeNextInvoiceNumber,
  computeServicePeriod,
  formatDateDE,
  formatEuro,
  formatQtyNumber,
  formatQtyTwoDecimals,
  getCustomerBillingRecipient,
  getEffectiveBillingCustomerId,
  getTodayLocalIso,
  resolveCustomerNumber
} from '../../utils/invoicePdf.ts';
import {
  AlertTriangle,
  Car,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Hash,
  Home,
  Mail,
  Minus,
  Plus,
  Receipt,
  RotateCcw,
  User,
  X
} from 'lucide-react';

type PaymentTermChoice = '0' | '7' | '14' | '30' | 'cash';

const MONTH_NAMES_DE = [
  'Jänner',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember'
];

function parsePositiveDecimal(raw: string): number {
  const cleaned = raw.replace(',', '.').replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
}

function getMonthLabelsFromIso(isoDate: string): { currentMonth: string; prevMonth: string } {
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const now = new Date();
  const year = match ? Number(match[1]) : now.getFullYear();
  const monthIdx = match ? Number(match[2]) - 1 : now.getMonth();
  const safeIdx = monthIdx >= 0 && monthIdx < 12 ? monthIdx : 0;

  const prevDate = new Date(year, safeIdx - 1, 1);
  return {
    currentMonth: `${MONTH_NAMES_DE[safeIdx]} ${year}`,
    prevMonth: `${MONTH_NAMES_DE[prevDate.getMonth()]} ${prevDate.getFullYear()}`
  };
}

export const RechnungModal: React.FC = () => {
  const {
    activeModal,
    setActiveModal,
    customers,
    properties,
    invoices,
    selectedCustomerId: contextCustomerId,
    workRecords,
    preselectedWorkRecordIds,
    setPreselectedWorkRecordIds,
    createInvoiceFromRecords,
    setSelectedInvoiceId,
    setSendingInvoiceId,
    navigate
  } = useApp();

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerNumberStr, setCustomerNumberStr] = useState<string>('1001');
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [showAllOpenRecords, setShowAllOpenRecords] = useState<boolean>(false);

  const [issueDate, setIssueDate] = useState<string>(() => getTodayLocalIso());
  const [invoiceNumberStr, setInvoiceNumberStr] = useState<string>('');
  const [invoiceNumManuallyChanged, setInvoiceNumManuallyChanged] = useState<boolean>(false);

  const [paymentChoice, setPaymentChoice] = useState<PaymentTermChoice>('14');
  const [customServicePeriod, setCustomServicePeriod] = useState<string>('');
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const wasOpenRef = React.useRef(false);

  // Zusatzpositionen, Pauschalen & Nachlass
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [flatTravelEuro, setFlatTravelEuro] = useState<number>(0);
  const [travelHoursStr, setTravelHoursStr] = useState('');
  const [travelRateStr, setTravelRateStr] = useState('50');
  const [travelKmStr, setTravelKmStr] = useState('');
  const [travelKmRateStr, setTravelKmRateStr] = useState('0,60');

  const [disposalEnabled, setDisposalEnabled] = useState(false);
  const [disposalEuroStr, setDisposalEuroStr] = useState('25');

  const [smallMatEnabled, setSmallMatEnabled] = useState(false);
  const [smallMatEuroStr, setSmallMatEuroStr] = useState('15');

  const [discountPercent, setDiscountPercent] = useState<number>(0);

  useEffect(() => {
    const isOpen = activeModal === 'RECHNUNG_VORBEREITEN';
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      const todayIso = getTodayLocalIso();
      let initialCustId = '';

      const preselectedValid = workRecords.filter(
        (w) => preselectedWorkRecordIds.includes(w.id) && !w.settlement_id && !w.is_lcr
      );

      if (preselectedValid.length > 0) {
        const firstCustId =
          getEffectiveBillingCustomerId(preselectedValid[0], customers) ||
          preselectedValid[0].customer_id ||
          (customers[0]?.id ?? '');
        const spansMultipleCustomers = preselectedValid.some(
          (w) => getEffectiveBillingCustomerId(w, customers) !== firstCustId
        );

        initialCustId = firstCustId;
        setSelectedCustomerId(firstCustId);
        setShowAllOpenRecords(spansMultipleCustomers);
        setSelectedRecordIds(preselectedValid.map((w) => w.id));
      } else {
        const ctxCust = customers.find((c) => c.id === contextCustomerId);
        const redirectedRecipient = getCustomerBillingRecipient(ctxCust, customers);
        const defaultCustId = redirectedRecipient
          ? redirectedRecipient.id
          : ctxCust
            ? ctxCust.id
            : (customers[0]?.id ?? '');

        initialCustId = defaultCustId;
        setSelectedCustomerId(defaultCustId);
        setShowAllOpenRecords(false);

        const initialAvailable = workRecords
          .filter(
            (w) =>
              getEffectiveBillingCustomerId(w, customers) === defaultCustId &&
              !w.settlement_id &&
              !w.is_lcr
          )
          .map((w) => w.id);
        setSelectedRecordIds(initialAvailable);
      }

      setCustomerNumberStr(resolveCustomerNumber(initialCustId, customers));
      setIssueDate(todayIso);
      setInvoiceNumberStr(computeNextInvoiceNumber(invoices, todayIso).formatted);
      setInvoiceNumManuallyChanged(false);
      setPaymentChoice('14');
      setCustomServicePeriod('');
      setShowPdfPreview(false);

      setExtrasOpen(false);
      setFlatTravelEuro(0);
      setTravelHoursStr('');
      setTravelRateStr('50');
      setTravelKmStr('');
      setTravelKmRateStr('0,60');
      setDisposalEnabled(false);
      setDisposalEuroStr('25');
      setSmallMatEnabled(false);
      setSmallMatEuroStr('15');
      setDiscountPercent(0);
    } else if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
      if (preselectedWorkRecordIds.length > 0) {
        setPreselectedWorkRecordIds([]);
      }
    }
  }, [
    activeModal,
    contextCustomerId,
    customers,
    invoices,
    workRecords,
    preselectedWorkRecordIds,
    setPreselectedWorkRecordIds
  ]);

  const autoNextInvoice = useMemo(
    () => computeNextInvoiceNumber(invoices, issueDate),
    [invoices, issueDate]
  );

  // Wenn das Jahr beim Rechnungsdatum wechselt und die Nummer nicht manuell überschrieben wurde, automatisch anpassen
  const handleIssueDateChange = (nextDate: string) => {
    setIssueDate(nextDate);
    if (!invoiceNumManuallyChanged && nextDate) {
      setInvoiceNumberStr(computeNextInvoiceNumber(invoices, nextDate).formatted);
    }
  };

  const stepInvoiceNumber = (delta: number) => {
    const current = invoiceNumberStr.trim() || autoNextInvoice.formatted;
    const slashMatch = current.match(/^(.*?)(\d+)\/(\d{4})$/);
    if (slashMatch) {
      const prefix = slashMatch[1] || 'RE-';
      const nextSeq = Math.max(1, parseInt(slashMatch[2], 10) + delta);
      const yr = slashMatch[3];
      const nextFormatted = `${prefix}${nextSeq}/${yr}`;
      setInvoiceNumberStr(nextFormatted);
      setInvoiceNumManuallyChanged(nextFormatted !== autoNextInvoice.formatted);
      return;
    }
    const trailingMatch = current.match(/^(.*?)(\d+)$/);
    if (trailingMatch) {
      const prefix = trailingMatch[1];
      const nextSeq = Math.max(1, parseInt(trailingMatch[2], 10) + delta);
      const nextFormatted = `${prefix}${nextSeq}`;
      setInvoiceNumberStr(nextFormatted);
      setInvoiceNumManuallyChanged(nextFormatted !== autoNextInvoice.formatted);
      return;
    }
    const fallbackSeq = Math.max(1, autoNextInvoice.seq + delta);
    const nextFormatted = `RE-${fallbackSeq}/${autoNextInvoice.year}`;
    setInvoiceNumberStr(nextFormatted);
    setInvoiceNumManuallyChanged(nextFormatted !== autoNextInvoice.formatted);
  };

  const stepCustomerNumber = (delta: number) => {
    const digitsMatch = customerNumberStr.trim().match(/^(.*?)(\d+)$/);
    if (digitsMatch) {
      const prefix = digitsMatch[1];
      const nextVal = Math.max(1, parseInt(digitsMatch[2], 10) + delta);
      setCustomerNumberStr(`${prefix}${nextVal}`);
    } else {
      const fallback = parseInt(resolveCustomerNumber(selectedCustomerId, customers), 10) || 1001;
      setCustomerNumberStr(String(Math.max(1, fallback + delta)));
    }
  };

  const effectiveInvoiceNumber = invoiceNumberStr.trim() || autoNextInvoice.formatted;

  const isDuplicateInvoiceNumber = useMemo(
    () =>
      invoices.some(
        (inv) =>
          !inv.is_storno &&
          inv.status !== 'cancelled' &&
          inv.invoice_number.trim().toLowerCase() === effectiveInvoiceNumber.toLowerCase()
      ),
    [invoices, effectiveInvoiceNumber]
  );

  const totalOpenNonLcrCount = useMemo(
    () => workRecords.filter((w) => !w.settlement_id && !w.is_lcr).length,
    [workRecords]
  );

  // Ungebundene, abrechenbare Originalarbeiten (inkl. Sub-Objekten & Mehrfachauswahl) ohne L.C.R.
  const availableRecords = useMemo(
    () =>
      workRecords.filter(
        (w) =>
          !w.settlement_id &&
          !w.is_lcr &&
          (showAllOpenRecords ||
            getEffectiveBillingCustomerId(w, customers) === selectedCustomerId ||
            selectedRecordIds.includes(w.id))
      ),
    [workRecords, customers, selectedCustomerId, showAllOpenRecords, selectedRecordIds]
  );

  const selectedRecords = useMemo(
    () => availableRecords.filter((r) => selectedRecordIds.includes(r.id)),
    [availableRecords, selectedRecordIds]
  );

  const positiveExtraItems = useMemo<InvoiceLineItem[]>(() => {
    const items: InvoiceLineItem[] = [];

    if (flatTravelEuro > 0) {
      items.push({
        id: 'extra-anfahrt-pauschal',
        description: 'Anfahrtspauschale',
        quantity_label: '1,00 Psch',
        unit_price_label: formatEuro(flatTravelEuro),
        amount: flatTravelEuro
      });
    }

    const travelHours = parsePositiveDecimal(travelHoursStr);
    const travelRate = parsePositiveDecimal(travelRateStr);
    if (travelHours > 0) {
      items.push({
        id: 'extra-anfahrtszeit',
        description: 'Anfahrtszeit',
        quantity_label: `${formatQtyTwoDecimals(travelHours)} Std`,
        unit_price_label: formatEuro(travelRate),
        amount: Math.round(travelHours * travelRate * 100) / 100
      });
    }

    const travelKm = parsePositiveDecimal(travelKmStr);
    const kmRate = parsePositiveDecimal(travelKmRateStr);
    if (travelKm > 0) {
      items.push({
        id: 'extra-fahrtkosten',
        description: 'Fahrtkosten',
        quantity_label: `${formatQtyNumber(travelKm)} km`,
        unit_price_label: `${kmRate.toLocaleString('de-DE', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })} EUR`,
        amount: Math.round(travelKm * kmRate * 100) / 100
      });
    }

    if (disposalEnabled) {
      const dispAmt = parsePositiveDecimal(disposalEuroStr);
      if (dispAmt > 0) {
        items.push({
          id: 'extra-entsorgung',
          description: 'Grünschnitt-Entsorgung & Abtransport',
          quantity_label: '1,00 Psch',
          unit_price_label: formatEuro(dispAmt),
          amount: dispAmt
        });
      }
    }

    if (smallMatEnabled) {
      const matAmt = parsePositiveDecimal(smallMatEuroStr);
      if (matAmt > 0) {
        items.push({
          id: 'extra-kleinmaterial',
          description: 'Klein- & Verbrauchsmaterial',
          quantity_label: '1,00 Psch',
          unit_price_label: formatEuro(matAmt),
          amount: matAmt
        });
      }
    }

    return items;
  }, [
    flatTravelEuro,
    travelHoursStr,
    travelRateStr,
    travelKmStr,
    travelKmRateStr,
    disposalEnabled,
    disposalEuroStr,
    smallMatEnabled,
    smallMatEuroStr
  ]);

  const baseLineItems = useMemo(
    () =>
      buildLineItemsFromRecords(selectedRecords, positiveExtraItems, {
        billingCustomerId: selectedCustomerId,
        customers,
        properties
      }),
    [selectedRecords, positiveExtraItems, selectedCustomerId, customers, properties]
  );

  const baseSubtotal = useMemo(
    () => Math.round(baseLineItems.reduce((sum, li) => sum + li.amount, 0) * 100) / 100,
    [baseLineItems]
  );

  const discountItem = useMemo<InvoiceLineItem | null>(() => {
    if (discountPercent <= 0 || baseSubtotal <= 0) return null;
    const discountAmt = -Math.round(baseSubtotal * (discountPercent / 100) * 100) / 100;
    if (discountAmt === 0) return null;
    return {
      id: 'extra-nachlass',
      description: `Nachlass (${discountPercent} %)`,
      quantity_label: '1,00 Psch',
      unit_price_label: formatEuro(discountAmt),
      amount: discountAmt
    };
  }, [discountPercent, baseSubtotal]);

  const allExtraItems = useMemo<InvoiceLineItem[]>(
    () => (discountItem ? [...positiveExtraItems, discountItem] : positiveExtraItems),
    [positiveExtraItems, discountItem]
  );

  const draftLineItems = useMemo<InvoiceLineItem[]>(
    () => (discountItem ? [...baseLineItems, discountItem] : baseLineItems),
    [baseLineItems, discountItem]
  );

  const totalAmount = useMemo(
    () => Math.round(draftLineItems.reduce((sum, li) => sum + li.amount, 0) * 100) / 100,
    [draftLineItems]
  );

  const autoServicePeriod = useMemo(
    () => computeServicePeriod(selectedRecords, issueDate),
    [selectedRecords, issueDate]
  );

  const { currentMonth: currentMonthLabel, prevMonth: prevMonthLabel } = useMemo(
    () => getMonthLabelsFromIso(issueDate),
    [issueDate]
  );

  const issueDateFormatted = formatDateDE(issueDate);
  const effectiveServicePeriod = customServicePeriod.trim() || autoServicePeriod;
  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);

  const isPaidInCash = paymentChoice === 'cash';
  const dueDays = isPaidInCash ? 0 : parseInt(paymentChoice, 10);
  const dueIso = addDaysIso(issueDate, dueDays);
  const paymentTermsClause = buildPaymentTermsClause(dueDays, isPaidInCash);

  const effectiveCustomerNumber =
    customerNumberStr.trim() || resolveCustomerNumber(selectedCustomerId, customers);

  const previewData: ResolvedInvoiceData = {
    invoiceNumber: effectiveInvoiceNumber,
    issueDateIso: issueDate,
    issueDateFormatted,
    dueDateIso: dueIso,
    dueDateFormatted: formatDateDE(dueIso),
    customerNumber: effectiveCustomerNumber,
    contactPerson: ISSUER_CONTACT_PERSON,
    recipientName: selectedCustomer?.name || 'Kunde',
    recipientStreet: selectedCustomer?.street || '',
    recipientZip: selectedCustomer?.zip || '',
    recipientCity: selectedCustomer?.city || '',
    recipientCountry: 'Österreich',
    servicePeriod: effectiveServicePeriod,
    lineItems: draftLineItems,
    totalAmount,
    isStorno: false,
    stornoReason: null,
    paymentTermsText: paymentTermsClause,
    isPaidInCash
  };

  if (activeModal !== 'RECHNUNG_VORBEREITEN') return null;

  const canIssue = selectedCustomerId !== '' && draftLineItems.length > 0;
  const todayIso = getTodayLocalIso();

  const toggleRecord = (id: string) => {
    setSelectedRecordIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedRecordIds.length === availableRecords.length) {
      setSelectedRecordIds([]);
    } else {
      setSelectedRecordIds(availableRecords.map((r) => r.id));
    }
  };

  const handleCreateInvoice = (openSendSheetAfter: boolean) => {
    if (!canIssue) return;
    const inv = createInvoiceFromRecords(selectedCustomerId, selectedRecordIds, {
      extraItems: allExtraItems,
      issueDate,
      servicePeriod: effectiveServicePeriod,
      invoiceNumber: effectiveInvoiceNumber,
      dueDays,
      customerNumber: effectiveCustomerNumber,
      paymentTermsText: paymentTermsClause,
      paidInCash: isPaidInCash
    });
    setPreselectedWorkRecordIds([]);
    setSelectedInvoiceId(inv.id);
    setActiveModal(null);
    navigate('M04_ABRECHNUNG');
    if (openSendSheetAfter) {
      setSendingInvoiceId(inv.id);
    }
  };

  const paymentSubtitle = isPaidInCash
    ? 'Barzahlung (direkt bezahlt)'
    : dueDays === 0
      ? 'Sofort fällig'
      : `${dueDays} Tage Zahlungsziel`;

  const activeExtraCount = allExtraItems.length;
  const extraDeltaSum = Math.round(allExtraItems.reduce((s, item) => s + item.amount, 0) * 100) / 100;

  return (
    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
      <div className="flex-1" onClick={() => setActiveModal(null)} />

      <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[93%] flex flex-col animate-slide-up">
        {/* Header mit Original-Logo & Live-Rechnungsnummer */}
        <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={HAFNER_LOGO_URL}
              alt="Hafner Grünraum Handwerk"
              className="w-10 h-10 object-contain shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-base font-bold text-slate-900 leading-tight truncate">
                  Rechnung vorbereiten
                </h2>
                <span className="px-1.5 py-0.5 rounded-md bg-indigo-50 text-[#3138A0] font-bold text-[10px] shrink-0">
                  {effectiveInvoiceNumber}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                Hafner Grünraum Handwerk · {paymentSubtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveModal(null)}
            className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-full hover:bg-slate-100 transition-colors shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Originalgetreue A4 PDF-Vorschau */}
        {showPdfPreview ? (
          <div className="flex-1 overflow-y-auto py-3 space-y-3 overscroll-contain">
            <InvoicePaperPreview data={previewData} isDraft />

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowPdfPreview(false)}
                className="h-11 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-colors"
              >
                ← Zurück zum Entwurf
              </button>
              <button
                type="button"
                disabled={!canIssue}
                onClick={() => handleCreateInvoice(true)}
                className="h-11 bg-[#3138A0] hover:bg-[#272d82] disabled:opacity-50 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors"
              >
                <Mail size={14} />
                <span>Ausstellen & Senden</span>
              </button>
            </div>
          </div>
        ) : (
          /* Entwurfs-Ansicht: Übersicht oben, alle Eingabeoptionen im unteren Bereich (Pixel 10 Pro) */
          <div className="flex-1 overflow-y-auto py-3 flex flex-col gap-3 text-xs text-slate-700 overscroll-contain">
            {/* OBEN: Übersicht (Gesamtbetrag & Rechnungspositionen / Offene Arbeiten) */}
            <div className="space-y-3">
              {/* Gesamtbetrag */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                <div>
                  <span className="font-semibold text-slate-800 block">Gesamtbetrag brutto:</span>
                  <span className="text-[10px] text-slate-500">
                    Gem. §6 Abs. 1 Z 27 UStG 1994 ·{' '}
                    {isPaidInCash ? 'Bar bezahlt' : `Fällig bis ${formatDateDE(dueIso)}`}
                  </span>
                </div>
                <span className="text-base font-bold text-[#B4470B] shrink-0">
                  {formatEuro(totalAmount)}
                </span>
              </div>

              {/* Offene Arbeiten (Mehrfachauswahl) */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label className="font-semibold text-slate-700">
                    Offene Arbeiten ({selectedRecordIds.length}/{availableRecords.length} gewählt)
                  </label>
                  <div className="flex items-center gap-2.5">
                    {totalOpenNonLcrCount > availableRecords.length || showAllOpenRecords ? (
                      <button
                        type="button"
                        onClick={() => setShowAllOpenRecords((prev) => !prev)}
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-md transition-colors ${
                          showAllOpenRecords
                            ? 'bg-[#3138A0] text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        Alle Objekte
                      </button>
                    ) : null}
                    {availableRecords.length > 0 && (
                      <button
                        type="button"
                        onClick={handleSelectAll}
                        className="text-[11px] font-semibold text-[#3138A0] hover:underline"
                      >
                        {selectedRecordIds.length === availableRecords.length
                          ? 'Keine'
                          : 'Alle wählen'}
                      </button>
                    )}
                  </div>
                </div>

                {availableRecords.length === 0 ? (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-center text-slate-500">
                    <p className="text-xs">Keine offenen Arbeiten für diesen Kunden.</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      L.C.R.-Arbeiten sind ausgeschlossen · Pauschale unten möglich.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {availableRecords.map((rec) => {
                      const isSelected = selectedRecordIds.includes(rec.id);
                      const isSubWork = rec.customer_id !== selectedCustomerId;
                      const origCust = isSubWork
                        ? customers.find((c) => c.id === rec.customer_id)
                        : null;
                      const recProp = rec.property_id
                        ? properties.find((p) => p.id === rec.property_id)
                        : null;

                      return (
                        <div
                          key={rec.id}
                          onClick={() => toggleRecord(rec.id)}
                          className={`p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                            isSelected
                              ? 'bg-indigo-50/50 border-[#3138A0]'
                              : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 pr-2">
                            <div
                              className={`w-5 h-5 rounded-md flex items-center justify-center border shrink-0 transition-colors ${
                                isSelected
                                  ? 'bg-[#3138A0] border-[#3138A0] text-white'
                                  : 'bg-white border-slate-300'
                              }`}
                            >
                              {isSelected && <Check size={13} strokeWidth={3} />}
                            </div>
                            <div className="min-w-0">
                              <span className="font-semibold text-slate-900 block text-xs truncate">
                                {rec.title} · {formatDateDE(rec.work_date)}
                              </span>
                              {(isSubWork || recProp) && (
                                <span className="text-[10px] font-semibold text-[#3138A0] flex items-center gap-1 truncate mt-0.5">
                                  <Home size={10} className="shrink-0" />
                                  <span className="truncate">
                                    {isSubWork && origCust ? `Sub: ${origCust.name}` : ''}
                                    {isSubWork && origCust && recProp ? ' · ' : ''}
                                    {recProp ? recProp.name : ''}
                                  </span>
                                </span>
                              )}
                              <span className="text-[11px] text-slate-500 block">
                                {formatQtyTwoDecimals(rec.hours)} Std{' '}
                                {rec.hourly_rate !== null
                                  ? `· ${formatEuro(rec.hourly_rate)}`
                                  : '· Satz offen'}
                                {rec.materials.length > 0
                                  ? ` · +${rec.materials.length} Material`
                                  : ''}
                              </span>
                            </div>
                          </div>

                          <span
                            className={`font-bold text-xs shrink-0 ${
                              rec.accounting_amount !== null ? 'text-slate-900' : 'text-[#B42318]'
                            }`}
                          >
                            {rec.accounting_amount !== null
                              ? formatEuro(rec.accounting_amount)
                              : 'Satz offen'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* UNTERER BEREICH: Alle Eingabeoptionen gebündelt direkt über den Aktionsbuttons */}
            <div className="mt-auto pt-2.5 border-t border-slate-100 space-y-3">
              {/* Empfänger & Kundennummer */}
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-8">
                  <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
                    <User size={13} className="text-slate-500" />
                    <span>Empfänger</span>
                  </label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSelectedCustomerId(nextId);
                      setCustomerNumberStr(resolveCustomerNumber(nextId, customers));
                      const nextRecs = workRecords
                        .filter(
                          (w) =>
                            getEffectiveBillingCustomerId(w, customers) === nextId &&
                            !w.settlement_id &&
                            !w.is_lcr
                        )
                        .map((w) => w.id);
                      setSelectedRecordIds(nextRecs);
                    }}
                    className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 font-semibold"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.city ? `(${c.city})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-span-4">
                  <label className="font-semibold text-slate-700 block mb-1">Kunden-Nr.</label>
                  <div className="flex items-center h-11 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden focus-within:bg-white focus-within:border-[#3138A0]">
                    <button
                      type="button"
                      onClick={() => stepCustomerNumber(-1)}
                      aria-label="Kundennummer verringern"
                      className="w-7 h-full flex items-center justify-center text-slate-600 hover:bg-slate-200/70 active:bg-slate-200 shrink-0 border-r border-slate-200/80"
                    >
                      <Minus size={13} />
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={customerNumberStr}
                      onChange={(e) => setCustomerNumberStr(e.target.value)}
                      className="min-w-0 flex-1 h-full px-1 bg-transparent text-center font-semibold text-xs text-slate-900 outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={() => stepCustomerNumber(1)}
                      aria-label="Kundennummer erhöhen"
                      className="w-7 h-full flex items-center justify-center text-[#3138A0] hover:bg-indigo-50 active:bg-indigo-100 shrink-0 border-l border-slate-200/80"
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Rechnungsnummer (+/- Stepper + Direktwahl) & Rechnungsdatum */}
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-7">
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700 flex items-center gap-1">
                      <Hash size={12} className="text-[#3138A0]" />
                      <span>Rechnungs-Nr.</span>
                    </label>
                    {effectiveInvoiceNumber !== autoNextInvoice.formatted && (
                      <button
                        type="button"
                        onClick={() => {
                          setInvoiceNumberStr(autoNextInvoice.formatted);
                          setInvoiceNumManuallyChanged(false);
                        }}
                        className="text-[10px] font-semibold text-[#3138A0] flex items-center gap-0.5 hover:underline"
                      >
                        <RotateCcw size={10} />
                        <span>Auto ({autoNextInvoice.formatted})</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center h-11 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden focus-within:bg-white focus-within:border-[#3138A0]">
                    <button
                      type="button"
                      onClick={() => stepInvoiceNumber(-1)}
                      aria-label="Vorherige Rechnungsnummer"
                      className="w-9 h-full flex items-center justify-center text-slate-600 hover:bg-slate-200/70 active:bg-slate-200 transition-colors shrink-0 border-r border-slate-200/80"
                    >
                      <Minus size={15} />
                    </button>
                    <input
                      type="text"
                      value={invoiceNumberStr}
                      onChange={(e) => {
                        setInvoiceNumberStr(e.target.value);
                        setInvoiceNumManuallyChanged(true);
                      }}
                      placeholder={autoNextInvoice.formatted}
                      className="min-w-0 flex-1 h-full px-1.5 bg-transparent text-center font-bold text-xs text-slate-900 outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={() => stepInvoiceNumber(1)}
                      aria-label="Nächste Rechnungsnummer"
                      className="w-9 h-full flex items-center justify-center text-[#3138A0] hover:bg-indigo-50 active:bg-indigo-100 transition-colors shrink-0 border-l border-slate-200/80"
                    >
                      <Plus size={15} />
                    </button>
                  </div>

                  {isDuplicateInvoiceNumber && (
                    <p className="mt-1 text-[10px] font-semibold text-amber-700 flex items-center gap-1">
                      <AlertTriangle size={11} className="shrink-0" />
                      <span>Nummer bereits vergeben</span>
                    </p>
                  )}
                </div>

                <div className="col-span-5">
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700">Datum</label>
                    {issueDate !== todayIso && (
                      <button
                        type="button"
                        onClick={() => handleIssueDateChange(todayIso)}
                        className="text-[10px] font-semibold text-[#3138A0] hover:underline"
                      >
                        Heute
                      </button>
                    )}
                  </div>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => handleIssueDateChange(e.target.value)}
                    className="w-full h-11 px-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 font-semibold"
                  />
                </div>
              </div>

              {/* Zahlungsziel / Zahlungsart (1-Tipp-Auswahl) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700">Zahlungsziel / Zahlungsart</label>
                  <span className="text-[10px] font-medium text-slate-500">
                    {isPaidInCash ? 'Direkt als bezahlt verbucht' : `Fällig am ${formatDateDE(dueIso)}`}
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {(
                    [
                      { id: '0', label: 'Sofort' },
                      { id: '7', label: '7 Tage' },
                      { id: '14', label: '14 Tage' },
                      { id: '30', label: '30 Tage' },
                      { id: 'cash', label: 'Bar' }
                    ] as const
                  ).map((opt) => {
                    const active = paymentChoice === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setPaymentChoice(opt.id)}
                        className={`h-9 rounded-xl border text-[11px] font-semibold transition-all active:scale-97 ${
                          active
                            ? 'bg-[#3138A0] border-[#3138A0] text-white shadow-2xs'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Leistungszeitraum per Schnellwahl-Chips + Feld */}
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Leistungszeitraum</label>
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {[
                    {
                      key: 'auto',
                      label: 'Aus Arbeiten',
                      val: '',
                      isActive:
                        customServicePeriod.trim() === '' ||
                        customServicePeriod.trim() === autoServicePeriod
                    },
                    {
                      key: 'issue',
                      label: `Tag (${issueDateFormatted})`,
                      val: issueDateFormatted,
                      isActive: customServicePeriod.trim() === issueDateFormatted
                    },
                    {
                      key: 'curMonth',
                      label: currentMonthLabel,
                      val: currentMonthLabel,
                      isActive: customServicePeriod.trim() === currentMonthLabel
                    },
                    {
                      key: 'prevMonth',
                      label: prevMonthLabel,
                      val: prevMonthLabel,
                      isActive: customServicePeriod.trim() === prevMonthLabel
                    }
                  ].map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={() => setCustomServicePeriod(chip.val)}
                      className={`px-2.5 h-7 rounded-lg border text-[11px] font-semibold transition-colors ${
                        chip.isActive
                          ? 'bg-indigo-50 border-[#3138A0] text-[#3138A0]'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={customServicePeriod}
                  onChange={(e) => setCustomServicePeriod(e.target.value)}
                  placeholder={autoServicePeriod}
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 font-medium"
                />
              </div>

              {/* Zusatzpositionen, Pauschalen & Nachlass (1-Tipp-Auswahl) */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-50/70">
                <button
                  type="button"
                  onClick={() => setExtrasOpen((p) => !p)}
                  className="w-full px-3 py-2.5 flex items-center justify-between text-left hover:bg-slate-100/70 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Car size={15} className="text-[#3138A0] shrink-0" />
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-800 block text-xs">
                        Anfahrt, Pauschalen & Nachlass
                      </span>
                      <span className="text-[10px] text-slate-500 block truncate">
                        {activeExtraCount > 0
                          ? `${activeExtraCount} gewählt (${extraDeltaSum >= 0 ? '+' : ''}${formatEuro(extraDeltaSum)})`
                          : 'Anfahrtspauschale, Entsorgung, Kleinmaterial oder Rabatt'}
                      </span>
                    </div>
                  </div>
                  {extrasOpen ? (
                    <ChevronUp size={16} className="text-slate-400 shrink-0" />
                  ) : (
                    <ChevronDown size={16} className="text-slate-400 shrink-0" />
                  )}
                </button>

                {extrasOpen && (
                  <div className="p-3 bg-white border-t border-slate-200 space-y-3">
                    {/* Anfahrtspauschale Schnellwahl */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                        Anfahrtspauschale (1-Tipp)
                      </label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[0, 15, 25, 35].map((euro) => {
                          const active = flatTravelEuro === euro;
                          return (
                            <button
                              key={euro}
                              type="button"
                              onClick={() => setFlatTravelEuro(euro)}
                              className={`h-8.5 rounded-xl border text-[11px] font-semibold transition-colors ${
                                active
                                  ? 'bg-[#3138A0] border-[#3138A0] text-white'
                                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              {euro === 0 ? 'Keine' : `${euro} €`}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Schnell-Pauschalen: Grünschnitt & Kleinmaterial */}
                    <div className="space-y-2 pt-1 border-t border-slate-100">
                      <label className="text-[11px] font-semibold text-slate-700 block">
                        Häufige Pauschalen
                      </label>

                      {/* Grünschnitt-Entsorgung */}
                      <div className="p-2 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setDisposalEnabled((p) => !p)}
                            className="flex items-center gap-2 text-left min-w-0 flex-1"
                          >
                            <span
                              className={`w-4.5 h-4.5 rounded-md flex items-center justify-center border shrink-0 ${
                                disposalEnabled
                                  ? 'bg-[#3138A0] border-[#3138A0] text-white'
                                  : 'bg-white border-slate-300'
                              }`}
                            >
                              {disposalEnabled && <Check size={12} strokeWidth={3} />}
                            </span>
                            <span className="font-semibold text-slate-800 text-xs truncate">
                              Grünschnitt-Entsorgung
                            </span>
                          </button>
                          <div className="flex items-center gap-1">
                            {['15', '25', '45'].map((val) => (
                              <button
                                key={val}
                                type="button"
                                onClick={() => {
                                  setDisposalEuroStr(val);
                                  setDisposalEnabled(true);
                                }}
                                className={`px-2 h-7 rounded-lg text-[10px] font-bold border transition-colors ${
                                  disposalEnabled && disposalEuroStr === val
                                    ? 'bg-[#3138A0] border-[#3138A0] text-white'
                                    : 'bg-white border-slate-200 text-slate-700'
                                }`}
                              >
                                {val} €
                              </button>
                            ))}
                            <input
                              type="text"
                              inputMode="decimal"
                              value={disposalEuroStr}
                              onChange={(e) => {
                                setDisposalEuroStr(e.target.value);
                                setDisposalEnabled(true);
                              }}
                              aria-label="Betrag Grünschnitt-Entsorgung"
                              className="w-14 h-7 px-1.5 bg-white border border-slate-200 rounded-lg text-right text-[11px] font-bold text-slate-900"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Klein- & Verbrauchsmaterial */}
                      <div className="p-2 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setSmallMatEnabled((p) => !p)}
                            className="flex items-center gap-2 text-left min-w-0 flex-1"
                          >
                            <span
                              className={`w-4.5 h-4.5 rounded-md flex items-center justify-center border shrink-0 ${
                                smallMatEnabled
                                  ? 'bg-[#3138A0] border-[#3138A0] text-white'
                                  : 'bg-white border-slate-300'
                              }`}
                            >
                              {smallMatEnabled && <Check size={12} strokeWidth={3} />}
                            </span>
                            <span className="font-semibold text-slate-800 text-xs truncate">
                              Kleinmaterial-Pauschale
                            </span>
                          </button>
                          <div className="flex items-center gap-1">
                            {['10', '15', '30'].map((val) => (
                              <button
                                key={val}
                                type="button"
                                onClick={() => {
                                  setSmallMatEuroStr(val);
                                  setSmallMatEnabled(true);
                                }}
                                className={`px-2 h-7 rounded-lg text-[10px] font-bold border transition-colors ${
                                  smallMatEnabled && smallMatEuroStr === val
                                    ? 'bg-[#3138A0] border-[#3138A0] text-white'
                                    : 'bg-white border-slate-200 text-slate-700'
                                }`}
                              >
                                {val} €
                              </button>
                            ))}
                            <input
                              type="text"
                              inputMode="decimal"
                              value={smallMatEuroStr}
                              onChange={(e) => {
                                setSmallMatEuroStr(e.target.value);
                                setSmallMatEnabled(true);
                              }}
                              aria-label="Betrag Kleinmaterial"
                              className="w-14 h-7 px-1.5 bg-white border border-slate-200 rounded-lg text-right text-[11px] font-bold text-slate-900"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Nachlass / Rabatt Schnellwahl */}
                    <div className="pt-1 border-t border-slate-100">
                      <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                        Nachlass / Rabatt
                      </label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[0, 3, 5, 10].map((pct) => {
                          const active = discountPercent === pct;
                          return (
                            <button
                              key={pct}
                              type="button"
                              onClick={() => setDiscountPercent(pct)}
                              className={`h-8.5 rounded-xl border text-[11px] font-semibold transition-colors ${
                                active
                                  ? 'bg-[#3138A0] border-[#3138A0] text-white'
                                  : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              {pct === 0 ? 'Kein' : `−${pct} %`}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Detaillierte Anfahrtszeit / Kilometer */}
                    <div className="pt-1 border-t border-slate-100 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                            Anfahrtszeit (Std)
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={travelHoursStr}
                            onChange={(e) => setTravelHoursStr(e.target.value)}
                            placeholder="z.B. 0,5"
                            className="w-full h-9.5 px-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                            Satz Anfahrt (EUR/Std)
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={travelRateStr}
                            onChange={(e) => setTravelRateStr(e.target.value)}
                            placeholder="50,00"
                            className="w-full h-9.5 px-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                            Fahrtkosten (km)
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={travelKmStr}
                            onChange={(e) => setTravelKmStr(e.target.value)}
                            placeholder="z.B. 35"
                            className="w-full h-9.5 px-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                            Kilometersatz (EUR/km)
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={travelKmRateStr}
                            onChange={(e) => setTravelKmRateStr(e.target.value)}
                            placeholder="0,60"
                            className="w-full h-9.5 px-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        {!showPdfPreview && (
          <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPdfPreview(true)}
              disabled={!canIssue}
              className="px-3 h-12 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shrink-0"
            >
              <FileText size={15} className="text-[#3138A0]" />
              <span>Vorschau</span>
            </button>
            <button
              type="button"
              onClick={() => handleCreateInvoice(false)}
              disabled={!canIssue}
              className="px-3 h-12 bg-white hover:bg-slate-50 border border-slate-300 disabled:opacity-50 text-slate-800 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shrink-0"
            >
              <Receipt size={15} className="text-[#3138A0]" />
              <span>Ausstellen</span>
            </button>
            <button
              type="button"
              onClick={() => handleCreateInvoice(true)}
              disabled={!canIssue}
              className="flex-1 h-12 bg-[#3138A0] hover:bg-[#272d82] disabled:opacity-50 active:scale-98 text-white font-semibold rounded-xl text-xs transition-all shadow-xs flex items-center justify-center gap-1.5"
            >
              <Mail size={15} />
              <span>Ausstellen & Senden</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
