import React, { useEffect, useState } from 'react';
import { useApp, usePixelBackLayer } from '../../context/AppContext.tsx';
import { X, Package, Tag, Euro, FileText, Trash2 } from 'lucide-react';

const UNIT_PRESETS = ['Stück', 'Sack', 'm³', 'm²', 'm', 'kg', 'Liter', 'Pauschale'];
const CATEGORY_PRESETS = ['Verbrauchsmaterial', 'Erde & Mulch', 'Dünger & Saatgut', 'Pflanzgut', 'Entsorgung'];

export const MaterialModal: React.FC = () => {
  const {
    activeModal,
    setActiveModal,
    materials,
    selectedMaterialId,
    setSelectedMaterialId,
    addMaterial,
    updateMaterial,
    deleteMaterial
  } = useApp();

  const isOpen = activeModal === 'MATERIAL_ANLEGEN' || activeModal === 'MATERIAL_BEARBEITEN';
  const editingMaterial =
    activeModal === 'MATERIAL_BEARBEITEN' && selectedMaterialId
      ? materials.find((m) => m.id === selectedMaterialId) || null
      : null;

  const [name, setName] = useState('');
  const [unit, setUnit] = useState('Stück');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('Verbrauchsmaterial');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    if (editingMaterial) {
      setName(editingMaterial.name || '');
      setUnit(editingMaterial.unit || 'Stück');
      setPrice(
        editingMaterial.price_per_unit !== null && editingMaterial.price_per_unit !== undefined
          ? String(editingMaterial.price_per_unit).replace('.', ',')
          : ''
      );
      setCategory(editingMaterial.category || 'Verbrauchsmaterial');
      setNotes(editingMaterial.notes || '');
    } else {
      setName('');
      setUnit('Stück');
      setPrice('');
      setCategory('Verbrauchsmaterial');
      setNotes('');
    }
  }, [isOpen, editingMaterial]);

  const handleClose = () => {
    setActiveModal(null);
    setSelectedMaterialId(null);
  };

  usePixelBackLayer(isOpen, handleClose);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const rawPrice = price.trim().replace(/\s+/g, '');
    const cleanedPrice = rawPrice.includes(',')
      ? rawPrice.replace(/\./g, '').replace(',', '.')
      : rawPrice;
    const parsedPrice =
      cleanedPrice === ''
        ? null
        : Number.isFinite(parseFloat(cleanedPrice))
          ? Math.round(parseFloat(cleanedPrice) * 100) / 100
          : null;

    if (editingMaterial) {
      updateMaterial(editingMaterial.id, {
        name: name.trim(),
        unit: unit.trim() || 'Stück',
        price_per_unit: parsedPrice,
        category: category.trim() || 'Verbrauchsmaterial',
        notes: notes.trim()
      });
    } else {
      addMaterial({
        name: name.trim(),
        unit: unit.trim() || 'Stück',
        price_per_unit: parsedPrice,
        category: category.trim() || 'Verbrauchsmaterial',
        notes: notes.trim()
      });
    }

    handleClose();
  };

  const handleDelete = () => {
    if (!editingMaterial) return;
    deleteMaterial(editingMaterial.id);
    handleClose();
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
      <div className="flex-1" onClick={handleClose} />

      <form
        onSubmit={handleSave}
        className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[90%] flex flex-col animate-slide-up"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900 leading-tight">
              {editingMaterial ? 'Material bearbeiten' : 'Neues Material anlegen'}
            </h2>
            <p className="text-[11px] text-slate-500">Material- & Preisstammdaten</p>
          </div>
          <div className="flex items-center gap-1">
            {editingMaterial && (
              <button
                type="button"
                onClick={handleDelete}
                className="w-9 h-9 flex items-center justify-center text-red-600 hover:bg-red-50 rounded-full transition-colors"
                aria-label="Material löschen"
                title="Material löschen"
              >
                <Trash2 size={18} />
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-full hover:bg-slate-100 transition-colors"
              aria-label="Schließen"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3.5 text-xs text-slate-700 overscroll-contain">
          <div>
            <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
              <Package size={13} className="text-slate-500" />
              <span>Materialbezeichnung *</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              placeholder="z. B. Rindenmulch fein, Rasensamen, Hornspäne…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm text-slate-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Tag size={13} className="text-slate-500" />
                <span>Einheit</span>
              </label>
              <input
                type="text"
                placeholder="Stück, Sack, m³…"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm text-slate-900"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Euro size={13} className="text-slate-500" />
                <span>Preis je Einheit (€)</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="Optional (z. B. 12,50)"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm text-slate-900 font-semibold"
              />
            </div>
          </div>

          {/* Schnellwahl-Chips für Einheit */}
          <div className="flex flex-wrap gap-1.5 -mt-1">
            {UNIT_PRESETS.map((u) => {
              const active = unit.trim().toLowerCase() === u.toLowerCase();
              return (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUnit(u)}
                  className={`px-2.5 h-7 rounded-lg border text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-[#3138A0] border-[#3138A0] text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {u}
                </button>
              );
            })}
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">Kategorie</label>
            <input
              type="text"
              placeholder="z. B. Verbrauchsmaterial, Dünger, Pflanzgut"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm text-slate-900"
            />
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {CATEGORY_PRESETS.map((cat) => {
                const active = category.trim().toLowerCase() === cat.toLowerCase();
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`px-2.5 h-7 rounded-lg border text-[11px] font-semibold transition-colors ${
                      active
                        ? 'bg-indigo-50 border-[#3138A0] text-[#3138A0]'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
              <FileText size={13} className="text-slate-500" />
              <span>Notiz / Artikelinfo (optional)</span>
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
            type="button"
            onClick={handleClose}
            className="flex-1 h-12 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-semibold rounded-xl text-sm transition-all"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="flex-1 h-12 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-all shadow-xs"
          >
            {editingMaterial ? 'Speichern' : 'Material anlegen'}
          </button>
        </div>
      </form>
    </div>
  );
};
