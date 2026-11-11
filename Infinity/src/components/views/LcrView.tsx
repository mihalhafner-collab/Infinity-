import React, { useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { Bookmark, Clock, User, ChevronRight, Check, Pencil } from 'lucide-react';

export const LcrView: React.FC = () => {
  const { workRecords, customers, toggleLcrWorkRecord, setSelectedWorkRecordId, setActiveModal } = useApp();

  const [customerFilter, setCustomerFilter] = useState<string>('all');

  // Filter only L.C.R. records
  const lcrRecords = workRecords.filter((w) => {
    if (!w.is_lcr) return false;
    if (customerFilter !== 'all' && w.customer_id !== customerFilter) return false;
    return true;
  });

  const totalHours = lcrRecords.reduce((sum, w) => sum + w.hours, 0);

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
      <Header title="L.C.R." subtitle="Referenzübersicht" showBack />

      {/* Reine Status-/Übersichtsleiste oben */}
      <div className="px-4 py-2 bg-white border-b border-slate-200/80 flex items-center justify-between text-xs text-slate-600 shrink-0">
        <div className="flex items-center gap-1.5 font-semibold text-slate-800">
          <Bookmark size={15} className="text-[#3138A0]" />
          <span>Referenz-Einträge ({lcrRecords.length})</span>
        </div>
        <span className="text-[#3138A0] font-bold">{totalHours} Std. gesamt</span>
      </div>

      {/* Body List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 overscroll-contain">
        <div className="p-2.5 bg-indigo-50/60 border border-indigo-100 rounded-xl text-[11px] text-[#3138A0] leading-relaxed">
          Referenzen auf markierte Originalaufzeichnungen. Keine eigene Abrechnung, keine Kopie und kein Zahlungsbereich (gemäß REQ-015/016).
        </div>

        {lcrRecords.length === 0 ? (
          <div className="p-8 bg-white border border-slate-200 rounded-2xl text-center text-slate-400 text-xs">
            Keine Arbeiten mit L.C.R.-Kennzeichnung vorhanden.
          </div>
        ) : (
          lcrRecords.map((rec) => {
            const cust = customers.find((c) => c.id === rec.customer_id);

            return (
              <div
                key={rec.id}
                className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-[#3138A0] shrink-0 font-bold text-xs">
                      <Clock size={16} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 leading-tight">
                        {rec.title}
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {cust?.name} · {rec.work_date}
                      </p>
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

                  <span className="px-2 py-0.5 bg-indigo-50 text-[#3138A0] text-[10px] font-bold rounded-md">
                    L.C.R.
                  </span>
                </div>

                {rec.materials && rec.materials.length > 0 && (
                  <div className="p-2 bg-amber-50/70 border border-amber-100 rounded-lg text-[11px] text-slate-700 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-amber-800">Material:</span>
                    {rec.materials.map((m, i) => (
                      <span key={i}>
                        {m.quantity.toLocaleString('de-DE')} {m.unit} {m.name}
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

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <button
                    onClick={() => {
                      setSelectedWorkRecordId(rec.id);
                      setActiveModal('ARBEIT_BEARBEITEN');
                    }}
                    className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center gap-1.5 transition-colors"
                  >
                    <Pencil size={12} className="text-[#3138A0]" />
                    <span>Bearbeiten</span>
                  </button>

                  <button
                    onClick={() => toggleLcrWorkRecord(rec.id)}
                    className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    Kennzeichnung entfernen
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Untere Leiste fixiert (Pixel 10 Pro Daumenzone) */}
      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-md">
        <BottomActionBar>
          <select
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            className="h-10 bg-slate-100 border border-slate-200 rounded-xl px-3 text-xs font-semibold text-slate-700 outline-hidden max-w-[200px]"
          >
            <option value="all">Alle Kunden</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </BottomActionBar>
        <BottomNav />
      </div>
    </div>
  );
};
