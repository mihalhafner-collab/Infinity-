import { jsPDF } from 'jspdf';
import type {
  BusinessExpense,
  ExpenseCategory,
  Invoice,
  TaxCalculationMethod,
  TaxSettings
} from '../types/index.ts';
import {
  ensureHafnerLogoLoaded,
  formatDateDE,
  ISSUER_COMPANY,
  ISSUER_CONTACT_PERSON,
  ISSUER_STREET,
  ISSUER_CITY,
  ISSUER_TAX_NR
} from './invoicePdf.ts';

export const KU_REVENUE_LIMIT = 55000; // § 6 Abs. 1 Z 27 UStG & § 17 Abs. 3a EStG
export const KU_TOLERANCE_LIMIT = 60500; // +10 % Toleranzgrenze
export const GWG_LIMIT_EUR = 1000; // § 13 EStG (Brutto für USt-Kleinunternehmer)
export const GRUNDFREIBETRAG_BASE_CAP = 33000; // § 10 EStG (15 % bis 33.000 € = max. 4.950 €)
export const GRUNDFREIBETRAG_RATE = 0.15;

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  wareneinsatz: 'Material & Wareneinsatz',
  treibstoff_kfz: 'Treibstoff, KFZ & Fahrtkosten',
  werkzeug_anlage: 'Gerät, Maschine & Werkzeug (GWG / AfA)',
  versicherung_buero: 'Versicherung, Telefon & Büro',
  sonstiges: 'Entsorgung & Sonstige Ausgaben'
};

export interface EvaluatedExpenseItem {
  expense: BusinessExpense;
  deductibleInYear: number;
  kind: 'running' | 'wareneinsatz' | 'gwg' | 'afa' | 'inactive_year';
  ruleLabel: string;
}

export interface MethodResult {
  key: Exclude<TaxCalculationMethod, 'auto_best'>;
  title: string;
  shortTitle: string;
  legalRef: string;
  eligible: boolean;
  ineligibleReason?: string;
  totalIncome: number;
  flatRateDeduction: number; // Pauschalierte Betriebsausgaben
  flatRatePercent: number | null;
  actualRunningAndGoods: number; // Tatsächliche laufende Ausgaben / Wareneinsatz
  depreciationGwgAfa: number; // GWG + Jahres-/Halbjahres-AfA (nur bei echter E/A)
  additionalDeductions: number; // SVS + Arbeitsplatzpauschale + 50% Öffi
  svsDeduction: number;
  workplaceDeduction: number;
  transitDeduction: number;
  preliminaryProfit: number; // Vorläufiger Gewinn / Verlust vor Grundfreibetrag
  grundfreibetrag: number; // 15 % Grundfreibetrag (§ 10 EStG, max. 4.950 €)
  taxableProfit: number; // Steuerpflichtiger Gewinn / Verlust (ESt-Bemessungsgrundlage)
  estimatedIncomeTax: number; // Orientierung nach § 33 EStG Tarif 2026
}

export interface GuvSummary {
  year: number;
  invoicedIncomeInYear: number;
  paidInvoiceIncomeInYear: number;
  manualExtraIncome: number;
  totalCashIncome: number; // Maßgeblicher Zufluss gem. § 19 EStG
  openReceivablesTotal: number; // Noch nicht zugeflossene offene Rechnungsbeträge
  kuLimitUsedPercent: number;
  kuStatus: 'ok' | 'tolerance' | 'exceeded';
  evaluatedExpenses: EvaluatedExpenseItem[];
  wareneinsatzTotal: number;
  runningOtherTotal: number;
  gwgTotal: number;
  afaTotal: number;
  totalActualExpensesAndAfa: number;
  methods: Record<Exclude<TaxCalculationMethod, 'auto_best'>, MethodResult>;
  bestMethodKey: Exclude<TaxCalculationMethod, 'auto_best'>;
  activeMethodKey: Exclude<TaxCalculationMethod, 'auto_best'>;
  activeResult: MethodResult;
  savingsVsActualTaxable: number; // Vorteil beste Methode ggü. zweitbester / Einzelbelegen
  recommendationText: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Österreichischer Einkommensteuertarif 2026 (§ 33 Abs. 1 EStG)
 * Orientierungsberechnung ohne persönliche Absetzbeträge (Familienbonus etc.)
 */
export function estimateAustrianIncomeTax2026(taxableIncome: number): number {
  if (taxableIncome <= 13539) return 0;

  const brackets: Array<{ from: number; to: number; rate: number }> = [
    { from: 13539, to: 21992, rate: 0.2 },
    { from: 21992, to: 36458, rate: 0.3 },
    { from: 36458, to: 70365, rate: 0.4 },
    { from: 70365, to: 104859, rate: 0.48 },
    { from: 104859, to: 1000000, rate: 0.5 },
    { from: 1000000, to: Number.POSITIVE_INFINITY, rate: 0.55 }
  ];

  let tax = 0;
  for (const b of brackets) {
    if (taxableIncome > b.from) {
      const slice = Math.min(taxableIncome, b.to) - b.from;
      tax += slice * b.rate;
    }
  }
  return round2(tax);
}

/**
 * Prüft für jede Ausgabe / Anschaffung die Abzugsfähigkeit im Steuerjahr:
 * - Laufende Ausgaben / Wareneinsatz: 100 % im Zahlungsjahr (§ 19 EStG)
 * - Werkzeug / Anlage ≤ 1.000 €: GWG-Sofortabschreibung 100 % (§ 13 EStG)
 * - Werkzeug / Anlage > 1.000 €: Lineare AfA über Nutzungsdauer inkl. Halbjahres-AfA (§ 7 EStG)
 */
export function evaluateExpenseForYear(
  expense: BusinessExpense,
  targetYear: number
): EvaluatedExpenseItem {
  const expYear = parseInt(expense.date.slice(0, 4), 10);
  const expMonth = parseInt(expense.date.slice(5, 7), 10) || 1;
  const amount = Math.max(0, expense.amount || 0);

  if (Number.isNaN(expYear)) {
    return {
      expense,
      deductibleInYear: 0,
      kind: 'inactive_year',
      ruleLabel: 'Ungültiges Datum'
    };
  }

  if (expense.category !== 'werkzeug_anlage') {
    if (expYear !== targetYear) {
      return {
        expense,
        deductibleInYear: 0,
        kind: 'inactive_year',
        ruleLabel: `Zahlungsjahr ${expYear}`
      };
    }
    return {
      expense,
      deductibleInYear: round2(amount),
      kind: expense.category === 'wareneinsatz' ? 'wareneinsatz' : 'running',
      ruleLabel:
        expense.category === 'wareneinsatz'
          ? 'Wareneinsatz (100 % im Zahlungsjahr)'
          : 'Betriebsausgabe (100 % im Zahlungsjahr)'
    };
  }

  // Kategorie: Gerät, Maschine & Werkzeug (GWG § 13 EStG vs. AfA § 7 EStG)
  if (amount <= GWG_LIMIT_EUR) {
    if (expYear !== targetYear) {
      return {
        expense,
        deductibleInYear: 0,
        kind: 'inactive_year',
        ruleLabel: `GWG bereits ${expYear} abgeschrieben`
      };
    }
    return {
      expense,
      deductibleInYear: round2(amount),
      kind: 'gwg',
      ruleLabel: 'GWG § 13 EStG (≤ 1.000 € · 100 % Sofortabschreibung)'
    };
  }

  // Anlagegut > 1.000 € -> Lineare AfA inkl. Halbjahres-AfA (§ 7 Abs. 1 & 2 EStG)
  const lifeYears = Math.max(2, Math.min(20, Math.round(expense.useful_life_years || 5)));
  const annualRate = amount / lifeYears;
  const isSecondHalf = expMonth >= 7; // Inbetriebnahme ab 1. Juli -> Halbjahres-AfA (50 %)

  if (!isSecondHalf) {
    // 1. Halbjahr (Jan–Jun): Volle Jahres-AfA von expYear bis expYear + lifeYears - 1
    if (targetYear < expYear || targetYear >= expYear + lifeYears) {
      return {
        expense,
        deductibleInYear: 0,
        kind: 'inactive_year',
        ruleLabel: `AfA-Zeitraum ${expYear}–${expYear + lifeYears - 1}`
      };
    }
    const yearIndex = targetYear - expYear + 1;
    return {
      expense,
      deductibleInYear: round2(annualRate),
      kind: 'afa',
      ruleLabel: `Lineare AfA § 7 EStG · Jahr ${yearIndex}/${lifeYears} (Ganzjahres-AfA)`
    };
  }

  // 2. Halbjahr (Jul–Dez): 50 % im Kaufjahr, volle Jahre dazwischen, 50 % im Auslaufjahr (expYear + lifeYears)
  if (targetYear < expYear || targetYear > expYear + lifeYears) {
    return {
      expense,
      deductibleInYear: 0,
      kind: 'inactive_year',
      ruleLabel: `AfA-Zeitraum ${expYear}–${expYear + lifeYears}`
    };
  }

  if (targetYear === expYear) {
    return {
      expense,
      deductibleInYear: round2(annualRate * 0.5),
      kind: 'afa',
      ruleLabel: `Halbjahres-AfA § 7 EStG (Kauf 2. HJ · 50 % im 1. Jahr, ND ${lifeYears} J.)`
    };
  }

  if (targetYear === expYear + lifeYears) {
    return {
      expense,
      deductibleInYear: round2(annualRate * 0.5),
      kind: 'afa',
      ruleLabel: `Rest-Halbjahres-AfA § 7 EStG (Auslaufjahr · 50 %, ND ${lifeYears} J.)`
    };
  }

  const yearIndex = targetYear - expYear + 1;
  return {
    expense,
    deductibleInYear: round2(annualRate),
    kind: 'afa',
    ruleLabel: `Lineare AfA § 7 EStG · Jahr ${yearIndex}/${lifeYears} (100 % Jahresrate)`
  };
}

export function calculateGuvSummary(
  invoices: Invoice[],
  expenses: BusinessExpense[],
  settings: TaxSettings
): GuvSummary {
  const year = settings.selected_year || 2026;
  const yearPrefix = `${year}-`;

  // 1. Zugeflossene Betriebseinnahmen im Kalenderjahr gem. Zufluss-Abfluss-Prinzip (§ 19 EStG)
  let paidInvoiceIncomeInYear = 0;
  let invoicedIncomeInYear = 0;
  let openReceivablesTotal = 0;

  for (const inv of invoices) {
    if (!inv.is_storno && inv.status !== 'cancelled') {
      if (inv.issue_date.startsWith(yearPrefix)) {
        invoicedIncomeInYear += inv.total_amount;
      }
      const totalPaidAllTime = inv.payments.reduce((s, p) => s + p.amount, 0);
      openReceivablesTotal += Math.max(0, inv.total_amount - totalPaidAllTime);
    }

    for (const p of inv.payments) {
      if (p.date && p.date.startsWith(yearPrefix)) {
        paidInvoiceIncomeInYear += p.amount;
      }
    }
  }

  paidInvoiceIncomeInYear = round2(Math.max(0, paidInvoiceIncomeInYear));
  invoicedIncomeInYear = round2(Math.max(0, invoicedIncomeInYear));
  openReceivablesTotal = round2(Math.max(0, openReceivablesTotal));

  const manualExtraIncome = round2(Math.max(0, settings.manual_extra_income || 0));
  const totalCashIncome = round2(paidInvoiceIncomeInYear + manualExtraIncome);

  // Kleinunternehmer-Status (§ 6 Abs. 1 Z 27 UStG & § 17 Abs. 3a EStG)
  const kuLimitUsedPercent = Math.min(125, Math.round((totalCashIncome / KU_REVENUE_LIMIT) * 100));
  const kuStatus: 'ok' | 'tolerance' | 'exceeded' =
    totalCashIncome <= KU_REVENUE_LIMIT
      ? 'ok'
      : totalCashIncome <= KU_TOLERANCE_LIMIT
        ? 'tolerance'
        : 'exceeded';

  const kuEligible = totalCashIncome <= KU_TOLERANCE_LIMIT;
  const basisLimit = year >= 2026 ? 420000 : 320000;
  const basisRate = year >= 2026 ? 0.15 : 0.135;

  // 2. Ausgaben, GWG & AfA auswerten
  const evaluatedExpenses = expenses.map((e) => evaluateExpenseForYear(e, year));
  const wareneinsatzTotal = round2(
    evaluatedExpenses
      .filter((i) => i.kind === 'wareneinsatz')
      .reduce((s, i) => s + i.deductibleInYear, 0)
  );
  const runningOtherTotal = round2(
    evaluatedExpenses
      .filter((i) => i.kind === 'running')
      .reduce((s, i) => s + i.deductibleInYear, 0)
  );
  const gwgTotal = round2(
    evaluatedExpenses
      .filter((i) => i.kind === 'gwg')
      .reduce((s, i) => s + i.deductibleInYear, 0)
  );
  const afaTotal = round2(
    evaluatedExpenses
      .filter((i) => i.kind === 'afa')
      .reduce((s, i) => s + i.deductibleInYear, 0)
  );
  const totalActualExpensesAndAfa = round2(
    wareneinsatzTotal + runningOtherTotal + gwgTotal + afaTotal
  );

  // 3. Zusatzabzüge (gelten sowohl bei Pauschalierung als auch E/A-Rechnung!)
  const svsDeduction = round2(Math.max(0, settings.svs_paid || 0));
  // Arbeitsplatzpauschale (§ 4 Abs. 4 Z 8 EStG) entfällt gesetzlich ab 2027
  const workplaceDeduction = year <= 2026 ? settings.workplace_allowance || 0 : 0;
  const transitDeduction = round2(Math.max(0, (settings.transit_ticket_full || 0) * 0.5));
  const additionalDeductions = round2(svsDeduction + workplaceDeduction + transitDeduction);

  const computeGrundfreibetrag = (prelimProfit: number): number => {
    if (prelimProfit <= 0) return 0;
    const cappedBase = Math.min(prelimProfit, GRUNDFREIBETRAG_BASE_CAP);
    return round2(cappedBase * GRUNDFREIBETRAG_RATE);
  };

  // Methode 1: Kleinunternehmerpauschalierung 45 % (Handwerk / Grünraum-Regelbetrieb)
  const ku45Raw = Math.min(totalCashIncome * 0.45, 24750);
  const ku45Flat = round2(Math.min(totalCashIncome, ku45Raw)); // Pauschale allein darf keinen Verlust erzeugen
  const ku45Prelim = round2(totalCashIncome - ku45Flat - additionalDeductions);
  const ku45Gfb = computeGrundfreibetrag(ku45Prelim);
  const ku45Taxable = round2(ku45Prelim - ku45Gfb);

  const methodKu45: MethodResult = {
    key: 'ku_pauschal_45',
    title: 'Kleinunternehmerpauschalierung 45 % (Handwerk / Regelbetrieb)',
    shortTitle: 'KU-Pauschale 45 %',
    legalRef: '§ 17 Abs. 3a EStG · max. 24.750 € Pauschale',
    eligible: kuEligible,
    ineligibleReason: kuEligible
      ? undefined
      : `Umsatz über Toleranzgrenze von ${KU_TOLERANCE_LIMIT.toLocaleString('de-DE')} €`,
    totalIncome: totalCashIncome,
    flatRateDeduction: ku45Flat,
    flatRatePercent: 45,
    actualRunningAndGoods: 0,
    depreciationGwgAfa: 0,
    additionalDeductions,
    svsDeduction,
    workplaceDeduction,
    transitDeduction,
    preliminaryProfit: ku45Prelim,
    grundfreibetrag: ku45Gfb,
    taxableProfit: ku45Taxable,
    estimatedIncomeTax: estimateAustrianIncomeTax2026(ku45Taxable)
  };

  // Methode 2: Kleinunternehmerpauschalierung 20 % (Dienstleistungsbetrieb gem. DLB-V)
  const ku20Raw = Math.min(totalCashIncome * 0.2, 11000);
  const ku20Flat = round2(Math.min(totalCashIncome, ku20Raw));
  const ku20Prelim = round2(totalCashIncome - ku20Flat - additionalDeductions);
  const ku20Gfb = computeGrundfreibetrag(ku20Prelim);
  const ku20Taxable = round2(ku20Prelim - ku20Gfb);

  const methodKu20: MethodResult = {
    key: 'ku_pauschal_20',
    title: 'Kleinunternehmerpauschalierung 20 % (Dienstleistung lt. DLB-V)',
    shortTitle: 'KU-Pauschale 20 %',
    legalRef: '§ 17 Abs. 3a EStG iVm DLB-V · max. 11.000 €',
    eligible: kuEligible,
    ineligibleReason: kuEligible
      ? undefined
      : `Umsatz über Toleranzgrenze von ${KU_TOLERANCE_LIMIT.toLocaleString('de-DE')} €`,
    totalIncome: totalCashIncome,
    flatRateDeduction: ku20Flat,
    flatRatePercent: 20,
    actualRunningAndGoods: 0,
    depreciationGwgAfa: 0,
    additionalDeductions,
    svsDeduction,
    workplaceDeduction,
    transitDeduction,
    preliminaryProfit: ku20Prelim,
    grundfreibetrag: ku20Gfb,
    taxableProfit: ku20Taxable,
    estimatedIncomeTax: estimateAustrianIncomeTax2026(ku20Taxable)
  };

  // Methode 3: Basispauschalierung (§ 17 Abs. 1 EStG: 15 % ab 2026 + Wareneinsatz zusätzlich!)
  const basisEligible = totalCashIncome <= basisLimit;
  const basisFlatMax = year >= 2026 ? 63000 : 43200;
  const basisFlat = round2(Math.min(totalCashIncome, Math.min(totalCashIncome * basisRate, basisFlatMax)));
  const basisPrelim = round2(
    totalCashIncome - basisFlat - wareneinsatzTotal - additionalDeductions
  );
  const basisGfb = computeGrundfreibetrag(basisPrelim);
  const basisTaxable = round2(basisPrelim - basisGfb);

  const methodBasis15: MethodResult = {
    key: 'basis_pauschal_15',
    title: `Basispauschalierung ${year >= 2026 ? '15 %' : '13,5 %'} + Wareneinsatz`,
    shortTitle: `Basispauschale ${year >= 2026 ? '15 %' : '13,5 %'}`,
    legalRef: `§ 17 Abs. 1 EStG · inkl. Wareneinsatz bis ${basisLimit.toLocaleString('de-DE')} €`,
    eligible: basisEligible,
    ineligibleReason: basisEligible ? undefined : 'Umsatzgrenze Basispauschalierung überschritten',
    totalIncome: totalCashIncome,
    flatRateDeduction: basisFlat,
    flatRatePercent: year >= 2026 ? 15 : 13.5,
    actualRunningAndGoods: wareneinsatzTotal,
    depreciationGwgAfa: 0,
    additionalDeductions,
    svsDeduction,
    workplaceDeduction,
    transitDeduction,
    preliminaryProfit: basisPrelim,
    grundfreibetrag: basisGfb,
    taxableProfit: basisTaxable,
    estimatedIncomeTax: estimateAustrianIncomeTax2026(basisTaxable)
  };

  // Methode 4: Echte Einnahmen-Ausgaben-Rechnung (§ 4 Abs. 3 EStG inkl. GWG & AfA)
  const earPrelim = round2(
    totalCashIncome -
      wareneinsatzTotal -
      runningOtherTotal -
      gwgTotal -
      afaTotal -
      additionalDeductions
  );
  const earGfb = computeGrundfreibetrag(earPrelim);
  const earTaxable = round2(earPrelim - earGfb);

  const methodEar: MethodResult = {
    key: 'ear_echt',
    title: 'Echte Einnahmen-Ausgaben-Rechnung (Einzelbelege + GWG + AfA)',
    shortTitle: 'Echte E/A-Rechnung',
    legalRef: '§ 4 Abs. 3 EStG · inkl. GWG (§ 13) & AfA (§ 7)',
    eligible: true,
    totalIncome: totalCashIncome,
    flatRateDeduction: 0,
    flatRatePercent: null,
    actualRunningAndGoods: round2(wareneinsatzTotal + runningOtherTotal),
    depreciationGwgAfa: round2(gwgTotal + afaTotal),
    additionalDeductions,
    svsDeduction,
    workplaceDeduction,
    transitDeduction,
    preliminaryProfit: earPrelim,
    grundfreibetrag: earGfb,
    taxableProfit: earTaxable,
    estimatedIncomeTax: estimateAustrianIncomeTax2026(earTaxable)
  };

  const methods: Record<Exclude<TaxCalculationMethod, 'auto_best'>, MethodResult> = {
    ku_pauschal_45: methodKu45,
    ku_pauschal_20: methodKu20,
    basis_pauschal_15: methodBasis15,
    ear_echt: methodEar
  };

  // Günstigste zulässige Methode ermitteln (niedrigste Steuerbemessungsgrundlage)
  const eligibleList = Object.values(methods).filter((m) => m.eligible);
  eligibleList.sort((a, b) => a.taxableProfit - b.taxableProfit);
  const bestMethod = eligibleList[0] || methodEar;
  const bestMethodKey = bestMethod.key;

  const activeMethodKey: Exclude<TaxCalculationMethod, 'auto_best'> =
    settings.preferred_method === 'auto_best'
      ? bestMethodKey
      : methods[settings.preferred_method].eligible
        ? settings.preferred_method
        : bestMethodKey;

  const activeResult = methods[activeMethodKey];
  const savingsVsActualTaxable = round2(methodEar.taxableProfit - bestMethod.taxableProfit);

  let recommendationText = '';
  if (totalCashIncome === 0 && totalActualExpensesAndAfa === 0) {
    recommendationText =
      'Sobald Zahlungszuflüsse oder Ausgaben im gewählten Jahr vorliegen, ermittelt der Günstigkeits-Check automatisch die steuerlich beste Variante.';
  } else if (bestMethodKey === 'ear_echt') {
    const diffToKu45 = kuEligible
      ? round2(methodKu45.taxableProfit - methodEar.taxableProfit)
      : 0;
    recommendationText =
      diffToKu45 > 0
        ? `Durch hohe tatsächliche Ausgaben/Abschreibungen ist die echte E/A-Rechnung um ${diffToKu45.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € günstiger als die 45 %-Pauschale.`
        : 'Die echte Einnahmen-Ausgaben-Rechnung liefert aktuell die niedrigste Steuerbemessungsgrundlage (auch Verluste voll anrechenbar).';
  } else {
    recommendationText = `${bestMethod.shortTitle} senkt Ihre Steuerbemessungsgrundlage ohne Einzelbeleg-Nachweis um ${Math.max(0, savingsVsActualTaxable).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € gegenüber der Belegabrechnung.`;
  }

  return {
    year,
    invoicedIncomeInYear,
    paidInvoiceIncomeInYear,
    manualExtraIncome,
    totalCashIncome,
    openReceivablesTotal,
    kuLimitUsedPercent,
    kuStatus,
    evaluatedExpenses,
    wareneinsatzTotal,
    runningOtherTotal,
    gwgTotal,
    afaTotal,
    totalActualExpensesAndAfa,
    methods,
    bestMethodKey,
    activeMethodKey,
    activeResult,
    savingsVsActualTaxable,
    recommendationText
  };
}

function fmtEur(val: number): string {
  return `${val.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} EUR`;
}

export async function generateGuvPdfAsync(summary: GuvSummary): Promise<{
  blob: Blob;
  filename: string;
}> {
  const logoDataUrl = await ensureHafnerLogoLoaded();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'PNG', 152, 8, 38, 38);
    } catch {
      // Fallback ohne Bild
    }
  }

  const leftX = 20;
  const rightX = 190;
  const width = rightX - leftX;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(20, 20, 20);
  doc.text(`Gewinn- & Verlustübersicht (E/A) ${summary.year}`, leftX, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text(`${ISSUER_COMPANY} · Inh. ${ISSUER_CONTACT_PERSON}`, leftX, 26);
  doc.text(`${ISSUER_STREET}, ${ISSUER_CITY} · St.-Nr. ${ISSUER_TAX_NR}`, leftX, 30.5);
  doc.text(
    'USt-Kleinunternehmer gem. § 6 Abs. 1 Z 27 UStG · Zufluss-Abfluss-Prinzip (§ 19 EStG)',
    leftX,
    35
  );

  let y = 48;
  const res = summary.activeResult;

  // Gewählte Methode Box
  doc.setFillColor(238, 241, 250);
  doc.rect(leftX, y, width, 13, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(35, 42, 120);
  doc.text(`Gewählte Gewinnermittlung: ${res.title}`, leftX + 3, y + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(60, 60, 60);
  doc.text(res.legalRef, leftX + 3, y + 10.5);

  y += 19;

  // Haupttabelle Ergebnisrechnung
  doc.setFillColor(230, 232, 235);
  doc.rect(leftX, y, width, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 15, 15);
  doc.text('Position der Gewinnermittlung', leftX + 2, y + 4.8);
  doc.text('Betrag', rightX - 2, y + 4.8, { align: 'right' });
  y += 9;

  const addRow = (label: string, amountStr: string, bold = false, muted = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(9.2);
    doc.setTextColor(muted ? 95 : 20, muted ? 95 : 20, muted ? 95 : 20);
    doc.text(label, leftX + 2, y);
    doc.text(amountStr, rightX - 2, y, { align: 'right' });
    y += 6.2;
  };

  addRow(
    `Zugeflossene Rechnungszahlungen ${summary.year} (§ 19 EStG)`,
    fmtEur(summary.paidInvoiceIncomeInYear)
  );
  if (summary.manualExtraIncome > 0) {
    addRow('Sonstige Betriebseinnahmen (manuell erfasst)', fmtEur(summary.manualExtraIncome));
  }
  addRow('Summe Betriebseinnahmen (Zufluss)', fmtEur(res.totalIncome), true);

  y += 1.5;
  if (res.flatRateDeduction > 0) {
    addRow(
      `− Pauschalierte Betriebsausgaben (${res.flatRatePercent} %)`,
      `- ${fmtEur(res.flatRateDeduction)}`
    );
  }
  if (res.actualRunningAndGoods > 0) {
    addRow(
      res.key === 'basis_pauschal_15'
        ? '− Abzugsfähiger Wareneinsatz / Material'
        : '− Laufende Betriebsausgaben & Wareneinsatz (Belege)',
      `- ${fmtEur(res.actualRunningAndGoods)}`
    );
  }
  if (res.depreciationGwgAfa > 0) {
    addRow(
      '− Abschreibungen (GWG § 13 EStG + Jahres-/Halbjahres-AfA § 7 EStG)',
      `- ${fmtEur(res.depreciationGwgAfa)}`
    );
  }
  if (res.svsDeduction > 0) {
    addRow('− Bezahlte SVS-Pflichtbeiträge', `- ${fmtEur(res.svsDeduction)}`);
  }
  if (res.workplaceDeduction > 0) {
    addRow(
      '− Arbeitsplatzpauschale (§ 4 Abs. 4 Z 8 EStG)',
      `- ${fmtEur(res.workplaceDeduction)}`
    );
  }
  if (res.transitDeduction > 0) {
    addRow('− Öffi-Ticket (50 % abzugsfähig)', `- ${fmtEur(res.transitDeduction)}`);
  }

  doc.setDrawColor(190, 190, 190);
  doc.line(leftX, y - 2.5, rightX, y - 2.5);
  addRow('= Vorläufiges Betriebsergebnis', fmtEur(res.preliminaryProfit), true);
  addRow(
    '− Gewinnfreibetrag / Grundfreibetrag (15 % gem. § 10 EStG, max. 4.950 EUR)',
    `- ${fmtEur(res.grundfreibetrag)}`
  );

  doc.setFillColor(230, 232, 235);
  doc.rect(leftX, y - 4.2, width, 7.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(10, 10, 10);
  doc.text('= Steuerpflichtiger Gewinn / Verlust (Bemessungsgrundlage)', leftX + 2, y + 1);
  doc.text(fmtEur(res.taxableProfit), rightX - 2, y + 1, { align: 'right' });
  y += 10;

  addRow(
    `Unverbindliche Einkommensteuer-Orientierung (Tarif ${summary.year}, § 33 EStG)`,
    fmtEur(res.estimatedIncomeTax),
    false,
    true
  );
  addRow(
    `Informativ: Offene Rechnungsforderungen (erst bei Zahlungseingang steuerwirksam)`,
    fmtEur(summary.openReceivablesTotal),
    false,
    true
  );

  // Methodenvergleich (Günstigkeitsprüfung)
  y += 5;
  doc.setFillColor(230, 232, 235);
  doc.rect(leftX, y, width, 6.8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.2);
  doc.setTextColor(15, 15, 15);
  doc.text('Automatischer Günstigkeits-Vergleich (Österreich EStG)', leftX + 2, y + 4.6);
  doc.text('Stpfl. Ergebnis', rightX - 2, y + 4.6, { align: 'right' });
  y += 8.5;

  Object.values(summary.methods).forEach((m) => {
    const isBest = m.key === summary.bestMethodKey;
    const label = `${m.shortTitle}${isBest ? ' [EMPFEHLUNG]' : ''}${!m.eligible ? ' (nicht zulässig)' : ''}`;
    addRow(label, m.eligible ? fmtEur(m.taxableProfit) : '—', isBest, !m.eligible);
  });

  // Erfasste Ausgaben & Anlagen im Steuerjahr
  const activeExpItems = summary.evaluatedExpenses.filter((i) => i.deductibleInYear > 0);
  if (activeExpItems.length > 0) {
    y += 5;
    if (y > 240) {
      doc.addPage();
      y = 22;
    }
    doc.setFillColor(230, 232, 235);
    doc.rect(leftX, y, width, 6.8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.2);
    doc.setTextColor(15, 15, 15);
    doc.text(`Beleg- & Abschreibungsverzeichnis ${summary.year}`, leftX + 2, y + 4.6);
    doc.text(`Ansatz ${summary.year}`, rightX - 2, y + 4.6, { align: 'right' });
    y += 8.5;

    for (const item of activeExpItems) {
      if (y > 272) {
        doc.addPage();
        y = 22;
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(25, 25, 25);
      doc.text(
        `${formatDateDE(item.expense.date)} · ${item.expense.title} (${item.ruleLabel})`,
        leftX + 2,
        y
      );
      doc.text(fmtEur(item.deductibleInYear), rightX - 2, y, { align: 'right' });
      y += 5.5;
    }
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(110, 110, 110);
  doc.text(
    'Hinweis: Automatisierte Rechenhilfe nach österr. EStG/UStG zur Vorbereitung für FinanzOnline / Steuerberatung. Keine Rechtsberatung.',
    leftX,
    286
  );

  const filename = `${summary.year}_GuV_EA_Uebersicht_Hafner.pdf`;
  return { blob: doc.output('blob'), filename };
}
