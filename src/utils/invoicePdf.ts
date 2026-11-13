import { jsPDF } from 'jspdf';
import type {
  Customer,
  CustomerProperty,
  Invoice,
  InvoiceLineItem,
  WorkRecord
} from '../types/index.ts';

export const HAFNER_LOGO_URL = '/assets/aistudio/Hafner_Rechnungslogo_Original_236f7b3b.png';

export const ISSUER_COMPANY = 'Hafner Michael – Grünraum Handwerk';
export const ISSUER_NAME = 'Hafner Michael';
export const ISSUER_CONTACT_PERSON = 'Michael Hafner';
export const ISSUER_RETURN_LINE =
  'Hafner Michael - Goethestrasse 2 - 9560 Feldkirchen in Kärnten';
export const ISSUER_STREET = 'Goethestrasse 2';
export const ISSUER_CITY = '9560 Feldkirchen in Kärnten';
export const ISSUER_COUNTRY = 'Österreich';
export const ISSUER_PHONE = '06802376503';
export const ISSUER_EMAIL = 'hafnerm@gmx.at';
export const ISSUER_COURT = 'Amtsgericht Feldkirchen';
export const ISSUER_TAX_NR = '59 0640553';
export const ISSUER_BANK_NAME = 'Bank N26';
export const ISSUER_IBAN = 'DE41100110012348393811';
export const ISSUER_BIC = 'NTSBDEB1XXX';

export const TAX_EXEMPTION_CLAUSE =
  'Der Rechnungsbetrag enthält gem. §6 Abs. 1 Z 27 UStG 1994 keine Umsatzsteuer';
export const PAYMENT_TERMS_CLAUSE =
  'Zahlungsbedingungen: Zahlung innerhalb von 14 Tagen ab Rechnungseingang ohne Abzüge.';

let cachedLogoDataUrl: string | null = null;
let logoLoadPromise: Promise<string | null> | null = null;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Logo konnte nicht gelesen werden'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function ensureHafnerLogoLoaded(): Promise<string | null> {
  if (cachedLogoDataUrl) {
    return Promise.resolve(cachedLogoDataUrl);
  }
  if (!logoLoadPromise && typeof window !== 'undefined') {
    logoLoadPromise = fetch(HAFNER_LOGO_URL)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => (blob ? blobToDataUrl(blob) : null))
      .then((dataUrl) => {
        cachedLogoDataUrl = dataUrl;
        return dataUrl;
      })
      .catch(() => null);
  }
  return logoLoadPromise || Promise.resolve(null);
}

// Sofort beim App-Start im Hintergrund vorladen
if (typeof window !== 'undefined') {
  void ensureHafnerLogoLoaded();
}

export interface ResolvedInvoiceData {
  invoiceNumber: string;
  issueDateIso: string;
  issueDateFormatted: string;
  dueDateIso: string;
  dueDateFormatted: string;
  customerNumber: string;
  contactPerson: string;
  recipientName: string;
  recipientStreet: string;
  recipientZip: string;
  recipientCity: string;
  recipientCountry: string;
  servicePeriod: string;
  lineItems: InvoiceLineItem[];
  totalAmount: number;
  isStorno: boolean;
  stornoReason: string | null;
  paymentTermsText?: string;
  isPaidInCash?: boolean;
}

export function getTodayLocalIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDateDE(isoDate?: string | null): string {
  if (!isoDate) return '';
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[3]}.${match[2]}.${match[1]}`;
  }
  return isoDate;
}

export function addDaysIso(isoDate: string, days: number): string {
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days);
  if (Number.isNaN(d.getTime())) return isoDate;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function computeNextInvoiceNumber(
  invoices: Invoice[],
  issueDateIso: string
): { seq: number; year: string; formatted: string } {
  const year = issueDateIso.slice(0, 4) || String(new Date().getFullYear());
  const existingSeqs = invoices
    .filter((i) => !i.is_storno)
    .map((i) => {
      const slashMatch = i.invoice_number.trim().match(/^RE-(\d+)\/(\d{4})$/i);
      if (slashMatch && slashMatch[2] === year) {
        return parseInt(slashMatch[1], 10);
      }
      return 0;
    });
  const baseMax = existingSeqs.length > 0 ? Math.max(...existingSeqs, 74) : 74;
  const seq = baseMax + 1;
  return { seq, year, formatted: `RE-${seq}/${year}` };
}

export function buildPaymentTermsClause(dueDays: number, isPaidInCash = false): string {
  if (isPaidInCash) {
    return 'Zahlungsbedingungen: Rechnungsbetrag dankend bar erhalten.';
  }
  if (dueDays <= 0) {
    return 'Zahlungsbedingungen: Sofort nach Rechnungseingang ohne Abzüge fällig.';
  }
  return `Zahlungsbedingungen: Zahlung innerhalb von ${dueDays} Tagen ab Rechnungseingang ohne Abzüge.`;
}

export function formatEuro(amount: number): string {
  return `${amount.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} EUR`;
}

export function formatQtyTwoDecimals(val: number): string {
  return val.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function formatQtyNumber(val: number): string {
  return val.toLocaleString('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

export function computeServicePeriod(records: WorkRecord[], fallbackIsoDate: string): string {
  const dates = records
    .map((r) => r.work_date)
    .filter(Boolean)
    .sort();
  if (dates.length === 0) {
    return formatDateDE(fallbackIsoDate);
  }
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === last) {
    return formatDateDE(first);
  }
  return `${formatDateDE(first)} - ${formatDateDE(last)}`;
}

export function resolveCustomerNumber(customerId: string, customers: Customer[]): string {
  const idx = customers.findIndex((c) => c.id === customerId);
  if (idx >= 0) {
    return String(1001 + idx);
  }
  const digits = customerId.replace(/\D/g, '');
  return digits ? String(1000 + (parseInt(digits.slice(-3), 10) % 900)) : '1001';
}

export function getCustomerBillingRecipient(
  customer: Customer | undefined | null,
  customers: Customer[]
): Customer | null {
  if (!customer) return null;
  if (
    customer.billing_mode === 'divergent_recipient' &&
    customer.default_billing_customer_id &&
    customer.default_billing_customer_id !== customer.id
  ) {
    return customers.find((c) => c.id === customer.default_billing_customer_id) || null;
  }
  return null;
}

export function getEffectiveBillingCustomerId(
  rec: WorkRecord,
  customers: Customer[]
): string {
  const workCust = customers.find((c) => c.id === rec.customer_id);
  const divergent = getCustomerBillingRecipient(workCust, customers);
  if (divergent) {
    return divergent.id;
  }
  if (
    rec.billing_customer_id &&
    customers.some((c) => c.id === rec.billing_customer_id)
  ) {
    return rec.billing_customer_id;
  }
  return rec.customer_id;
}

export function buildLineItemsFromRecords(
  records: WorkRecord[],
  extraItems: InvoiceLineItem[] = [],
  context?: {
    billingCustomerId?: string;
    customers?: Customer[];
    properties?: CustomerProperty[];
  }
): InvoiceLineItem[] {
  const items: InvoiceLineItem[] = [];

  const sortedRecords = [...records].sort((a, b) => a.work_date.localeCompare(b.work_date));

  for (const rec of sortedRecords) {
    const workAmount =
      rec.hourly_rate !== null
        ? Math.round(rec.hours * rec.hourly_rate * 100) / 100
        : rec.accounting_amount || 0;

    let itemDescription = rec.title;
    const isSubRecord =
      !!context?.billingCustomerId && rec.customer_id !== context.billingCustomerId;
    if (isSubRecord) {
      const origCust = context?.customers?.find((c) => c.id === rec.customer_id);
      const prop = rec.property_id
        ? context?.properties?.find((p) => p.id === rec.property_id)
        : undefined;
      if (origCust && prop && prop.name !== origCust.name) {
        itemDescription = `${rec.title} (${origCust.name} – ${prop.name})`;
      } else if (prop) {
        itemDescription = `${rec.title} (${prop.name})`;
      } else if (origCust) {
        itemDescription = `${rec.title} (${origCust.name})`;
      }
    }

    items.push({
      id: `li-${rec.id}`,
      description: itemDescription,
      quantity_label: `${formatQtyTwoDecimals(rec.hours)} Std`,
      unit_price_label: rec.hourly_rate !== null ? formatEuro(rec.hourly_rate) : 'Pauschal',
      amount: workAmount
    });

    if (rec.materials && rec.materials.length > 0) {
      for (const mat of rec.materials) {
        const matTotal =
          mat.total !== null
            ? mat.total
            : mat.price_per_unit !== null
              ? Math.round(mat.quantity * mat.price_per_unit * 100) / 100
              : 0;
        items.push({
          id: `li-mat-${rec.id}-${mat.material_id}`,
          description: mat.name,
          quantity_label: `${formatQtyTwoDecimals(mat.quantity)} ${mat.unit}`,
          unit_price_label:
            mat.price_per_unit !== null ? formatEuro(mat.price_per_unit) : 'inkl.',
          amount: matTotal
        });
      }
    }
  }

  for (const extra of extraItems) {
    items.push(extra);
  }

  return items;
}

export function resolveInvoiceDisplayData(
  invoice: Invoice,
  customers: Customer[],
  workRecords: WorkRecord[]
): ResolvedInvoiceData {
  const customer = customers.find((c) => c.id === invoice.customer_id);
  const boundRecords = workRecords.filter(
    (w) => invoice.work_record_ids.includes(w.id) || w.settlement_id === invoice.id
  );

  let lineItems: InvoiceLineItem[] = [];
  if (invoice.line_items && invoice.line_items.length > 0) {
    lineItems = invoice.line_items.map((item) => ({
      ...item,
      unit_price_label: item.unit_price_label.replace(/\s*€$/, ' EUR'),
      quantity_label: item.quantity_label.replace(/\s*Std\.$/, ' Std')
    }));
  } else if (boundRecords.length > 0) {
    lineItems = buildLineItemsFromRecords(boundRecords).map((item) =>
      invoice.is_storno ? { ...item, amount: -Math.abs(item.amount) } : item
    );
  } else {
    lineItems = [
      {
        id: `li-fallback-${invoice.id}`,
        description: invoice.is_storno
          ? `Storno (${invoice.storno_reason || 'Korrektur'})`
          : 'Gartenpflege',
        quantity_label: '1,00 Psch',
        unit_price_label: formatEuro(invoice.total_amount),
        amount: invoice.total_amount
      }
    ];
  }

  const servicePeriod =
    invoice.service_period || computeServicePeriod(boundRecords, invoice.issue_date);

  const dueIso = invoice.due_date || addDaysIso(invoice.issue_date, 14);

  return {
    invoiceNumber: invoice.invoice_number,
    issueDateIso: invoice.issue_date,
    issueDateFormatted: formatDateDE(invoice.issue_date),
    dueDateIso: dueIso,
    dueDateFormatted: formatDateDE(dueIso),
    customerNumber:
      invoice.customer_number?.trim() || resolveCustomerNumber(invoice.customer_id, customers),
    contactPerson: ISSUER_CONTACT_PERSON,
    recipientName: invoice.billing_customer_name || customer?.name || 'Kunde',
    recipientStreet: invoice.recipient_street ?? customer?.street ?? '',
    recipientZip: invoice.recipient_zip ?? customer?.zip ?? '',
    recipientCity: invoice.recipient_city ?? customer?.city ?? '',
    recipientCountry: 'Österreich',
    servicePeriod,
    lineItems,
    totalAmount: invoice.total_amount,
    isStorno: invoice.is_storno,
    stornoReason: invoice.storno_reason,
    paymentTermsText: invoice.payment_terms_text,
    isPaidInCash: invoice.paid_in_cash
  };
}

export function buildInvoiceFilename(
  invoiceNumber: string,
  issueDateIso: string,
  isStorno = false
): string {
  const safeNum = invoiceNumber
    .trim()
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  const docType = isStorno ? 'Storno' : 'Rechnung';
  const datePrefix = issueDateIso || getTodayLocalIso();
  return `${datePrefix}_${docType}_${safeNum || 'Beleg'}.pdf`;
}

function drawDinMarksAndFooter(
  doc: jsPDF,
  pageNum: number,
  totalPages: number
) {
  // DIN 5008 Falzmarken & Lochmarke links
  doc.setDrawColor(45, 45, 45);
  doc.setLineWidth(0.5);
  doc.line(0, 105, 4, 105);
  doc.setLineWidth(0.65);
  doc.line(0, 148.5, 6.5, 148.5);
  doc.setLineWidth(0.5);
  doc.line(0, 210, 4, 210);

  // Seitenzahl rechts über Fußzeile (z.B. 1/1)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(35, 35, 35);
  doc.text(`${pageNum}/${totalPages}`, 192, 267, { align: 'right' });

  // 4-spaltige Original-Fußzeile
  const fy = 275;
  const lh = 3.5;
  doc.setFontSize(7.2);
  doc.setTextColor(40, 40, 40);

  // Spalte 1: Adresse
  doc.text(ISSUER_NAME, 20, fy);
  doc.text(ISSUER_STREET, 20, fy + lh);
  doc.text(ISSUER_CITY, 20, fy + lh * 2);
  doc.text(ISSUER_COUNTRY, 20, fy + lh * 3);

  // Spalte 2: Kontakt
  doc.text(`Tel. ${ISSUER_PHONE}`, 63, fy);
  doc.text(`E-Mail ${ISSUER_EMAIL}`, 63, fy + lh);

  // Spalte 3: Amtsgericht & Steuernummer
  doc.text(ISSUER_COURT, 105, fy);
  doc.text(`Steuer-Nr. ${ISSUER_TAX_NR}`, 105, fy + lh);
  doc.text(`Inhaber/-in ${ISSUER_CONTACT_PERSON}`, 105, fy + lh * 2);

  // Spalte 4: Bankverbindung
  doc.text(ISSUER_BANK_NAME, 149, fy);
  doc.text(`IBAN ${ISSUER_IBAN}`, 149, fy + lh);
  doc.text(`BIC ${ISSUER_BIC}`, 149, fy + lh * 2);

  doc.setTextColor(0, 0, 0);
}

export function generateInvoicePdf(
  data: ResolvedInvoiceData,
  explicitLogoDataUrl?: string | null
): {
  blob: Blob;
  file: File;
  filename: string;
} {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const logoUrlToUse = explicitLogoDataUrl !== undefined ? explicitLogoDataUrl : cachedLogoDataUrl;

  // Original-Logo rechts oben (HAFNER GRÜNRAUM HANDWERK, 250x250 Quadrat)
  if (logoUrlToUse) {
    try {
      doc.addImage(logoUrlToUse, 'PNG', 150, 6, 42, 42);
    } catch {
      // Fallback Textmarke falls Bilddaten nicht lesbar
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(34, 122, 59);
      doc.text('HAFNER', 171, 36, { align: 'center' });
      doc.setFontSize(8);
      doc.text('GRÜNRAUM HANDWERK', 171, 41, { align: 'center' });
      doc.setTextColor(0, 0, 0);
    }
  }

  // Absender-Rücksendeangabe über dem Adressfeld
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.text(ISSUER_RETURN_LINE, 20, 49);

  // Empfängeradresse links (DIN-Sichtfenster)
  let addrY = 61;
  doc.setFontSize(10);
  doc.setTextColor(15, 15, 15);
  doc.text(data.recipientName, 20, addrY);

  if (data.recipientStreet.trim()) {
    addrY += 4.6;
    doc.text(data.recipientStreet.trim(), 20, addrY);
  }

  const cityLine = [data.recipientZip.trim(), data.recipientCity.trim()].filter(Boolean).join(' ');
  if (cityLine) {
    addrY += 4.6;
    doc.text(cityLine, 20, addrY);
  }

  if (data.recipientStreet.trim() || cityLine) {
    addrY += 4.6;
    doc.text(data.recipientCountry, 20, addrY);
  }

  // Rechnungs-Metadatenblock rechts
  const metaLeftX = 128;
  const metaRightX = 192;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(15, 15, 15);
  doc.text('Rechnungs-Nr.', metaLeftX, 56.5);
  doc.text(data.invoiceNumber, metaRightX, 56.5, { align: 'right' });

  doc.setFontSize(8.2);
  doc.setTextColor(35, 35, 35);
  doc.text('Rechnungsdatum', metaLeftX, 61.5);
  doc.text(data.issueDateFormatted, metaRightX, 61.5, { align: 'right' });

  doc.text('Leistungszeitraum', metaLeftX, 65.5);
  doc.text(data.servicePeriod, metaRightX, 65.5, { align: 'right' });

  doc.text('Ihre Kundennummer', metaLeftX, 73);
  doc.text(data.customerNumber, metaRightX, 73, { align: 'right' });

  doc.text('Ihr Ansprechpartner', metaLeftX, 77);
  doc.text(data.contactPerson, metaRightX, 77, { align: 'right' });

  // Betreffzeile
  const contentLeftX = 22;
  const contentRightX = 192;
  const tableWidth = contentRightX - contentLeftX;

  let y = 97;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.setTextColor(10, 10, 10);
  doc.text(
    data.isStorno
      ? `Stornorechnung Nr. ${data.invoiceNumber}`
      : `Rechnungs Nr. ${data.invoiceNumber}`,
    contentLeftX,
    y
  );

  // Anschreiben / Einleitungstext
  y = 109;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(20, 20, 20);
  doc.text('Sehr geehrte Damen und Herren,', contentLeftX, y);

  y += 7.5;
  if (data.isStorno) {
    doc.text(
      `hiermit stornieren wir die betreffende Abrechnung (${data.stornoReason || 'Korrektur'}):`,
      contentLeftX,
      y
    );
    y += 7;
  } else {
    doc.text('vielen Dank für Ihren Auftrag und das damit verbundene Vertrauen!', contentLeftX, y);
    y += 4.5;
    doc.text('Hiermit stelle ich Ihnen die folgenden Leistungen in Rechnung:', contentLeftX, y);
    y += 7;
  }

  // Positionstabelle (hellgraue Balken, ohne harte Rahmenlinien wie im Original)
  const colPosX = contentLeftX + 1.5;
  const colDescX = contentLeftX + 11;
  const colMengeRightX = contentLeftX + 113;
  const colUnitRightX = contentLeftX + 140;
  const colTotalRightX = contentRightX - 1.5;

  doc.setFillColor(230, 232, 235);
  doc.rect(contentLeftX, y, tableWidth, 6.8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(10, 10, 10);
  doc.text('Pos.', colPosX, y + 4.7);
  doc.text('Beschreibung', colDescX, y + 4.7);
  doc.text('Menge', colMengeRightX, y + 4.7, { align: 'right' });
  doc.text('Einzelpreis', colUnitRightX, y + 4.7, { align: 'right' });
  doc.text('Gesamtpreis', colTotalRightX, y + 4.7, { align: 'right' });

  y += 8.5;

  data.lineItems.forEach((item, index) => {
    const descLines = doc.splitTextToSize(item.description, 75) as string[];
    const rowH = Math.max(8.5, descLines.length * 4.5 + 4);

    if (y + rowH > 230) {
      doc.addPage();
      y = 25;
    }

    const rowBaseline = y + 4.2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(`${index + 1}.`, colPosX, rowBaseline);

    doc.setFont('helvetica', 'bold');
    doc.text(descLines, colDescX, rowBaseline);

    doc.setFont('helvetica', 'normal');
    doc.text(item.quantity_label, colMengeRightX, rowBaseline, { align: 'right' });
    doc.text(item.unit_price_label, colUnitRightX, rowBaseline, { align: 'right' });
    doc.text(formatEuro(item.amount), colTotalRightX, rowBaseline, { align: 'right' });

    y += rowH;
  });

  // Summenblock: Gesamtbetrag netto -> Kleinunternehmer-Zeile -> Gesamtbetrag brutto
  y += 2;
  if (y + 52 > 258) {
    doc.addPage();
    y = 25;
  }

  // Zeile 1: Gesamtbetrag netto (grauer Balken)
  doc.setFillColor(230, 232, 235);
  doc.rect(contentLeftX, y, tableWidth, 6.5, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Gesamtbetrag netto', colDescX, y + 4.5);
  doc.text(formatEuro(data.totalAmount), colTotalRightX, y + 4.5, { align: 'right' });

  y += 6.5;

  // Zeile 2: §6 Abs. 1 Z 27 UStG 1994 (weiß)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(TAX_EXEMPTION_CLAUSE, colDescX, y + 4.6);

  y += 6.8;

  // Zeile 3: Gesamtbetrag brutto (grauer Balken, fett)
  doc.setFillColor(230, 232, 235);
  doc.rect(contentLeftX, y, tableWidth, 6.8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Gesamtbetrag brutto', colDescX, y + 4.7);
  doc.text(formatEuro(data.totalAmount), colTotalRightX, y + 4.7, { align: 'right' });

  // Zahlungsbedingungen & Grußformel
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.2);
  doc.setTextColor(20, 20, 20);

  if (!data.isStorno) {
    if (data.isPaidInCash) {
      doc.text(
        data.paymentTermsText || 'Zahlungsbedingungen: Rechnungsbetrag dankend bar erhalten.',
        contentLeftX,
        y
      );
      y += 8.5;
    } else {
      doc.text(data.paymentTermsText || PAYMENT_TERMS_CLAUSE, contentLeftX, y);
      y += 7.5;
      doc.text(
        'Bitte überweisen Sie den Rechnungsbetrag unter Angabe der Rechnungsnummer auf das unten angegebene',
        contentLeftX,
        y
      );
      y += 4.3;
      doc.text('Konto.', contentLeftX, y);
      y += 4.5;
      doc.text(
        `Der Rechnungsbetrag ist bis zum ${data.dueDateFormatted} fällig.`,
        contentLeftX,
        y
      );
      y += 8.5;
    }
  } else {
    y += 4;
  }

  doc.text('Mit freundlichen Grüßen', contentLeftX, y);
  y += 4.5;
  doc.text(ISSUER_CONTACT_PERSON, contentLeftX, y);

  // DIN-Marken, Seitenzahlen & 4-spaltige Fußzeile auf allen Seiten rendern
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawDinMarksAndFooter(doc, p, totalPages);
  }

  const filename = buildInvoiceFilename(data.invoiceNumber, data.issueDateIso, data.isStorno);
  const blob = doc.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });

  return { blob, file, filename };
}

export async function generateInvoicePdfAsync(data: ResolvedInvoiceData): Promise<{
  blob: Blob;
  file: File;
  filename: string;
}> {
  const logoDataUrl = await ensureHafnerLogoLoaded();
  return generateInvoicePdf(data, logoDataUrl);
}
