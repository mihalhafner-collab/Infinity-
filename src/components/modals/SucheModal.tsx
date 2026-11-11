import React, { useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { Search, Mic, X, Calendar, Briefcase, Wrench, Package, ChevronRight } from 'lucide-react';
import { ScreenId } from '../../types/index.ts';
import { getCategoryLabel } from '../../utils/equipmentConfig.ts';

export const SucheModal: React.FC = () => {
  const {
    isSearchOpen,
    setIsSearchOpen,
    customers,
    appointments,
    workRecords,
    equipments,
    setSelectedCustomerId,
    navigate
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'customers' | 'appointments' | 'work' | 'equipment'>('all');
  const [isListening, setIsListening] = useState(false);

  if (!isSearchOpen) return null;

  const query = searchQuery.trim().toLowerCase();

  // Filter items matching query
  const matchingCustomers = customers.filter(
    (c) =>
      !query ||
      c.name.toLowerCase().includes(query) ||
      c.city.toLowerCase().includes(query) ||
      c.phone.includes(query)
  );

  const matchingAppointments = appointments.filter(
    (a) =>
      !query ||
      (a.title && a.title.toLowerCase().includes(query)) ||
      (a.address && a.address.toLowerCase().includes(query)) ||
      a.date.includes(query)
  );

  const matchingWork = workRecords.filter(
    (w) =>
      !query ||
      w.title.toLowerCase().includes(query) ||
      w.notes.toLowerCase().includes(query) ||
      w.work_date.includes(query)
  );

  const matchingEquipment = equipments.filter((e) => {
    if (!query) return true;
    const catLabel = getCategoryLabel(e.category).toLowerCase();
    const specsText = e.specs ? Object.values(e.specs).join(' ').toLowerCase() : '';
    return (
      e.name.toLowerCase().includes(query) ||
      e.model.toLowerCase().includes(query) ||
      catLabel.includes(query) ||
      specsText.includes(query)
    );
  });

  const handleOpenCustomer = (id: string) => {
    setSelectedCustomerId(id);
    setIsSearchOpen(false);
    navigate('M03_KUNDEN');
  };

  const handleOpenNav = (screen: ScreenId) => {
    setIsSearchOpen(false);
    navigate(screen);
  };

  const simulateSpeech = () => {
    setIsListening(true);
    setTimeout(() => {
      setSearchQuery('Hecke');
      setIsListening(false);
    }, 800);
  };

  return (
    <div className="absolute inset-0 z-50 bg-white flex flex-col animate-fade-in">
      {/* Search Header */}
      <div className="p-3 border-b border-slate-200 flex items-center gap-2">
        <div className="flex-1 h-12 bg-slate-100 rounded-full px-3.5 flex items-center gap-2 border border-slate-200/80 focus-within:bg-white focus-within:border-[#3138A0] focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
          <Search size={18} className="text-slate-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Kunden, Termine, Arbeiten suchen..."
            className="flex-1 bg-transparent border-none outline-hidden text-sm text-slate-900 placeholder:text-slate-400"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-full"
            >
              <X size={15} />
            </button>
          )}
          <button
            onClick={simulateSpeech}
            className={`p-1.5 rounded-full transition-colors ${
              isListening ? 'text-[#B42318] bg-red-50 animate-pulse' : 'text-slate-500 hover:text-[#3138A0]'
            }`}
            title="Spracheingabe"
          >
            <Mic size={17} />
          </button>
        </div>

        <button
          onClick={() => setIsSearchOpen(false)}
          className="px-3 h-12 flex items-center justify-center text-sm font-semibold text-slate-600 hover:text-slate-900 active:scale-95 transition-all"
        >
          Fertig
        </button>
      </div>

      {/* Filter Chips (Page 56) */}
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
        <button
          onClick={() => setFilterType('all')}
          className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
            filterType === 'all'
              ? 'bg-[#3138A0] text-white shadow-2xs'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
          }`}
        >
          Alle
        </button>
        <button
          onClick={() => setFilterType('customers')}
          className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
            filterType === 'customers'
              ? 'bg-[#3138A0] text-white shadow-2xs'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
          }`}
        >
          Kunden ({matchingCustomers.length})
        </button>
        <button
          onClick={() => setFilterType('appointments')}
          className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
            filterType === 'appointments'
              ? 'bg-[#3138A0] text-white shadow-2xs'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
          }`}
        >
          Termine ({matchingAppointments.length})
        </button>
        <button
          onClick={() => setFilterType('work')}
          className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
            filterType === 'work'
              ? 'bg-[#3138A0] text-white shadow-2xs'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
          }`}
        >
          Arbeiten ({matchingWork.length})
        </button>
        <button
          onClick={() => setFilterType('equipment')}
          className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
            filterType === 'equipment'
              ? 'bg-[#3138A0] text-white shadow-2xs'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
          }`}
        >
          Geräte & Zubehör ({matchingEquipment.length})
        </button>
      </div>

      {/* Results Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Kunden Treffer */}
        {(filterType === 'all' || filterType === 'customers') && matchingCustomers.length > 0 && (
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
              Kunden
            </span>
            <div className="space-y-1.5">
              {matchingCustomers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleOpenCustomer(c.id)}
                  className="w-full p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between hover:border-[#3138A0] transition-colors text-left shadow-2xs"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-[#3138A0] shrink-0 font-bold text-xs">
                      {c.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <span className="font-bold text-slate-900 block text-xs leading-tight">
                        {c.name}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {c.city} · {c.phone}
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-slate-400" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Termine Treffer */}
        {(filterType === 'all' || filterType === 'appointments') && matchingAppointments.length > 0 && (
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
              Termine
            </span>
            <div className="space-y-1.5">
              {matchingAppointments.map((a) => (
                <button
                  key={a.id}
                  onClick={() => handleOpenNav('M02_PLANUNG')}
                  className="w-full p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between hover:border-[#3138A0] transition-colors text-left shadow-2xs"
                >
                  <div className="flex items-center gap-2.5">
                    <Calendar size={18} className="text-[#3138A0] shrink-0" />
                    <div>
                      <span className="font-bold text-slate-900 block text-xs leading-tight">
                        {a.title || 'Termin'}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {a.date} {a.start_time ? `· ${a.start_time} Uhr` : '· Ohne Uhrzeit'}
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-slate-400" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Arbeiten Treffer */}
        {(filterType === 'all' || filterType === 'work') && matchingWork.length > 0 && (
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
              Arbeitsaufzeichnungen
            </span>
            <div className="space-y-1.5">
              {matchingWork.map((w) => (
                <button
                  key={w.id}
                  onClick={() => handleOpenNav('M08_ARBEITEN')}
                  className="w-full p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between hover:border-[#3138A0] transition-colors text-left shadow-2xs"
                >
                  <div className="flex items-center gap-2.5">
                    <Briefcase size={18} className="text-[#3138A0] shrink-0" />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900 text-xs">
                          {w.title}
                        </span>
                        {w.is_lcr && (
                          <span className="px-1.5 py-0.2 bg-indigo-100 text-[#3138A0] text-[9px] font-bold rounded">
                            L.C.R.
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {w.work_date} · {w.hours} Std.
                      </span>
                    </div>
                  </div>
                  <span className="font-bold text-xs text-[#B4470B]">
                    {(w.accounting_amount || 0).toFixed(2)} €
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Geräte & Zubehör Treffer */}
        {(filterType === 'all' || filterType === 'equipment') && matchingEquipment.length > 0 && (
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
              Geräte & Zubehör
            </span>
            <div className="space-y-1.5">
              {matchingEquipment.map((e) => {
                const isZubehoer = e.item_type === 'zubehoer';
                return (
                  <button
                    key={e.id}
                    onClick={() => handleOpenNav('M10_GERAETE')}
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between hover:border-[#3138A0] transition-colors text-left shadow-2xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {e.photo ? (
                        <img
                          src={e.photo}
                          alt={e.name}
                          className="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                            isZubehoer
                              ? 'bg-indigo-50 border-indigo-100 text-[#3138A0]'
                              : 'bg-emerald-50 border-emerald-100 text-[#2C7738]'
                          }`}
                        >
                          {isZubehoer ? <Package size={16} /> : <Wrench size={16} />}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 truncate text-xs leading-tight">
                            {e.name}
                          </span>
                          {isZubehoer && (
                            <span className="px-1.5 py-0.5 bg-indigo-50 text-[#3138A0] text-[9px] font-bold rounded shrink-0">
                              Zubehör
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-500 block truncate">
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
                    <ChevronRight size={16} className="text-slate-400 shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
