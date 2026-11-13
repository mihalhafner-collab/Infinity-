import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import {
  computeNextCustomerNumber,
  resolveCustomerNumber
} from '../../utils/invoicePdf.ts';
import {
  X,
  User,
  Phone,
  Mail,
  MapPin,
  FileCheck,
  Receipt,
  Trash2,
  Hash,
  Minus,
  Plus
} from 'lucide-react';

export const KundeModal: React.FC = () => {
  const {
    activeModal,
    setActiveModal,
    customers,
    selectedCustomerId,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    setSelectedCustomerId
  } = useApp();

  const isCreating = activeModal === 'KUNDE_ANLEGEN';
  const isEditing = activeModal === 'KUNDE_BEARBEITEN';
  const existingCustomer = isEditing
    ? customers.find((c) => c.id === selectedCustomerId)
    : null;

  const [customerNumber, setCustomerNumber] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [street, setStreet] = useState('');
  const [zip, setZip] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');
  const [electronicConsent, setElectronicConsent] = useState(false);
  const [hasDivergentBilling, setHasDivergentBilling] = useState(false);
  const [billingCustomerId, setBillingCustomerId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selectableBillingCustomers = customers.filter(
    (c) => !isEditing || c.id !== existingCustomer?.id
  );

  useEffect(() => {
    setConfirmDelete(false);
    if (isEditing && existingCustomer) {
      setCustomerNumber(
        existingCustomer.customer_number?.trim() ||
          resolveCustomerNumber(existingCustomer.id, customers)
      );
      setName(existingCustomer.name || '');
      setCompany(existingCustomer.company || '');
      setPhone(existingCustomer.phone || '');
      setEmail(existingCustomer.email || '');
      setStreet(existingCustomer.street || '');
      setZip(existingCustomer.zip || '');
      setCity(existingCustomer.city || '');
      setNotes(existingCustomer.notes || '');
      setElectronicConsent(!!existingCustomer.electronic_invoice_consent);
      const isDiv =
        existingCustomer.billing_mode === 'divergent_recipient' &&
        !!existingCustomer.default_billing_customer_id;
      setHasDivergentBilling(isDiv);
      setBillingCustomerId(existingCustomer.default_billing_customer_id || '');
    } else if (isCreating) {
      setCustomerNumber(computeNextCustomerNumber(customers));
      setName('');
      setCompany('');
      setPhone('');
      setEmail('');
      setStreet('');
      setZip('');
      setCity('');
      setNotes('');
      setElectronicConsent(false);
      setHasDivergentBilling(false);
      setBillingCustomerId('');
    }
  }, [activeModal, selectedCustomerId, isCreating, isEditing, existingCustomer, customers]);

  if (!isCreating && !isEditing) return null;

  const effectiveBillingId =
    hasDivergentBilling && billingCustomerId ? billingCustomerId : null;

  const stepCustomerNum = (delta: number) => {
    const trimmed = customerNumber.trim();
    const match = trimmed.match(/^(.*?)(\d+)$/);
    if (match) {
      const prefix = match[1];
      const nextVal = Math.max(1, parseInt(match[2], 10) + delta);
      setCustomerNumber(`${prefix}${nextVal}`);
    } else {
      const fallback = parseInt(computeNextCustomerNumber(customers), 10) || 1001;
      setCustomerNumber(String(Math.max(1, fallback + delta)));
    }
  };

  const handleSave = () => {
    if (!name.trim()) return;
    if (hasDivergentBilling && selectableBillingCustomers.length > 0 && !billingCustomerId) {
      return;
    }
    const payload = {
      customer_number:
        customerNumber.trim() ||
        (existingCustomer
          ? resolveCustomerNumber(existingCustomer.id, customers)
          : computeNextCustomerNumber(customers)),
      name: name.trim(),
      company: company.trim() || 'Privatkunde',
      phone: phone.trim(),
      email: email.trim(),
      street: street.trim(),
      zip: zip.trim(),
      city: city.trim(),
      notes: notes.trim(),
      electronic_invoice_consent: electronicConsent,
      billing_mode: (effectiveBillingId ? 'divergent_recipient' : 'standard') as
        | 'standard'
        | 'divergent_recipient',
      default_billing_customer_id: effectiveBillingId
    };

    if (isEditing && existingCustomer) {
      updateCustomer(existingCustomer.id, payload);
    } else {
      const newCust = addCustomer(payload);
      setSelectedCustomerId(newCust.id);
    }
    setActiveModal(null);
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
      <div className="flex-1" onClick={() => setActiveModal(null)} />

      <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[90%] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900 leading-tight">
              {isEditing ? 'Stammdaten bearbeiten' : 'Neuen Kunden anlegen'}
            </h2>
            <p className="text-[11px] text-slate-500">
              Stammdaten, Kundennummer & Kontakt
            </p>
          </div>
          <button
            onClick={() => setActiveModal(null)}
            className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-full hover:bg-slate-100 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3.5 text-xs text-slate-700">
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-8">
              <label className="font-semibold text-slate-700 block mb-1 flex items-center gap-1">
                <User size={13} className="text-slate-500" />
                <span>Name / Bezeichnung *</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. Max Mustermann"
                className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm text-slate-900 font-medium"
              />
            </div>

            <div className="col-span-4">
              <label className="font-semibold text-slate-700 block mb-1 flex items-center gap-1">
                <Hash size={12} className="text-[#3138A0]" />
                <span>Kunden-Nr.</span>
              </label>
              <div className="flex items-center h-11 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden focus-within:bg-white focus-within:border-[#3138A0]">
                <button
                  type="button"
                  onClick={() => stepCustomerNum(-1)}
                  aria-label="Kundennummer verringern"
                  className="w-7 h-full flex items-center justify-center text-slate-600 hover:bg-slate-200/70 active:bg-slate-200 shrink-0 border-r border-slate-200/80"
                >
                  <Minus size={13} />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={customerNumber}
                  onChange={(e) => setCustomerNumber(e.target.value)}
                  placeholder="1001"
                  className="min-w-0 flex-1 h-full px-1 bg-transparent text-center font-bold text-xs text-slate-900 outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => stepCustomerNum(1)}
                  aria-label="Kundennummer erhöhen"
                  className="w-7 h-full flex items-center justify-center text-[#3138A0] hover:bg-indigo-50 active:bg-indigo-100 shrink-0 border-l border-slate-200/80"
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Kategorie / Firma
              </label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Privatkunde"
                className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1 flex items-center gap-1">
                <Phone size={13} className="text-slate-500" />
                <span>Telefon</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0664 ..."
                className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1 flex items-center gap-1">
              <Mail size={13} className="text-slate-500" />
              <span>E-Mail</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="kunde@beispiel.at"
              className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
            />
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1 flex items-center gap-1">
              <MapPin size={13} className="text-slate-500" />
              <span>Straße & Hausnummer</span>
            </label>
            <input
              type="text"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              placeholder="Gartenstraße 1"
              className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">PLZ</label>
              <input
                type="text"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="9560"
                className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
              />
            </div>
            <div className="col-span-2">
              <label className="font-semibold text-slate-700 block mb-1">Ort</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Feldkirchen"
                className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
              />
            </div>
          </div>

          {/* Abweichender Rechnungsempfänger (Sub-Auftrag) */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Receipt size={16} className="text-[#3138A0] shrink-0" />
                <div className="min-w-0">
                  <span className="font-semibold text-slate-800 block text-xs">
                    Anderer Rechnungsempfänger (Sub)
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    Arbeiten am Objekt erfassen, Abrechnung über Auftraggeber-Kunden
                  </span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={hasDivergentBilling}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setHasDivergentBilling(checked);
                  if (checked && !billingCustomerId && selectableBillingCustomers.length > 0) {
                    setBillingCustomerId(selectableBillingCustomers[0].id);
                  }
                }}
                className="w-5 h-5 accent-[#3138A0] rounded-sm cursor-pointer shrink-0"
              />
            </div>

            {hasDivergentBilling && (
              <div className="pt-2 border-t border-slate-200/80">
                {selectableBillingCustomers.length === 0 ? (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    Noch kein weiterer Kunde vorhanden. Bitte zuerst den Auftraggeber als Kunden anlegen.
                  </p>
                ) : (
                  <div>
                    <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                      Abrechnung über Kunde auswählen *
                    </label>
                    <select
                      value={billingCustomerId}
                      onChange={(e) => setBillingCustomerId(e.target.value)}
                      className="w-full h-10 px-2.5 bg-white border border-[#3138A0]/50 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-semibold text-slate-900"
                    >
                      {selectableBillingCustomers.map((bc) => (
                        <option key={bc.id} value={bc.id}>
                          {bc.name} {bc.city ? `(${bc.city})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* E-Rechnung Zustimmung */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCheck size={16} className="text-[#3138A0]" />
              <div>
                <span className="font-semibold text-slate-800 block text-xs">E-Rechnung Zustimmung</span>
                <span className="text-[10px] text-slate-500">Zustimmung zum digitalen Rechnungsversand</span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={electronicConsent}
              onChange={(e) => setElectronicConsent(e.target.checked)}
              className="w-5 h-5 accent-[#3138A0] rounded-sm cursor-pointer"
            />
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Besonderheiten / Notizen
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="z.B. Zufahrt, Schlüssel hinterlegt, Hunde..."
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 resize-none"
            />
          </div>

          {isEditing && existingCustomer && (
            <div className="pt-2 border-t border-slate-100">
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="w-full h-10 rounded-xl border border-red-200 bg-red-50/60 hover:bg-red-50 text-[#B42318] font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Trash2 size={14} />
                  <span>Kunde löschen</span>
                </button>
              ) : (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#B42318]">
                    Kunde wirklich löschen?
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600"
                    >
                      Nein
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        deleteCustomer(existingCustomer.id);
                        setActiveModal(null);
                      }}
                      className="px-2.5 py-1.5 bg-[#B42318] text-white rounded-lg text-xs font-semibold"
                    >
                      Ja, löschen
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
          <button
            onClick={() => setActiveModal(null)}
            className="flex-1 h-12 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-semibold rounded-xl text-sm transition-all"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={
              !name.trim() ||
              (hasDivergentBilling && selectableBillingCustomers.length > 0 && !billingCustomerId)
            }
            className="flex-1 h-12 bg-[#3138A0] hover:bg-[#272d82] disabled:opacity-50 active:scale-98 text-white font-semibold rounded-xl text-sm transition-all shadow-xs"
          >
            {isEditing ? 'Änderungen speichern' : 'Kunde speichern'}
          </button>
        </div>
      </div>
    </div>
  );
};
