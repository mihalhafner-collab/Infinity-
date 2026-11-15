import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Home,
  Wallet
} from 'lucide-react';
import { ScreenId } from '../../types/index.ts';
import { getCategoryLabel } from '../../utils/equipmentConfig.ts';
import {
  buildSearchIndexEntry,
  formatAmountSearchable,
  formatIsoToDeSearchable,
  parseSearchQuery,
  scoreSearchIndex
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
    currentScreen,
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
    expenses,
    setSelectedCustomerId,
    setSelectedInvoiceId,
    setSelectedWorkRecordId,
    setSelectedEquipmentId,
    setSelectedPlanungDate,
    setActiveModal,
    navigate
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<SearchFilterTab>('all');
  const [isListening, setIsListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsScrollRef = useRef<HTMLDivElement>(null);

  // Bei jedem Öffnen/Schließen der Suche oder Wechsel in ein anderes Menü auf neue Suche zurücksetzen
  useEffect(() => {
    setSearchQuery('');
    setFilterType('all');
    if (resultsScrollRef.current) {
      resultsScrollRef.current.scrollTop = 0;
    }
    if (isSearchOpen) {
      const t = setTimeout(() => {
        inputRef.current?.focus();
      }, 40);
      return () => clearTimeout(t);
    }
  }, [isSearchOpen, currentScreen]);

  // Bei Filter- oder Suchtextänderung Liste nach oben scrollen
  useEffect(() => {
    if (resultsScrollRef.current) {
      resultsScrollRef.current.scrollTop = 0;
    }
  }, [filterType, searchQuery]);

  const query = searchQuery.trim();
  const parsedQuery = useMemo(() => parseSearchQuery(query), [query]);

  const customerMap = useMemo(() => {
    const map = new Map<string, (typeof customers)[number]>();
    for (const c of customers) {
      map.set(c.id, c);
    }
    return map;
  }, [customers]);

  const propertyMap = useMemo(() => {
    const map = new Map<string, (typeof properties)[number]>();
    for (const p of properties) {
      map.set(p.id, p);
    }
    return map;
  }, [properties]);

  // 1. Vorberechneter Suchindex: Kunden & Objekte
  const indexedCustomers = useMemo(() => {
    return customers.map((c) => {
      const custProps = properties.filter((p) => p.customer_id === c.id);
      const subRecipient = c.default_billing_customer_id
        ? customerMap.get(c.default_billing_customer_id)?.name
        : '';
      return {
        item: c,
        index: buildSearchIndexEntry({
          exactKeys: [c.customer_number, c.zip],
          primary: [c.name, c.customer_number],
          secondary: [
            c.city,
            c.street,
            c.phone,
            c.email,
            subRecipient,
            ...custProps.map((p) => p.name)
          ],
          keywords: [
            c.notes,
            c.billing_mode === 'divergent_recipient' ? 'sub subauftrag abweichend' : '',
            ...custProps.flatMap((p) => [p.address, p.notes, p.access_info])
          ]
        })
      };
    });
  }, [customers, properties, customerMap]);

  const matchingCustomers = useMemo(() => {
    if (!query) {
      return [...customers].sort((a, b) => a.name.localeCompare(b.name, 'de'));
    }
    return indexedCustomers
      .map(({ item, index }) => ({
        item,
        score: scoreSearchIndex(parsedQuery, index)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.item.name.localeCompare(b.item.name, 'de');
      })
      .map((entry) => entry.item);
  }, [indexedCustomers, customers, parsedQuery, query]);

  // 2. Vorberechneter Suchindex: Termine
  const indexedAppointments = useMemo(() => {
    return appointments.map((a) => {
      const cust = a.customer_id ? customerMap.get(a.customer_id) : undefined;
      const prop = a.property_id ? propertyMap.get(a.property_id) : undefined;
      return {
        item: a,
        index: buildSearchIndexEntry({
          exactKeys: [cust?.customer_number, a.date],
          primary: [a.title, cust?.name],
          secondary: [
            a.address,
            cust?.city,
            cust?.street,
            prop?.name,
            prop?.address,
            formatIsoToDeSearchable(a.date)
          ],
          keywords: [a.start_time, a.end_time, a.notes, 'termin kalender']
        })
      };
    });
  }, [appointments, customerMap, propertyMap]);

  const matchingAppointments = useMemo(() => {
    if (!query) {
      return [...appointments].sort((a, b) => b.date.localeCompare(a.date));
    }
    return indexedAppointments
      .map(({ item, index }) => ({
        item,
        score: scoreSearchIndex(parsedQuery, index)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.item.date.localeCompare(a.item.date);
      })
      .map((entry) => entry.item);
  }, [indexedAppointments, appointments, parsedQuery, query]);

  // 3. Vorberechneter Suchindex: Arbeitsaufzeichnungen
  const indexedWork = useMemo(() => {
    return workRecords.map((w) => {
      const cust = customerMap.get(w.customer_id);
      const prop = w.property_id ? propertyMap.get(w.property_id) : undefined;
      const matNames = (w.materials || []).map((m) => `${m.name} ${m.unit}`).join(' ');
      const statusKeywords = w.settlement_id
        ? 'abgerechnet verrechnet erledigt'
        : w.is_lcr
          ? 'lcr l.c.r.'
          : 'offen unbezahlt';
      return {
        item: w,
        index: buildSearchIndexEntry({
          exactKeys: [cust?.customer_number, w.work_date],
          primary: [w.title, cust?.name],
          secondary: [
            prop?.name,
            prop?.address,
            cust?.city,
            formatIsoToDeSearchable(w.work_date),
            formatAmountSearchable(w.accounting_amount)
          ],
          keywords: [
            w.notes,
            matNames,
            statusKeywords,
            `${w.hours} std stunden`,
            w.start_time,
            w.end_time
          ]
        })
      };
    });
  }, [workRecords, customerMap, propertyMap]);

  const matchingWork = useMemo(() => {
    if (!query) {
      return [...workRecords].sort((a, b) => b.work_date.localeCompare(a.work_date));
    }
    return indexedWork
      .map(({ item, index }) => ({
        item,
        score: scoreSearchIndex(parsedQuery, index)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.item.work_date.localeCompare(a.item.work_date);
      })
      .map((entry) => entry.item);
  }, [indexedWork, workRecords, parsedQuery, query]);

  // 4. Vorberechneter Suchindex: Rechnungen, Ausgaben, Aufträge, Angebote & Anfragen
  const indexedInvoices = useMemo(() => {
    return invoices.map((inv) => {
      const cust = customerMap.get(inv.customer_id);
      const itemTexts = (inv.line_items || []).map((li) => li.description).join(' ');
      const statusText =
        inv.status === 'paid'
          ? 'bezahlt erledigt'
          : inv.status === 'draft'
            ? 'entwurf konzept'
            : 'offen unbezahlt';
      return {
        item: inv,
        index: buildSearchIndexEntry({
          exactKeys: [inv.invoice_number, inv.customer_number, cust?.customer_number],
          primary: [inv.invoice_number, inv.billing_customer_name, cust?.name],
          secondary: [
            formatIsoToDeSearchable(inv.issue_date),
            formatAmountSearchable(inv.total_amount),
            inv.customer_number
          ],
          keywords: [
            formatIsoToDeSearchable(inv.due_date),
            statusText,
            inv.is_pauschal ? 'pauschal pauschalrechnung' : 'regie',
            inv.subject_text,
            inv.intro_text,
            itemTexts
          ]
        })
      };
    });
  }, [invoices, customerMap]);

  const matchingInvoices = useMemo(() => {
    if (!query) return invoices;
    return indexedInvoices
      .map(({ item, index }) => ({
        item,
        score: scoreSearchIndex(parsedQuery, index)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.item.issue_date.localeCompare(a.item.issue_date);
      })
      .map((entry) => entry.item);
  }, [indexedInvoices, invoices, parsedQuery, query]);

  const indexedExpenses = useMemo(() => {
    return expenses.map((exp) => ({
      item: exp,
      index: buildSearchIndexEntry({
        exactKeys: [exp.date],
        primary: [exp.title, exp.category],
        secondary: [formatIsoToDeSearchable(exp.date), formatAmountSearchable(exp.amount)],
        keywords: [exp.notes, 'ausgabe betriebsausgabe guv']
      })
    }));
  }, [expenses]);

  const matchingExpenses = useMemo(() => {
    if (!query) return expenses;
    return indexedExpenses
      .map(({ item, index }) => ({
        item,
        score: scoreSearchIndex(parsedQuery, index)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.item.date.localeCompare(a.item.date);
      })
      .map((entry) => entry.item);
  }, [indexedExpenses, expenses, parsedQuery, query]);

  const indexedOrders = useMemo(() => {
    return orders.map((o) => {
      const cust = customerMap.get(o.customer_id);
      return {
        item: o,
        index: buildSearchIndexEntry({
          exactKeys: [cust?.customer_number],
          primary: [o.title, cust?.name],
          secondary: [formatIsoToDeSearchable(o.scheduled_date), cust?.city],
          keywords: [o.notes, 'auftrag auftraege']
        })
      };
    });
  }, [orders, customerMap]);

  const matchingOrders = useMemo(() => {
    if (!query) return orders;
    return indexedOrders
      .map(({ item, index }) => ({
        item,
        score: scoreSearchIndex(parsedQuery, index)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }, [indexedOrders, orders, parsedQuery, query]);

  const indexedOffers = useMemo(() => {
    return offers.map((off) => {
      const cust = customerMap.get(off.customer_id);
      return {
        item: off,
        index: buildSearchIndexEntry({
          exactKeys: [cust?.customer_number],
          primary: [off.title, cust?.name],
          secondary: [formatAmountSearchable(off.total_amount), cust?.city],
          keywords: ['angebot angebote']
        })
      };
    });
  }, [offers, customerMap]);

  const matchingOffers = useMemo(() => {
    if (!query) return offers;
    return indexedOffers
      .map(({ item, index }) => ({
        item,
        score: scoreSearchIndex(parsedQuery, index)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }, [indexedOffers, offers, parsedQuery, query]);

  const indexedInquiries = useMemo(() => {
    return inquiries.map((inq) => {
      const cust = customerMap.get(inq.customer_id);
      return {
        item: inq,
        index: buildSearchIndexEntry({
          exactKeys: [cust?.customer_number],
          primary: [inq.title, cust?.name],
          secondary: [formatIsoToDeSearchable(inq.desired_date), cust?.city],
          keywords: [inq.notes, 'anfrage anfragen']
        })
      };
    });
  }, [inquiries, customerMap]);

  const matchingInquiries = useMemo(() => {
    if (!query) return inquiries;
    return indexedInquiries
      .map(({ item, index }) => ({
        item,
        score: scoreSearchIndex(parsedQuery, index)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }, [indexedInquiries, inquiries, parsedQuery, query]);

  // 5. Vorberechneter Suchindex: Geräte, Zubehör & Material
  const indexedEquipment = useMemo(() => {
    return equipments.map((e) => {
      const catLabel = getCategoryLabel(e.category, e.item_type);
      const specsText = e.specs ? Object.values(e.specs).join(' ') : '';
      return {
        item: e,
        index: buildSearchIndexEntry({
          primary: [e.name, e.model],
          secondary: [catLabel, specsText],
          keywords: [
            e.notes,
            e.maintenance_plan,
            e.item_type === 'zubehoer' ? 'zubehör zubehoer' : 'gerät geraet maschine',
            e.status === 'faellig' ? 'wartung fällig faellig' : 'einsatzbereit'
          ]
        })
      };
    });
  }, [equipments]);

  const matchingEquipment = useMemo(() => {
    if (!query) return equipments;
    return indexedEquipment
      .map(({ item, index }) => ({
        item,
        score: scoreSearchIndex(parsedQuery, index)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }, [indexedEquipment, equipments, parsedQuery, query]);

  const indexedMaterials = useMemo(() => {
    return materials.map((m) => ({
      item: m,
      index: buildSearchIndexEntry({
        primary: [m.name, m.category],
        secondary: [m.unit, formatAmountSearchable(m.price_per_unit)],
        keywords: [m.notes, 'material']
      })
    }));
  }, [materials]);

  const matchingMaterials = useMemo(() => {
    if (!query) return materials;
    return indexedMaterials
      .map(({ item, index }) => ({
        item,
        score: scoreSearchIndex(parsedQuery, index)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }, [indexedMaterials, materials, parsedQuery, query]);

  if (!isSearchOpen) return null;

  const totalInvoicesAndVorgaenge =
    matchingInvoices.length +
    matchingExpenses.length +
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

  const resetAndCloseSearch = () => {
    setSearchQuery('');
    setFilterType('all');
    setIsSearchOpen(false);
  };

  const handleOpenCustomer = (id: string) => {
    resetAndCloseSearch();
    setSelectedCustomerId(id);
    navigate('M03_KUNDEN');
  };

  const handleOpenInvoice = (id: string) => {
    resetAndCloseSearch();
    setSelectedInvoiceId(id);
    navigate('M04_ABRECHNUNG');
  };

  const handleOpenExpense = () => {
    resetAndCloseSearch();
    setSelectedInvoiceId(null);
    navigate('M04_ABRECHNUNG');
  };

  const handleOpenWorkRecord = (id: string) => {
    resetAndCloseSearch();
    setSelectedWorkRecordId(id);
    navigate('M08_ARBEITEN');
    setActiveModal('ARBEIT_BEARBEITEN');
  };

  const handleOpenAppointment = (dateIso: string) => {
    resetAndCloseSearch();
    setSelectedPlanungDate(dateIso);
    navigate('M02_PLANUNG');
  };

  const handleOpenNav = (screen: ScreenId) => {
    resetAndCloseSearch();
    navigate(screen);
  };

  const handleOpenEquipment = (id: string) => {
    resetAndCloseSearch();
    setSelectedEquipmentId(id);
    navigate('M10_GERAETE');
    setActiveModal('GERAET_BEARBEITEN');
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
            placeholder="Name, #Kd-Nr., Ort, Arbeit, Monat, Betrag…"
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
          onClick={resetAndCloseSearch}
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
      <div
        ref={resultsScrollRef}
        className="flex-1 overflow-y-auto p-3.5 space-y-4 overscroll-contain"
      >
        {totalResults === 0 && (
          <div className="p-8 bg-white border border-slate-200 rounded-2xl text-center space-y-2 shadow-2xs">
            <Search size={24} className="text-slate-400 mx-auto" />
            <p className="text-sm font-bold text-slate-900">
              Keine Treffer für „{searchQuery}“
            </p>
            <p className="text-xs text-slate-500">
              Suche unterstützt Namen, Kundennummern (#), Orte, Monate, Beträge, Rechnungsnummern und Materialien.
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
                            {c.customer_number && (
                              <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded shrink-0">
                                #{c.customer_number}
                              </span>
                            )}
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
                      onClick={() => handleOpenAppointment(a.date)}
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
                const isBilled = Boolean(w.settlement_id);
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => handleOpenWorkRecord(w.id)}
                    className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-2xl flex items-center justify-between hover:border-[#3138A0] active:bg-slate-50 transition-colors text-left shadow-2xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-indigo-50 text-[#3138A0] flex items-center justify-center shrink-0">
                        <Briefcase size={16} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-950 text-[13px] truncate">
                            {w.title}
                          </span>
                          {isBilled ? (
                            <span className="px-1.5 py-0.5 bg-emerald-50 text-[#2C7738] text-[10px] font-bold rounded shrink-0">
                              Abger.
                            </span>
                          ) : w.is_lcr ? (
                            <span className="px-1.5 py-0.5 bg-indigo-50 text-[#3138A0] text-[10px] font-bold rounded shrink-0">
                              L.C.R.
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 bg-orange-50 text-[#B4470B] text-[10px] font-bold rounded shrink-0">
                              Offen
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-600 block truncate">
                          {cust ? `${cust.name} · ` : ''}
                          {w.work_date} · {w.hours} Std.
                        </span>
                      </div>
                    </div>
                    <span className="font-bold text-[13px] text-[#B4470B] shrink-0 pl-2 tabular-nums">
                      {(w.accounting_amount || 0).toFixed(2)} €
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 4. Rechnungen, Ausgaben, Aufträge, Angebote & Anfragen */}
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
                              {inv.status === 'paid'
                                ? 'Bezahlt'
                                : inv.status === 'draft'
                                  ? 'Entwurf'
                                  : 'Offen'}
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

              {matchingExpenses.length > 0 && (
                <div>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2 px-0.5">
                    Betriebsausgaben ({matchingExpenses.length})
                  </span>
                  <div className="space-y-2">
                    {matchingExpenses.slice(0, 15).map((exp) => (
                      <button
                        key={exp.id}
                        type="button"
                        onClick={() => handleOpenExpense()}
                        className="w-full p-3 bg-white border border-slate-200 rounded-2xl flex items-center justify-between hover:border-[#3138A0] active:bg-slate-50 transition-colors text-left shadow-2xs"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                            <Wallet size={18} />
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-slate-950 text-sm block truncate">
                              {exp.title}
                            </span>
                            <span className="text-xs text-slate-600 block truncate">
                              Ausgabe · {exp.date}
                            </span>
                          </div>
                        </div>
                        <span className="font-bold text-sm text-[#B42318] tabular-nums shrink-0 pl-2">
                          −{exp.amount.toFixed(2)} €
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
                          onClick={() => handleOpenEquipment(e.id)}
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
