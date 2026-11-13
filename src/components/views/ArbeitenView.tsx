import React, { useMemo, useState } from 'react';
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
  Clock,
  Home,
  Lock,
  Pencil,
  Receipt,
  Search,
  Trash2,
  X
} from 'lucide-react';
import { WorkRecord } from '../../types/index.ts';
import { getEffectiveBillingCustomerId } from '../../utils/invoicePdf.ts';
import {
  formatIsoToDeSearchable,
  matchesSearchQuery
} from '../../utils/searchUtils.ts';

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
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [lockedNotice, setLockedNotice] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  usePixelBackLayer(selectionMode, () => {
    setSelectionMode(false);
    setSelectedIds([]);
  });

  const filteredRecords = useMemo(
    () =>
      workRecords.filter((w) => {
        if (filterCustomer !== 'all' && w.customer_id !== filterCustomer) return false;
        if (searchQuery.trim()) {
          const cust = customers.find((c) => c.id === w.customer_id);
          const prop = w.property_id
            ? properties.find((p) => p.id === w.property_id)
            : undefined;
          const matText = (w.materials || []).map((m) => m.name).join(' ');
          return matchesSearchQuery(searchQuery, [
            w.title,
            w.notes,
            formatIsoToDeSearchable(w.work_date),
            cust?.name,
            prop?.name,
            matText
          ]);
        }
        return true;
      }),
    [workRecords, filterCustomer, searchQuery, customers, properties]
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
        <div className="m-3 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-[#B42318] flex items-start gap-2 animate-fade-in shadow-xs shrink-0">
          <Lock size={15} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block">Hinweis zur Sperre</span>
            <span>{lockedNotice}</span>
          </div>
        </div>
      )}

      {/* List of Work Records (WF-013, WF-014, WF-015) */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 overscroll-contain">
        <div className="p-2.5 bg-slate-100/80 rounded-xl text-[11px] text-slate-500">
          Alle Originalaufzeichnungen bleiben erhalten. Über „Auswählen“ können mehrere Arbeiten gemeinsam abgerechnet, auf L.C.R. gesetzt oder gelöscht werden.
        </div>

        {filteredRecords.length === 0 ? (
          <div className="p-8 bg-white border border-slate-200 rounded-2xl text-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-indigo-50 text-[#3138A0] flex items-center justify-center mx-auto">
              <Briefcase size={24} />
            </div>
            <h3 className="font-bold text-slate-900 text-sm">Keine Arbeitsaufzeichnungen</h3>
            <p className="text-xs text-slate-500 max-w-[240px] mx-auto">
              Erfassen Sie geleistete Arbeitsstunden und verwendete Materialien über das + Menü unten.
            </p>
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

            return (
              <div
                key={rec.id}
                onClick={selectionMode ? () => toggleSelectRecord(rec.id) : undefined}
                className={`p-3.5 bg-white border rounded-2xl shadow-2xs space-y-2.5 transition-all ${
                  selectionMode ? 'cursor-pointer active:scale-[0.99]' : ''
                } ${
                  selectionMode && isSelected
                    ? 'border-[#3138A0] bg-indigo-50/25 ring-1 ring-[#3138A0]/20'
                    : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {selectionMode ? (
                      <div
                        className={`w-6 h-6 mt-0.5 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? 'bg-[#3138A0] border-[#3138A0] text-white'
                            : 'bg-white border-slate-300'
                        }`}
                      >
                        {isSelected && <Check size={14} strokeWidth={3} />}
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-[#3138A0] shrink-0 font-bold text-xs">
                        <Clock size={16} />
                      </div>
                    )}

                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-slate-900 leading-tight">
                        {rec.title}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {cust?.name} · {rec.work_date}
                      </p>
                      {(prop || subBillingCust) && (
                        <p className="text-[10px] font-semibold text-[#3138A0] flex items-center gap-1 mt-0.5">
                          {prop && (
                            <>
                              <Home size={10} className="shrink-0" />
                              <span className="truncate">{prop.name}</span>
                            </>
                          )}
                          {prop && subBillingCust && <span>·</span>}
                          {subBillingCust && (
                            <span className="truncate">Sub → {subBillingCust.name}</span>
                          )}
                        </p>
                      )}
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        {rec.start_time && rec.end_time ? `${rec.start_time}–${rec.end_time}` : ''}
                        {rec.break_minutes ? ` (−${rec.break_minutes}m Pause)` : ''}
                        {rec.start_time && rec.end_time ? ' · ' : ''}
                        <span className="font-semibold text-slate-800">
                          {rec.hours.toLocaleString('de-DE', { maximumFractionDigits: 2 })} Std.
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    {rec.accounting_amount !== null ? (
                      <span className="font-bold text-sm text-[#B4470B] block">
                        {rec.accounting_amount.toLocaleString('de-DE', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}{' '}
                        €
                      </span>
                    ) : (
                      <span className="font-bold text-xs text-[#B42318] block">
                        Satz offen
                      </span>
                    )}
                    {isBilled ? (
                      <span className="px-1.5 py-0.5 bg-emerald-50 text-[#2C7738] text-[10px] font-bold rounded">
                        Abgerechnet
                      </span>
                    ) : rec.is_lcr ? (
                      <span className="px-1.5 py-0.5 bg-indigo-50 text-[#3138A0] text-[10px] font-bold rounded">
                        L.C.R.
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 bg-orange-50 text-[#B4470B] text-[10px] font-bold rounded">
                        Offen
                      </span>
                    )}
                  </div>
                </div>

                {rec.materials && rec.materials.length > 0 && (
                  <div className="p-2 bg-amber-50/70 border border-amber-100 rounded-lg text-[11px] text-slate-700 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-amber-800">Material:</span>
                    {rec.materials.map((m, i) => (
                      <span key={i}>
                        {m.quantity.toLocaleString('de-DE')} {m.unit} {m.name}
                        {m.total !== null
                          ? ` (${m.total.toLocaleString('de-DE', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })} €)`
                          : ''}
                        {i < rec.materials.length - 1 ? ',' : ''}
                      </span>
                    ))}
                  </div>
                )}

                {rec.notes && (
                  <p className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded-lg italic">
                    {rec.notes}
                  </p>
                )}

                {/* L.C.R. Schalter & Bearbeiten Bar (ausgeblendet im Mehrfachauswahl-Modus für ruhige Bedienung) */}
                {!selectionMode && (
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <Bookmark
                        size={14}
                        className={rec.is_lcr ? 'text-[#3138A0]' : 'text-slate-400'}
                      />
                      <span className="font-medium">L.C.R.:</span>
                      {isBilled ? (
                        <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                          Rechnung fixiert
                        </span>
                      ) : (
                        <button
                          onClick={() => handleToggleLcr(rec)}
                          className={`px-2 py-0.5 text-[11px] font-semibold rounded-md transition-colors ${
                            rec.is_lcr
                              ? 'bg-[#3138A0] text-white shadow-2xs'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {rec.is_lcr ? 'Aktiviert' : 'Aktivieren'}
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        setSelectedWorkRecordId(rec.id);
                        setActiveModal('ARBEIT_BEARBEITEN');
                      }}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center gap-1.5 transition-colors"
                      title="Aufzeichnung bearbeiten"
                    >
                      <Pencil size={12} className="text-[#3138A0]" />
                      <span>Bearbeiten</span>
                    </button>
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
        {/* Filter & Schnellsuche im unteren Bedienbereich */}
        <div className="px-3.5 pt-2.5 pb-1.5 border-b border-slate-100 space-y-1.5">
          <div className="flex items-center gap-2 text-xs">
            <div className="flex-1 min-w-0 h-9 bg-slate-50 border border-slate-200 rounded-xl px-2.5 flex items-center gap-1.5 focus-within:bg-white focus-within:border-[#3138A0] transition-colors">
              <Search size={14} className="text-slate-400 shrink-0" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tätigkeit, Kunde, Datum…"
                className="flex-1 min-w-0 bg-transparent border-none outline-hidden text-xs font-medium text-slate-900 placeholder:text-slate-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-slate-400 hover:text-slate-700"
                  aria-label="Filter zurücksetzen"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <select
              value={filterCustomer}
              onChange={(e) => {
                setFilterCustomer(e.target.value);
                setSelectedIds([]);
              }}
              className="w-[140px] shrink-0 h-9 bg-slate-50 border border-slate-200 rounded-xl px-2 text-xs font-semibold text-slate-700 outline-hidden truncate"
            >
              <option value="all">Alle Kunden ({workRecords.length})</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

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

        <BottomActionBar />
        <BottomNav />
      </div>
    </div>
  );
};
