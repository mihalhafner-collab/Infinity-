import React, { useState } from 'react';
import { useApp, usePixelBackLayer } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { SwipeToDeleteRow } from '../common/SwipeToDeleteRow.tsx';
import { UndoToast } from '../common/UndoToast.tsx';
import { Package, Plus, Pencil, X } from 'lucide-react';
import { Material } from '../../types/index.ts';

export const MaterialView: React.FC = () => {
  const { materials, addMaterial, updateMaterial, deleteMaterial } = useApp();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('Sack');
  const [price, setPrice] = useState('12');
  const [category, setCategory] = useState('Verbrauchsmaterial');
  const [notes, setNotes] = useState('');

  usePixelBackLayer(isFormOpen, () => {
    setIsFormOpen(false);
    setEditingMaterialId(null);
  });

  const openCreateForm = () => {
    setEditingMaterialId(null);
    setName('');
    setUnit('Sack');
    setPrice('12');
    setCategory('Verbrauchsmaterial');
    setNotes('');
    setIsFormOpen(true);
  };

  const openEditForm = (m: Material) => {
    setEditingMaterialId(m.id);
    setName(m.name);
    setUnit(m.unit || 'Stück');
    setPrice(m.price_per_unit !== null ? String(m.price_per_unit) : '');
    setCategory(m.category || 'Verbrauchsmaterial');
    setNotes(m.notes || '');
    setIsFormOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const parsedPrice = price.trim() === '' ? null : parseFloat(price.replace(',', '.')) || 0;

    if (editingMaterialId) {
      updateMaterial(editingMaterialId, {
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
    setIsFormOpen(false);
    setEditingMaterialId(null);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
      <Header
        title="Material"
        subtitle={`Betrieb · ${materials.length} Materialien`}
        showBack
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-2.5 space-y-2 overscroll-contain">
        {materials.length === 0 ? (
          <div className="p-7 bg-white border border-slate-200 rounded-2xl text-center space-y-2.5 mt-2">
            <div className="w-11 h-11 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center mx-auto">
              <Package size={22} />
            </div>
            <h3 className="font-bold text-slate-900 text-sm">Kein Material angelegt</h3>
            <p className="text-xs text-slate-500 max-w-[240px] mx-auto">
              Erfassen Sie Produkte und Einheitspreise für die schnelle Zuordnung an Arbeitsaufzeichnungen.
            </p>
            <button
              type="button"
              onClick={openCreateForm}
              className="mt-1 px-4 py-2 bg-[#3138A0] text-white text-xs font-semibold rounded-xl"
            >
              + Material anlegen
            </button>
          </div>
        ) : (
          materials.map((m) => (
            <SwipeToDeleteRow
              key={m.id}
              onDelete={() => deleteMaterial(m.id)}
              deleteLabel="Material löschen"
            >
              <div
                onClick={() => openEditForm(m)}
                className="px-3 py-2.5 bg-white border border-slate-200/90 hover:border-slate-300 rounded-2xl shadow-2xs flex items-center justify-between gap-2.5 cursor-pointer active:scale-[0.99] transition-all"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700 shrink-0">
                    <Package size={16} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-[13px] font-bold text-slate-950 leading-tight truncate">
                      {m.name}
                    </h4>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      {m.category || 'Material'} · Einheit: {m.unit}
                      {m.notes ? ` · ${m.notes}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <span className="text-[13px] font-bold text-[#B4470B] block tabular-nums">
                      {m.price_per_unit !== null
                        ? `${m.price_per_unit.toLocaleString('de-DE', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })} €`
                        : 'Preis offen'}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium block">
                      je {m.unit}
                    </span>
                  </div>
                  <div className="w-6 h-6 rounded-lg bg-slate-100 text-[#3138A0] flex items-center justify-center shrink-0">
                    <Pencil size={11} />
                  </div>
                </div>
              </div>
            </SwipeToDeleteRow>
          ))
        )}
      </div>

      <UndoToast />

      {/* Bottom-Sheet für Material anlegen / bearbeiten */}
      {isFormOpen && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
          <div
            className="flex-1"
            onClick={() => {
              setIsFormOpen(false);
              setEditingMaterialId(null);
            }}
          />
          <form
            onSubmit={handleSave}
            className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 space-y-3 text-xs animate-slide-up"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h4 className="font-bold text-slate-900 text-sm">
                {editingMaterialId ? 'Material bearbeiten' : 'Neues Material erfassen'}
              </h4>
              <button
                type="button"
                onClick={() => {
                  setIsFormOpen(false);
                  setEditingMaterialId(null);
                }}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Bezeichnung *</label>
              <input
                type="text"
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. Hornspäne, Rindenmulch, Rasensamen…"
                className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-hidden focus:border-[#3138A0]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Einheit</label>
                <input
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="Sack, kg, Liter, m³…"
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-hidden focus:border-[#3138A0]"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Preis je Einheit (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Optional"
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-bold outline-hidden focus:border-[#3138A0]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Kategorie</label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Verbrauchsmaterial"
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-hidden focus:border-[#3138A0]"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Notiz</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-hidden focus:border-[#3138A0]"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setIsFormOpen(false);
                  setEditingMaterialId(null);
                }}
                className="flex-1 h-11 bg-slate-100 text-slate-700 rounded-xl font-semibold"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={!name.trim()}
                className="flex-1 h-11 bg-[#3138A0] text-white rounded-xl font-semibold disabled:opacity-50"
              >
                Speichern
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-md">
        <BottomActionBar>
          <button
            type="button"
            onClick={openCreateForm}
            className="h-10 px-4 bg-[#3138A0] hover:bg-[#272d82] active:scale-97 text-white text-xs font-bold rounded-2xl flex items-center justify-center gap-1.5 shadow-2xs transition-all"
          >
            <Plus size={15} strokeWidth={2.5} />
            <span>Material anlegen</span>
          </button>
        </BottomActionBar>
        <BottomNav />
      </div>
    </div>
  );
};
