import React, { useEffect, useMemo, useState } from 'react';
import { InvoiceLineItem, WorkRecord, useApp } from '../../context/AppContext.tsx';
import { InvoicePaperPreview } from '../common/InvoicePaperPreview.tsx';
import { CollapsibleCard } from '../common/CollapsibleCard.tsx';
import {
  DEFAULT_INVOICE_INTRO_TEXT,
  DEFAULT_PAUSCHAL_INTRO_TEXT,
  HAFNER_LOGO_URL,
  ISSUER_CONTACT_PERSON,
  ResolvedInvoiceData,
  addDaysIso,
  buildLineItemsFromRecords,
  buildPaymentTermsClause,
  buildPersonalizedIntroText,
  computeNextInvoiceNumber,
  computeServicePeriod,
  detectRecipientSalutation,
  formatDateDE,
  formatEuro,
  formatQtyNumber,
  formatQtyTwoDecimals,
  getCustomerBillingRecipient,
  getEffectiveBillingCustomerId,
  getTodayLocalIso,
  replaceIntroSalutation,
  resolveCustomerNumber,
  sanitizeIntroTextSalutation
} from '../../utils/invoicePdf.ts';
import {
  AlertTriangle,
  Car,
  Check,
  Edit3,
  FileText,
  Hash,
  Home,
  Layers,
  Mail,
  Minus,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Trash2,
  User,
  X
} from 'lucide-react';

type PaymentTermChoice = '0' | '7' | '14' | '30' | 'cash';

type IntroTemplateKey = 'standard' | 'pauschal' | 'sammel' | 'objekt' | 'kurz';

const INTRO_TEMPLATES: Array<{
  key: IntroTemplateKey;
  label: string;
  text: string;
}> = [
  {
    key: 'standard',
    label: 'Standard',
    text: DEFAULT_INVOICE_INTRO_TEXT
  },
  {
    key: 'pauschal',
    label: 'Pauschal',
    text: DEFAULT_PAUSCHAL_INTRO_TEXT
  },
  {
    key: 'sammel',
    label: 'Sammelrechnung',
    text: 'Sehr geehrte Damen und Herren,\nvielen Dank für die gute Zusammenarbeit!\nHiermit rechne ich die im Leistungszeitraum durchgeführten Arbeiten gesammelt ab:'
  },
  {
    key: 'objekt',
    label: 'Objekt / Sub',
    text: 'Sehr geehrte Damen und Herren,\nhiermit stelle ich Ihnen die durchgeführten Objekt- und Grünraumarbeiten gemäß Aufstellung in Rechnung:'
  },
  {
    key: 'kurz',
    label: 'Kurzfassung',
    text: 'Sehr geehrte Damen und Herren,\nvielen Dank für Ihren Auftrag. Abrechnung der durchgeführten Leistungen:'
  }
];

const PAUSCHAL_TITLE_PRESETS = [
  'Garten- & Grünraumpflege pauschal',
  'Dauerpflege / Objektbetreuung pauschal',
  'Sammelabrechnung durchgeführte Arbeiten pauschal',
  'Außenanlagen- & Winterdienstbetreuung pauschal'
];

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

function parseSignedDecimalInput(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const isNeg = trimmed.startsWith('-');
  const cleaned = trimmed.replace(',', '.').replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  if (Number.isNaN(parsed)) return 0;
  return isNeg ? -parsed : parsed;
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
    currentScreen,
    workRecords,
    preselectedWorkRecordIds,
    setPreselectedWorkRecordIds,
    createInvoiceFromRecords,
    updateWorkRecord,
    deleteWorkRecord,
    setSelectedInvoiceId,
    setSendingInvoiceId,
    navigate
  } = useApp();

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [autoRedirectedFromCustomerName, setAutoRedirectedFromCustomerName] = useState<string>('');
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

  // Direktes Bearbeiten einer offenen Arbeit durch Antippen in der Rechnungsvorbereitung
  const [editingWorkId, setEditingWorkId] = useState<string | null>(null);
  const [editWorkTitle, setEditWorkTitle] = useState<string>('');
  const [editWorkDate, setEditWorkDate] = useState<string>('');
  const [editWorkHoursStr, setEditWorkHoursStr] = useState<string>('');
  const [editWorkRateStr, setEditWorkRateStr] = useState<string>('');
  const [editWorkAmountStr, setEditWorkAmountStr] = useState<string>('');
  const [editWorkAmountManual, setEditWorkAmountManual] = useState<boolean>(false);

  // Pauschalherstellung & Zusammenfassen mehrerer Rechnungen
  const [isPauschalMode, setIsPauschalMode] = useState<boolean>(false);
  const [pauschalSectionOpen, setPauschalSectionOpen] = useState<boolean>(false);
  const [selectedMergeInvoiceIds, setSelectedMergeInvoiceIds] = useState<string[]>([]);
  const [showAllInvoicesForMerge, setShowAllInvoicesForMerge] = useState<boolean>(false);
  const [pauschalDescription, setPauschalDescription] = useState<string>(
    'Garten- & Grünraumpflege pauschal'
  );
  const [pauschalAmountStr, setPauschalAmountStr] = useState<string>('');
  const [pauschalAmountManuallyEdited, setPauschalAmountManuallyEdited] = useState<boolean>(false);

  // Erweiterte Auswahl & Direkt editierbarer Rechnungstext + Positionen
  const [textOptionsOpen, setTextOptionsOpen] = useState<boolean>(false);
  const [activeIntroTemplate, setActiveIntroTemplate] = useState<IntroTemplateKey>('standard');
  const [customSubjectText, setCustomSubjectText] = useState<string>('');
  const [customIntroText, setCustomIntroText] = useState<string>(DEFAULT_INVOICE_INTRO_TEXT);
  const [customPaymentTermsText, setCustomPaymentTermsText] = useState<string>('');
  const [customClosingText, setCustomClosingText] = useState<string>('');

  const [positionsEditorOpen, setPositionsEditorOpen] = useState<boolean>(false);
  const [lineItemOverrides, setLineItemOverrides] = useState<
    Record<string, Partial<InvoiceLineItem>>
  >({});
  const [customFreeItems, setCustomFreeItems] = useState<InvoiceLineItem[]>([]);

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
    const isOpen =
      activeModal === 'RECHNUNG_VORBEREITEN' || activeModal === 'PAUSCHALRECHNUNG_VORBEREITEN';
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      const startInPauschal = activeModal === 'PAUSCHALRECHNUNG_VORBEREITEN';
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
        const origWorkCust = customers.find((c) => c.id === preselectedValid[0].customer_id);
        setAutoRedirectedFromCustomerName(
          origWorkCust && origWorkCust.id !== firstCustId ? origWorkCust.name : ''
        );
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
        let candidateCustId = redirectedRecipient
          ? redirectedRecipient.id
          : ctxCust
            ? ctxCust.id
            : '';

        const openWorkForCandidate = candidateCustId
          ? workRecords.filter(
              (w) =>
                getEffectiveBillingCustomerId(w, customers) === candidateCustId &&
                !w.settlement_id &&
                !w.is_lcr
            )
          : [];

        // Automatische Erkennung des Rechnungsempfängers: falls kein Kunde mit offenen Arbeiten vorgewählt ist, ersten Kunden mit offenen Arbeiten wählen
        if (!candidateCustId || (openWorkForCandidate.length === 0 && currentScreen !== 'M03_KUNDEN')) {
          const firstOpenRecord = workRecords.find((w) => !w.settlement_id && !w.is_lcr);
          if (firstOpenRecord) {
            candidateCustId =
              getEffectiveBillingCustomerId(firstOpenRecord, customers) ||
              firstOpenRecord.customer_id;
          } else if (!candidateCustId) {
            candidateCustId = customers[0]?.id ?? '';
          }
        }

        setAutoRedirectedFromCustomerName(
          redirectedRecipient && ctxCust && redirectedRecipient.id === candidateCustId
            ? ctxCust.name
            : ''
        );

        initialCustId = candidateCustId;
        setSelectedCustomerId(candidateCustId);
        setShowAllOpenRecords(false);

        const initialAvailable = workRecords
          .filter(
            (w) =>
              getEffectiveBillingCustomerId(w, customers) === candidateCustId &&
              !w.settlement_id &&
              !w.is_lcr
          )
          .map((w) => w.id);
        setSelectedRecordIds(initialAvailable);
      }

      const initialCustObj = customers.find((c) => c.id === initialCustId);
      const initialRecipientName = initialCustObj?.name || 'Kunde';

      // Kundennummer direkt aus dem Kundenkonto übernehmen
      setCustomerNumberStr(resolveCustomerNumber(initialCustId, customers));
      setIssueDate(todayIso);
      setInvoiceNumberStr(computeNextInvoiceNumber(invoices, todayIso).formatted);
      setInvoiceNumManuallyChanged(false);
      setPaymentChoice('14');
      setCustomServicePeriod('');
      setShowPdfPreview(false);
      setEditingWorkId(null);

      setIsPauschalMode(startInPauschal);
      setPauschalSectionOpen(startInPauschal);
      setSelectedMergeInvoiceIds([]);
      setShowAllInvoicesForMerge(false);
      setPauschalDescription('Garten- & Grünraumpflege pauschal');
      setPauschalAmountStr('');
      setPauschalAmountManuallyEdited(false);

      setTextOptionsOpen(false);
      setActiveIntroTemplate(startInPauschal ? 'pauschal' : 'standard');
      setCustomSubjectText('');
      setCustomIntroText(
        buildPersonalizedIntroText(initialRecipientName, startInPauschal, initialCustObj)
      );
      setCustomPaymentTermsText('');
      setCustomClosingText('');

      setPositionsEditorOpen(false);
      setLineItemOverrides({});
      setCustomFreeItems([]);

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
      setEditingWorkId(null);
      if (preselectedWorkRecordIds.length > 0) {
        setPreselectedWorkRecordIds([]);
      }
    }
  }, [
    activeModal,
    contextCustomerId,
    currentScreen,
    customers,
    invoices,
    workRecords,
    preselectedWorkRecordIds,
    setPreselectedWorkRecordIds
  ]);

  // Bestehende Rechnungen, die in eine Pauschalrechnung zusammengefasst werden können
  const mergeableInvoices = useMemo(
    () =>
      invoices.filter(
        (inv) =>
          !inv.is_storno &&
          inv.status !== 'cancelled' &&
          (showAllInvoicesForMerge ||
            inv.customer_id === selectedCustomerId ||
            selectedMergeInvoiceIds.includes(inv.id))
      ),
    [invoices, selectedCustomerId, showAllInvoicesForMerge, selectedMergeInvoiceIds]
  );

  const selectedMergeInvoices = useMemo(
    () => mergeableInvoices.filter((inv) => selectedMergeInvoiceIds.includes(inv.id)),
    [mergeableInvoices, selectedMergeInvoiceIds]
  );

  const invoicesForNextNumber = useMemo(
    () =>
      selectedMergeInvoiceIds.length > 0
        ? invoices.filter((inv) => !selectedMergeInvoiceIds.includes(inv.id))
        : invoices,
    [invoices, selectedMergeInvoiceIds]
  );

  const autoNextInvoice = useMemo(
    () => computeNextInvoiceNumber(invoicesForNextNumber, issueDate),
    [invoicesForNextNumber, issueDate]
  );

  const handleIssueDateChange = (nextDate: string) => {
    setIssueDate(nextDate);
    if (!invoiceNumManuallyChanged && nextDate) {
      setInvoiceNumberStr(computeNextInvoiceNumber(invoicesForNextNumber, nextDate).formatted);
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
      invoicesForNextNumber.some(
        (inv) =>
          !inv.is_storno &&
          inv.status !== 'cancelled' &&
          inv.invoice_number.trim().toLowerCase() === effectiveInvoiceNumber.toLowerCase()
      ),
    [invoicesForNextNumber, effectiveInvoiceNumber]
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

  // Arbeitsaufzeichnungen, die bereits an ausgewählte zusammenzufassende Rechnungen gebunden sind
  const recordsFromMergedInvoices = useMemo(() => {
    if (selectedMergeInvoices.length === 0) return [];
    const idSet = new Set<string>(selectedMergeInvoices.flatMap((inv) => inv.work_record_ids));
    return workRecords.filter(
      (w) =>
        idSet.has(w.id) ||
        (w.settlement_id !== null && selectedMergeInvoiceIds.includes(w.settlement_id))
    );
  }, [selectedMergeInvoices, selectedMergeInvoiceIds, workRecords]);

  // Alle betroffenen Arbeitsaufzeichnungen (offene gewählte + jene aus zusammengefassten Rechnungen)
  const allCombinedRecords = useMemo(() => {
    const map = new Map<string, WorkRecord>();
    for (const r of recordsFromMergedInvoices) map.set(r.id, r);
    for (const r of selectedRecords) map.set(r.id, r);
    return Array.from(map.values()).sort((a, b) => a.work_date.localeCompare(b.work_date));
  }, [recordsFromMergedInvoices, selectedRecords]);

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

  // Referenz-Summe aus offenen Arbeiten + gewählten zusammenzufassenden Rechnungen
  const calculatedReferenceSum = useMemo(() => {
    const openItems = buildLineItemsFromRecords(selectedRecords, [], {
      billingCustomerId: selectedCustomerId,
      customers,
      properties
    });
    const openSum = openItems.reduce((s, li) => s + li.amount, 0);
    const mergedInvSum = selectedMergeInvoices.reduce((s, inv) => s + inv.total_amount, 0);
    return Math.round((openSum + mergedInvSum) * 100) / 100;
  }, [selectedRecords, selectedMergeInvoices, selectedCustomerId, customers, properties]);

  // Wenn die Referenzsumme sich ändert und der Pauschalbetrag noch nicht manuell überschrieben wurde, automatisch synchronisieren
  useEffect(() => {
    if (!pauschalAmountManuallyEdited) {
      if (calculatedReferenceSum > 0) {
        setPauschalAmountStr(
          calculatedReferenceSum.toLocaleString('de-DE', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })
        );
      } else if (!pauschalAmountStr) {
        setPauschalAmountStr('250,00');
      }
    }
  }, [calculatedReferenceSum, pauschalAmountManuallyEdited, pauschalAmountStr]);

  const baseLineItems = useMemo(() => {
    let generated: InvoiceLineItem[] = [];

    if (isPauschalMode) {
      const lumpAmount =
        pauschalAmountStr.trim() !== ''
          ? parseSignedDecimalInput(pauschalAmountStr)
          : calculatedReferenceSum;
      const desc = pauschalDescription.trim() || 'Garten- & Grünraumpflege pauschal';
      generated = [
        {
          id: 'li-pauschal-main',
          description: desc,
          quantity_label: '1,00 Psch',
          unit_price_label: formatEuro(lumpAmount),
          amount: Math.round(lumpAmount * 100) / 100
        },
        ...positiveExtraItems
      ];
    } else {
      // Standard-Modus: Einzelpositionen aus offenen Arbeiten (+ ggf. Positionen aus zusammengefassten Rechnungen)
      const recordItems = buildLineItemsFromRecords(selectedRecords, [], {
        billingCustomerId: selectedCustomerId,
        customers,
        properties
      });
      const mergedItems: InvoiceLineItem[] = selectedMergeInvoices.flatMap((inv) =>
        inv.line_items && inv.line_items.length > 0
          ? inv.line_items.map((li, idx) => ({
              ...li,
              id: `merged-${inv.id}-${idx}`
            }))
          : [
              {
                id: `merged-${inv.id}-0`,
                description: `Leistungen lt. ${inv.invoice_number} (${formatDateDE(inv.issue_date)})`,
                quantity_label: '1,00 Psch',
                unit_price_label: formatEuro(inv.total_amount),
                amount: inv.total_amount
              }
            ]
      );
      generated = [...mergedItems, ...recordItems, ...positiveExtraItems];
    }

    return [...generated, ...customFreeItems].map((item) => {
      const ov = lineItemOverrides[item.id];
      if (!ov) return item;
      return {
        ...item,
        description: ov.description !== undefined ? ov.description : item.description,
        quantity_label: ov.quantity_label !== undefined ? ov.quantity_label : item.quantity_label,
        unit_price_label:
          ov.unit_price_label !== undefined ? ov.unit_price_label : item.unit_price_label,
        amount: ov.amount !== undefined ? ov.amount : item.amount
      };
    });
  }, [
    isPauschalMode,
    pauschalAmountStr,
    calculatedReferenceSum,
    pauschalDescription,
    positiveExtraItems,
    selectedRecords,
    selectedCustomerId,
    customers,
    properties,
    selectedMergeInvoices,
    customFreeItems,
    lineItemOverrides
  ]);

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
    () => computeServicePeriod(allCombinedRecords, issueDate),
    [allCombinedRecords, issueDate]
  );

  const { currentMonth: currentMonthLabel, prevMonth: prevMonthLabel } = useMemo(
    () => getMonthLabelsFromIso(issueDate),
    [issueDate]
  );

  const issueDateFormatted = formatDateDE(issueDate);
  const effectiveServicePeriod = customServicePeriod.trim() || autoServicePeriod;
  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
  const detectedSalutation = useMemo(
    () => detectRecipientSalutation(selectedCustomer?.name || 'Kunde', selectedCustomer),
    [selectedCustomer]
  );
  const sanitizedCustomIntroText = useMemo(
    () =>
      sanitizeIntroTextSalutation(
        customIntroText,
        selectedCustomer?.name || 'Kunde',
        selectedCustomer
      ),
    [customIntroText, selectedCustomer]
  );
  const currentIntroFirstLine = useMemo(() => {
    const first = (sanitizedCustomIntroText || '').trim().split(/\r?\n/)[0]?.trim() || '';
    return first;
  }, [sanitizedCustomIntroText]);

  const isPaidInCash = paymentChoice === 'cash';
  const dueDays = isPaidInCash ? 0 : parseInt(paymentChoice, 10);
  const dueIso = addDaysIso(issueDate, dueDays);
  const autoPaymentTermsClause = buildPaymentTermsClause(dueDays, isPaidInCash);
  const effectivePaymentTerms = customPaymentTermsText.trim() || autoPaymentTermsClause;

  const effectiveCustomerNumber =
    customerNumberStr.trim() || resolveCustomerNumber(selectedCustomerId, customers);

  const defaultSubjectPlaceholder = isPauschalMode
    ? `Pauschalrechnung Nr. ${effectiveInvoiceNumber}`
    : `Rechnungs Nr. ${effectiveInvoiceNumber}`;

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
    subjectText: customSubjectText.trim() || undefined,
    introText: sanitizedCustomIntroText.trim() || undefined,
    closingText: customClosingText.trim() || undefined,
    isPauschal: isPauschalMode,
    lineItems: draftLineItems,
    totalAmount,
    isStorno: false,
    stornoReason: null,
    paymentTermsText: effectivePaymentTerms,
    isPaidInCash
  };

  if (
    activeModal !== 'RECHNUNG_VORBEREITEN' &&
    activeModal !== 'PAUSCHALRECHNUNG_VORBEREITEN'
  ) {
    return null;
  }

  const canIssue = selectedCustomerId !== '' && draftLineItems.length > 0;
  const todayIso = getTodayLocalIso();

  const applyRecipientSelection = (rawNextCustId: string, updateRecords = true) => {
    const rawCust = customers.find((c) => c.id === rawNextCustId);
    const redirected = getCustomerBillingRecipient(rawCust, customers);
    const effectiveCust = redirected || rawCust;
    const effectiveId = effectiveCust?.id || rawNextCustId;

    setAutoRedirectedFromCustomerName(
      redirected && rawCust && redirected.id !== rawCust.id ? rawCust.name : ''
    );
    setSelectedCustomerId(effectiveId);
    setCustomerNumberStr(resolveCustomerNumber(effectiveId, customers));
    const nextSalutation = detectRecipientSalutation(
      effectiveCust?.name || 'Kunde',
      effectiveCust
    ).salutationLine;
    setCustomIntroText((prev) => replaceIntroSalutation(prev, nextSalutation));

    if (updateRecords) {
      setSelectedMergeInvoiceIds([]);
      const nextRecs = workRecords
        .filter(
          (w) =>
            getEffectiveBillingCustomerId(w, customers) === effectiveId &&
            !w.settlement_id &&
            !w.is_lcr
        )
        .map((w) => w.id);
      setSelectedRecordIds(nextRecs);
    }
  };

  const toggleRecord = (id: string) => {
    const nextIds = selectedRecordIds.includes(id)
      ? selectedRecordIds.filter((r) => r !== id)
      : [...selectedRecordIds, id];
    setSelectedRecordIds(nextIds);

    // Automatische Empfänger-Erkennung aus gewählten Arbeiten
    if (nextIds.length > 0) {
      const chosenRecs = workRecords.filter((w) => nextIds.includes(w.id));
      const billingIds = Array.from(
        new Set(chosenRecs.map((w) => getEffectiveBillingCustomerId(w, customers)))
      ).filter(Boolean);
      if (billingIds.length === 1 && billingIds[0] !== selectedCustomerId) {
        applyRecipientSelection(billingIds[0], false);
      }
    }
  };

  const toggleMergeInvoice = (invId: string) => {
    setSelectedMergeInvoiceIds((prev) =>
      prev.includes(invId) ? prev.filter((id) => id !== invId) : [...prev, invId]
    );
  };

  const handleSelectAll = () => {
    if (selectedRecordIds.length === availableRecords.length) {
      setSelectedRecordIds([]);
    } else {
      setSelectedRecordIds(availableRecords.map((r) => r.id));
    }
  };

  // Öffnet den Direkt-Editor für eine offene Arbeit direkt in der Rechnungs-Vorbereitung
  const startInlineEditWork = (rec: WorkRecord) => {
    if (editingWorkId === rec.id) {
      setEditingWorkId(null);
      return;
    }
    setEditingWorkId(rec.id);
    setEditWorkTitle(rec.title);
    setEditWorkDate(rec.work_date);
    setEditWorkHoursStr(String(rec.hours).replace('.', ','));
    setEditWorkRateStr(rec.hourly_rate !== null ? String(rec.hourly_rate).replace('.', ',') : '');
    setEditWorkAmountStr(
      rec.accounting_amount !== null ? String(rec.accounting_amount).replace('.', ',') : ''
    );
    setEditWorkAmountManual(rec.hourly_rate === null && rec.accounting_amount !== null);
  };

  const clearWorkLineItemOverride = (workId: string) => {
    const liKey = `li-${workId}`;
    setLineItemOverrides((prev) => {
      if (!(liKey in prev)) return prev;
      const next = { ...prev };
      delete next[liKey];
      return next;
    });
  };

  const handleInlineWorkTitleChange = (rec: WorkRecord, nextTitle: string) => {
    setEditWorkTitle(nextTitle);
    if (nextTitle.trim()) {
      updateWorkRecord(rec.id, { title: nextTitle.trim() });
      clearWorkLineItemOverride(rec.id);
    }
  };

  const handleInlineWorkDateChange = (rec: WorkRecord, nextDate: string) => {
    setEditWorkDate(nextDate);
    if (nextDate) {
      updateWorkRecord(rec.id, { work_date: nextDate });
      clearWorkLineItemOverride(rec.id);
    }
  };

  const handleInlineWorkHoursOrRateChange = (
    rec: WorkRecord,
    nextHoursRaw: string,
    nextRateRaw: string
  ) => {
    setEditWorkHoursStr(nextHoursRaw);
    setEditWorkRateStr(nextRateRaw);
    const h = parsePositiveDecimal(nextHoursRaw);
    const hasRate = nextRateRaw.trim() !== '';
    const r = hasRate
      ? parsePositiveDecimal(nextRateRaw)
      : rec.hourly_rate && rec.hourly_rate > 0
        ? rec.hourly_rate
        : 50;
    const matCost = rec.material_cost || 0;
    const calc = Math.round((h * r + matCost) * 100) / 100;
    setEditWorkAmountStr(String(calc).replace('.', ','));

    if (h > 0) {
      updateWorkRecord(rec.id, {
        hours: h,
        hourly_rate: r,
        accounting_amount: calc
      });
      clearWorkLineItemOverride(rec.id);
    }
  };

  const handleInlineWorkAmountChange = (rec: WorkRecord, nextAmountRaw: string) => {
    setEditWorkAmountManual(true);
    setEditWorkAmountStr(nextAmountRaw);
    const amt = parsePositiveDecimal(nextAmountRaw);
    if (nextAmountRaw.trim() === '') return;

    const r =
      editWorkRateStr.trim() !== ''
        ? parsePositiveDecimal(editWorkRateStr)
        : rec.hourly_rate && rec.hourly_rate > 0
          ? rec.hourly_rate
          : 50;
    const matCost = rec.material_cost || 0;
    const nextHours =
      r > 0 && matCost === 0
        ? Math.round((Math.max(0, amt) / r) * 100) / 100
        : parsePositiveDecimal(editWorkHoursStr) || rec.hours;

    if (r > 0 && matCost === 0) {
      setEditWorkHoursStr(String(nextHours).replace('.', ','));
    }

    updateWorkRecord(rec.id, {
      hours: nextHours,
      hourly_rate: r,
      accounting_amount: Math.round(amt * 100) / 100
    });
    clearWorkLineItemOverride(rec.id);
  };

  const saveInlineEditWork = (rec: WorkRecord) => {
    const nextHours = parsePositiveDecimal(editWorkHoursStr) || rec.hours;
    const hasRate = editWorkRateStr.trim() !== '';
    const nextRate = hasRate
      ? parsePositiveDecimal(editWorkRateStr)
      : rec.hourly_rate && rec.hourly_rate > 0
        ? rec.hourly_rate
        : 50;
    const matCost = rec.material_cost || 0;

    let nextAccountingAmount: number | null = null;
    if (editWorkAmountManual && editWorkAmountStr.trim() !== '') {
      nextAccountingAmount =
        Math.round(parsePositiveDecimal(editWorkAmountStr) * 100) / 100;
    } else if (nextRate !== null) {
      nextAccountingAmount = Math.round((nextHours * nextRate + matCost) * 100) / 100;
    } else if (editWorkAmountStr.trim() !== '') {
      nextAccountingAmount =
        Math.round(parsePositiveDecimal(editWorkAmountStr) * 100) / 100;
    }

    const reconciledHours =
      editWorkAmountManual &&
      nextAccountingAmount !== null &&
      nextRate !== null &&
      nextRate > 0 &&
      matCost === 0
        ? Math.round((nextAccountingAmount / nextRate) * 100) / 100
        : nextHours;

    updateWorkRecord(rec.id, {
      title: editWorkTitle.trim() || rec.title,
      work_date: editWorkDate || rec.work_date,
      hours: reconciledHours,
      hourly_rate: nextRate,
      accounting_amount: nextAccountingAmount
    });
    clearWorkLineItemOverride(rec.id);

    if (!selectedRecordIds.includes(rec.id)) {
      setSelectedRecordIds((prev) => [...prev, rec.id]);
    }
    setEditingWorkId(null);
  };

  const handleGeneratePauschalSummaryDescription = () => {
    const parts: string[] = [];
    if (allCombinedRecords.length > 0) {
      const uniqueTitles = Array.from(new Set(allCombinedRecords.map((r) => r.title)));
      const dates = allCombinedRecords.map((r) => formatDateDE(r.work_date));
      const dateSummary =
        dates.length <= 3
          ? dates.join(', ')
          : `${dates[0]} – ${dates[dates.length - 1]} (${dates.length} Einsätze)`;
      parts.push(`${uniqueTitles.join(', ')} (${dateSummary})`);
    }
    if (selectedMergeInvoices.length > 0) {
      const invNums = selectedMergeInvoices.map((i) => i.invoice_number).join(', ');
      parts.push(`Zusammenfassung aus ${invNums}`);
    }
    setPauschalDescription(
      parts.length > 0 ? `Pauschalabrechnung: ${parts.join(' · ')}` : 'Garten- & Grünraumpflege pauschal'
    );
  };

  const handleAddFreeLineItem = () => {
    const newItem: InvoiceLineItem = {
      id: `free-${Date.now()}`,
      description: 'Zusatzleistung / Position',
      quantity_label: '1,00 Psch',
      unit_price_label: '50,00 EUR',
      amount: 50
    };
    setCustomFreeItems((prev) => [...prev, newItem]);
    setPositionsEditorOpen(true);
  };

  const handleUpdateLineItemOverride = (
    id: string,
    patch: Partial<InvoiceLineItem>
  ) => {
    if (id.startsWith('free-')) {
      setCustomFreeItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
      );
      return;
    }

    let computedPatch: Partial<InvoiceLineItem> = { ...patch };

    // Wenn eine Position einer Arbeitsaufzeichnung (li-<workId>) bearbeitet wird,
    // sofort die zugrunde liegende Arbeitsaufzeichnung (und damit Offene Stunden) aktualisieren!
    if (id.startsWith('li-')) {
      const recId = id.slice(3);
      const rec = workRecords.find((w) => w.id === recId);
      if (rec) {
        const rate = rec.hourly_rate && rec.hourly_rate > 0 ? rec.hourly_rate : 50;
        const matCost = rec.material_cost || 0;

        if (patch.quantity_label !== undefined) {
          const parsedHours = parsePositiveDecimal(patch.quantity_label);
          if (parsedHours > 0) {
            const nextAmount = Math.round((parsedHours * rate + matCost) * 100) / 100;
            computedPatch.amount = nextAmount;
            updateWorkRecord(recId, {
              hours: parsedHours,
              hourly_rate: rate,
              accounting_amount: nextAmount
            });
          }
        } else if (patch.unit_price_label !== undefined) {
          const parsedRate = parsePositiveDecimal(patch.unit_price_label);
          if (parsedRate > 0) {
            const h = rec.hours || 1;
            const nextAmount = Math.round((h * parsedRate + matCost) * 100) / 100;
            computedPatch.amount = nextAmount;
            updateWorkRecord(recId, {
              hourly_rate: parsedRate,
              accounting_amount: nextAmount
            });
          }
        } else if (patch.amount !== undefined) {
          const nextAmount = Math.round(patch.amount * 100) / 100;
          const nextHours =
            rate > 0 && matCost === 0
              ? Math.round((nextAmount / rate) * 100) / 100
              : rec.hours;
          if (nextHours !== null) {
            computedPatch.quantity_label = `${nextHours.toFixed(2).replace('.', ',')} Std`;
          }
          updateWorkRecord(recId, {
            hours: nextHours,
            hourly_rate: rate,
            accounting_amount: nextAmount
          });
        }

        if (patch.description !== undefined) {
          const cleanedTitle = patch.description.split(' (')[0].split(' – ')[0].trim();
          if (cleanedTitle) {
            updateWorkRecord(recId, { title: cleanedTitle });
          }
        }
      }
    }

    setLineItemOverrides((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        ...computedPatch
      }
    }));
  };

  const handleRemoveFreeLineItem = (id: string) => {
    setCustomFreeItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleSwitchPauschalMode = (enablePauschal: boolean) => {
    setIsPauschalMode(enablePauschal);
    const currentSalutation =
      currentIntroFirstLine || detectedSalutation.salutationLine;
    if (enablePauschal) {
      setPauschalSectionOpen(true);
      if (activeIntroTemplate === 'standard') {
        setActiveIntroTemplate('pauschal');
        setCustomIntroText(replaceIntroSalutation(DEFAULT_PAUSCHAL_INTRO_TEXT, currentSalutation));
      }
    } else {
      if (activeIntroTemplate === 'pauschal') {
        setActiveIntroTemplate('standard');
        setCustomIntroText(replaceIntroSalutation(DEFAULT_INVOICE_INTRO_TEXT, currentSalutation));
      }
    }
  };

  const handleCreateInvoice = (openSendSheetAfter: boolean) => {
    if (!canIssue) return;
    const inv = createInvoiceFromRecords(selectedCustomerId, selectedRecordIds, {
      extraItems: allExtraItems,
      customLineItems: draftLineItems,
      issueDate,
      servicePeriod: effectiveServicePeriod,
      invoiceNumber: effectiveInvoiceNumber,
      dueDays,
      customerNumber: effectiveCustomerNumber,
      paymentTermsText: effectivePaymentTerms,
      subjectText: customSubjectText.trim() || undefined,
      introText: sanitizedCustomIntroText.trim() || undefined,
      closingText: customClosingText.trim() || undefined,
      isPauschal: isPauschalMode,
      replaceInvoiceIds: selectedMergeInvoiceIds,
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
  const extraDeltaSum =
    Math.round(allExtraItems.reduce((s, item) => s + item.amount, 0) * 100) / 100;

  return (
    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
      <div className="flex-1" onClick={() => setActiveModal(null)} />

      <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[94%] flex flex-col animate-slide-up">
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
                  {isPauschalMode ? 'Pauschalrechnung' : 'Rechnung vorbereiten'}
                </h2>
                <span className="px-1.5 py-0.5 rounded-md bg-indigo-50 text-[#3138A0] font-bold text-[10px] shrink-0">
                  {effectiveInvoiceNumber}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                Kd.-Nr. {effectiveCustomerNumber} · {paymentSubtitle}
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
          /* Entwurfs-Ansicht: Übersicht oben, alle Optionen übersichtlich darunter (Pixel 10 Pro) */
          <div className="flex-1 overflow-y-auto py-3 flex flex-col gap-3 text-xs text-slate-700 overscroll-contain">
            {/* OBEN: Gesamtbetrag & Modus-Umschalter (Einzelabrechnung vs. Pauschalherstellung) */}
            <div className="space-y-2.5">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between gap-2">
                <div>
                  <span className="font-bold text-slate-900 block">
                    {isPauschalMode ? 'Pauschalbetrag brutto:' : 'Gesamtbetrag brutto:'}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Gem. §6 Abs. 1 Z 27 UStG 1994 ·{' '}
                    {isPaidInCash ? 'Bar bezahlt' : `Fällig bis ${formatDateDE(dueIso)}`}
                  </span>
                </div>
                <span className="text-base font-bold text-[#B4470B] shrink-0 tabular-nums">
                  {formatEuro(totalAmount)}
                </span>
              </div>

              {/* 1-Tipp Umschalter: Einzelpositionen vs. Pauschalherstellung */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-2xl">
                <button
                  type="button"
                  onClick={() => handleSwitchPauschalMode(false)}
                  className={`h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    !isPauschalMode
                      ? 'bg-white text-[#3138A0] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Receipt size={14} />
                  <span>Einzelpositionen</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchPauschalMode(true)}
                  className={`h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    isPauschalMode
                      ? 'bg-[#3138A0] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Layers size={14} />
                  <span>Pauschalherstellung</span>
                </button>
              </div>

              {/* PAUSCHALHERSTELLUNG & MEHRERE RECHNUNGEN ZUSAMMENFASSEN */}
              {(isPauschalMode || selectedMergeInvoiceIds.length > 0) && (
                <CollapsibleCard
                  title="Pauschalrechnung & Rechnungen bündeln"
                  subtitle={
                    selectedMergeInvoiceIds.length > 0
                      ? `${selectedMergeInvoiceIds.length} Rechnungen + ${selectedRecordIds.length} Arbeiten → ${allCombinedRecords.length} als abgerechnet`
                      : 'Pauschalbetrag festlegen oder mehrere Rechnungen zusammenfassen'
                  }
                  icon={<Layers size={16} />}
                  iconBgClassName="bg-indigo-50 text-[#3138A0] border-indigo-100"
                  open={pauschalSectionOpen}
                  onToggle={() => setPauschalSectionOpen((p) => !p)}
                >
                  <div className="space-y-3 text-xs">
                    {/* Pauschalbetrag & Bezeichnung */}
                    {isPauschalMode && (
                      <div className="space-y-2.5">
                        <div className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-7">
                            <label className="text-[11px] font-bold text-slate-700 block mb-1">
                              Pauschalbetrag (€)
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={pauschalAmountStr}
                              onChange={(e) => {
                                setPauschalAmountStr(e.target.value);
                                setPauschalAmountManuallyEdited(true);
                              }}
                              placeholder="250,00"
                              className="w-full h-10 px-3 bg-white border border-indigo-200 rounded-xl focus:border-[#3138A0] outline-hidden text-sm font-bold text-[#B4470B]"
                            />
                          </div>
                          <div className="col-span-5">
                            <button
                              type="button"
                              onClick={() => {
                                setPauschalAmountManuallyEdited(false);
                                setPauschalAmountStr(
                                  calculatedReferenceSum.toLocaleString('de-DE', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                  })
                                );
                              }}
                              className="w-full h-10 px-2 bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] font-bold text-[11px] rounded-xl border border-indigo-200 transition-colors"
                            >
                              Summe ({calculatedReferenceSum.toFixed(0)} €)
                            </button>
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[11px] font-bold text-slate-700">
                              Pauschal-Bezeichnung auf Rechnung
                            </label>
                            <button
                              type="button"
                              onClick={handleGeneratePauschalSummaryDescription}
                              className="text-[10px] font-bold text-[#3138A0] hover:underline"
                            >
                              Aus Auswahl erzeugen
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1 mb-1.5">
                            {PAUSCHAL_TITLE_PRESETS.map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => setPauschalDescription(preset)}
                                className={`px-2 py-1 rounded-lg border text-[10px] font-semibold transition-colors ${
                                  pauschalDescription === preset
                                    ? 'bg-[#3138A0] border-[#3138A0] text-white'
                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                                }`}
                              >
                                {preset}
                              </button>
                            ))}
                          </div>
                          <textarea
                            rows={2}
                            value={pauschalDescription}
                            onChange={(e) => setPauschalDescription(e.target.value)}
                            className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-medium text-slate-900 resize-none"
                          />
                        </div>
                      </div>
                    )}

                    {/* Mehrere bestehende Rechnungen auswählen & zu einer Pauschalrechnung bündeln */}
                    <div className="pt-2 border-t border-slate-200/80 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-slate-800 block text-[11px]">
                            Aus bestehenden Rechnungen zusammenfassen ({selectedMergeInvoiceIds.length})
                          </span>
                          <span className="text-[10px] text-slate-500 block">
                            Arbeiten daraus werden als abgerechnet markiert & einsortiert
                          </span>
                        </div>
                        {invoices.filter((i) => !i.is_storno && i.status !== 'cancelled').length >
                          mergeableInvoices.length || showAllInvoicesForMerge ? (
                          <button
                            type="button"
                            onClick={() => setShowAllInvoicesForMerge((p) => !p)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold shrink-0 ${
                              showAllInvoicesForMerge
                                ? 'bg-[#3138A0] text-white'
                                : 'bg-white border border-slate-200 text-slate-700'
                            }`}
                          >
                            Alle Kunden
                          </button>
                        ) : null}
                      </div>

                      {mergeableInvoices.length === 0 ? (
                        <p className="text-[11px] text-slate-400 italic">
                          Keine bestehenden Rechnungen für diesen Kunden vorhanden.
                        </p>
                      ) : (
                        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                          {mergeableInvoices.map((inv) => {
                            const isChecked = selectedMergeInvoiceIds.includes(inv.id);
                            const linkedCount = workRecords.filter(
                              (w) =>
                                inv.work_record_ids.includes(w.id) || w.settlement_id === inv.id
                            ).length;
                            return (
                              <div
                                key={inv.id}
                                onClick={() => toggleMergeInvoice(inv.id)}
                                className={`p-2 rounded-xl border cursor-pointer flex items-center justify-between gap-2 transition-colors ${
                                  isChecked
                                    ? 'bg-indigo-50/70 border-[#3138A0]'
                                    : 'bg-white border-slate-200 hover:border-slate-300'
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <div
                                    className={`w-4.5 h-4.5 rounded-md flex items-center justify-center border shrink-0 ${
                                      isChecked
                                        ? 'bg-[#3138A0] border-[#3138A0] text-white'
                                        : 'bg-white border-slate-300'
                                    }`}
                                  >
                                    {isChecked && <Check size={11} strokeWidth={3} />}
                                  </div>
                                  <div className="min-w-0">
                                    <span className="font-bold text-slate-900 block text-xs truncate">
                                      {inv.invoice_number} · {inv.billing_customer_name}
                                    </span>
                                    <span className="text-[10px] text-slate-500 block">
                                      {formatDateDE(inv.issue_date)} · {linkedCount}{' '}
                                      {linkedCount === 1 ? 'Arbeit' : 'Arbeiten'}
                                    </span>
                                  </div>
                                </div>
                                <span className="font-bold text-xs text-slate-900 shrink-0 tabular-nums">
                                  {formatEuro(inv.total_amount)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </CollapsibleCard>
              )}

              {/* Offene Arbeiten (Mehrfachauswahl + durch Tippen direkt bearbeitbar) */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div>
                    <label className="font-semibold text-slate-700 block">
                      Offene Arbeiten ({selectedRecordIds.length}/{availableRecords.length} gewählt)
                    </label>
                    <span className="text-[10px] text-slate-400">
                      Antippen zum direkten Bearbeiten · Checkbox für Auswahl
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
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
                      Sie können oben eine Pauschalrechnung oder unten eine freie Position erstellen.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {availableRecords.map((rec) => {
                      const isSelected = selectedRecordIds.includes(rec.id);
                      const isEditingThis = editingWorkId === rec.id;
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
                          className={`rounded-2xl border transition-all overflow-hidden ${
                            isEditingThis
                              ? 'bg-white border-[#3138A0] shadow-sm'
                              : isSelected
                                ? 'bg-indigo-50/50 border-[#3138A0]'
                                : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="p-3 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              {/* Checkbox links: schaltet Auswahl um */}
                              <button
                                type="button"
                                onClick={() => toggleRecord(rec.id)}
                                aria-label="Arbeit für Rechnung auswählen"
                                className={`w-6 h-6 rounded-lg flex items-center justify-center border shrink-0 transition-colors ${
                                  isSelected
                                    ? 'bg-[#3138A0] border-[#3138A0] text-white'
                                    : 'bg-white border-slate-300'
                                }`}
                              >
                                {isSelected && <Check size={14} strokeWidth={3} />}
                              </button>

                              {/* Textbereich: Antippen öffnet sofortige Direkt-Bearbeitung */}
                              <div
                                onClick={() => startInlineEditWork(rec)}
                                className="min-w-0 flex-1 cursor-pointer"
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-slate-900 block text-xs truncate">
                                    {rec.title} · {formatDateDE(rec.work_date)}
                                  </span>
                                  <Pencil size={11} className="text-[#3138A0] shrink-0" />
                                </div>
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
                                    : '· Pauschal / Satz tippen'}
                                  {rec.materials.length > 0
                                    ? ` · +${rec.materials.length} Material`
                                    : ''}
                                </span>
                              </div>
                            </div>

                            {/* Betrag rechts: Antippen öffnet ebenfalls Direkt-Bearbeitung */}
                            <button
                              type="button"
                              onClick={() => startInlineEditWork(rec)}
                              className={`px-2 py-1 rounded-lg font-bold text-xs shrink-0 border transition-colors ${
                                rec.accounting_amount !== null
                                  ? 'bg-white border-slate-200 text-slate-900 hover:border-[#3138A0]'
                                  : 'bg-red-50 border-red-200 text-[#B42318]'
                              }`}
                            >
                              {rec.accounting_amount !== null
                                ? formatEuro(rec.accounting_amount)
                                : 'Satz eingeben'}
                            </button>
                          </div>

                          {/* DIREKT-BEARBEITUNG BEIM ANTIPPEN (LIVE-SYNC MIT OFFENEN STUNDEN) */}
                          {isEditingThis && (
                            <div className="px-3 pb-3 pt-2.5 border-t border-indigo-100 bg-indigo-50/30 space-y-2.5">
                              <div className="grid grid-cols-12 gap-2">
                                <div className="col-span-7">
                                  <label className="text-[10px] font-bold text-slate-600 block mb-0.5">
                                    Tätigkeit / Positionstext
                                  </label>
                                  <input
                                    type="text"
                                    value={editWorkTitle}
                                    onChange={(e) => handleInlineWorkTitleChange(rec, e.target.value)}
                                    className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-hidden focus:border-[#3138A0]"
                                  />
                                </div>
                                <div className="col-span-5">
                                  <label className="text-[10px] font-bold text-slate-600 block mb-0.5">
                                    Datum
                                  </label>
                                  <input
                                    type="date"
                                    value={editWorkDate}
                                    onChange={(e) => handleInlineWorkDateChange(rec, e.target.value)}
                                    className="w-full h-9 px-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-hidden focus:border-[#3138A0]"
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <label className="text-[10px] font-bold text-slate-600 block mb-0.5">
                                    Stunden
                                  </label>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={editWorkHoursStr}
                                    onChange={(e) => {
                                      setEditWorkAmountManual(false);
                                      handleInlineWorkHoursOrRateChange(
                                        rec,
                                        e.target.value,
                                        editWorkRateStr
                                      );
                                    }}
                                    className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 outline-hidden focus:border-[#3138A0]"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-slate-600 block mb-0.5">
                                    Satz (€/Std.)
                                  </label>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={editWorkRateStr}
                                    onChange={(e) => {
                                      setEditWorkAmountManual(false);
                                      handleInlineWorkHoursOrRateChange(
                                        rec,
                                        editWorkHoursStr,
                                        e.target.value
                                      );
                                    }}
                                    placeholder="z.B. 50"
                                    className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900 outline-hidden focus:border-[#3138A0]"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-slate-600 block mb-0.5">
                                    Betrag (€)
                                  </label>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={editWorkAmountStr}
                                    onChange={(e) => handleInlineWorkAmountChange(rec, e.target.value)}
                                    placeholder="Gesamt €"
                                    className="w-full h-9 px-2.5 bg-white border border-indigo-200 rounded-xl text-xs font-bold text-[#B4470B] outline-hidden focus:border-[#3138A0]"
                                  />
                                </div>
                              </div>

                              {/* 1-Tipp Stundensatz-Schnellwahl */}
                              <div className="flex items-center justify-between gap-1.5 flex-wrap">
                                <div className="flex items-center gap-1 flex-wrap">
                                  {[45, 50, 55, 60, 70].map((rate) => (
                                    <button
                                      key={rate}
                                      type="button"
                                      onClick={() => {
                                        setEditWorkAmountManual(false);
                                        handleInlineWorkHoursOrRateChange(
                                          rec,
                                          editWorkHoursStr,
                                          String(rate)
                                        );
                                      }}
                                      className={`px-2 h-7 rounded-lg text-[10px] font-bold border transition-colors ${
                                        !editWorkAmountManual && editWorkRateStr === String(rate)
                                          ? 'bg-[#3138A0] border-[#3138A0] text-white'
                                          : 'bg-white border-slate-200 text-slate-700'
                                      }`}
                                    >
                                      {rate} €/h
                                    </button>
                                  ))}
                                </div>

                                <div className="flex items-center gap-1.5 ml-auto">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingWorkId(null);
                                      setSelectedRecordIds((prev) =>
                                        prev.filter((id) => id !== rec.id)
                                      );
                                      deleteWorkRecord(rec.id);
                                    }}
                                    className="px-2.5 h-8 bg-red-50 border border-red-200 rounded-xl text-[11px] font-semibold text-red-600"
                                    title="Arbeitsaufzeichnung löschen"
                                  >
                                    Löschen
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => saveInlineEditWork(rec)}
                                    className="px-3 h-8 bg-[#3138A0] hover:bg-[#272d82] text-white rounded-xl text-[11px] font-bold shadow-2xs"
                                  >
                                    Fertig
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* UNTERER BEREICH: Alle Rechnungsoptionen übersichtlich & direkt editierbar */}
            <div className="mt-auto pt-2.5 border-t border-slate-100 space-y-3">
              {/* Empfänger (automatisch erkannt) & aus Kundenkonto übernommene Kundennummer + direkte Ansprache */}
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-8">
                    <label className="font-semibold text-slate-700 mb-1 flex items-center justify-between gap-1">
                      <span className="flex items-center gap-1">
                        <User size={13} className="text-[#3138A0]" />
                        <span>Rechnungsempfänger</span>
                      </span>
                      <span className="text-[10px] font-bold text-[#2C7738] bg-emerald-50 px-1.5 py-0.5 rounded">
                        Auto erkannt
                      </span>
                    </label>
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => applyRecipientSelection(e.target.value, true)}
                      className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 font-semibold"
                    >
                      {customers.map((c) => {
                        const cNum =
                          c.customer_number?.trim() || resolveCustomerNumber(c.id, customers);
                        const subVia = getCustomerBillingRecipient(c, customers);
                        return (
                          <option key={c.id} value={c.id}>
                            {c.name} (#{cNum})
                            {subVia ? ` → über ${subVia.name}` : c.city ? ` · ${c.city}` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="col-span-4">
                    <label className="font-semibold text-slate-700 block mb-1 truncate">
                      Kunden-Nr.
                    </label>
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
                        className="min-w-0 flex-1 h-full px-1 bg-transparent text-center font-bold text-xs text-slate-900 outline-hidden"
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

                {autoRedirectedFromCustomerName && (
                  <div className="px-2.5 py-1.5 bg-indigo-50 border border-indigo-100 rounded-xl text-[11px] text-[#3138A0] font-semibold">
                    Sub-Abrechnung erkannt: Objekt „{autoRedirectedFromCustomerName}“ wird direkt über{' '}
                    <span className="font-bold">{selectedCustomer?.name}</span> abgerechnet.
                  </div>
                )}

                {/* Direkte Ansprache in der Rechnung (automatisch aus Empfängername erkannt + 1-Tipp Wahl) */}
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-slate-600">
                      Direkte Ansprache auf Rechnung:
                    </span>
                    <span className="text-[11px] font-bold text-[#3138A0] truncate">
                      {currentIntroFirstLine || detectedSalutation.salutationLine}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(detectedSalutation.lastName
                      ? [
                          {
                            key: 'frau',
                            label: `Frau ${detectedSalutation.title ? `${detectedSalutation.title} ` : ''}${detectedSalutation.lastName}`,
                            line: detectedSalutation.frauLine
                          },
                          {
                            key: 'herr',
                            label: `Herr ${detectedSalutation.title ? `${detectedSalutation.title} ` : ''}${detectedSalutation.lastName}`,
                            line: detectedSalutation.herrLine
                          },
                          ...(detectedSalutation.type !== 'company'
                            ? [
                                {
                                  key: 'fam',
                                  label: `Familie ${detectedSalutation.lastName}`,
                                  line: detectedSalutation.familyLine
                                }
                              ]
                            : []),
                          {
                            key: 'du',
                            label: 'Per Du',
                            line: detectedSalutation.duLine
                          },
                          {
                            key: 'firma',
                            label: 'Damen & Herren',
                            line: detectedSalutation.companyLine
                          }
                        ]
                      : [
                          {
                            key: 'firma',
                            label: 'Damen & Herren',
                            line: detectedSalutation.companyLine
                          },
                          {
                            key: 'du',
                            label: 'Guten Tag',
                            line: detectedSalutation.duLine
                          }
                        ]
                    ).map((opt) => {
                      const isActive = currentIntroFirstLine === opt.line;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() =>
                            setCustomIntroText((prev) => replaceIntroSalutation(prev, opt.line))
                          }
                          className={`px-2 py-1 rounded-lg border text-[10px] font-semibold transition-colors ${
                            isActive
                              ? 'bg-[#3138A0] border-[#3138A0] text-white'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
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

              {/* AUSKLAPPBAR 1: RECHNUNGSTEXT & VORLAGEN DIREKT EDITIERBAR */}
              <CollapsibleCard
                title="Rechnungstext & Vorlagen"
                subtitle="Betreff, Anschreiben & Zahlungstext direkt bearbeiten"
                icon={<Edit3 size={15} />}
                iconBgClassName="bg-indigo-50 text-[#3138A0] border-indigo-100"
                open={textOptionsOpen}
                onToggle={() => setTextOptionsOpen((p) => !p)}
              >
                <div className="space-y-3 text-xs">
                  {/* 1-Tipp Textvorlagen */}
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      Vorlage wählen (1-Tipp)
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {INTRO_TEMPLATES.map((tpl) => {
                        const active = activeIntroTemplate === tpl.key;
                        return (
                          <button
                            key={tpl.key}
                            type="button"
                            onClick={() => {
                              setActiveIntroTemplate(tpl.key);
                              const currentSalutation =
                                currentIntroFirstLine || detectedSalutation.salutationLine;
                              setCustomIntroText(
                                replaceIntroSalutation(tpl.text, currentSalutation)
                              );
                            }}
                            className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${
                              active
                                ? 'bg-[#3138A0] border-[#3138A0] text-white'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {tpl.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Betreffzeile direkt editierbar */}
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      Betreff / Überschrift
                    </label>
                    <input
                      type="text"
                      value={customSubjectText}
                      onChange={(e) => setCustomSubjectText(e.target.value)}
                      placeholder={defaultSubjectPlaceholder}
                      className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-bold text-slate-900"
                    />
                  </div>

                  {/* Einleitungstext / Anschreiben direkt editierbar */}
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      Anschreiben / Einleitungstext
                    </label>
                    <textarea
                      rows={3}
                      value={customIntroText}
                      onChange={(e) => setCustomIntroText(e.target.value)}
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900 leading-relaxed resize-none"
                    />
                  </div>

                  {/* Zahlungsbedingungen & Schlusstext direkt editierbar */}
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      Zahlungsbedingungen
                    </label>
                    <input
                      type="text"
                      value={customPaymentTermsText}
                      onChange={(e) => setCustomPaymentTermsText(e.target.value)}
                      placeholder={autoPaymentTermsClause}
                      className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                    />
                  </div>

                  {!isPaidInCash && (
                    <div>
                      <label className="text-[11px] font-bold text-slate-700 block mb-1">
                        Zusätzlicher Überweisungs- / Schlusstext (optional)
                      </label>
                      <textarea
                        rows={2}
                        value={customClosingText}
                        onChange={(e) => setCustomClosingText(e.target.value)}
                        placeholder={`Bitte überweisen Sie den Rechnungsbetrag unter Angabe der Rechnungsnummer auf das unten angegebene Konto. Der Rechnungsbetrag ist bis zum ${formatDateDE(dueIso)} fällig.`}
                        className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900 resize-none"
                      />
                    </div>
                  )}
                </div>
              </CollapsibleCard>

              {/* AUSKLAPPBAR 2: RECHNUNGSPOSITIONEN & FREIE POSITIONEN DIREKT BEARBEITEN */}
              <CollapsibleCard
                title="Positionstexte & Freie Positionen"
                subtitle={`${draftLineItems.length} ${
                  draftLineItems.length === 1 ? 'Position' : 'Positionen'
                } auf der Rechnung direkt anpassen`}
                icon={<FileText size={15} />}
                iconBgClassName="bg-slate-100 text-slate-700 border-slate-200"
                open={positionsEditorOpen}
                onToggle={() => setPositionsEditorOpen((p) => !p)}
              >
                <div className="space-y-2.5 text-xs">
                  {baseLineItems.map((item, idx) => {
                    const isFree = item.id.startsWith('free-');
                    return (
                      <div
                        key={item.id}
                        className="p-2.5 bg-white border border-slate-200 rounded-xl space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase">
                            Position {idx + 1}
                          </span>
                          {isFree && (
                            <button
                              type="button"
                              onClick={() => handleRemoveFreeLineItem(item.id)}
                              className="text-[10px] font-bold text-[#B42318] flex items-center gap-0.5"
                            >
                              <Trash2 size={11} />
                              <span>Entfernen</span>
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) =>
                            handleUpdateLineItemOverride(item.id, {
                              description: e.target.value
                            })
                          }
                          placeholder="Beschreibung auf Rechnung..."
                          className="w-full h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-900 outline-hidden focus:bg-white focus:border-[#3138A0]"
                        />
                        <div className="grid grid-cols-3 gap-1.5">
                          <div>
                            <label className="text-[10px] text-slate-500 block">Menge</label>
                            <input
                              type="text"
                              value={item.quantity_label}
                              onChange={(e) =>
                                handleUpdateLineItemOverride(item.id, {
                                  quantity_label: e.target.value
                                })
                              }
                              className="w-full h-8 px-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-900"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-500 block">Einzelpreis</label>
                            <input
                              type="text"
                              value={item.unit_price_label}
                              onChange={(e) =>
                                handleUpdateLineItemOverride(item.id, {
                                  unit_price_label: e.target.value
                                })
                              }
                              className="w-full h-8 px-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-900"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-500 block">Gesamt (€)</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={String(item.amount).replace('.', ',')}
                              onChange={(e) => {
                                const parsed = parseSignedDecimalInput(e.target.value);
                                handleUpdateLineItemOverride(item.id, {
                                  amount: parsed
                                });
                              }}
                              className="w-full h-8 px-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-bold text-[#B4470B]"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={handleAddFreeLineItem}
                    className="w-full h-9 rounded-xl border border-dashed border-[#3138A0] bg-indigo-50/50 hover:bg-indigo-50 text-[#3138A0] font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Plus size={14} />
                    <span>Freie Rechnungsposition hinzufügen</span>
                  </button>
                </div>
              </CollapsibleCard>

              {/* AUSKLAPPBAR 3: ANFAHRT, PAUSCHALEN & NACHLASS */}
              <CollapsibleCard
                title="Anfahrt, Pauschalen & Nachlass"
                subtitle={
                  activeExtraCount > 0
                    ? `${activeExtraCount} gewählt (${extraDeltaSum >= 0 ? '+' : ''}${formatEuro(extraDeltaSum)})`
                    : 'Anfahrtspauschale, Entsorgung, Kleinmaterial oder Rabatt'
                }
                icon={<Car size={15} />}
                iconBgClassName="bg-indigo-50 text-[#3138A0] border-indigo-100"
                open={extrasOpen}
                onToggle={() => setExtrasOpen((p) => !p)}
              >
                <div className="space-y-3 text-xs">
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
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {euro === 0 ? 'Keine' : `${euro} €`}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Schnell-Pauschalen: Grünschnitt & Kleinmaterial */}
                  <div className="space-y-2 pt-1 border-t border-slate-200/80">
                    <label className="text-[11px] font-semibold text-slate-700 block">
                      Häufige Pauschalen
                    </label>

                    {/* Grünschnitt-Entsorgung */}
                    <div className="p-2 rounded-xl border border-slate-200 bg-white space-y-1.5">
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
                                  : 'bg-slate-50 border-slate-200 text-slate-700'
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
                            className="w-14 h-7 px-1.5 bg-slate-50 border border-slate-200 rounded-lg text-right text-[11px] font-bold text-slate-900"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Klein- & Verbrauchsmaterial */}
                    <div className="p-2 rounded-xl border border-slate-200 bg-white space-y-1.5">
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
                                  : 'bg-slate-50 border-slate-200 text-slate-700'
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
                            className="w-14 h-7 px-1.5 bg-slate-50 border border-slate-200 rounded-lg text-right text-[11px] font-bold text-slate-900"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Nachlass / Rabatt Schnellwahl */}
                  <div className="pt-1 border-t border-slate-200/80">
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
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {pct === 0 ? 'Kein' : `−${pct} %`}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Detaillierte Anfahrtszeit / Kilometer */}
                  <div className="pt-1 border-t border-slate-200/80 space-y-2">
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
                          className="w-full h-9.5 px-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
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
                          className="w-full h-9.5 px-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
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
                          className="w-full h-9.5 px-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
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
                          className="w-full h-9.5 px-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </CollapsibleCard>
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
