import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import {
  Search,
  Mic,
  X,
  Calendar,
  Briefcase,
  Wrench,
  Package,
  ChevronRight,
  Receipt,
  CheckSquare,
  FileText,
  MessageSquare,
  Home
} from 'lucide-react';
import { ScreenId } from '../../types/index.ts';
import { getCategoryLabel } from '../../utils/equipmentConfig.ts';
import {
  formatIsoToDeSearchable,
  matchesSearchQuery
} from '../../utils/searchUtils.ts';

type SearchFilterTab =
  | 'all'
  | 'customers'
  | 'appointments'
  | 'work'
  | 'invoices_orders'
  | 'equipment';

interface SpeechRecognitionAlternativeLike {
  transcript?: string;
}

interface SpeechRecognitionResultLike {
  0?: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results?: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionInstanceLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export const SucheModal: React.FC = () => {
  const {
    isSearchOpen,
    setIsSearchOpen,
    customers,
    properties,
    appointments,
    workRecords,
    invoices,
    orders,
    offers,
    inquiries,
    equipments,
    materials,
    setSelectedCustomerId,
    setSelectedInvoiceId,
    navigate
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<SearchFilterTab>('all');
  const [isListening, setIsListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = searchQuery.trim();

  const customerMap = useMemo(() => {
    const map = new Map<string, (typeof customers)[number]>();
    for (const c of customers) {
      map.set(c.id, c);
    }
    return map;
  }, [customers]);

  // 1. Kunden & Objekte durchsuchen (inkl. Straße, PLZ, Ort, Telefon, E-Mail, Notiz, Objekte & Sub-Empfänger)
  const matchingCustomers = useMemo(() => {
    return customers
      .filter((c) => {
        if (!query) return true;
        const custProps = properties.filter((p) => p.customer_id === c.id);
        const subRecipient = c.default_billing_customer_id
          ? customerMap.get(c.default_billing_customer_id)?.name
          : '';
        return matchesSearchQuery(query, [
          c.name,
          c.customer_number,
          c.street,
          c.zip,
          c.city,
          c.phone,
          c.email,
          c.notes,
          subRecipient,
          ...custProps.flatMap((p) => [p.name, p.address, p.notes, p.access_info])
        ]);
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }, [customers, properties, customerMap, query]);

  // 2. Termine durchsuchen (inkl. Kundenname & deutsches Datum)
  const matchingAppointments = useMemo(() => {
    return appointments
      .filter((a) => {
        if (!query) return true;
        const cust = a.customer_id ? customerMap.get(a.customer_id) : undefined;
        return matchesSearchQuery(query, [
          a.title,
          a.address,
          formatIsoToDeSearchable(a.date),
          a.start_time,
          a.end_time,
          a.notes,
          cust?.name,
          cust?.city
        ]);
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [appointments, customerMap, query]);

  // 3. Arbeitsaufzeichnungen durchsuchen (inkl. Kunde, Objekt, Material & deutsches Datum)
  const matchingWork = useMemo(() => {
    return workRecords
      .filter((w) => {
        if (!query) return true;
        const cust = customerMap.get(w.customer_id);
        const prop = w.property_id
          ? properties.find((p) => p.id === w.property_id)
          : undefined;
        const matNames = (w.materials || []).map((m) => m.name).join(' ');
        return matchesSearchQuery(query, [
          w.title,
          w.notes,
          formatIsoToDeSearchable(w.work_date),
          cust?.name,
          cust?.city,
          prop?.name,
          prop?.address,
          matNames,
          w.is_lcr ? 'LCR L.C.R.' : ''
        ]);
      })
      .sort((a, b) => b.work_date.localeCompare(a.work_date));
  }, [workRecords, customerMap, properties, query]);

  // 4. Rechnungen, Aufträge, Angebote & Anfragen durchsuchen
  const matchingInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (!query) return true;
      const cust = customerMap.get(inv.customer_id);
      return matchesSearchQuery(query, [
        inv.invoice_number,
        inv.billing_customer_name,
        cust?.name,
        formatIsoToDeSearchable(inv.issue_date),
        formatIsoToDeSearchable(inv.due_date),
        inv.total_amount
      ]);
    });
  }, [invoices, customerMap, query]);

  const matchingOrders = useMemo(() => {
    return orders.filter((o) => {
      if (!query) return true;
      const cust = customerMap.get(o.customer_id);
      return matchesSearchQuery(query, [
        o.title,
        o.notes,
        formatIsoToDeSearchable(o.scheduled_date),
        cust?.name,
        cust?.city
      ]);
    });
  }, [orders, customerMap, query]);

  const matchingOffers = useMemo(() => {
    return offers.filter((off) => {
      if (!query) return true;
      const cust = customerMap.get(off.customer_id);
      return matchesSearchQuery(query, [
        off.title,
        cust?.name,
        off.total_amount
      ]);
    });
  }, [offers, customerMap, query]);

  const matchingInquiries = useMemo(() => {
    return inquiries.filter((inq) => {
      if (!query) return true;
      const cust = customerMap.get(inq.customer_id);
      return matchesSearchQuery(query, [
        inq.title,
        inq.notes,
        formatIsoToDeSearchable(inq.desired_date),
        cust?.name
      ]);
    });
  }, [inquiries, customerMap, query]);

  // 5. Geräte, Zubehör & Material durchsuchen
  const matchingEquipment = useMemo(() => {
    return equipments.filter((e) => {
      if (!query) return true;
      const catLabel = getCategoryLabel(e.category, e.item_type);
      const specsText = e.specs ? Object.values(e.specs).join(' ') : '';
      return matchesSearchQuery(query, [
        e.name,
        e.model,
        catLabel,
        specsText,
        e.notes,
        e.maintenance_plan
      ]);
    });
  }, [equipments, query]);

  const matchingMaterials = useMemo(() => {
    return materials.filter((m) => {
      if (!query) return true;
      return matchesSearchQuery(query, [
        m.name,
        m.category,
        m.unit,
        m.notes,
        m.price_per_unit
      ]);
    });
  }, [materials, query]);

  if (!isSearchOpen) return null;

  const totalInvoicesAndVorgaenge =
    matchingInvoices.length +
    matchingOrders.length +
    matchingOffers.length +
    matchingInquiries.length;

  const totalEquipmentAndMaterial =
    matchingEquipment.length + matchingMaterials.length;

  const totalResults =
    matchingCustomers.length +
    matchingAppointments.length +
    matchingWork.length +
    totalInvoicesAndVorgaenge +
    totalEquipmentAndMaterial;

  const handleOpenCustomer = (id: string) => {
    setSelectedCustomerId(id);
    setIsSearchOpen(false);
    navigate('M03_KUNDEN');
  };

  const handleOpenInvoice = (id: string) => {
    setSelectedInvoiceId(id);
    setIsSearchOpen(false);
    navigate('M04_ABRECHNUNG');
  };

  const handleOpenNav = (screen: ScreenId) => {
    setIsSearchOpen(false);
    navigate(screen);
  };

  const handleStartSpeechRecognition = () => {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstanceLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstanceLike;
    };
    const SpeechRecCtor = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecCtor) {
      inputRef.current?.focus();
      return;
    }

    try {
      const recognition = new SpeechRecCtor();
      recognition.lang = 'de-AT';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      setIsListening(true);

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        const transcript = event.results?.[0]?.[0]?.transcript?.trim();
        if (transcript) {
          setSearchQuery(transcript);
        }
        setIsListening(false);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch {
      setIsListening(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="absolute inset-0 z-50 bg-[#F8F9FA] flex flex-col animate-fade-in">
      {/* Search Header */}
      <div className="p-3.5 bg-white border-b border-slate-200 flex items-center gap-2">
        <div className="flex-1 h-12 bg-slate-100 rounded-2xl px-3.5 flex items-center gap-2.5 border border-slate-200 focus-within:bg-white focus-within:border-[#3138A0] focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
          <Search size={19} className="text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            type="search"
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Name, Ort, Tel., Arbeit, Rechnung suchen…"
            className="flex-1 bg-transparent border-none outline-hidden text-sm font-medium text-slate-950 placeholder:text-slate-400"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                inputRef.current?.focus();
              }}
              className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-full"
              aria-label="Suchtext löschen"
            >
              <X size={17} />
            </button>
          )}
          <button
            type="button"
            onClick={handleStartSpeechRecognition}
            className={`w-9 h-9 flex items-center justify-center rounded-xl transition-colors ${
              isListening
                ? 'text-[#B42318] bg-red-50 animate-pulse'
                : 'text-slate-600 hover:text-[#3138A0]'
            }`}
            title="Spracheingabe (Pixel 10 Pro)"
          >
            <Mic size={19} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setIsSearchOpen(false)}
          className="px-3 h-12 flex items-center justify-center text-xs font-bold text-[#3138A0] hover:bg-indigo-50 rounded-xl active:scale-95 transition-all shrink-0"
        >
          Fertig
        </button>
      </div>

      {/* Filter Chips */}
      <div className="px-3.5 py-2.5 bg-white border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
        {(
          [
            { id: 'all', label: `Alle (${totalResults})` },
            { id: 'customers', label: `Kunden (${matchingCustomers.length})` },
            { id: 'appointments', label: `Termine (${matchingAppointments.length})` },
            { id: 'work', label: `Arbeiten (${matchingWork.length})` },
            {
              id: 'invoices_orders',
              label: `Belege & Aufträge (${totalInvoicesAndVorgaenge})`
            },
            {
              id: 'equipment',
              label: `Geräte & Material (${totalEquipmentAndMaterial})`
            }
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilterType(tab.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
              filterType === tab.id
                ? 'bg-[#3138A0] text-white shadow-2xs'
                : 'bg-slate-100 border border-slate-200/80 text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Results Feed */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4 overscroll-contain">
        {totalResults === 0 && (
          <div className="p-8 bg-white border border-slate-200 rounded-2xl text-center space-y-2 shadow-2xs">
            <Search size={24} className="text-slate-400 mx-auto" />
            <p className="text-sm font-bold text-slate-900">
              Keine Treffer für „{searchQuery}“
            </p>
            <p className="text-xs text-slate-500">
              Suche unterstützt Teilworte, Orte, Telefonnummern, Rechnungsnummern und Objektnamen.
            </p>
          </div>
        )}

        {/* 1. Kunden Treffer */}
        {(filterType === 'all' || filterType === 'customers') &&
          matchingCustomers.length > 0 && (
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2 px-0.5">
                Kunden ({matchingCustomers.length})
              </span>
              <div className="space-y-2">
                {(query ? matchingCustomers : matchingCustomers.slice(0, 15)).map((c) => {
                  const custProps = properties.filter((p) => p.customer_id === c.id);
                  const addressLine = [c.street, [c.zip, c.city].filter(Boolean).join(' ')]
                    .filter(Boolean)
                    .join(', ');
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleOpenCustomer(c.id)}
                      className="w-full p-3 bg-white border border-slate-200 rounded-2xl flex items-center justify-between hover:border-[#3138A0] active:bg-slate-50 transition-colors text-left shadow-2xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-[#3138A0] shrink-0 font-bold text-xs">
                          {c.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-950 text-sm leading-snug truncate">
                              {c.name}
                            </span>
                            {custProps.length > 0 && (
                              <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded flex items-center gap-0.5 shrink-0">
                                <Home size={10} />
                                <span>{custProps.length}</span>
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-slate-600 block truncate">
                            {addressLine || c.city || 'Adresse offen'}
                            {c.phone ? ` · ${c.phone}` : ''}
                          </span>
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-slate-400 shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

        {/* 2. Termine Treffer */}
        {(filterType === 'all' || filterType === 'appointments') &&
          matchingAppointments.length > 0 && (
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2 px-0.5">
                Termine ({matchingAppointments.length})
              </span>
              <div className="space-y-2">
                {matchingAppointments.slice(0, 20).map((a) => {
                  const cust = a.customer_id ? customerMap.get(a.customer_id) : undefined;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => handleOpenNav('M02_PLANUNG')}
                      className="w-full p-3 bg-white border border-slate-200 rounded-2xl flex items-center justify-between hover:border-[#3138A0] active:bg-slate-50 transition-colors text-left shadow-2xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-indigo-50 text-[#3138A0] flex items-center justify-center shrink-0">
                          <Calendar size={18} />
                        </div>
                        <div className="min-w-0">
                          <span className="font-bold text-slate-950 block text-sm leading-snug truncate">
                            {a.title || 'Termin'}
                          </span>
                          <span className="text-xs text-slate-600 block truncate">
                            {cust ? `${cust.name} · ` : ''}
                            {a.date} {a.start_time ? `· ${a.start_time} Uhr` : '· Ohne Uhrzeit'}
                          </span>
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-slate-400 shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

        {/* 3. Arbeiten Treffer */}
        {(filterType === 'all' || filterType === 'work') && matchingWork.length > 0 && (
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2 px-0.5">
              Arbeitsaufzeichnungen ({matchingWork.length})
            </span>
            <div className="space-y-2">
              {matchingWork.slice(0, 20).map((w) => {
                const cust = customerMap.get(w.customer_id);
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => handleOpenNav('M08_ARBEITEN')}
                    className="w-full p-3 bg-white border border-slate-200 rounded-2xl flex items-center justify-between hover:border-[#3138A0] active:bg-slate-50 transition-colors text-left shadow-2xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-indigo-50 text-[#3138A0] flex items-center justify-center shrink-0">
                        <Briefcase size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-950 text-sm truncate">
                            {w.title}
                          </span>
                          {w.is_lcr && (
                            <span className="px-1.5 py-0.5 bg-indigo-100 text-[#3138A0] text-[10px] font-bold rounded shrink-0">
                              L.C.R.
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-slate-600 block truncate">
                          {cust ? `${cust.name} · ` : ''}
                          {w.work_date} · {w.hours} Std.
                        </span>
                      </div>
                    </div>
                    <span className="font-bold text-sm text-[#B4470B] shrink-0 pl-2 tabular-nums">
                      {(w.accounting_amount || 0).toFixed(2)} €
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 4. Rechnungen, Aufträge, Angebote & Anfragen */}
        {(filterType === 'all' || filterType === 'invoices_orders') &&
          totalInvoicesAndVorgaenge > 0 && (
            <div className="space-y-3">
              {matchingInvoices.length > 0 && (
                <div>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2 px-0.5">
                    Rechnungen ({matchingInvoices.length})
                  </span>
                  <div className="space-y-2">
                    {matchingInvoices.slice(0, 15).map((inv) => (
                      <button
                        key={inv.id}
                        type="button"
                        onClick={() => handleOpenInvoice(inv.id)}
                        className="w-full p-3 bg-white border border-slate-200 rounded-2xl flex items-center justify-between hover:border-[#3138A0] active:bg-slate-50 transition-colors text-left shadow-2xs"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-orange-50 text-[#B4470B] flex items-center justify-center shrink-0">
                            <Receipt size={18} />
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-slate-950 text-sm block truncate">
                              {inv.invoice_number} · {inv.billing_customer_name}
                            </span>
                            <span className="text-xs text-slate-600 block truncate">
                              Datum: {inv.issue_date} ·{' '}
                              {inv.status === 'paid' ? 'Bezahlt' : 'Offen'}
                            </span>
                          </div>
                        </div>
                        <span className="font-bold text-sm text-slate-900 tabular-nums shrink-0 pl-2">
                          {inv.total_amount.toFixed(2)} €
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(matchingOrders.length > 0 ||
                matchingOffers.length > 0 ||
                matchingInquiries.length > 0) && (
                <div>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2 px-0.5">
                    Aufträge, Angebote & Anfragen (
                    {matchingOrders.length +
                      matchingOffers.length +
                      matchingInquiries.length}
                    )
                  </span>
                  <div className="space-y-2">
                    {matchingOrders.map((o) => {
                      const cust = customerMap.get(o.customer_id);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => handleOpenNav('M07_AUFTRAEGE')}
                          className="w-full p-3 bg-white border border-slate-200 rounded-2xl flex items-center justify-between hover:border-[#3138A0] transition-colors text-left shadow-2xs"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <CheckSquare size={18} className="text-[#3138A0] shrink-0" />
                            <div className="min-w-0">
                              <span className="font-bold text-slate-950 text-sm block truncate">
                                {o.title}
                              </span>
                              <span className="text-xs text-slate-600 block truncate">
                                Auftrag · {cust?.name || 'Kunde'}
                              </span>
                            </div>
                          </div>
                          <ChevronRight size={18} className="text-slate-400 shrink-0" />
                        </button>
                      );
                    })}
                    {matchingOffers.map((off) => {
                      const cust = customerMap.get(off.customer_id);
                      return (
                        <button
                          key={off.id}
                          type="button"
                          onClick={() => handleOpenNav('M06_ANGEBOTE')}
                          className="w-full p-3 bg-white border border-slate-200 rounded-2xl flex items-center justify-between hover:border-[#3138A0] transition-colors text-left shadow-2xs"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <FileText size={18} className="text-[#3138A0] shrink-0" />
                            <div className="min-w-0">
                              <span className="font-bold text-slate-950 text-sm block truncate">
                                {off.title}
                              </span>
                              <span className="text-xs text-slate-600 block truncate">
                                Angebot · {cust?.name || 'Kunde'}
                              </span>
                            </div>
                          </div>
                          <span className="font-bold text-xs text-[#3138A0] shrink-0">
                            {(off.total_amount || 0).toFixed(0)} €
                          </span>
                        </button>
                      );
                    })}
                    {matchingInquiries.map((inq) => {
                      const cust = customerMap.get(inq.customer_id);
                      return (
                        <button
                          key={inq.id}
                          type="button"
                          onClick={() => handleOpenNav('M05_ANFRAGEN')}
                          className="w-full p-3 bg-white border border-slate-200 rounded-2xl flex items-center justify-between hover:border-[#3138A0] transition-colors text-left shadow-2xs"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <MessageSquare size={18} className="text-[#9A1B8D] shrink-0" />
                            <div className="min-w-0">
                              <span className="font-bold text-slate-950 text-sm block truncate">
                                {inq.title}
                              </span>
                              <span className="text-xs text-slate-600 block truncate">
                                Anfrage · {cust?.name || 'Kunde'}
                              </span>
                            </div>
                          </div>
                          <ChevronRight size={18} className="text-slate-400 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

        {/* 5. Geräte, Zubehör & Material Treffer */}
        {(filterType === 'all' || filterType === 'equipment') &&
          totalEquipmentAndMaterial > 0 && (
            <div className="space-y-3">
              {matchingEquipment.length > 0 && (
                <div>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2 px-0.5">
                    Geräte & Zubehör ({matchingEquipment.length})
                  </span>
                  <div className="space-y-2">
                    {matchingEquipment.map((e) => {
                      const isZubehoer = e.item_type === 'zubehoer';
                      return (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => handleOpenNav('M10_GERAETE')}
                          className="w-full p-3 bg-white border border-slate-200 rounded-2xl flex items-center justify-between hover:border-[#3138A0] transition-colors text-left shadow-2xs"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {e.photo ? (
                              <img
                                src={e.photo}
                                alt={e.name}
                                className="w-10 h-10 rounded-xl object-cover border border-slate-200 shrink-0"
                              />
                            ) : (
                              <div
                                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                                  isZubehoer
                                    ? 'bg-indigo-50 border-indigo-100 text-[#3138A0]'
                                    : 'bg-emerald-50 border-emerald-100 text-[#2C7738]'
                                }`}
                              >
                                {isZubehoer ? <Package size={18} /> : <Wrench size={18} />}
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-950 truncate text-sm leading-snug">
                                  {e.name}
                                </span>
                                {isZubehoer && (
                                  <span className="px-1.5 py-0.5 bg-indigo-50 text-[#3138A0] text-[10px] font-bold rounded shrink-0">
                                    Zubehör
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-slate-600 block truncate">
                                {e.model || getCategoryLabel(e.category)} ·{' '}
                                {isZubehoer
                                  ? e.quantity != null
                                    ? `${e.quantity} Stk.`
                                    : 'Zubehör'
                                  : e.status === 'faellig'
                                    ? 'Wartung fällig'
                                    : 'Einsatzbereit'}
                              </span>
                            </div>
                          </div>
                          <ChevronRight size={18} className="text-slate-400 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {matchingMaterials.length > 0 && (
                <div>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2 px-0.5">
                    Material ({matchingMaterials.length})
                  </span>
                  <div className="space-y-2">
                    {matchingMaterials.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleOpenNav('M11_MATERIAL')}
                        className="w-full p-3 bg-white border border-slate-200 rounded-2xl flex items-center justify-between hover:border-[#3138A0] transition-colors text-left shadow-2xs"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                            <Package size={17} />
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-slate-950 text-sm block truncate">
                              {m.name}
                            </span>
                            <span className="text-xs text-slate-600 block truncate">
                              {m.category || 'Material'} · Einheit: {m.unit}
                            </span>
                          </div>
                        </div>
                        <span className="font-bold text-xs text-[#B4470B] tabular-nums shrink-0">
                          {m.price_per_unit != null
                            ? `${m.price_per_unit.toFixed(2)} €`
                            : '—'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
      </div>
    </div>
  );
};
