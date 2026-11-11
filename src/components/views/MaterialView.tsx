import React, { useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { Package, Tag, Plus, Check } from 'lucide-react';

export const MaterialView: React.FC = () => {
  const { materials, addMaterial, setActiveModal } = useApp();

  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('Sack');
  const [price, setPrice] = useState('12');
  const [category, setCategory] = useState('Verbrauchsmaterial');
  const [notes, setNotes] = useState('');

  const handleCreate = () => {
    if (!name.trim()) return;
    addMaterial({
      name: name.trim(),
      unit: unit.trim(),
      price_per_unit: parseFloat(price) || 0,
      category: category.trim(),
      notes: notes.trim()
    });
    setName('');
    setIsAdding(false);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
      <Header
        title="Material"
        subtitle={`Betrieb · ${materials.length} Materialien`}
        showBack
      />

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 overscroll-contain">
        <div className="p-2.5 bg-slate-100 rounded-xl text-[11px] text-slate-500">
          Materialübersicht & Preise. Verbrauch wird bewusst an konkreten Arbeiten erfasst; kein separates Lagerverwaltungssystem (KISS & YAGNI).
        </div>

        {/* Inline Add Material Form */}
        {isAdding && (
          <div className="p-3.5 bg-white border border-[#3138A0] rounded-2xl shadow-sm space-y-3 animate-fade-in text-xs">
            <h4 className="font-bold text-slate-900 text-sm">Neues Material erfassen</h4>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">Bezeichnung</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. Hornspäne, Rindenmulch..."
                className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Einheit</label>
                <input
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="Sack, kg, Liter..."
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Preis je Einheit (€)</label>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-bold"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setIsAdding(false)}
                className="flex-1 h-10 bg-slate-100 text-slate-700 rounded-xl font-semibold"
              >
                Abbrechen
              </button>
              <button
                onClick={handleCreate}
                disabled={!name.trim()}
                className="flex-1 h-10 bg-[#3138A0] text-white rounded-xl font-semibold disabled:opacity-50"
              >
                Speichern
              </button>
            </div>
          </div>
        )}

        {/* Material Items List (ILL-013, WF-019) */}
        {materials.length === 0 && !isAdding ? (
          <div className="p-8 bg-white border border-slate-200 rounded-2xl text-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center mx-auto">
              <Package size={24} />
            </div>
            <h3 className="font-bold text-slate-900 text-sm">Kein Material angelegt</h3>
            <p className="text-xs text-slate-500 max-w-[240px] mx-auto">
              Erfassen Sie Produkte und Einheitspreise für einfache Zuordnung an Arbeitsaufzeichnungen.
            </p>
            <button
              onClick={() => setIsAdding(true)}
              className="mt-2 px-4 py-2 bg-[#3138A0] text-white text-xs font-semibold rounded-xl"
            >
              + Material anlegen
            </button>
          </div>
        ) : (
          materials.map((m) => (
            <div
              key={m.id}
              className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-amber-700 shrink-0">
                  <Package size={17} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 leading-tight">{m.name}</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Verwendetes Produkt · {m.unit}
                  </p>
                  {m.notes && <p className="text-[11px] text-slate-400 mt-0.5">{m.notes}</p>}
                </div>
              </div>

              <div className="text-right">
                <span className="text-sm font-bold text-[#B4470B] block font-mono">
                  {m.price_per_unit !== null ? `${m.price_per_unit.toFixed(2)} €` : 'Preis offen'}
                </span>
                <span className="text-[10px] text-slate-400 font-medium">
                  pro {m.unit}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-md">
        <BottomActionBar>
          <button
            type="button"
            onClick={() => setActiveModal('MATERIAL_ANLEGEN')}
            className="h-10 px-4 bg-[#3138A0] hover:bg-[#272d82] active:scale-97 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-2xs transition-all"
          >
            <Plus size={15} />
            <span>Material anlegen</span>
          </button>
        </BottomActionBar>
        <BottomNav />
      </div>
    </div>
  );
};
