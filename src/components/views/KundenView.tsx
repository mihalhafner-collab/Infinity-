import React, { useState, useEffect, useRef } from 'react';
import { useApp, usePixelBackLayer } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { UndoToast } from '../common/UndoToast.tsx';
import { SwipeToDeleteRow } from '../common/SwipeToDeleteRow.tsx';
import {
  User,
  Phone,
  MapPin,
  Navigation,
  MessageCircle,
  ChevronRight,
  Home,
  MessageSquare,
  FileText,
  CheckSquare,
  Briefcase,
  Calendar,
  Search,
  Share2,
  Plus,
  Pencil,
  KeyRound,
  Ruler,
  Camera,
  ImagePlus,
  X,
  Copy,
  Receipt,
  Bookmark,
  Send,
  Clock,
  Trash2
} from 'lucide-react';
import { compressImageFile } from '../../utils/imageCompress.ts';
import {
  formatDateDE,
  getCustomerBillingRecipient,
  getEffectiveBillingCustomerId,
  getTodayLocalIso
} from '../../utils/invoicePdf.ts';

function buildMapsUrl(addressQuery: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressQuery)}`;
}

function buildMapsNavigationUrl(destinationQuery: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    destinationQuery
  )}&travelmode=driving`;
}

function formatWhatsAppNumber(phone: string): string {
  let cleaned = phone.trim().replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('00')) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith('0')) {
    cleaned = `43${cleaned.slice(1)}`;
  }
  return cleaned.replace(/\D/g, '');
}

function buildWhatsAppUrl(phone: string): string {
  return `https://wa.me/${formatWhatsAppNumber(phone)}`;
}

export const KundenView: React.FC = () => {
  const {
    customers,
    properties,
    workRecords,
    appointments,
    inquiries,
    offers,
    orders,
    invoices,
    selectedCustomerId,
    setSelectedCustomerId,
    customerTab: activeTab,
    setCustomerTab: setActiveTab,
    customerWorkViewOpen,
    setCustomerWorkViewOpen,
    customerTermineViewOpen,
    setCustomerTermineViewOpen,
    setSelectedPropertyId,
    setSelectedInvoiceId,
    setSelectedWorkRecordId,
    setSendingInvoiceId,
    setPrefilledWorkTitle,
    updateCustomer,
    deleteCustomer,
    addProperty,
    updateProperty,
    deleteProperty,
    deleteAppointment,
    deleteWorkRecordsBatch,
    deleteInvoice,
    setActiveModal,
    navigate,
    goBack,
    setIsSearchOpen,
    setIsPlusMenuOpen
  } = useApp();

  const [contactExpanded, setContactExpanded] = useState(true);
  const [confirmDeleteCustomer, setConfirmDeleteCustomer] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [showCombinedAmounts, setShowCombinedAmounts] = useState(false);
  const [workStatusFilter, setWorkStatusFilter] = useState<'all' | 'open' | 'billed'>('all');
  const [appointmentFilter, setAppointmentFilter] = useState<'all' | 'upcoming' | 'past'>('all');
  const contentScrollRef = useRef<HTMLDivElement>(null);

  usePixelBackLayer(confirmDeleteCustomer, () => setConfirmDeleteCustomer(false));
  usePixelBackLayer(Boolean(previewPhoto), () => setPreviewPhoto(null));

  useEffect(() => {
    setConfirmDeleteCustomer(false);
    setShowCombinedAmounts(false);
    setWorkStatusFilter('all');
    setAppointmentFilter('all');
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTop = 0;
    }
  }, [selectedCustomerId]);

  useEffect(() => {
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTop = 0;
    }
  }, [customerWorkViewOpen, customerTermineViewOpen]);

  // If a customer is selected, show Kundenakte
  const currentCustomer = customers.find((c) => c.id === selectedCustomerId);

  // Customer List View
  if (!currentCustomer) {
    return (
      <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
        <Header
          title="Kunden"
          subtitle={
            customers.length > 0
              ? `${customers.length} Kunden · Links wischen löscht`
              : '0 Kunden'
          }
        />

        <UndoToast />

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5 overscroll-contain">
          {customers.length === 0 ? (
            <div className="p-8 bg-white border border-slate-200 rounded-2xl text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-indigo-50 text-[#3138A0] flex items-center justify-center mx-auto">
                <User size={24} />
              </div>
              <h3 className="font-bold text-slate-900 text-sm">Noch keine Kunden angelegt</h3>
              <p className="text-xs text-slate-500 max-w-[240px] mx-auto">
                Legen Sie Ihren ersten Kunden über das + Menü unten an, um Objekte, Termine und Abrechnungen zu verwalten.
              </p>
            </div>
          ) : (
            customers.map((c) => {
              const customerProps = properties.filter((p) => p.customer_id === c.id);
              const divRecip = getCustomerBillingRecipient(c, customers);
              const custAddr = [
                c.street,
                [c.zip, c.city].filter(Boolean).join(' ')
              ]
                .filter((part) => part && part.trim().length > 0)
                .join(', ');
              const propAddr =
                customerProps.find((p) => p.address?.trim())?.address?.trim() || '';
              const exactAddress = propAddr || custAddr;
              const navTarget = exactAddress || c.name;
              const cleanPhone = (c.phone || '').replace(/\s+/g, '');
              const hasWhatsApp = Boolean(c.phone && formatWhatsAppNumber(c.phone).length > 0);

              return (
                <SwipeToDeleteRow
                  key={c.id}
                  onDelete={() => deleteCustomer(c.id)}
                  deleteLabel="Kunde löschen"
                  className="rounded-2xl"
                >
                  <div
                    onClick={() => {
                      setActiveTab('objekte');
                      setSelectedCustomerId(c.id);
                    }}
                    className="p-4 bg-white border border-slate-200 rounded-2xl shadow-2xs hover:border-[#3138A0] active:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between gap-2.5"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-11 h-11 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-[#3138A0] font-bold text-sm shrink-0">
                        {c.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-base font-bold text-slate-950 leading-snug truncate">
                            {c.name}
                          </h3>
                          {divRecip && (
                            <span className="text-xs font-semibold text-[#3138A0] truncate max-w-[140px]">
                              · Sub → {divRecip.name}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5 truncate">
                          {customerProps.length}{' '}
                          {customerProps.length === 1 ? 'Objekt' : 'Objekte'}
                          {exactAddress ? ` · ${exactAddress}` : ''}
                        </p>
                      </div>
                    </div>

                    {/* Direkte Kundenaktionen: Google Maps Navigation, Anruf, WhatsApp (44dp+ Daumenziele) */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <a
                        href={buildMapsNavigationUrl(navTarget)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="w-11 h-11 rounded-xl bg-indigo-50 hover:bg-indigo-100 active:scale-95 text-[#3138A0] flex items-center justify-center transition-all"
                        title={`Google Maps Navigation zu ${c.name}`}
                        aria-label={`Navigation zu ${c.name}`}
                      >
                        <Navigation size={19} />
                      </a>

                      {cleanPhone ? (
                        <a
                          href={`tel:${cleanPhone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="w-11 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-800 flex items-center justify-center transition-all"
                          title={`${c.name} anrufen`}
                          aria-label={`${c.name} anrufen`}
                        >
                          <Phone size={19} />
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCustomerId(c.id);
                            setActiveModal('KUNDE_BEARBEITEN');
                          }}
                          className="w-11 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-400 flex items-center justify-center transition-all"
                          title="Telefonnummer ergänzen"
                          aria-label="Telefonnummer ergänzen"
                        >
                          <Phone size={19} />
                        </button>
                      )}

                      {hasWhatsApp ? (
                        <a
                          href={buildWhatsAppUrl(c.phone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="w-11 h-11 rounded-xl bg-emerald-50 hover:bg-emerald-100 active:scale-95 text-[#128C7E] flex items-center justify-center transition-all"
                          title={`WhatsApp Nachricht an ${c.name}`}
                          aria-label={`WhatsApp an ${c.name}`}
                        >
                          <MessageCircle size={19} />
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCustomerId(c.id);
                            setActiveModal('KUNDE_BEARBEITEN');
                          }}
                          className="w-11 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-400 flex items-center justify-center transition-all"
                          title="Telefonnummer für WhatsApp ergänzen"
                          aria-label="Telefonnummer für WhatsApp ergänzen"
                        >
                          <MessageCircle size={19} />
                        </button>
                      )}
                    </div>
                  </div>
                </SwipeToDeleteRow>
              );
            })
          )}
        </div>

        {/* Untere Leiste fixiert (Pixel 10 Pro Daumenzone) */}
        <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-md">
          <BottomActionBar>
            <button
              type="button"
              onClick={() => setActiveModal('KUNDE_ANLEGEN')}
              className="h-11 px-4 bg-[#3138A0] hover:bg-[#272d82] active:scale-97 text-white text-sm font-bold rounded-2xl flex items-center justify-center gap-1.5 shadow-xs transition-all whitespace-nowrap"
            >
              <Plus size={18} strokeWidth={2.5} />
              <span>Kunde anlegen</span>
            </button>
          </BottomActionBar>
          <BottomNav />
        </div>
      </div>
    );
  }

  // Kundenakte Detail View (ILL-003, WF-007, WF-008, WF-009)
  const customerProps = properties.filter((p) => p.customer_id === currentCustomer.id);
  const customerPropIds = new Set(customerProps.map((p) => p.id));
  const customerInquiries = inquiries.filter((i) => i.customer_id === currentCustomer.id);
  const customerOffers = offers.filter((o) => o.customer_id === currentCustomer.id);
  const customerOrders = orders.filter((o) => o.customer_id === currentCustomer.id);

  const todayIso = getTodayLocalIso();
  const customerAppointmentsAll = appointments.filter(
    (a) =>
      a.customer_id === currentCustomer.id ||
      (a.property_id ? customerPropIds.has(a.property_id) : false)
  );
  const upcomingCustomerAppointments = customerAppointmentsAll
    .filter((a) => a.date >= todayIso)
    .sort((a, b) => {
      const dCmp = a.date.localeCompare(b.date);
      if (dCmp !== 0) return dCmp;
      return (a.start_time || '99:99').localeCompare(b.start_time || '99:99');
    });
  const pastCustomerAppointments = customerAppointmentsAll
    .filter((a) => a.date < todayIso)
    .sort((a, b) => {
      const dCmp = b.date.localeCompare(a.date);
      if (dCmp !== 0) return dCmp;
      return (b.start_time || '').localeCompare(a.start_time || '');
    });
  const customerAppointments = [...upcomingCustomerAppointments, ...pastCustomerAppointments];
  const displayedCustomerAppointments =
    appointmentFilter === 'upcoming'
      ? upcomingCustomerAppointments
      : appointmentFilter === 'past'
        ? pastCustomerAppointments
        : customerAppointments;

  const customerWork = workRecords.filter((w) => w.customer_id === currentCustomer.id);
  const openWork = customerWork.filter((w) => !w.settlement_id && !w.is_lcr);
  const openHoursSum = Math.round(openWork.reduce((s, w) => s + w.hours, 0) * 100) / 100;
  const openAmountSum =
    Math.round(openWork.reduce((s, w) => s + (w.accounting_amount || 0), 0) * 100) / 100;

  // Erstellte L.C.R. für diesen Kunden erfassen
  const lcrWork = workRecords
    .filter(
      (w) =>
        w.is_lcr &&
        (w.customer_id === currentCustomer.id ||
          w.billing_customer_id === currentCustomer.id ||
          getEffectiveBillingCustomerId(w, customers) === currentCustomer.id)
    )
    .sort((a, b) => b.work_date.localeCompare(a.work_date));
  const lcrHoursSum = Math.round(lcrWork.reduce((s, w) => s + w.hours, 0) * 100) / 100;
  const lcrAmountSum =
    Math.round(lcrWork.reduce((s, w) => s + (w.accounting_amount || 0), 0) * 100) / 100;

  const divergentRecipient = getCustomerBillingRecipient(currentCustomer, customers);
  const otherCustomers = customers.filter((c) => c.id !== currentCustomer.id);
  const isDivergentActive =
    currentCustomer.billing_mode === 'divergent_recipient' && !!divergentRecipient;

  const customerWorkIds = new Set(customerWork.map((w) => w.id));
  const customerInvoices = invoices.filter(
    (i) =>
      i.customer_id === currentCustomer.id ||
      i.work_record_ids.some((wid) => customerWorkIds.has(wid))
  );
  const activeCustomerInvoices = customerInvoices.filter(
    (i) => !i.is_storno && i.status !== 'cancelled'
  );
  const invoicedAmountSum =
    Math.round(activeCustomerInvoices.reduce((s, i) => s + i.total_amount, 0) * 100) / 100;
  const sentCustomerInvoices = customerInvoices.filter((i) => Boolean(i.sent_at || i.sent_via));

  // Alle mit diesem Kundenkonto verknüpften Arbeitsaufzeichnungen (eigene Objekte, Sub-Kunden, Abrechnungszuordnung)
  const accountInvoiceWorkIds = new Set(
    invoices
      .filter((i) => i.customer_id === currentCustomer.id)
      .flatMap((i) => i.work_record_ids)
  );
  const accountLinkedWork = workRecords
    .filter(
      (w) =>
        w.customer_id === currentCustomer.id ||
        w.billing_customer_id === currentCustomer.id ||
        getEffectiveBillingCustomerId(w, customers) === currentCustomer.id ||
        accountInvoiceWorkIds.has(w.id)
    )
    .sort((a, b) => {
      const dateCmp = b.work_date.localeCompare(a.work_date);
      if (dateCmp !== 0) return dateCmp;
      return (b.start_time || '').localeCompare(a.start_time || '');
    });

  const linkedOpenWork = accountLinkedWork.filter((w) => !w.settlement_id && !w.is_lcr);
  const linkedBilledWork = accountLinkedWork.filter((w) => Boolean(w.settlement_id));
  const linkedTotalHours =
    Math.round(accountLinkedWork.reduce((s, w) => s + w.hours, 0) * 100) / 100;
  const linkedOpenHours =
    Math.round(linkedOpenWork.reduce((s, w) => s + w.hours, 0) * 100) / 100;
  const linkedOpenAmount =
    Math.round(linkedOpenWork.reduce((s, w) => s + (w.accounting_amount || 0), 0) * 100) / 100;
  const linkedTotalAmount =
    Math.round(accountLinkedWork.reduce((s, w) => s + (w.accounting_amount || 0), 0) * 100) / 100;

  const displayedLinkedWork =
    workStatusFilter === 'open'
      ? linkedOpenWork
      : workStatusFilter === 'billed'
        ? linkedBilledWork
        : accountLinkedWork;

  const handleToggleDivergentBilling = (enabled: boolean) => {
    if (enabled) {
      const targetId =
        currentCustomer.default_billing_customer_id &&
        otherCustomers.some((c) => c.id === currentCustomer.default_billing_customer_id)
          ? currentCustomer.default_billing_customer_id
          : (otherCustomers[0]?.id ?? null);
      updateCustomer(currentCustomer.id, {
        billing_mode: targetId ? 'divergent_recipient' : 'standard',
        default_billing_customer_id: targetId
      });
    } else {
      updateCustomer(currentCustomer.id, {
        billing_mode: 'standard',
        default_billing_customer_id: null
      });
    }
  };

  const handleChangeBillingCustomer = (targetId: string) => {
    updateCustomer(currentCustomer.id, {
      billing_mode: targetId ? 'divergent_recipient' : 'standard',
      default_billing_customer_id: targetId || null
    });
  };

  const customerFullAddress = [
    currentCustomer.street,
    [currentCustomer.zip, currentCustomer.city].filter(Boolean).join(' ')
  ]
    .filter((part) => part && part.trim().length > 0)
    .join(', ');

  const primaryMapAddress =
    customerProps.find((p) => p.address?.trim())?.address ||
    customerFullAddress ||
    currentCustomer.name;

  const handleQuickCreateFromCustomerAddress = () => {
    const created = addProperty({
      customer_id: currentCustomer.id,
      name: 'Hausgarten',
      property_type: 'Hausgarten',
      address: customerFullAddress
    });
    setSelectedPropertyId(created.id);
    setActiveModal('OBJEKT_BEARBEITEN');
  };

  const handleInlinePhotoUpload = async (
    propId: string,
    existingPhotos: string[],
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    try {
      const added: string[] = [];
      for (const file of files.slice(0, 4)) {
        const dataUrl = await compressImageFile(file);
        added.push(dataUrl);
      }
      updateProperty(propId, { photos: [...existingPhotos, ...added] });
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
      {/* Header with back button */}
      <Header
        title={currentCustomer.name}
        subtitle={`Kundenakte · ${
          activeTab === 'objekte'
            ? 'Objekte'
            : activeTab === 'vorgaenge'
              ? customerWorkViewOpen
                ? 'Vorgänge · Arbeiten'
                : customerTermineViewOpen
                  ? 'Vorgänge · Termine'
                  : 'Vorgänge'
              : 'Geld'
        }`}
        showBack
        onBack={goBack}
      />

      <UndoToast />

      {/* Content Area oben: nutzt vollen frei gewordenen Platz */}
      <div
        ref={contentScrollRef}
        className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3 overscroll-contain"
      >
        {/* TAB 1: OBJEKTE (WF-007, WF-028) */}
        {activeTab === 'objekte' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-0.5 text-[11px] text-slate-500">
              <span className="uppercase tracking-wider font-semibold">
                Kundenobjekte ({customerProps.length})
              </span>
              {customerProps.length > 0 && (
                <span className="text-[10px] text-slate-400">
                  Tippen bearbeitet · Links wischen löscht
                </span>
              )}
            </div>

            {customerProps.length === 0 ? (
              <div className="p-4 bg-white border border-dashed border-slate-300 rounded-2xl text-center space-y-2.5 shadow-2xs">
                <div className="w-11 h-11 rounded-full bg-indigo-50 text-[#3138A0] flex items-center justify-center mx-auto">
                  <Home size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Noch kein Objekt hinterlegt
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5 max-w-[270px] mx-auto">
                    Hinterlegen Sie Einsatzadresse, Fläche (m²), Torcode/Zugang, Gegebenheiten vor Ort und Objektfotos.
                  </p>
                </div>
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPropertyId(null);
                      setActiveModal('OBJEKT_ANLEGEN');
                    }}
                    className="w-full h-11 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-xs"
                  >
                    <Plus size={15} />
                    <span>Objekt mit Infos anlegen</span>
                  </button>
                  {customerFullAddress && (
                    <button
                      type="button"
                      onClick={handleQuickCreateFromCustomerAddress}
                      className="w-full h-10 bg-indigo-50 hover:bg-indigo-100 active:scale-98 text-[#3138A0] text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all"
                    >
                      <Copy size={13} />
                      <span className="truncate">
                        Aus Anschrift ({currentCustomer.street || currentCustomer.city}) erstellen
                      </span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              customerProps.map((prop) => {
                const propWorks = customerWork.filter((w) => w.property_id === prop.id);
                const propPhotos = prop.photos || [];
                const propFeatures = prop.features || [];
                const hasMetrics =
                  (prop.area_sqm !== null && prop.area_sqm !== undefined) ||
                  (prop.hedge_length_m !== null && prop.hedge_length_m !== undefined);

                return (
                  <SwipeToDeleteRow
                    key={prop.id}
                    onDelete={() => deleteProperty(prop.id)}
                    deleteLabel="Objekt löschen"
                  >
                    <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2.5">
                      {/* Top Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div
                          onClick={() => {
                            setSelectedPropertyId(prop.id);
                            setActiveModal('OBJEKT_BEARBEITEN');
                          }}
                          className="flex items-start gap-2.5 min-w-0 flex-1 cursor-pointer"
                        >
                          <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-[#3138A0] shrink-0 mt-0.5">
                            <Home size={17} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h4 className="text-sm font-bold text-slate-900 leading-tight truncate">
                                {prop.name}
                              </h4>
                              {prop.property_type && prop.property_type !== prop.name && (
                                <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-semibold rounded-md">
                                  {prop.property_type}
                                </span>
                              )}
                            </div>
                            {prop.address ? (
                              <a
                                href={buildMapsUrl(prop.address)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs text-slate-600 hover:text-[#3138A0] hover:underline flex items-center gap-1 mt-0.5"
                              >
                                <MapPin size={12} className="text-[#3138A0] shrink-0" />
                                <span className="truncate">{prop.address}</span>
                              </a>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic block mt-0.5">
                                Keine Einsatzadresse hinterlegt
                              </span>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPropertyId(prop.id);
                            setActiveModal('OBJEKT_BEARBEITEN');
                          }}
                          className="w-9 h-9 rounded-xl bg-slate-50 hover:bg-indigo-50 border border-slate-200 flex items-center justify-center text-[#3138A0] shrink-0 transition-colors"
                          title="Objektinfos bearbeiten"
                          aria-label="Objektinfos bearbeiten"
                        >
                          <Pencil size={15} />
                        </button>
                      </div>

                      {/* Maße & Einsätze */}
                      {(hasMetrics || propWorks.length > 0) && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {prop.area_sqm !== null && prop.area_sqm !== undefined && (
                            <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200/80 text-[#2C7738] text-[11px] font-bold rounded-lg flex items-center gap-1">
                              <Ruler size={11} />
                              <span>{prop.area_sqm} m² Grünfläche</span>
                            </span>
                          )}
                          {prop.hedge_length_m !== null && prop.hedge_length_m !== undefined && (
                            <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200/80 text-[#2C7738] text-[11px] font-bold rounded-lg flex items-center gap-1">
                              <Ruler size={11} />
                              <span>{prop.hedge_length_m} lfm Hecke</span>
                            </span>
                          )}
                          {propWorks.length > 0 && (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-lg flex items-center gap-1">
                              <Briefcase size={11} />
                              <span>
                                {propWorks.length}{' '}
                                {propWorks.length === 1 ? 'Arbeit' : 'Arbeiten'}
                              </span>
                            </span>
                          )}
                        </div>
                      )}

                      {/* Zugang / Schlüssel / Torcode */}
                      {prop.access_info && (
                        <div className="p-2 bg-amber-50/80 border border-amber-200/80 rounded-xl flex items-start gap-2 text-xs text-amber-900">
                          <KeyRound size={14} className="text-amber-600 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <span className="font-bold text-[10px] uppercase tracking-wide text-amber-700 block">
                              Zugang / Schlüssel
                            </span>
                            <span className="font-medium break-words">{prop.access_info}</span>
                          </div>
                        </div>
                      )}

                      {/* Gegebenheiten vor Ort Chips */}
                      {propFeatures.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {propFeatures.map((feat) => (
                            <span
                              key={feat}
                              className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-semibold rounded-md"
                            >
                              {feat}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Objektnotizen */}
                      {prop.notes && (
                        <div className="p-2 bg-slate-50 border border-slate-200/70 rounded-xl text-xs text-slate-700 leading-snug">
                          {prop.notes}
                        </div>
                      )}

                      {/* Fotos Leiste + Direkt-Kamera & Galerie-Upload */}
                      <div className="flex items-center gap-2 overflow-x-auto pt-0.5">
                        {propPhotos.map((src, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setPreviewPhoto(src)}
                            className="w-14 h-14 rounded-xl overflow-hidden border border-slate-200 shrink-0 bg-slate-100"
                          >
                            <img
                              src={src}
                              alt={`${prop.name} Foto ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ))}
                        <label
                          className="h-14 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 active:scale-95 border border-indigo-200 text-[#3138A0] text-[11px] font-bold flex flex-col items-center justify-center gap-0.5 shrink-0 cursor-pointer transition-all"
                          title="Mit Kamera öffnen"
                        >
                          <Camera size={16} />
                          <span>Kamera</span>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => handleInlinePhotoUpload(prop.id, propPhotos, e)}
                            className="hidden"
                          />
                        </label>
                        <label
                          className="h-14 px-3 rounded-xl border border-dashed border-slate-300 hover:border-[#3138A0] active:scale-95 bg-slate-50/70 hover:bg-indigo-50/40 text-slate-600 hover:text-[#3138A0] text-[11px] font-semibold flex flex-col items-center justify-center gap-0.5 shrink-0 cursor-pointer transition-all"
                          title="Foto aus Galerie wählen"
                        >
                          <ImagePlus size={16} />
                          <span>Galerie</span>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(e) => handleInlinePhotoUpload(prop.id, propPhotos, e)}
                            className="hidden"
                          />
                        </label>
                      </div>

                      {/* Quick Action Footer am Objekt */}
                      <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPropertyId(prop.id);
                            setActiveModal('OBJEKT_BEARBEITEN');
                          }}
                          className="flex-1 min-h-[38px] px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Pencil size={13} className="text-[#3138A0]" />
                          <span>Infos ergänzen</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPropertyId(prop.id);
                            setActiveModal('ARBEIT_NACHTRAGEN');
                          }}
                          className="flex-1 min-h-[38px] px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Plus size={14} />
                          <span>Arbeit hier</span>
                        </button>
                      </div>
                    </div>
                  </SwipeToDeleteRow>
                );
              })
            )}

            {/* Kontakt & Stammdaten Aufklappbar (ILL-003, WF-007) */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs mt-3">
              <div className="w-full min-h-[48px] px-3 py-2.5 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setContactExpanded(!contactExpanded)}
                  className="flex-1 flex items-center justify-between text-left min-w-0"
                >
                  <div>
                    <span className="text-xs font-bold text-slate-900 block leading-tight">
                      Kontakt & Stammdaten
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Telefon, E-Mail, Rechnungsanschrift
                    </span>
                  </div>
                  <ChevronRight
                    size={16}
                    className={`text-slate-400 transition-transform mr-1 ${
                      contactExpanded ? 'rotate-90' : ''
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModal('KUNDE_BEARBEITEN')}
                  className="h-9 px-2.5 rounded-xl bg-slate-100 hover:bg-indigo-50 text-[#3138A0] text-[11px] font-semibold flex items-center gap-1 shrink-0 transition-colors"
                  title="Stammdaten bearbeiten"
                >
                  <Pencil size={12} />
                  <span>Ändern</span>
                </button>
              </div>

              {contactExpanded && (
                <div className="p-3 bg-slate-50/70 border-t border-slate-100 text-xs space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">Telefon:</span>
                    {currentCustomer.phone ? (
                      <a
                        href={`tel:${currentCustomer.phone.replace(/\s+/g, '')}`}
                        className="font-bold text-[#3138A0] hover:underline"
                      >
                        {currentCustomer.phone}
                      </a>
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">E-Mail:</span>
                    {currentCustomer.email ? (
                      <a
                        href={`mailto:${currentCustomer.email}`}
                        className="font-semibold text-slate-800 hover:underline truncate"
                      >
                        {currentCustomer.email}
                      </a>
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500 shrink-0">Ort / Anschrift:</span>
                    <span className="font-medium text-slate-800 text-right">
                      {customerFullAddress || '–'}
                    </span>
                  </div>
                  {currentCustomer.notes && (
                    <div className="pt-1.5 border-t border-slate-200">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">
                        Kundennotiz:
                      </span>
                      <p className="text-[11px] text-slate-700 mt-0.5">{currentCustomer.notes}</p>
                    </div>
                  )}

                  {/* Aktivierbare Option: Abweichender Rechnungsempfänger (Sub-Auftrag) */}
                  <div className="pt-2.5 border-t border-slate-200/90 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Receipt size={14} className="text-[#3138A0] shrink-0" />
                        <div className="min-w-0">
                          <span className="font-bold text-slate-800 block text-xs leading-tight">
                            Anderer Rechnungsempfänger (Sub)
                          </span>
                          <span className="text-[10px] text-slate-500 block">
                            Arbeiten bleiben am Objekt · Abrechnung über gewählten Kunden
                          </span>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={isDivergentActive}
                        disabled={!isDivergentActive && otherCustomers.length === 0}
                        onChange={(e) => handleToggleDivergentBilling(e.target.checked)}
                        className="w-5 h-5 accent-[#3138A0] rounded-sm cursor-pointer disabled:opacity-40 shrink-0"
                      />
                    </div>

                    {otherCustomers.length === 0 && !isDivergentActive && (
                      <p className="text-[10px] text-slate-400 italic">
                        Für Sub-Abrechnung zuerst den Auftraggeber als Kunden anlegen.
                      </p>
                    )}

                    {isDivergentActive && (
                      <div className="p-2 bg-indigo-50/70 border border-indigo-200/80 rounded-xl space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-wide text-[#3138A0] block">
                          Abrechnung über Kunde:
                        </label>
                        <select
                          value={divergentRecipient?.id || ''}
                          onChange={(e) => handleChangeBillingCustomer(e.target.value)}
                          className="w-full h-10 px-2.5 bg-white border border-indigo-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-semibold text-slate-900"
                        >
                          {otherCustomers.map((oc) => (
                            <option key={oc.id} value={oc.id}>
                              {oc.name} {oc.city ? `(${oc.city})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Kundenakte löschen */}
                  <div className="pt-2.5 border-t border-slate-200/90">
                    {!confirmDeleteCustomer ? (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteCustomer(true)}
                        className="w-full h-9 rounded-xl border border-red-200 bg-red-50/60 hover:bg-red-50 text-[#B42318] font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Trash2 size={13} />
                        <span>Kunde löschen</span>
                      </button>
                    ) : (
                      <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#B42318]">
                          Kunde „{currentCustomer.name}“ löschen?
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteCustomer(false)}
                            className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600"
                          >
                            Nein
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteCustomer(currentCustomer.id)}
                            className="px-2.5 py-1.5 bg-[#B42318] text-white rounded-lg text-xs font-semibold"
                          >
                            Ja, löschen
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: VORGÄNGE (WF-008) */}
        {activeTab === 'vorgaenge' &&
          (customerWorkViewOpen ? (
            /* ÜBERSICHTLICHE ANSICHT ALLER MIT DEM KUNDENKONTO VERKNÜPFTEN ARBEITSAUFZEICHNUNGEN (NUR IN KUNDENAKTE) */
            <div className="space-y-3">
              {/* Kompakte Konto-Zusammenfassung oben */}
              <div className="grid grid-cols-3 gap-2">
                <div className="py-2 px-2.5 bg-white border border-slate-200 rounded-xl shadow-2xs text-center">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-tight block">
                    Verknüpft
                  </span>
                  <span className="text-sm font-bold text-slate-900 block mt-0.5 font-mono">
                    {accountLinkedWork.length} · {linkedTotalHours} Std.
                  </span>
                </div>

                <div className="py-2 px-2.5 bg-white border border-slate-200 rounded-xl shadow-2xs text-center">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-tight block">
                    Offen
                  </span>
                  <span className="text-sm font-bold text-[#B4470B] block mt-0.5 font-mono">
                    {linkedOpenAmount.toFixed(0)} €
                  </span>
                </div>

                <div className="py-2 px-2.5 bg-white border border-slate-200 rounded-xl shadow-2xs text-center">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-tight block">
                    Gesamtwert
                  </span>
                  <span className="text-sm font-bold text-[#3138A0] block mt-0.5 font-mono">
                    {linkedTotalAmount.toFixed(0)} €
                  </span>
                </div>
              </div>

              {displayedLinkedWork.length === 0 ? (
                <div className="p-6 bg-white border border-slate-200 rounded-2xl text-center space-y-2 shadow-2xs">
                  <div className="w-10 h-10 rounded-full bg-indigo-50 text-[#3138A0] flex items-center justify-center mx-auto">
                    <Briefcase size={18} />
                  </div>
                  <p className="text-xs font-bold text-slate-800">
                    {accountLinkedWork.length === 0
                      ? 'Noch keine Arbeitsaufzeichnungen mit diesem Konto verknüpft'
                      : 'Keine Einträge in diesem Filter'}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Über „+ Arbeit“ unten können Arbeitszeiten direkt erfasst werden.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {displayedLinkedWork.map((rec) => {
                    const isSubCustomer = rec.customer_id !== currentCustomer.id;
                    const subCust = isSubCustomer
                      ? customers.find((c) => c.id === rec.customer_id)
                      : null;
                    const effBillingId = getEffectiveBillingCustomerId(rec, customers);
                    const billedViaCust =
                      !isSubCustomer && effBillingId !== currentCustomer.id
                        ? customers.find((c) => c.id === effBillingId)
                        : null;
                    const prop = rec.property_id
                      ? properties.find((p) => p.id === rec.property_id)
                      : null;
                    const linkedInvoice = rec.settlement_id
                      ? invoices.find((inv) => inv.id === rec.settlement_id)
                      : null;
                    const isBilled = Boolean(rec.settlement_id);

                    const cardContent = (
                      <div
                        onClick={() => {
                          setSelectedWorkRecordId(rec.id);
                          setActiveModal('ARBEIT_BEARBEITEN');
                        }}
                        className="p-3 bg-white border border-slate-200 rounded-2xl shadow-2xs hover:border-[#3138A0] transition-colors cursor-pointer space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-[#3138A0] shrink-0 mt-0.5">
                              <Clock size={15} />
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-xs font-bold text-slate-900 leading-tight truncate">
                                {rec.title}
                              </h4>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                {formatDateDE(rec.work_date)}
                                {rec.start_time && rec.end_time
                                  ? ` · ${rec.start_time}–${rec.end_time}`
                                  : ''}
                                {' · '}
                                <span className="font-semibold text-slate-800">
                                  {rec.hours.toLocaleString('de-DE', {
                                    maximumFractionDigits: 2
                                  })}{' '}
                                  Std.
                                </span>
                              </p>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span
                              className={`text-xs font-bold block ${
                                rec.accounting_amount !== null
                                  ? 'text-slate-900'
                                  : 'text-[#B42318]'
                              }`}
                            >
                              {rec.accounting_amount !== null
                                ? `${rec.accounting_amount.toLocaleString('de-DE', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                  })} €`
                                : 'Satz offen'}
                            </span>

                            {isBilled ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  if (linkedInvoice) {
                                    e.stopPropagation();
                                    setSelectedInvoiceId(linkedInvoice.id);
                                    navigate('M04_ABRECHNUNG');
                                  }
                                }}
                                className="mt-0.5 px-1.5 py-0.5 bg-emerald-50 text-[#2C7738] text-[10px] font-bold rounded-md inline-block"
                              >
                                {linkedInvoice ? linkedInvoice.invoice_number : 'Abgerechnet'}
                              </button>
                            ) : rec.is_lcr ? (
                              <span className="mt-0.5 px-1.5 py-0.5 bg-indigo-50 text-[#3138A0] text-[10px] font-bold rounded-md inline-block">
                                L.C.R.
                              </span>
                            ) : (
                              <span className="mt-0.5 px-1.5 py-0.5 bg-orange-50 text-[#B4470B] text-[10px] font-bold rounded-md inline-block">
                                Offen
                              </span>
                            )}
                          </div>
                        </div>

                        {(subCust || billedViaCust || prop || rec.materials.length > 0 || rec.notes) && (
                          <div className="pt-1.5 border-t border-slate-100 space-y-1">
                            {(subCust || billedViaCust || prop || rec.materials.length > 0) && (
                              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                {subCust && (
                                  <span className="px-1.5 py-0.5 bg-indigo-50 text-[#3138A0] font-bold rounded-md">
                                    Sub: {subCust.name}
                                  </span>
                                )}
                                {billedViaCust && (
                                  <span className="px-1.5 py-0.5 bg-indigo-50 text-[#3138A0] font-bold rounded-md">
                                    Abrechnung → {billedViaCust.name}
                                  </span>
                                )}
                                {prop && (
                                  <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 font-semibold rounded-md flex items-center gap-1">
                                    <Home size={10} className="text-[#3138A0]" />
                                    <span>{prop.name}</span>
                                  </span>
                                )}
                                {rec.materials.length > 0 && (
                                  <span className="px-1.5 py-0.5 bg-amber-50 text-amber-800 font-semibold rounded-md">
                                    +{rec.materials.length} Material
                                  </span>
                                )}
                              </div>
                            )}
                            {rec.notes && (
                              <p className="text-[11px] text-slate-500 truncate">{rec.notes}</p>
                            )}
                          </div>
                        )}
                      </div>
                    );

                    return isBilled ? (
                      <div key={rec.id}>{cardContent}</div>
                    ) : (
                      <SwipeToDeleteRow
                        key={rec.id}
                        onDelete={() => deleteWorkRecordsBatch([rec.id])}
                        deleteLabel="Aufzeichnung löschen"
                      >
                        {cardContent}
                      </SwipeToDeleteRow>
                    );
                  })}
                </div>
              )}
            </div>
          ) : customerTermineViewOpen ? (
            /* ÜBERSICHTLICHE ANSICHT ALLER EINGETRAGENEN TERMINE DES KUNDEN (NUR IN KUNDENAKTE) */
            <div className="space-y-3">
              {/* Kompakte Termin-Zusammenfassung oben */}
              <div className="grid grid-cols-3 gap-2">
                <div className="py-2 px-2.5 bg-white border border-slate-200 rounded-xl shadow-2xs text-center">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-tight block">
                    Eingetragen
                  </span>
                  <span className="text-sm font-bold text-slate-900 block mt-0.5 font-mono">
                    {customerAppointments.length}
                  </span>
                </div>

                <div className="py-2 px-2.5 bg-white border border-slate-200 rounded-xl shadow-2xs text-center">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-tight block">
                    Anstehend
                  </span>
                  <span className="text-sm font-bold text-[#3138A0] block mt-0.5 font-mono">
                    {upcomingCustomerAppointments.length}
                  </span>
                </div>

                <div className="py-2 px-2.5 bg-white border border-slate-200 rounded-xl shadow-2xs text-center">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-tight block">
                    Vergangen
                  </span>
                  <span className="text-sm font-bold text-slate-600 block mt-0.5 font-mono">
                    {pastCustomerAppointments.length}
                  </span>
                </div>
              </div>

              {displayedCustomerAppointments.length === 0 ? (
                <div className="p-6 bg-white border border-slate-200 rounded-2xl text-center space-y-2 shadow-2xs">
                  <div className="w-10 h-10 rounded-full bg-indigo-50 text-[#3138A0] flex items-center justify-center mx-auto">
                    <Calendar size={18} />
                  </div>
                  <p className="text-xs font-bold text-slate-800">
                    {customerAppointments.length === 0
                      ? 'Noch keine Termine für diesen Kunden eingetragen'
                      : 'Keine Termine in diesem Filter'}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Über das + Menü unten können neue Termine direkt geplant werden.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {displayedCustomerAppointments.map((app) => {
                    const prop = app.property_id
                      ? properties.find((p) => p.id === app.property_id)
                      : null;
                    const resolvedAddress =
                      app.address?.trim() || prop?.address?.trim() || customerFullAddress;
                    const cleanNotes = (app.notes || '')
                      .replace(/\[gcal:[^\]]+\]/g, '')
                      .trim();
                    const isToday = app.date === todayIso;
                    const isPast = app.date < todayIso;

                    return (
                      <SwipeToDeleteRow
                        key={app.id}
                        onDelete={() => deleteAppointment(app.id)}
                        deleteLabel="Termin löschen"
                      >
                        <div className="p-3 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2.5 min-w-0">
                              <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-[#3138A0] shrink-0 mt-0.5">
                                <Calendar size={15} />
                              </div>
                              <div className="min-w-0">
                                <h4 className="text-xs font-bold text-slate-900 leading-tight truncate">
                                  {app.title || 'Termin'}
                                </h4>
                                <p className="text-[11px] text-slate-500 mt-0.5">
                                  <span className="font-semibold text-slate-800">
                                    {formatDateDE(app.date)}
                                  </span>
                                  {' · '}
                                  {app.start_time
                                    ? `${app.start_time}${app.end_time ? `–${app.end_time}` : ''}`
                                    : 'Ganztägig'}
                                  {app.duration_minutes ? ` (${app.duration_minutes} Min.)` : ''}
                                </p>
                              </div>
                            </div>

                            <div className="shrink-0">
                              {isToday ? (
                                <span className="px-2 py-0.5 bg-indigo-50 border border-indigo-100 text-[#3138A0] text-[10px] font-bold rounded-md">
                                  Heute
                                </span>
                              ) : isPast ? (
                                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-semibold rounded-md">
                                  Vergangen
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 bg-emerald-50 text-[#2C7738] text-[10px] font-bold rounded-md">
                                  Geplant
                                </span>
                              )}
                            </div>
                          </div>

                          {(prop || resolvedAddress || cleanNotes) && (
                            <div className="pt-1.5 border-t border-slate-100 space-y-1">
                              {(prop || resolvedAddress) && (
                                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                  {prop && (
                                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 font-semibold rounded-md flex items-center gap-1">
                                      <Home size={10} className="text-[#3138A0]" />
                                      <span>{prop.name}</span>
                                    </span>
                                  )}
                                  {resolvedAddress && (
                                    <a
                                      href={buildMapsUrl(resolvedAddress)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="px-1.5 py-0.5 bg-slate-50 hover:bg-indigo-50 text-slate-600 hover:text-[#3138A0] font-medium rounded-md flex items-center gap-1 max-w-full truncate transition-colors"
                                    >
                                      <MapPin size={10} className="text-[#3138A0] shrink-0" />
                                      <span className="truncate">{resolvedAddress}</span>
                                    </a>
                                  )}
                                </div>
                              )}
                              {cleanNotes && (
                                <p className="text-[11px] text-slate-500 bg-slate-50 px-2 py-1 rounded-lg">
                                  {cleanNotes}
                                </p>
                              )}
                            </div>
                          )}

                          <div className="pt-1 border-t border-slate-100 flex items-center justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPropertyId(
                                  app.property_id || customerProps[0]?.id || null
                                );
                                setPrefilledWorkTitle(app.title || 'Gartenarbeit');
                                setActiveModal('ARBEIT_NACHTRAGEN');
                              }}
                              className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] text-[11px] font-semibold flex items-center gap-1 transition-colors"
                            >
                              <Clock size={11} />
                              <span>Arbeit erfassen</span>
                            </button>
                          </div>
                        </div>
                      </SwipeToDeleteRow>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* Anfragen */}
              <div
                onClick={() => navigate('M05_ANFRAGEN')}
                className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between cursor-pointer hover:border-[#3138A0]"
              >
                <div className="flex items-center gap-2.5">
                  <MessageSquare size={16} className="text-[#3138A0]" />
                  <div>
                    <span className="font-bold text-xs text-slate-900 block">Anfragen</span>
                    <span className="text-[11px] text-slate-500">
                      {customerInquiries.length} vorhanden
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {customerInquiries.some((i) => i.status === 'neu') && (
                    <span className="px-1.5 py-0.5 bg-fuchsia-50 text-[#9A1B8D] text-[10px] font-bold rounded">
                      1 neu
                    </span>
                  )}
                  <ChevronRight size={16} className="text-slate-400" />
                </div>
              </div>

              {/* Angebote */}
              <div
                onClick={() => navigate('M06_ANGEBOTE')}
                className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between cursor-pointer hover:border-[#3138A0]"
              >
                <div className="flex items-center gap-2.5">
                  <FileText size={16} className="text-[#3138A0]" />
                  <div>
                    <span className="font-bold text-xs text-slate-900 block">Angebote</span>
                    <span className="text-[11px] text-slate-500">
                      {customerOffers.length} Angebote
                    </span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </div>

              {/* Aufträge */}
              <div
                onClick={() => navigate('M07_AUFTRAEGE')}
                className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between cursor-pointer hover:border-[#3138A0]"
              >
                <div className="flex items-center gap-2.5">
                  <CheckSquare size={16} className="text-[#3138A0]" />
                  <div>
                    <span className="font-bold text-xs text-slate-900 block">Aufträge</span>
                    <span className="text-[11px] text-slate-500">
                      {customerOrders.length} Aufträge
                    </span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </div>

              {/* Termine (öffnet die eingetragenen Termine direkt in der Kundenakte) */}
              <div
                onClick={() => {
                  setCustomerWorkViewOpen(false);
                  setCustomerTermineViewOpen(true);
                }}
                className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between cursor-pointer hover:border-[#3138A0]"
              >
                <div className="flex items-center gap-2.5">
                  <Calendar size={16} className="text-[#3138A0]" />
                  <div>
                    <span className="font-bold text-xs text-slate-900 block">Termine</span>
                    <span className="text-[11px] text-slate-500">
                      {customerAppointments.length === 0
                        ? '0 Termine'
                        : upcomingCustomerAppointments.length > 0
                          ? `${customerAppointments.length} eingetragen · ${upcomingCustomerAppointments.length} anstehend`
                          : `${customerAppointments.length} eingetragen`}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {upcomingCustomerAppointments.length > 0 && (
                    <span className="px-1.5 py-0.5 bg-indigo-50 text-[#3138A0] text-[10px] font-bold rounded">
                      {upcomingCustomerAppointments.length} geplant
                    </span>
                  )}
                  <ChevronRight size={16} className="text-slate-400" />
                </div>
              </div>

              {/* Arbeiten (öffnet die Konto-Arbeitsübersicht direkt in der Kundenakte) */}
              <div
                onClick={() => {
                  setCustomerTermineViewOpen(false);
                  setCustomerWorkViewOpen(true);
                }}
                className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between cursor-pointer hover:border-[#3138A0]"
              >
                <div className="flex items-center gap-2.5">
                  <Briefcase size={16} className="text-[#3138A0]" />
                  <div>
                    <span className="font-bold text-xs text-slate-900 block">Arbeiten</span>
                    <span className="text-[11px] text-slate-500">
                      {accountLinkedWork.length === 0
                        ? '0 Aufzeichnungen'
                        : linkedOpenWork.length > 0
                          ? `${accountLinkedWork.length} verknüpft · ${linkedOpenWork.length} offen (${linkedOpenHours} Std.)`
                          : `${accountLinkedWork.length} verknüpft (${linkedTotalHours} Std.)`}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {linkedOpenAmount > 0 ? (
                    <span className="text-xs font-bold text-[#B4470B] px-1.5 py-0.5 bg-orange-50 rounded">
                      {linkedOpenAmount.toFixed(0)} €
                    </span>
                  ) : linkedTotalAmount > 0 ? (
                    <span className="text-xs font-bold text-slate-600 px-1.5 py-0.5 bg-slate-100 rounded">
                      {linkedTotalAmount.toFixed(0)} €
                    </span>
                  ) : null}
                  <ChevronRight size={16} className="text-slate-400" />
                </div>
              </div>
            </div>
          ))}

        {/* TAB 3: GELD (WF-009) */}
        {activeTab === 'geld' && (
          <div className="space-y-3">
            {/* Offene Arbeiten Card */}
            <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Offene Arbeiten
              </span>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-lg font-bold text-slate-900 block">
                    {openHoursSum} Std.
                  </span>
                  <span className="text-xs text-slate-500">Nicht abgerechnet</span>
                </div>
                <span className="text-xl font-bold text-[#B4470B]">
                  {openAmountSum.toFixed(2)} €
                </span>
              </div>
              {openWork.length > 0 && (
                <button
                  onClick={() => setActiveModal('RECHNUNG_VORBEREITEN')}
                  className="w-full mt-1 py-2.5 bg-[#3138A0] hover:bg-[#272d82] text-white text-xs font-semibold rounded-xl transition-all shadow-xs"
                >
                  {divergentRecipient
                    ? `Jetzt über ${divergentRecipient.name} abrechnen`
                    : 'Diesen Betrag jetzt abrechnen'}
                </button>
              )}
            </div>

            {/* Erstellte L.C.R. einfach darstellen */}
            <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-[#3138A0] uppercase tracking-wider flex items-center gap-1">
                  <Bookmark size={12} />
                  <span>Erstellte L.C.R.</span>
                </span>
                <span className="text-xs text-slate-500">
                  {lcrWork.length} {lcrWork.length === 1 ? 'Eintrag' : 'Einträge'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-lg font-bold text-slate-900 block">
                    {lcrHoursSum} Std.
                  </span>
                  <span className="text-xs text-slate-500">Für Kunden erfasst</span>
                </div>
                <span className="text-xl font-bold text-[#3138A0]">
                  {lcrAmountSum.toFixed(2)} €
                </span>
              </div>

              {lcrWork.length > 0 && (
                <div className="space-y-1.5 pt-1 border-t border-slate-100">
                  {lcrWork.map((rec) => (
                    <div
                      key={rec.id}
                      onClick={() => {
                        setSelectedWorkRecordId(rec.id);
                        setActiveModal('ARBEIT_BEARBEITEN');
                      }}
                      className="p-2 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs cursor-pointer hover:border-[#3138A0] transition-colors"
                    >
                      <div className="min-w-0 pr-2">
                        <span className="font-bold text-slate-900 block truncate">
                          {rec.title}
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          {rec.work_date} · {rec.hours} Std.
                        </span>
                      </div>
                      <span className="font-bold text-[#3138A0] shrink-0">
                        {rec.accounting_amount !== null
                          ? `${rec.accounting_amount.toFixed(2)} €`
                          : 'Satz offen'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Option: Beide Beträge addiert darstellen */}
            <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2.5">
              <label className="flex items-center justify-between gap-2 cursor-pointer select-none">
                <span className="text-xs font-bold text-slate-800">
                  Beide Beträge addiert anzeigen
                </span>
                <input
                  type="checkbox"
                  checked={showCombinedAmounts}
                  onChange={(e) => setShowCombinedAmounts(e.target.checked)}
                  className="w-5 h-5 accent-[#3138A0] rounded-sm cursor-pointer shrink-0"
                />
              </label>

              {showCombinedAmounts && (
                <div className="pt-2 border-t border-slate-100 space-y-2 text-xs">
                  <div className="p-2.5 bg-indigo-50/60 border border-indigo-100 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-900 block">
                        Offene Arbeiten + L.C.R.
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {Math.round((openHoursSum + lcrHoursSum) * 100) / 100} Std. ({openAmountSum.toFixed(2)} € + {lcrAmountSum.toFixed(2)} €)
                      </span>
                    </div>
                    <span className="text-base font-bold text-[#3138A0]">
                      {(openAmountSum + lcrAmountSum).toFixed(2)} €
                    </span>
                  </div>

                  {invoicedAmountSum > 0 && (
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="font-bold text-slate-900 block">
                          Rechnungen + L.C.R.
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {invoicedAmountSum.toFixed(2)} € + {lcrAmountSum.toFixed(2)} €
                          {openAmountSum > 0 ? ` (+ ${openAmountSum.toFixed(2)} € offen)` : ''}
                        </span>
                      </div>
                      <span className="text-base font-bold text-slate-900">
                        {(invoicedAmountSum + openAmountSum + lcrAmountSum).toFixed(2)} €
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Rechnungszuordnung Card */}
            <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Rechnungszuordnung
                </span>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[#3138A0] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isDivergentActive}
                    disabled={!isDivergentActive && otherCustomers.length === 0}
                    onChange={(e) => handleToggleDivergentBilling(e.target.checked)}
                    className="w-4 h-4 accent-[#3138A0] rounded-sm cursor-pointer disabled:opacity-40"
                  />
                  <span>Anderer Empfänger (Sub)</span>
                </label>
              </div>

              {isDivergentActive ? (
                <div className="space-y-1.5">
                  <label className="text-[11px] text-slate-600 block">
                    Abrechnung erfolgt über Kunde:
                  </label>
                  <select
                    value={divergentRecipient?.id || ''}
                    onChange={(e) => handleChangeBillingCustomer(e.target.value)}
                    className="w-full h-10 px-2.5 bg-indigo-50/60 border border-indigo-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs font-bold text-[#3138A0]"
                  >
                    {otherCustomers.map((oc) => (
                      <option key={oc.id} value={oc.id}>
                        {oc.name} {oc.city ? `(${oc.city})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">Empfänger:</span>
                  <span className="font-semibold text-slate-900">{currentCustomer.name}</span>
                </div>
              )}

              <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                <span className="text-slate-600">E-Rechnung:</span>
                <span
                  className={`font-semibold ${
                    (divergentRecipient ?? currentCustomer).electronic_invoice_consent
                      ? 'text-[#2C7738]'
                      : 'text-amber-600'
                  }`}
                >
                  {(divergentRecipient ?? currentCustomer).electronic_invoice_consent
                    ? 'Zustimmung erteilt'
                    : 'Zustimmung nicht erfasst'}
                </span>
              </div>
            </div>

            {/* Bereits versendete Rechnungen für diesen Kunden */}
            <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Send size={12} className="text-[#3138A0]" />
                  <span>Versendete Rechnungen</span>
                </span>
                <span className="text-xs text-slate-500">
                  {sentCustomerInvoices.length} versendet
                </span>
              </div>

              {sentCustomerInvoices.length === 0 ? (
                <p className="text-xs text-slate-400 italic">
                  Noch keine Rechnungen für diesen Kunden versendet.
                </p>
              ) : (
                <div className="space-y-2">
                  {sentCustomerInvoices.map((inv) => (
                    <div
                      key={`sent-${inv.id}`}
                      onClick={() => {
                        setSelectedInvoiceId(inv.id);
                        navigate('M04_ABRECHNUNG');
                      }}
                      className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs cursor-pointer hover:border-[#3138A0] transition-colors"
                    >
                      <div className="min-w-0 pr-2">
                        <span className="font-bold text-slate-900 block truncate">
                          {inv.invoice_number}
                        </span>
                        <span className="text-[10px] text-[#2C7738] font-medium block truncate">
                          {inv.sent_at ? `Versendet am ${formatDateDE(inv.sent_at)}` : 'Versendet'}
                          {inv.sent_via ? ` · ${inv.sent_via}` : ''}
                        </span>
                      </div>

                      <div className="text-right flex items-center gap-2 shrink-0">
                        <div>
                          <span className="font-bold text-slate-900 block">
                            {inv.total_amount.toFixed(2)} €
                          </span>
                          <span
                            className={`text-[10px] font-semibold ${
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
                                  : 'Zahlung offen'}
                          </span>
                        </div>
                        <ChevronRight size={14} className="text-slate-400" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Rechnungen & Abschlüsse Liste */}
            <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Abschlüsse & Zahlungen
                  </span>
                  {customerInvoices.length > 0 && (
                    <span className="text-[10px] text-slate-400">
                      Tippen zum Bearbeiten · Nach links wischen löscht
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-500">{customerInvoices.length} Belege</span>
              </div>

              {customerInvoices.length === 0 ? (
                <p className="text-xs text-slate-400 italic">Noch keine Rechnungen ausgestellt.</p>
              ) : (
                <div className="space-y-2">
                  {customerInvoices.map((inv) => (
                    <SwipeToDeleteRow
                      key={inv.id}
                      onDelete={() => deleteInvoice(inv.id)}
                      deleteLabel="Beleg löschen"
                    >
                      <div
                        onClick={() => {
                          setSelectedInvoiceId(inv.id);
                          navigate('M04_ABRECHNUNG');
                        }}
                        className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs cursor-pointer hover:border-[#3138A0] transition-colors"
                      >
                        <div className="min-w-0 pr-2">
                          <span className="font-bold text-slate-900 block truncate">
                            {inv.invoice_number}
                          </span>
                          <span className="text-[10px] text-slate-500 block truncate">
                            {inv.issue_date}
                            {inv.customer_id !== currentCustomer.id
                              ? ` · über ${inv.billing_customer_name}`
                              : ''}
                          </span>
                        </div>
                        <div className="text-right flex items-center gap-2">
                          <div>
                            <span
                              className={`font-bold block ${
                                inv.is_storno ? 'text-[#B42318]' : 'text-slate-900'
                              }`}
                            >
                              {inv.total_amount.toFixed(2)} €
                            </span>
                            <span
                              className={`text-[10px] font-semibold ${
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
                                    : 'Zahlung offen'}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSendingInvoiceId(inv.id);
                            }}
                            className="w-8 h-8 rounded-xl bg-white border border-slate-200 hover:bg-indigo-50 flex items-center justify-center text-[#3138A0] transition-colors shrink-0"
                            title="Rechnung versenden"
                            aria-label="Rechnung versenden"
                          >
                            <Share2 size={14} />
                          </button>
                          <ChevronRight size={14} className="text-slate-400" />
                        </div>
                      </div>
                    </SwipeToDeleteRow>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Fullscreen Photo Preview inside PixelFrame */}
      {previewPhoto && (
        <div
          onClick={() => setPreviewPhoto(null)}
          className="absolute inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4 animate-fade-in"
        >
          <button
            type="button"
            onClick={() => setPreviewPhoto(null)}
            className="absolute top-12 right-4 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center hover:bg-white/25 transition-colors"
            aria-label="Vorschau schließen"
          >
            <X size={20} />
          </button>
          <img
            src={previewPhoto}
            alt="Objektfoto Vorschau"
            className="max-w-full max-h-[80%] rounded-2xl object-contain shadow-2xl"
          />
        </div>
      )}

      {/* Untere Bedienleiste fixiert (Pixel 10 Pro Daumenzone – ohne untere Hauptmenüleiste für maximalen Platz) */}
      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] pb-2">
        {/* Schnellfilter unten, wenn Vorgänge -> Arbeiten aktiviert ist */}
        {activeTab === 'vorgaenge' && customerWorkViewOpen && accountLinkedWork.length > 0 && (
          <div className="px-3 pt-2 pb-1.5 flex items-center justify-between gap-2 border-b border-slate-100">
            <div className="flex-1 flex p-0.5 bg-slate-100 rounded-xl">
              {(
                [
                  { id: 'all', label: `Alle (${accountLinkedWork.length})` },
                  { id: 'open', label: `Offen (${linkedOpenWork.length})` },
                  { id: 'billed', label: `Abgerechnet (${linkedBilledWork.length})` }
                ] as const
              ).map((flt) => (
                <button
                  key={flt.id}
                  type="button"
                  onClick={() => setWorkStatusFilter(flt.id)}
                  className={`flex-1 py-1.5 text-[11px] font-semibold rounded-lg transition-all ${
                    workStatusFilter === flt.id
                      ? 'bg-white text-[#3138A0] shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {flt.label}
                </button>
              ))}
            </div>

            {linkedOpenWork.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveModal('RECHNUNG_VORBEREITEN')}
                className="h-8 px-2.5 bg-[#3138A0] hover:bg-[#272d82] active:scale-95 text-white text-[11px] font-semibold rounded-xl flex items-center gap-1 shrink-0 shadow-2xs transition-all"
              >
                <Receipt size={13} />
                <span>Abrechnen</span>
              </button>
            )}
          </div>
        )}

        {/* Schnellfilter unten, wenn Vorgänge -> Termine aktiviert ist */}
        {activeTab === 'vorgaenge' &&
          customerTermineViewOpen &&
          customerAppointments.length > 0 && (
            <div className="px-3 pt-2 pb-1.5 flex items-center gap-2 border-b border-slate-100">
              <div className="flex-1 flex p-0.5 bg-slate-100 rounded-xl">
                {(
                  [
                    { id: 'all', label: `Alle (${customerAppointments.length})` },
                    { id: 'upcoming', label: `Anstehend (${upcomingCustomerAppointments.length})` },
                    { id: 'past', label: `Vergangen (${pastCustomerAppointments.length})` }
                  ] as const
                ).map((flt) => (
                  <button
                    key={flt.id}
                    type="button"
                    onClick={() => setAppointmentFilter(flt.id)}
                    className={`flex-1 py-1.5 text-[11px] font-semibold rounded-lg transition-all ${
                      appointmentFilter === flt.id
                        ? 'bg-white text-[#3138A0] shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {flt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

        {/* Zeile 1: Ansichtsauswahl [Objekte | Vorgänge | Geld] + kontextuelle Primäraktion */}
        <div className="px-3 pt-2 pb-1.5 flex items-center gap-2 border-b border-slate-100">
          <div className="flex-1 flex p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setCustomerWorkViewOpen(false);
                setCustomerTermineViewOpen(false);
                setActiveTab('objekte');
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'objekte'
                  ? 'bg-white text-[#3138A0] shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Objekte ({customerProps.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomerWorkViewOpen(false);
                setCustomerTermineViewOpen(false);
                setActiveTab('vorgaenge');
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'vorgaenge'
                  ? 'bg-white text-[#3138A0] shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Vorgänge
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomerWorkViewOpen(false);
                setCustomerTermineViewOpen(false);
                setActiveTab('geld');
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'geld'
                  ? 'bg-white text-[#3138A0] shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Geld
            </button>
          </div>

          {activeTab === 'objekte' && (
            <button
              type="button"
              onClick={() => {
                setSelectedPropertyId(null);
                setActiveModal('OBJEKT_ANLEGEN');
              }}
              className="h-9 px-3 bg-[#3138A0] hover:bg-[#272d82] active:scale-95 text-white text-xs font-semibold rounded-xl flex items-center gap-1 shrink-0 shadow-2xs transition-all"
            >
              <Plus size={14} />
              <span>Objekt</span>
            </button>
          )}

          {activeTab === 'geld' && openWork.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveModal('RECHNUNG_VORBEREITEN')}
              className="h-9 px-3 bg-[#3138A0] hover:bg-[#272d82] active:scale-95 text-white text-xs font-semibold rounded-xl flex items-center gap-1 shrink-0 shadow-2xs transition-all"
            >
              <Receipt size={14} />
              <span>Abrechnen</span>
            </button>
          )}
        </div>

        {/* Zeile 2: Klare Pixel 10 Pro Direktbedienung (Route, Anruf, WhatsApp, + Arbeit, Suche & Schnellmenü) */}
        <div className="px-3 py-2 flex items-center gap-1.5">
          <div className="flex-1 grid grid-cols-4 gap-1.5 min-w-0">
            <a
              href={buildMapsNavigationUrl(primaryMapAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="h-12 px-1 bg-indigo-50 hover:bg-indigo-100 active:scale-95 text-[#3138A0] font-bold text-[11px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all whitespace-nowrap"
              title="Direkte Google Maps Navigation zum Kunden"
            >
              <Navigation size={17} />
              <span>Route</span>
            </a>

            {currentCustomer.phone ? (
              <a
                href={`tel:${currentCustomer.phone.replace(/\s+/g, '')}`}
                className="h-12 px-1 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-800 font-bold text-[11px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all whitespace-nowrap"
                title="Kunden anrufen"
              >
                <Phone size={17} className="text-[#3138A0]" />
                <span>Anruf</span>
              </a>
            ) : (
              <button
                type="button"
                onClick={() => setActiveModal('KUNDE_BEARBEITEN')}
                className="h-12 px-1 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-400 font-bold text-[11px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all whitespace-nowrap"
                title="Telefonnummer ergänzen"
              >
                <Phone size={17} />
                <span>Anruf</span>
              </button>
            )}

            {currentCustomer.phone && formatWhatsAppNumber(currentCustomer.phone).length > 0 ? (
              <a
                href={buildWhatsAppUrl(currentCustomer.phone)}
                target="_blank"
                rel="noopener noreferrer"
                className="h-12 px-1 bg-emerald-50 hover:bg-emerald-100 active:scale-95 text-[#128C7E] font-bold text-[11px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all whitespace-nowrap"
                title="WhatsApp Nachricht senden"
              >
                <MessageCircle size={17} />
                <span>WhatsApp</span>
              </a>
            ) : (
              <button
                type="button"
                onClick={() => setActiveModal('KUNDE_BEARBEITEN')}
                className="h-12 px-1 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-400 font-bold text-[11px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all whitespace-nowrap"
                title="Telefonnummer für WhatsApp ergänzen"
              >
                <MessageCircle size={17} />
                <span>WhatsApp</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setSelectedPropertyId(customerProps[0]?.id || null);
                setActiveModal('ARBEIT_NACHTRAGEN');
              }}
              className="h-12 px-1 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-800 font-bold text-[11px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all whitespace-nowrap"
              title="Arbeit nachtragen (07:00 – 17:00)"
            >
              <Briefcase size={17} className="text-[#3138A0]" />
              <span>+ Arbeit</span>
            </button>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="w-11 h-12 flex items-center justify-center bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-800 rounded-xl transition-all shrink-0"
              aria-label="Suche öffnen"
              title="Suche"
            >
              <Search size={21} />
            </button>
            <button
              type="button"
              onClick={() => setIsPlusMenuOpen(true)}
              className="w-11 h-12 flex items-center justify-center bg-indigo-50 hover:bg-indigo-100 active:scale-95 text-[#3138A0] border border-indigo-200/80 rounded-xl transition-all shrink-0"
              aria-label="Schnellmenü öffnen"
              title="Schnellmenü"
            >
              <Plus size={23} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
