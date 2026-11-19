import type { Appointment, Customer, CustomerProperty, Invoice } from '../types/index.ts';
import { formatDateDE, formatEuro } from './invoicePdf.ts';

export type WhatsAppTemplateId =
  | 'rechnungszusendung'
  | 'terminbestaetigung'
  | 'zahlungserinnerung'
  | 'angebot_rueckfrage';

export interface WhatsAppTemplateDefinition {
  id: WhatsAppTemplateId;
  label: string;
  shortLabel: string;
  defaultBody: string;
}

const STORAGE_KEY = 'hafner_whatsapp_templates_v1';

export const WHATSAPP_TEMPLATES: readonly WhatsAppTemplateDefinition[] = [
  {
    id: 'rechnungszusendung',
    label: 'Rechnungszusendung',
    shortLabel: 'Rechnung',
    defaultBody:
      '{{anrede}}\n\nanbei sende ich Ihnen die Rechnung {{rechnungsnummer}} über {{betrag}}{{leistungszeitraum_zusatz}}.\n\n{{zahlungsziel}}\n\nVielen Dank für Ihren Auftrag!\nHerzliche Grüße\nHafner Michael – Grünraum Handwerk'
  },
  {
    id: 'terminbestaetigung',
    label: 'Terminbestätigung',
    shortLabel: 'Termin',
    defaultBody:
      '{{anrede}}\n\nhiermit bestätige ich gerne unseren Termin am {{termin_datum}}{{termin_uhrzeit_zusatz}}{{termin_ort_zusatz}}.\n\nLeistung: {{termin_leistung}}\n\nFalls sich bei Ihnen etwas ändert, geben Sie mir bitte kurz Bescheid.\nHerzliche Grüße\nHafner Michael – Grünraum Handwerk'
  },
  {
    id: 'zahlungserinnerung',
    label: 'Zahlungserinnerung',
    shortLabel: 'Erinnerung',
    defaultBody:
      '{{anrede}}\n\nich darf Sie freundlich an die noch offene Rechnung {{rechnungsnummer}} vom {{rechnungsdatum}} über {{offener_betrag}} (Fälligkeit: {{faelligkeitsdatum}}) erinnern.\n\nFalls sich Ihre Überweisung bereits mit dieser Nachricht überschnitten hat, betrachten Sie diese bitte als gegenstandslos.\n\nHerzliche Grüße\nHafner Michael – Grünraum Handwerk'
  },
  {
    id: 'angebot_rueckfrage',
    label: 'Kurzinfo / Rückfrage',
    shortLabel: 'Kurzinfo',
    defaultBody:
      '{{anrede}}\n\nich melde mich kurz bezüglich Ihrer Garten- und Grünraumpflege{{termin_ort_zusatz}}. Wann passt es Ihnen zeitlich für eine kurze Abstimmung?\n\nHerzliche Grüße\nHafner Michael – Grünraum Handwerk'
  }
] as const;

function buildCustomerSalutation(customerName?: string | null): string {
  const clean = (customerName || '').trim();
  if (!clean) return 'Guten Tag,';
  return `Guten Tag ${clean},`;
}

function loadCustomWhatsAppTemplates(): Partial<Record<WhatsAppTemplateId, string>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function getWhatsAppTemplateRawBody(id: WhatsAppTemplateId): string {
  const custom = loadCustomWhatsAppTemplates()[id];
  if (typeof custom === 'string' && custom.trim()) {
    return custom;
  }
  const found = WHATSAPP_TEMPLATES.find((t) => t.id === id);
  return found ? found.defaultBody : WHATSAPP_TEMPLATES[0].defaultBody;
}

export interface WhatsAppPersonalizationContext {
  customer?: Customer | null;
  customerName?: string | null;
  invoice?: Invoice | null;
  invoiceNumber?: string | null;
  totalAmount?: number | null;
  openAmount?: number | null;
  issueDate?: string | null;
  dueDate?: string | null;
  servicePeriod?: string | null;
  paymentTermsText?: string | null;
  appointment?: Appointment | null;
  property?: CustomerProperty | null;
}

export function personalizeWhatsAppTemplate(
  templateId: WhatsAppTemplateId,
  ctx: WhatsAppPersonalizationContext,
  customRawTemplate?: string
): string {
  const raw =
    typeof customRawTemplate === 'string' && customRawTemplate.trim()
      ? customRawTemplate
      : getWhatsAppTemplateRawBody(templateId);

  const name = (
    ctx.customerName ||
    ctx.customer?.name ||
    ctx.invoice?.billing_customer_name ||
    ''
  ).trim();
  const anrede = buildCustomerSalutation(name);

  const invNum = (ctx.invoiceNumber || ctx.invoice?.invoice_number || 'RE-2026').trim();
  const totalAmt =
    typeof ctx.totalAmount === 'number'
      ? ctx.totalAmount
      : typeof ctx.invoice?.total_amount === 'number'
        ? ctx.invoice.total_amount
        : 0;
  const paidAmt = (ctx.invoice?.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
  const openAmt =
    typeof ctx.openAmount === 'number'
      ? ctx.openAmount
      : Math.max(0, totalAmt - paidAmt) || totalAmt;

  const issueDateStr = formatDateDE(ctx.issueDate || ctx.invoice?.issue_date || '');
  const dueDateStr = formatDateDE(ctx.dueDate || ctx.invoice?.due_date || '');
  const servicePeriod = (ctx.servicePeriod || ctx.invoice?.service_period || '').trim();
  const servicePeriodAddon = servicePeriod ? ` (Leistungszeitraum: ${servicePeriod})` : '';
  const paymentTerms = (
    ctx.paymentTermsText ||
    ctx.invoice?.payment_terms_text ||
    (dueDateStr !== '—' ? `Zahlbar bis ${dueDateStr} ohne Abzug.` : 'Zahlbar innerhalb von 14 Tagen.')
  ).trim();

  const appDateStr = ctx.appointment?.date ? formatDateDE(ctx.appointment.date) : 'vereinbarten Tag';
  const appTimeStr = (ctx.appointment?.start_time || '').trim();
  const appTimeAddon = appTimeStr ? ` um ${appTimeStr} Uhr` : '';
  const appTitle = (ctx.appointment?.title || 'Garten- und Grünraumpflege').trim();

  const propLabel = (
    ctx.property?.address
      ? ctx.property.address
      : ctx.customer?.street
        ? `${ctx.customer.street}${ctx.customer.city ? `, ${ctx.customer.city}` : ''}`
        : ''
  ).trim();
  const ortAddon = propLabel ? ` (${propLabel})` : '';

  return raw
    .replace(/\{\{anrede\}\}/g, anrede)
    .replace(/\{\{kunde\}\}/g, name || 'Kunde')
    .replace(/\{\{rechnungsnummer\}\}/g, invNum)
    .replace(/\{\{betrag\}\}/g, formatEuro(totalAmt))
    .replace(/\{\{offener_betrag\}\}/g, formatEuro(openAmt))
    .replace(/\{\{rechnungsdatum\}\}/g, issueDateStr)
    .replace(/\{\{faelligkeitsdatum\}\}/g, dueDateStr)
    .replace(/\{\{leistungszeitraum\}\}/g, servicePeriod)
    .replace(/\{\{leistungszeitraum_zusatz\}\}/g, servicePeriodAddon)
    .replace(/\{\{zahlungsziel\}\}/g, paymentTerms)
    .replace(/\{\{termin_datum\}\}/g, appDateStr)
    .replace(/\{\{termin_uhrzeit\}\}/g, appTimeStr || 'nach Vereinbarung')
    .replace(/\{\{termin_uhrzeit_zusatz\}\}/g, appTimeAddon)
    .replace(/\{\{termin_leistung\}\}/g, appTitle)
    .replace(/\{\{termin_ort_zusatz\}\}/g, ortAddon);
}
