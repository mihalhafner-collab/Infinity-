import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, usePixelBackLayer } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import {
  Bookmark,
  Check,
  ChevronDown,
  Home,
  Pencil,
  Users
} from 'lucide-react';
import { getEffectiveBillingCustomerId } from '../../utils/invoicePdf.ts';

export const LcrView: React.FC = () => {
  const {
    workRecords,
    customers,
    properties,
    toggleLcrWorkRecord,
    setSelectedWorkRecordId,
    setActiveModal
  } = useApp();

  const [customerFilter, setCustomerFilter] = useState<string>('all');
  const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  usePixelBackLayer(isCustomerPickerOpen, () => setIsCustomerPickerOpen(false));

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [customerFilter]);

  const allLcrRecords = useMemo(
    () => workRecords.filter((w) => Boolean(w.is_lcr)),
    [workRecords]
  );

  const customerLcrCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of allLcrRecords) {
      map.set(w.customer_id, (map.get(w.customer_id) || 0) + 1);
    }
    return map;
  }, [allLcrRecords]);

  const lcrRecords = useMemo(
    () =>
      allLcrRecords.filter((w) => {
        if (customerFilter !== 'all' && w.customer_id !== customerFilter) return false;
        return true;
      }),
    [allLcrRecords, customerFilter]
  );

  const selectedCustomerObj = useMemo(
    () =>
      customerFilter === 'all'
        ? null
        : customers.find((c) => c.id === customerFilter) || null,
    [customers, customerFilter]
  );

  const totalHours = useMemo(
    () => Math.round(lcrRecords.reduce((sum, w) => sum + w.hours, 0) * 100) / 100,
    [lcrRecords]
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
      <Header title="L.C.R." subtitle="Referenzübersicht" showBack />

      {/* Kompakte Status-/Übersichtsleiste oben */}
      <div className="px-3.5 py-2 bg-white border-b border-slate-200/80 flex items-center justify-between text-xs text-slate-600 shrink-0">
        <div className="flex items-center gap-1.5 font-semibold text-slate-800">
          <Bookmark size={14} className="text-[#3138A0]" />
          <span>Referenz-Einträge ({lcrRecords.length})</span>
        </div>
        <span className="text-[#3138A0] font-bold">
          {totalHours.toLocaleString('de-DE', { maximumFractionDigits: 2 })} Std. gesamt
        </span>
      </div>

      {/* Kompakte 2-zeilige Liste analog zu Arbeitsaufzeichnungen */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3.5 py-2.5 space-y-2 overscroll-contain"
      >
        {lcrRecords.length === 0 ? (
          <div className="p-7 bg-white border border-slate-200 rounded-2xl text-center space-y-2 mt-2">
            <div className="w-11 h-11 rounded-full bg-indigo-50 text-[#3138A0] flex items-center justify-center mx-auto">
              <Bookmark size={22} />
            </div>
            <h3 className="font-bold text-slate-900 text-sm">Keine L.C.R.-Einträge</h3>
            <p className="text-xs text-slate-500 max-w-[240px] mx-auto">
              Keine Arbeiten mit L.C.R.-Kennzeichnung für die aktuelle Auswahl vorhanden.
            </p>
            {customerFilter !== 'all' && (
              <button
                type="button"
                onClick={() => setCustomerFilter('all')}
                className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] text-xs font-bold rounded-xl transition-colors"
              >
                Alle Kunden anzeigen ({allLcrRecords.length})
              </button>
            )}
          </div>
        ) : (
          lcrRecords.map((rec) => {
            const cust = customers.find((c) => c.id === rec.customer_id);
            const prop = rec.property_id
              ? properties.find((p) => p.id === rec.property_id)
              : null;
            const effBillingId = getEffectiveBillingCustomerId(rec, customers);
            const subBillingCust =
              effBillingId !== rec.customer_id
                ? customers.find((c) => c.id === effBillingId)
                : null;
            const hasMaterials = Boolean(rec.materials && rec.materials.length > 0);
            const hasExtraMeta = Boolean(prop || subBillingCust || hasMaterials || rec.notes);

            return (
              <div
                key={rec.id}
                onClick={() => {
                  setSelectedWorkRecordId(rec.id);
                  setActiveModal('ARBEIT_BEARBEITEN');
                }}
                className="px-3 py-2.5 bg-white border border-slate-200/90 hover:border-slate-300 rounded-2xl shadow-2xs space-y-1.5 transition-all cursor-pointer active:scale-[0.99]"
              >
                {/* Zeile 1: Tätigkeit links + Status & Betrag rechts */}
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[13px] font-bold text-slate-950 leading-tight truncate">
                    {rec.title}
                  </h3>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="px-1.5 py-0.5 bg-indigo-50 text-[#3138A0] text-[10px] font-bold rounded-md">
                      L.C.R.
                    </span>
                    {rec.accounting_amount !== null ? (
                      <span className="font-bold text-[13px] text-[#B4470B] tabular-nums">
                        {rec.accounting_amount.toLocaleString('de-DE', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}{' '}
                        €
                      </span>
                    ) : (
                      <span className="font-bold text-[11px] text-[#B42318]">
                        Satz offen
                      </span>
                    )}
                  </div>
                </div>

                {/* Zeile 2: Kunde · Datum · Stunden links + L.C.R. entfernen & Bearbeiten rechts */}
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 text-[11px] text-slate-500 truncate">
                    <span className="font-semibold text-slate-700">
                      {cust?.name || 'Unbekannt'}
                    </span>
                    {' · '}
                    <span>{rec.work_date}</span>
                    {' · '}
                    <span className="font-bold text-slate-900">
                      {rec.hours.toLocaleString('de-DE', { maximumFractionDigits: 2 })} Std.
                    </span>
                    {rec.start_time && rec.end_time && (
                      <span className="text-slate-400">
                        {' '}
                        ({rec.start_time}–{rec.end_time})
                      </span>
                    )}
                  </div>

                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => toggleLcrWorkRecord(rec.id)}
                      className="h-6 px-2 rounded-lg text-[10px] font-bold bg-[#3138A0] text-white flex items-center gap-1 shadow-2xs transition-colors"
                      title="L.C.R.-Kennzeichnung entfernen"
                    >
                      <Bookmark size={10} />
                      <span>Freigeben</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedWorkRecordId(rec.id);
                        setActiveModal('ARBEIT_BEARBEITEN');
                      }}
                      className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-[#3138A0] flex items-center justify-center transition-colors"
                      title="Aufzeichnung bearbeiten"
                      aria-label="Aufzeichnung bearbeiten"
                    >
                      <Pencil size={11} />
                    </button>
                  </div>
                </div>

                {hasExtraMeta && (
                  <div className="pt-1 border-t border-slate-100 flex flex-wrap items-center gap-1.5 text-[10px]">
                    {prop && (
                      <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 font-semibold rounded-md flex items-center gap-1 max-w-[160px] truncate">
                        <Home size={9} className="text-[#3138A0] shrink-0" />
                        <span className="truncate">{prop.name}</span>
                      </span>
                    )}
                    {subBillingCust && (
                      <span className="px-1.5 py-0.5 bg-indigo-50 text-[#3138A0] font-semibold rounded-md truncate">
                        Sub → {subBillingCust.name}
                      </span>
                    )}
                    {hasMaterials && (
                      <span className="px-1.5 py-0.5 bg-amber-50 text-amber-800 font-semibold rounded-md truncate">
                        Material:{' '}
                        {rec.materials
                          .map((m) => `${m.quantity.toLocaleString('de-DE')} ${m.unit} ${m.name}`)
                          .join(', ')}
                      </span>
                    )}
                    {rec.notes && (
                      <span className="text-slate-500 italic truncate max-w-full">
                        „{rec.notes}“
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Untere Leiste fixiert (Pixel 10 Pro Daumenzone) */}
      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-md">
        {isCustomerPickerOpen && (
          <div className="px-3.5 pt-2 pb-1.5 border-b border-slate-100">
            <div className="bg-white border border-slate-200/90 rounded-2xl shadow-lg p-1.5 max-h-56 overflow-y-auto space-y-1 animate-fade-in">
              <button
                type="button"
                onClick={() => {
                  setCustomerFilter('all');
                  setIsCustomerPickerOpen(false);
                }}
                className={`w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between gap-2 text-xs transition-colors ${
                  customerFilter === 'all'
                    ? 'bg-indigo-50/80 text-[#3138A0] font-bold'
                    : 'hover:bg-slate-50 text-slate-800 font-semibold'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                      customerFilter === 'all'
                        ? 'bg-[#3138A0] text-white'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <Users size={13} />
                  </div>
                  <span className="truncate">Alle Kunden</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold">
                    {allLcrRecords.length}
                  </span>
                  {customerFilter === 'all' && <Check size={14} className="text-[#3138A0]" />}
                </div>
              </button>

              {customers.map((c) => {
                const count = customerLcrCounts.get(c.id) || 0;
                const isSelectedCust = customerFilter === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCustomerFilter(c.id);
                      setIsCustomerPickerOpen(false);
                    }}
                    className={`w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between gap-2 text-xs transition-colors ${
                      isSelectedCust
                        ? 'bg-indigo-50/80 text-[#3138A0] font-bold'
                        : 'hover:bg-slate-50 text-slate-800 font-medium'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {c.customer_number && (
                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded shrink-0">
                          #{c.customer_number}
                        </span>
                      )}
                      <span className="truncate">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                          count > 0
                            ? 'bg-indigo-50 text-[#3138A0]'
                            : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        {count}
                      </span>
                      {isSelectedCust && <Check size={14} className="text-[#3138A0]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <BottomActionBar>
          <button
            type="button"
            onClick={() => setIsCustomerPickerOpen((prev) => !prev)}
            className={`w-full h-10 px-2.5 bg-white border rounded-xl flex items-center justify-between gap-2 transition-all ${
              isCustomerPickerOpen || customerFilter !== 'all'
                ? 'border-[#3138A0] ring-1 ring-[#3138A0]/15'
                : 'border-slate-200/90 hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                  isCustomerPickerOpen || customerFilter !== 'all'
                    ? 'bg-indigo-50 text-[#3138A0]'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                <Users size={13} />
              </div>
              <span className="text-xs font-bold text-slate-900 truncate">
                {selectedCustomerObj ? selectedCustomerObj.name : 'Alle Kunden'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-md">
                {selectedCustomerObj
                  ? customerLcrCounts.get(selectedCustomerObj.id) || 0
                  : allLcrRecords.length}
              </span>
              <div
                className={`w-6 h-6 rounded-lg flex items-center justify-center transition-transform duration-200 ${
                  isCustomerPickerOpen
                    ? 'bg-indigo-50 text-[#3138A0] rotate-180'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                <ChevronDown size={14} />
              </div>
            </div>
          </button>
        </BottomActionBar>
        <BottomNav />
      </div>
    </div>
  );
};
