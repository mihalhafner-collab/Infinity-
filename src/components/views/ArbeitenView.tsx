import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, usePixelBackLayer } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { UndoToast } from '../common/UndoToast.tsx';
import {
  Briefcase,
  Bookmark,
  Check,
  CheckSquare,
  ChevronDown,
  Home,
  Lock,
  Pencil,
  Receipt,
  Trash2,
  Users
} from 'lucide-react';
import { WorkRecord } from '../../types/index.ts';
import { getEffectiveBillingCustomerId } from '../../utils/invoicePdf.ts';

type WorkStatusFilter = 'all' | 'open' | 'billed' | 'lcr';

export const ArbeitenView: React.FC = () => {
  const {
    workRecords,
    customers,
    properties,
    toggleLcrWorkRecord,
    setLcrWorkRecordsBatch,
    deleteWorkRecordsBatch,
    setActiveModal,
    setSelectedCustomerId,
    setSelectedWorkRecordId,
    setPreselectedWorkRecordIds
  } = useApp();

  const [filterCustomer, setFilterCustomer] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<WorkStatusFilter>('all');
  const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState<boolean>(false);
  const [lockedNotice, setLockedNotice] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [filterCustomer, statusFilter]);

  usePixelBackLayer(selectionMode, () => {
    setSelectionMode(false);
    setSelectedIds([]);
  });

  usePixelBackLayer(isCustomerPickerOpen, () => {
    setIsCustomerPickerOpen(false);
  });

  // Anzahl Aufzeichnungen pro Kunde
  const customerRecordCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of workRecords) {
      map.set(w.customer_id, (map.get(w.customer_id) || 0) + 1);
    }
    return map;
  }, [workRecords]);

  // Basis-Filterung nach gewähltem Kunden (für exakte Status-Zähler)
  const baseFilteredRecords = useMemo(
    () =>
      workRecords.filter((w) => {
        if (filterCustomer !== 'all' && w.customer_id !== filterCustomer) return false;
        return true;
      }),
    [workRecords, filterCustomer]
  );

  // Zähler für Alle / Offen / Abgerechnet / L.C.R.
  const statusCounts = useMemo(() => {
    let open = 0;
    let billed = 0;
    let lcr = 0;
    for (const w of baseFilteredRecords) {
      if (w.settlement_id) {
        billed++;
      } else if (w.is_lcr) {
        lcr++;
      } else {
        open++;
      }
    }
    return {
      all: baseFilteredRecords.length,
      open,
      billed,
      lcr
    };
  }, [baseFilteredRecords]);

  // Endgültige Liste nach Status-Auswahl
  const filteredRecords = useMemo(
    () =>
      baseFilteredRecords.filter((w) => {
        if (statusFilter === 'open') return !w.settlement_id && !w.is_lcr;
        if (statusFilter === 'billed') return Boolean(w.settlement_id);
        if (statusFilter === 'lcr') return !w.settlement_id && Boolean(w.is_lcr);
        return true;
      }),
    [baseFilteredRecords, statusFilter]
  );

  const selectedCustomerObj = useMemo(
    () =>
      filterCustomer === 'all'
        ? null
        : customers.find((c) => c.id === filterCustomer) || null,
    [customers, filterCustomer]
  );

  const selectedRecords = useMemo(
    () => filteredRecords.filter((w) => selectedIds.includes(w.id)),
    [filteredRecords, selectedIds]
  );

  const unbilledSelected = useMemo(
    () => selectedRecords.filter((w) => !w.settlement_id),
    [selectedRecords]
  );

  const openBillableSelected = useMemo(
    () => selectedRecords.filter((w) => !w.settlement_id && !w.is_lcr),
    [selectedRecords]
  );

  const selectedHoursSum = useMemo(
    () => Math.round(selectedRecords.reduce((sum, r) => sum + r.hours, 0) * 100) / 100,
    [selectedRecords]
  );

  const selectedAmountSum = useMemo(
    () =>
      Math.round(
        selectedRecords.reduce((sum, r) => sum + (r.accounting_amount ?? 0), 0) * 100
      ) / 100,
    [selectedRecords]
  );

  const showLockedBanner = (msg: string) => {
    setLockedNotice(msg);
    setTimeout(() => setLockedNotice(null), 4000);
  };

  const handleToggleLcr = (record: WorkRecord) => {
    const res = toggleLcrWorkRecord(record.id);
    if (!res.success && res.reason) {
      showLockedBanner(res.reason);
    }
  };

  const toggleSelectRecord = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllFiltered = () => {
    if (selectedIds.length === filteredRecords.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredRecords.map((r) => r.id));
    }
  };

  const handleSelectOpenOnly = () => {
    const openIds = filteredRecords
      .filter((r) => !r.settlement_id && !r.is_lcr)
      .map((r) => r.id);
    setSelectedIds(openIds);
  };

  const handleBatchInvoice = () => {
    if (openBillableSelected.length === 0) {
      showLockedBanner(
        'Nur offene Arbeiten ohne L.C.R. können abgerechnet werden.'
      );
      return;
    }
    const firstBillable = openBillableSelected[0];
    const targetCustId =
      getEffectiveBillingCustomerId(firstBillable, customers) || firstBillable.customer_id;
    setSelectedCustomerId(targetCustId);
    setPreselectedWorkRecordIds(openBillableSelected.map((r) => r.id));
    setSelectionMode(false);
    setSelectedIds([]);
    setActiveModal('RECHNUNG_VORBEREITEN');
  };

  const handleBatchLcr = () => {
    if (unbilledSelected.length === 0) {
      showLockedBanner('Abgerechnete Arbeiten sind in einer Rechnung fixiert.');
      return;
    }
    const shouldActivate = unbilledSelected.some((r) => !r.is_lcr);
    setLcrWorkRecordsBatch(
      unbilledSelected.map((r) => r.id),
      shouldActivate
    );
    if (unbilledSelected.length < selectedRecords.length) {
      showLockedBanner(
        'Abgerechnete Einträge blieben unverändert (Rechnung fixiert).'
      );
    }
  };

  const handleBatchDelete = () => {
    if (unbilledSelected.length === 0) {
      showLockedBanner(
        'Abgerechnete Arbeiten können nicht gelöscht werden (Rechnung fixiert).'
      );
      return;
    }
    const deleteIds = unbilledSelected.map((r) => r.id);
    deleteWorkRecordsBatch(deleteIds);
    setSelectedIds((prev) => prev.filter((id) => !deleteIds.includes(id)));
    if (unbilledSelected.length < selectedRecords.length) {
      showLockedBanner(
        'Abgerechnete Einträge wurden übersprungen (Rechnung fixiert).'
      );
    } else {
      setSelectionMode(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
      <Header
        title="Arbeitsaufzeichnungen"
        subtitle={`${filteredRecords.length} Aufzeichnungen`}
        showBack
      />

      {/* Locked notice banner */}
      {lockedNotice && (
        <div className="mx-3 mt-2 p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-[#B42318] flex items-start gap-2 animate-fade-in shadow-xs shrink-0">
          <Lock size={14} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block">Hinweis zur Sperre</span>
            <span>{lockedNotice}</span>
          </div>
        </div>
      )}

      {/* Kompakte, übersichtliche Liste der Arbeitsaufzeichnungen */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3.5 py-2.5 space-y-2 overscroll-contain"
      >
        {filteredRecords.length === 0 ? (
          <div className="p-7 bg-white border border-slate-200 rounded-2xl text-center space-y-2.5 mt-2">
            <div className="w-11 h-11 rounded-full bg-indigo-50 text-[#3138A0] flex items-center justify-center mx-auto">
              <Briefcase size={22} />
            </div>
            <h3 className="font-bold text-slate-900 text-sm">Keine Arbeitsaufzeichnungen</h3>
            <p className="text-xs text-slate-500 max-w-[240px] mx-auto">
              {filterCustomer !== 'all' || statusFilter !== 'all'
                ? 'Keine Einträge für die gewählten Filter gefunden.'
                : 'Erfassen Sie geleistete Arbeitsstunden über das + Menü unten.'}
            </p>
            {(filterCustomer !== 'all' || statusFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setFilterCustomer('all');
                  setStatusFilter('all');
                }}
                className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] text-xs font-bold rounded-xl transition-colors"
              >
                Alle anzeigen ({workRecords.length})
              </button>
            )}
          </div>
        ) : (
          filteredRecords.map((rec) => {
            const cust = customers.find((c) => c.id === rec.customer_id);
            const prop = rec.property_id ? properties.find((p) => p.id === rec.property_id) : null;
            const effBillingId = getEffectiveBillingCustomerId(rec, customers);
            const subBillingCust =
              effBillingId !== rec.customer_id
                ? customers.find((c) => c.id === effBillingId)
                : null;
            const isBilled = !!rec.settlement_id;
            const isSelected = selectedIds.includes(rec.id);
            const hasMaterials = Boolean(rec.materials && rec.materials.length > 0);
            const hasExtraMeta = Boolean(prop || subBillingCust || hasMaterials || rec.notes);

            return (
              <div
                key={rec.id}
                onClick={() => {
                  if (selectionMode) {
                    toggleSelectRecord(rec.id);
                  } else {
                    setSelectedWorkRecordId(rec.id);
                    setActiveModal('ARBEIT_BEARBEITEN');
                  }
                }}
                className={`px-3 py-2.5 bg-white border rounded-2xl shadow-2xs space-y-1.5 transition-all cursor-pointer active:scale-[0.99] ${
                  selectionMode && isSelected
                    ? 'border-[#3138A0] bg-indigo-50/25 ring-1 ring-[#3138A0]/20'
                    : 'border-slate-200/90 hover:border-slate-300'
                }`}
              >
                {/* Zeile 1: Tätigkeit links + Status & Betrag rechts */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {selectionMode && (
                      <div
                        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? 'bg-[#3138A0] border-[#3138A0] text-white'
                            : 'bg-white border-slate-300'
                        }`}
                      >
                        {isSelected && <Check size={12} strokeWidth={3} />}
                      </div>
                    )}
                    <h3 className="text-[13px] font-bold text-slate-950 leading-tight truncate">
                      {rec.title}
                    </h3>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isBilled ? (
                      <span className="px-1.5 py-0.5 bg-emerald-50 text-[#2C7738] text-[10px] font-bold rounded-md">
                        Abgerechnet
                      </span>
                    ) : rec.is_lcr ? (
                      <span className="px-1.5 py-0.5 bg-indigo-50 text-[#3138A0] text-[10px] font-bold rounded-md">
                        L.C.R.
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 bg-orange-50 text-[#B4470B] text-[10px] font-bold rounded-md">
                        Offen
                      </span>
                    )}

                    {rec.accounting_amount != null ? (
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

                {/* Zeile 2: Kunde · Datum · Stunden links + L.C.R.-Schnellwahl & Bearbeiten rechts */}
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

                  {!selectionMode && (
                    <div
                      className="flex items-center gap-1 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!isBilled && (
                        <button
                          type="button"
                          onClick={() => handleToggleLcr(rec)}
                          className={`h-6 px-2 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors ${
                            rec.is_lcr
                              ? 'bg-[#3138A0] text-white shadow-2xs'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                          title={rec.is_lcr ? 'L.C.R. deaktivieren' : 'Auf L.C.R. setzen'}
                        >
                          <Bookmark size={10} />
                          <span>L.C.R.</span>
                        </button>
                      )}

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
                  )}
                </div>

                {/* Optionale Zusatzinfos (Objekt, Sub-Abrechnung, Material, Notiz) kompakt in einer Zeile */}
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

      {/* Undo-Banner für Mehrfach-Löschung */}
      <UndoToast />

      {/* Mehrfach-Aktionsleiste in der Daumenzone */}
      {selectionMode && selectedRecords.length > 0 && (
        <div className="shrink-0 bg-slate-900 text-white px-3.5 py-2.5 border-t border-slate-800 z-30 space-y-2 animate-slide-up">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold">
              {selectedRecords.length} gewählt ·{' '}
              {selectedHoursSum.toLocaleString('de-DE', { maximumFractionDigits: 2 })} Std.
            </span>
            <span className="font-bold text-amber-300">
              {selectedAmountSum.toLocaleString('de-DE', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}{' '}
              €
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={handleBatchInvoice}
              disabled={openBillableSelected.length === 0}
              className="h-10 bg-[#3138A0] hover:bg-[#272d82] disabled:opacity-40 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Receipt size={14} />
              <span>Abrechnen ({openBillableSelected.length})</span>
            </button>

            <button
              type="button"
              onClick={handleBatchLcr}
              disabled={unbilledSelected.length === 0}
              className="h-10 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Bookmark size={14} />
              <span>L.C.R.</span>
            </button>

            <button
              type="button"
              onClick={handleBatchDelete}
              disabled={unbilledSelected.length === 0}
              className="h-10 bg-red-600/90 hover:bg-red-600 disabled:opacity-40 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Trash2 size={14} />
              <span>Löschen</span>
            </button>
          </div>
        </div>
      )}

      {/* Untere Bedienleiste fixiert (Pixel 10 Pro Daumenzone) */}
      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-md">
        <div className="px-3.5 pt-2 pb-1.5 border-b border-slate-100 space-y-1.5">
          {/* Ausklappbare Kundenauswahl im einheitlichen App-Design */}
          {isCustomerPickerOpen && (
            <div className="bg-white border border-slate-200/90 rounded-2xl shadow-lg p-1.5 max-h-56 overflow-y-auto space-y-1 animate-fade-in">
              <button
                type="button"
                onClick={() => {
                  setFilterCustomer('all');
                  setSelectedIds([]);
                  setIsCustomerPickerOpen(false);
                }}
                className={`w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between gap-2 text-xs transition-colors ${
                  filterCustomer === 'all'
                    ? 'bg-indigo-50/80 text-[#3138A0] font-bold'
                    : 'hover:bg-slate-50 text-slate-800 font-semibold'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                      filterCustomer === 'all'
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
                    {workRecords.length}
                  </span>
                  {filterCustomer === 'all' && <Check size={14} className="text-[#3138A0]" />}
                </div>
              </button>

              {customers.map((c) => {
                const count = customerRecordCounts.get(c.id) || 0;
                const isSelectedCust = filterCustomer === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setFilterCustomer(c.id);
                      setSelectedIds([]);
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
          )}

          {/* Kundenauswahl im einheitlichen ausklappbaren Design + Wählen-Button */}
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setIsCustomerPickerOpen((prev) => !prev)}
              className={`flex-1 min-w-0 h-9 px-2.5 bg-white border rounded-xl flex items-center justify-between gap-2 transition-all ${
                isCustomerPickerOpen || filterCustomer !== 'all'
                  ? 'border-[#3138A0] ring-1 ring-[#3138A0]/15'
                  : 'border-slate-200/90 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    isCustomerPickerOpen || filterCustomer !== 'all'
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
                    ? customerRecordCounts.get(selectedCustomerObj.id) || 0
                    : workRecords.length}
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

            {filteredRecords.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (selectionMode) {
                    setSelectionMode(false);
                    setSelectedIds([]);
                  } else {
                    setSelectionMode(true);
                  }
                }}
                className={`h-9 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 ${
                  selectionMode
                    ? 'bg-[#3138A0] text-white'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                }`}
              >
                <CheckSquare size={14} />
                <span>{selectionMode ? 'Fertig' : 'Wählen'}</span>
              </button>
            )}
          </div>

          {selectionMode && filteredRecords.length > 0 && (
            <div className="flex items-center justify-between gap-2 text-[11px] pt-0.5">
              <span className="font-semibold text-[#3138A0]">
                {selectedIds.length} ausgewählt
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSelectOpenOnly}
                  className="px-2.5 py-1 rounded-lg bg-orange-50 text-[#B4470B] font-semibold hover:bg-orange-100 transition-colors"
                >
                  Offene wählen
                </button>
                <button
                  type="button"
                  onClick={handleSelectAllFiltered}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition-colors"
                >
                  {selectedIds.length === filteredRecords.length ? 'Keine' : 'Alle'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Gelber Bereich: Status-Auswahl [Alle | Offen | Abger. | L.C.R.] direkt links neben Lupe & Plus */}
        <BottomActionBar>
          <div className="w-full grid grid-cols-4 gap-0.5 p-1 bg-slate-100 rounded-2xl">
            {(
              [
                {
                  id: 'all',
                  label: 'Alle',
                  count: statusCounts.all,
                  activeClass: 'bg-white text-slate-900 shadow-2xs'
                },
                {
                  id: 'open',
                  label: 'Offen',
                  count: statusCounts.open,
                  activeClass: 'bg-white text-[#B4470B] shadow-2xs'
                },
                {
                  id: 'billed',
                  label: 'Abger.',
                  count: statusCounts.billed,
                  activeClass: 'bg-white text-[#2C7738] shadow-2xs'
                },
                {
                  id: 'lcr',
                  label: 'L.C.R.',
                  count: statusCounts.lcr,
                  activeClass: 'bg-white text-[#3138A0] shadow-2xs'
                }
              ] as const
            ).map((tab) => {
              const isActive = statusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setStatusFilter(tab.id);
                    setSelectedIds([]);
                  }}
                  className={`py-2 px-1 rounded-xl text-[10px] font-bold flex items-center justify-center gap-0.5 transition-all min-w-0 ${
                    isActive ? tab.activeClass : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span className="truncate">{tab.label}</span>
                  <span
                    className={`text-[9px] px-1 rounded shrink-0 ${
                      isActive ? 'bg-slate-100 font-extrabold' : 'text-slate-400 font-semibold'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </BottomActionBar>
        <BottomNav />
      </div>
    </div>
  );
};
