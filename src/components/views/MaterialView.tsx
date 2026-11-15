import React from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { SwipeToDeleteRow } from '../common/SwipeToDeleteRow.tsx';
import { UndoToast } from '../common/UndoToast.tsx';
import { Package, Plus, Pencil } from 'lucide-react';
import { Material } from '../../types/index.ts';

export const MaterialView: React.FC = () => {
  const {
    materials,
    deleteMaterial,
    setSelectedMaterialId,
    setActiveModal
  } = useApp();

  const openCreateForm = () => {
    setSelectedMaterialId(null);
    setActiveModal('MATERIAL_ANLEGEN');
  };

  const openEditForm = (m: Material) => {
    setSelectedMaterialId(m.id);
    setActiveModal('MATERIAL_BEARBEITEN');
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
