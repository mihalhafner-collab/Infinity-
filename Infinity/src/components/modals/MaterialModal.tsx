import React, { useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { X, Package, Tag, Euro, FileText } from 'lucide-react';

export const MaterialModal: React.FC = () => {
  const { activeModal, setActiveModal, addMaterial } = useApp();

  const [name, setName] = useState('');
  const [unit, setUnit] = useState('Stück');
  const [price, setPrice] = useState('15');
  const [category, setCategory] = useState('Verbrauchsmaterial');
  const [notes, setNotes] = useState('');

  if (activeModal !== 'MATERIAL_ANLEGEN') return null;

  const handleSave = () => {
    if (!name.trim()) return;
    addMaterial({
      name: name.trim(),
      unit: unit.trim() || 'Stück',
      price_per_unit: price ? parseFloat(price) : null,
      category: category.trim() || 'Verbrauchsmaterial',
      notes: notes.trim()
    });
    setActiveModal(null);
    setName('');
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
      <div className="flex-1" onClick={() => setActiveModal(null)} />

      <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[90%] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900 leading-tight">Neues Material anlegen</h2>
            <p className="text-[11px] text-slate-500">Material- & Preisstammdaten (M11)</p>
          </div>
          <button
            onClick={() => setActiveModal(null)}
            className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-full hover:bg-slate-100 transition-colors"
            aria-label="Schließen"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3.5 text-xs text-slate-700">
          <div>
            <label className="font-semibold text-slate-700 block mb-1 flex items-center gap-1">
              <Package size={13} className="text-slate-500" />
              <span>Materialbezeichnung *</span>
            </label>
            <input
              type="text"
              required
              placeholder="z. B. Rindenmulch fein"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm text-slate-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="font-semibold text-slate-700 block mb-1 flex items-center gap-1">
                <Tag size={13} className="text-slate-500" />
                <span>Einheit</span>
              </label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm text-slate-900"
              >
                <option value="Stück">Stück</option>
                <option value="Sack">Sack</option>
                <option value="m³">m³</option>
                <option value="m²">m²</option>
                <option value="m">m</option>
                <option value="kg">kg</option>
                <option value="l">l</option>
                <option value="Pauschale">Pauschale</option>
              </select>
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1 flex items-center gap-1">
                <Euro size={13} className="text-slate-500" />
                <span>Preis (€)</span>
              </label>
              <input
                type="number"
                step="0.01"
                placeholder="z. B. 12.50"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm text-slate-900 font-semibold"
              />
            </div>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Kategorie
            </label>
            <input
              type="text"
              placeholder="z. B. Verbrauchsmaterial, Dünger, Pflanzgut"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm text-slate-900"
            />
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1 flex items-center gap-1">
              <FileText size={13} className="text-slate-500" />
              <span>Notiz / Artikelnummer</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="z. B. 60l Sack, Körnung 0-20mm"
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 resize-none"
            />
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
            disabled={!name.trim()}
            className="flex-1 h-12 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-all shadow-xs"
          >
            Material anlegen
          </button>
        </div>
      </div>
    </div>
  );
};
