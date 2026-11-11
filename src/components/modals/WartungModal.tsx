import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { X, Calendar, Wrench, CheckCircle } from 'lucide-react';

export const WartungModal: React.FC = () => {
  const {
    activeModal,
    setActiveModal,
    equipments,
    selectedEquipmentId,
    recordMaintenance
  } = useApp();

  const geraeteOnly = equipments.filter((e) => (e.item_type || 'geraet') === 'geraet');

  const [equipmentId, setEquipmentId] = useState<string>('');
  const [plan, setPlan] = useState('Messer reinigen & schärfen');
  const [date, setDate] = useState('2026-11-10');
  const [nextDate, setNextDate] = useState('2027-02-10');
  const [note, setNote] = useState('Sichtprüfung und Reinigung durchgeführt');

  useEffect(() => {
    if (activeModal === 'WARTUNG_DOKUMENTIEREN') {
      const initial =
        geraeteOnly.find((e) => e.id === selectedEquipmentId) || geraeteOnly[0] || null;
      setEquipmentId(initial?.id || '');
      setPlan(initial?.maintenance_plan || 'Regelmäßige Prüfung & Reinigung');
      setDate('2026-11-10');
      const months = initial?.interval_months || 6;
      const d = new Date('2026-11-10T00:00:00');
      d.setMonth(d.getMonth() + months);
      setNextDate(d.toISOString().slice(0, 10));
      setNote('Sichtprüfung und Wartung durchgeführt');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModal, selectedEquipmentId]);

  if (activeModal !== 'WARTUNG_DOKUMENTIEREN') return null;

  const handleSave = () => {
    if (!equipmentId) return;
    recordMaintenance(equipmentId, plan, note, nextDate);
    setActiveModal(null);
  };

  const selectedEq = geraeteOnly.find((e) => e.id === equipmentId);

  return (
    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
      <div className="flex-1" onClick={() => setActiveModal(null)} />

      <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[90%] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5 min-w-0">
            {selectedEq?.photo && (
              <img
                src={selectedEq.photo}
                alt={selectedEq.name}
                className="w-10 h-10 rounded-xl object-cover border border-slate-200 shrink-0"
              />
            )}
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 leading-tight">Wartung dokumentieren</h2>
              <p className="text-[11px] text-slate-500 truncate">
                {selectedEq?.name || 'Gerätewartung'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveModal(null)}
            className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-full hover:bg-slate-100 transition-colors shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3 text-xs text-slate-700">
          <div>
            <label className="font-semibold text-slate-700 block mb-1 flex items-center gap-1">
              <Wrench size={13} className="text-slate-500" />
              <span>Gerät</span>
            </label>
            <select
              value={equipmentId}
              onChange={(e) => {
                setEquipmentId(e.target.value);
                const eq = geraeteOnly.find((x) => x.id === e.target.value);
                if (eq) setPlan(eq.maintenance_plan || 'Regelmäßige Prüfung');
              }}
              className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm text-slate-900"
            >
              {geraeteOnly.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.name} {eq.model ? `(${eq.model})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Wartungsplan / Vorgabe
            </label>
            <input
              type="text"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm text-slate-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="font-semibold text-slate-700 block mb-1 flex items-center gap-1">
                <Calendar size={13} className="text-slate-500" />
                <span>Durchgeführt am</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1 flex items-center gap-1">
                <Calendar size={13} className="text-slate-500" />
                <span>Nächste Fälligkeit</span>
              </label>
              <input
                type="date"
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
                className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 font-semibold text-[#2C7738]"
              />
            </div>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Notiz / Bemerkungen
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 resize-none"
            />
          </div>

          <div className="p-2.5 bg-emerald-50 border border-emerald-200/80 rounded-xl text-[11px] text-[#2C7738] flex items-center gap-2">
            <CheckCircle size={15} />
            <span>
              Wartung setzt den Gerätestatus auf „Einsatzbereit“ und archiviert den Eintrag in der Historie.
            </span>
          </div>
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
            className="flex-1 h-12 bg-[#2C7738] hover:bg-[#235f2d] active:scale-98 text-white font-semibold rounded-xl text-sm transition-all shadow-xs"
          >
            Wartung speichern
          </button>
        </div>
      </div>
    </div>
  );
};
