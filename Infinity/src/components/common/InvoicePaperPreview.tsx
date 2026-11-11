import React from 'react';
import {
  HAFNER_LOGO_URL,
  ISSUER_BANK_NAME,
  ISSUER_BIC,
  ISSUER_CITY,
  ISSUER_CONTACT_PERSON,
  ISSUER_COUNTRY,
  ISSUER_COURT,
  ISSUER_EMAIL,
  ISSUER_IBAN,
  ISSUER_NAME,
  ISSUER_PHONE,
  ISSUER_RETURN_LINE,
  ISSUER_STREET,
  ISSUER_TAX_NR,
  PAYMENT_TERMS_CLAUSE,
  ResolvedInvoiceData,
  TAX_EXEMPTION_CLAUSE,
  formatEuro
} from '../../utils/invoicePdf.ts';

interface InvoicePaperPreviewProps {
  data: ResolvedInvoiceData;
  isDraft?: boolean;
}

export const InvoicePaperPreview: React.FC<InvoicePaperPreviewProps> = ({
  data,
  isDraft = false
}) => {
  const cityLine = [data.recipientZip.trim(), data.recipientCity.trim()].filter(Boolean).join(' ');
  const displayInvNo = data.invoiceNumber?.trim() || (isDraft ? 'RE-Entwurf' : '');

  return (
    <div className="relative bg-white text-neutral-900 border border-neutral-300 rounded-lg shadow-xs px-4 pt-3 pb-4 font-sans text-[10px] leading-snug select-text overflow-hidden">
      {/* Dezente DIN-Falzmarken am linken Blattrand */}
      <span className="absolute left-0 top-[36%] w-1.5 h-[1.5px] bg-neutral-700" />
      <span className="absolute left-0 top-[51%] w-2.5 h-[2px] bg-neutral-800" />
      <span className="absolute left-0 top-[72%] w-1.5 h-[1.5px] bg-neutral-700" />

      {/* Oberer Bereich: Logo rechts oben */}
      <div className="flex justify-end">
        <img
          src={HAFNER_LOGO_URL}
          alt="Hafner Grünraum Handwerk"
          className="w-24 h-24 object-contain"
        />
      </div>

      {/* Adressfenster links + Rechnungs-Metadaten rechts */}
      <div className="grid grid-cols-12 gap-3 mt-1 items-start">
        <div className="col-span-6 min-w-0">
          <p className="text-[7px] text-neutral-600 leading-tight mb-2 break-words">
            {ISSUER_RETURN_LINE}
          </p>
          <div className="space-y-0.5 text-[10px] text-neutral-950">
            <p className="font-medium">{data.recipientName}</p>
            {data.recipientStreet.trim() && <p>{data.recipientStreet}</p>}
            {cityLine && <p>{cityLine}</p>}
            {(data.recipientStreet.trim() || cityLine) && <p>{data.recipientCountry}</p>}
          </div>
        </div>

        <div className="col-span-6 text-[8.5px] space-y-0.5 pt-1">
          <div className="flex items-baseline justify-between gap-1 text-[11px] text-neutral-950 pb-0.5">
            <span>Rechnungs-Nr.</span>
            <span className="font-medium text-right">{displayInvNo}</span>
          </div>
          <div className="flex justify-between gap-1 text-neutral-700">
            <span>Rechnungsdatum</span>
            <span className="text-right">{data.issueDateFormatted}</span>
          </div>
          <div className="flex justify-between gap-1 text-neutral-700">
            <span>Leistungszeitraum</span>
            <span className="text-right">{data.servicePeriod}</span>
          </div>
          <div className="flex justify-between gap-1 text-neutral-700 pt-1.5">
            <span>Ihre Kundennummer</span>
            <span className="text-right">{data.customerNumber}</span>
          </div>
          <div className="flex justify-between gap-1 text-neutral-700">
            <span>Ihr Ansprechpartner</span>
            <span className="text-right">{data.contactPerson}</span>
          </div>
        </div>
      </div>

      {/* Betreffzeile */}
      <div className="mt-5">
        <h3 className="text-xs font-bold text-neutral-950">
          {data.isStorno
            ? `Stornorechnung Nr. ${displayInvNo}`
            : `Rechnungs Nr. ${displayInvNo}`}
        </h3>
      </div>

      {/* Einleitungstext */}
      <div className="mt-2.5 space-y-1.5 text-[9.5px] text-neutral-900">
        <p>Sehr geehrte Damen und Herren,</p>
        {data.isStorno ? (
          <p>
            hiermit stornieren wir die betreffende Abrechnung ({data.stornoReason || 'Korrektur'}):
          </p>
        ) : (
          <p>
            vielen Dank für Ihren Auftrag und das damit verbundene Vertrauen!
            <br />
            Hiermit stelle ich Ihnen die folgenden Leistungen in Rechnung:
          </p>
        )}
      </div>

      {/* Positionstabelle im Original-Design (hellgraue Balken, EUR) */}
      <div className="mt-3">
        <div className="grid grid-cols-12 bg-[#E6E8EB] py-1 px-1.5 font-bold text-[8.5px] text-neutral-950">
          <div className="col-span-1">Pos.</div>
          <div className="col-span-4">Beschreibung</div>
          <div className="col-span-2 text-right">Menge</div>
          <div className="col-span-2 text-right">Einzelpreis</div>
          <div className="col-span-3 text-right">Gesamtpreis</div>
        </div>

        <div className="divide-y divide-neutral-100">
          {data.lineItems.map((item, idx) => (
            <div
              key={item.id}
              className="grid grid-cols-12 py-1.5 px-1.5 text-[9px] text-neutral-900 items-start"
            >
              <div className="col-span-1">{idx + 1}.</div>
              <div className="col-span-4 font-bold pr-1 break-words">{item.description}</div>
              <div className="col-span-2 text-right">{item.quantity_label}</div>
              <div className="col-span-2 text-right">{item.unit_price_label}</div>
              <div className="col-span-3 text-right">{formatEuro(item.amount)}</div>
            </div>
          ))}
        </div>

        {/* Summenblock: Netto -> §6 UStG -> Brutto */}
        <div className="mt-1">
          <div className="grid grid-cols-12 bg-[#E6E8EB] py-1 px-1.5 text-[9px] text-neutral-900">
            <div className="col-span-1" />
            <div className="col-span-7">Gesamtbetrag netto</div>
            <div className="col-span-4 text-right">{formatEuro(data.totalAmount)}</div>
          </div>

          <div className="grid grid-cols-12 py-1 px-1.5 text-[8.5px] text-neutral-800">
            <div className="col-span-1" />
            <div className="col-span-11">{TAX_EXEMPTION_CLAUSE}</div>
          </div>

          <div className="grid grid-cols-12 bg-[#E6E8EB] py-1 px-1.5 font-bold text-[9.5px] text-neutral-950">
            <div className="col-span-1" />
            <div className="col-span-7">Gesamtbetrag brutto</div>
            <div className="col-span-4 text-right">{formatEuro(data.totalAmount)}</div>
          </div>
        </div>
      </div>

      {/* Zahlungsbedingungen & Gruß */}
      <div className="mt-3.5 space-y-2 text-[9px] text-neutral-900">
        {!data.isStorno &&
          (data.isPaidInCash ? (
            <p>
              {data.paymentTermsText ||
                'Zahlungsbedingungen: Rechnungsbetrag dankend bar erhalten.'}
            </p>
          ) : (
            <>
              <p>{data.paymentTermsText || PAYMENT_TERMS_CLAUSE}</p>
              <p>
                Bitte überweisen Sie den Rechnungsbetrag unter Angabe der Rechnungsnummer auf das
                unten angegebene Konto.
                <br />
                Der Rechnungsbetrag ist bis zum {data.dueDateFormatted} fällig.
              </p>
            </>
          ))}
        <p className="pt-1">
          Mit freundlichen Grüßen
          <br />
          {ISSUER_CONTACT_PERSON}
        </p>
      </div>

      {/* Seitenzahl & 4-spaltige Fußzeile */}
      <div className="mt-5">
        <div className="text-right text-[8px] text-neutral-600 mb-1.5">1/1</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-neutral-200 text-[7.5px] text-neutral-700 leading-tight">
          <div>
            <p>{ISSUER_NAME}</p>
            <p>{ISSUER_STREET}</p>
            <p>{ISSUER_CITY}</p>
            <p>{ISSUER_COUNTRY}</p>
          </div>
          <div>
            <p>Tel. {ISSUER_PHONE}</p>
            <p>E-Mail {ISSUER_EMAIL}</p>
          </div>
          <div>
            <p>{ISSUER_COURT}</p>
            <p>Steuer-Nr. {ISSUER_TAX_NR}</p>
            <p>Inhaber/-in {ISSUER_CONTACT_PERSON}</p>
          </div>
          <div>
            <p>{ISSUER_BANK_NAME}</p>
            <p className="break-all">IBAN {ISSUER_IBAN}</p>
            <p>BIC {ISSUER_BIC}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
