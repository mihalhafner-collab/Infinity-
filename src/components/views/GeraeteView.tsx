import React, { useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { UndoToast } from '../common/UndoToast.tsx';
import { SwipeToDeleteRow } from '../common/SwipeToDeleteRow.tsx';
import {
  Wrench,
  CheckCircle,
  Plus,
  Package,
  Camera,
  Pencil,
  Link2,
  X
} from 'lucide-react';
import { Equipment } from '../../types/index.ts';
import { compressImageFile } from '../../utils/imageCompress.ts';
import {
  getCategoryDef,
  getCategoryLabel
} from '../../utils/equipmentConfig.ts';

export const GeraeteView: React.FC = () => {
  const {
    equipments,
    setSelectedEquipmentId,
    updateEquipment,
    deleteEquipment,
    setActiveModal
  } = useApp();

  const [activeTab, setActiveTab] = useState<'alle' | 'geraet' | 'zubehoer'>('alle');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [previewPhoto, setPreviewPhoto] = useState<{ src: string; title: string } | null>(null);

  const geraeteItems = equipments.filter((e) => (e.item_type || 'geraet') === 'geraet');
  const zubehoerItems = equipments.filter((e) => e.item_type === 'zubehoer');

  const tabFiltered = equipments.filter((e) => {
    const eType = e.item_type || 'geraet';
    if (activeTab === 'geraet' && eType !== 'geraet') return false;
    if (activeTab === 'zubehoer' && eType !== 'zubehoer') return false;
    return true;
  });

  // Verfügbare Kategorien innerhalb des aktiven Reiters
  const usedCategoryIds = Array.from(
    new Set(tabFiltered.map((e) => e.category).filter((c): c is string => !!c))
  );

  const visibleItems = tabFiltered.filter((e) => {
    if (selectedCategoryFilter !== 'all' && e.category !== selectedCategoryFilter) {
      return false;
    }
    return true;
  });

  const handleOpenCreateGeraet = () => {
    setSelectedEquipmentId(null);
    setActiveModal('GERAET_ANLEGEN');
  };

  const handleOpenCreateZubehoer = (parentId?: string) => {
    setSelectedEquipmentId(parentId || null);
    setActiveModal('ZUBEHOER_ANLEGEN');
  };

  const handleOpenEdit = (eqId: string) => {
    setSelectedEquipmentId(eqId);
    setActiveModal('GERAET_BEARBEITEN');
  };

  const handleDocumentMaintenance = (eqId: string) => {
    setSelectedEquipmentId(eqId);
    setActiveModal('WARTUNG_DOKUMENTIEREN');
  };

  const handleQuickAvatarUpload = async (
    eqId: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 480, 0.76);
      updateEquipment(eqId, { photo: compressed });
    } finally {
      e.target.value = '';
    }
  };

  const renderSpecBadges = (eq: Equipment) => {
    const specMap = eq.specs || {};
    const entries = Object.entries(specMap).filter(([, val]) => val && val.trim().length > 0);
    if (entries.length === 0) return null;

    const catDef = getCategoryDef(eq.category);
    return (
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([key, val]) => {
          const fieldDef = catDef?.fields.find((f) => f.key === key);
          const shortLabel = fieldDef ? fieldDef.label : key;
          const isHighlight =
            key === 'feilen_durchmesser' ||
            key === 'kettenteilung' ||
            key === 'faden_durchmesser';
          return (
            <span
              key={key}
              className={`px-2 py-0.5 rounded-lg text-[11px] border flex items-center gap-1 ${
                isHighlight
                  ? 'bg-indigo-50/80 border-indigo-200/80 text-[#3138A0] font-bold'
                  : 'bg-slate-50 border-slate-200 text-slate-700 font-medium'
              }`}
            >
              <span className="text-[10px] text-slate-400 font-semibold">{shortLabel}:</span>
              <span>{val}</span>
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
      <Header
        title="Geräte & Zubehör"
        subtitle="Maschinen, Parameter & Wartung"
        showBack
      />

      <UndoToast />

      {/* Ansicht oben, Bedienelemente unten */}

      {/* Content List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 overscroll-contain">
        {visibleItems.length === 0 ? (
          <div className="p-7 bg-white border border-slate-200 rounded-2xl text-center space-y-3 shadow-2xs">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-[#3138A0] flex items-center justify-center mx-auto">
              {activeTab === 'zubehoer' ? <Package size={24} /> : <Wrench size={24} />}
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">
                {activeTab === 'zubehoer'
                  ? 'Noch kein Zubehör erfasst'
                  : 'Noch keine Geräte oder Zubehörteile erfasst'}
              </h3>
              <p className="text-xs text-slate-500 max-w-[260px] mx-auto mt-1">
                Hinterlegen Sie Motorsägen, Ketten, Feilendurchmesser, Schneidgarnituren und Profilfotos für den schnellen Blick vor Ort.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleOpenCreateGeraet}
                className="px-3.5 py-2.5 bg-[#3138A0] hover:bg-[#272d82] text-white text-xs font-semibold rounded-xl shadow-2xs transition-colors flex items-center gap-1.5"
              >
                <Plus size={14} />
                <span>Gerät erfassen</span>
              </button>
              <button
                type="button"
                onClick={() => handleOpenCreateZubehoer()}
                className="px-3.5 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5"
              >
                <Package size={14} />
                <span>Zubehör erfassen</span>
              </button>
            </div>
          </div>
        ) : (
          visibleItems.map((eq) => {
            const isZubehoer = eq.item_type === 'zubehoer';
            const isDue = !isZubehoer && eq.status === 'faellig';
            const catLabel = getCategoryLabel(eq.category, eq.item_type);
            const parentGeraet =
              isZubehoer && eq.parent_equipment_id
                ? equipments.find((p) => p.id === eq.parent_equipment_id)
                : null;
            const linkedAccessories = !isZubehoer
              ? zubehoerItems.filter((z) => z.parent_equipment_id === eq.id)
              : [];

            return (
              <SwipeToDeleteRow
                key={eq.id}
                onDelete={() => deleteEquipment(eq.id)}
                deleteLabel={isZubehoer ? 'Zubehör löschen' : 'Gerät löschen'}
              >
                <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2.5">
                  {/* Top Row: Profilfoto + Name/Kategorie + Status/Edit */}
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {/* Profilfoto zur schnellen Erkennbarkeit */}
                      {eq.photo ? (
                        <button
                          type="button"
                          onClick={() => setPreviewPhoto({ src: eq.photo!, title: eq.name })}
                          className="w-14 h-14 rounded-2xl overflow-hidden border border-slate-200 shrink-0 bg-slate-100 shadow-2xs relative group"
                          title="Profilfoto vergrößern"
                        >
                          <img
                            src={eq.photo}
                            alt={eq.name}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ) : (
                        <label
                          className={`w-14 h-14 rounded-2xl border border-dashed flex flex-col items-center justify-center shrink-0 cursor-pointer transition-colors ${
                            isZubehoer
                              ? 'bg-indigo-50/50 border-indigo-200 text-[#3138A0] hover:bg-indigo-50'
                              : isDue
                                ? 'bg-fuchsia-50 border-fuchsia-200 text-[#9A1B8D]'
                                : 'bg-emerald-50/60 border-emerald-200 text-[#2C7738] hover:bg-emerald-50'
                          }`}
                          title="Profilfoto direkt hinzufügen"
                        >
                          <Camera size={17} />
                          <span className="text-[9px] font-bold mt-0.5">+ Foto</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleQuickAvatarUpload(eq.id, e)}
                            className="hidden"
                          />
                        </label>
                      )}

                      <div
                        onClick={() => handleOpenEdit(eq.id)}
                        className="min-w-0 flex-1 cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                              isZubehoer
                                ? 'bg-indigo-50 text-[#3138A0]'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {catLabel}
                          </span>
                          {isZubehoer && eq.quantity !== null && eq.quantity !== undefined && (
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                                eq.quantity === 0
                                  ? 'bg-red-50 text-[#B42318]'
                                  : 'bg-emerald-50 text-[#2C7738]'
                              }`}
                            >
                              {eq.quantity} Stk.
                            </span>
                          )}
                          {!isZubehoer && (
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                                isDue
                                  ? 'bg-fuchsia-50 text-[#9A1B8D]'
                                  : 'bg-emerald-50 text-[#2C7738]'
                              }`}
                            >
                              {isDue ? 'Wartung fällig' : 'Einsatzbereit'}
                            </span>
                          )}
                        </div>

                        <h3 className="text-sm font-bold text-slate-900 leading-tight mt-1 truncate">
                          {eq.name}
                        </h3>
                        {eq.model && (
                          <p className="text-xs text-slate-500 truncate">{eq.model}</p>
                        )}
                        {parentGeraet && (
                          <p className="text-[11px] font-semibold text-[#3138A0] flex items-center gap-1 mt-0.5 truncate">
                            <Link2 size={11} className="shrink-0" />
                            <span className="truncate">Zu Gerät: {parentGeraet.name}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenEdit(eq.id)}
                      className="w-9 h-9 rounded-xl bg-slate-50 hover:bg-indigo-50 border border-slate-200 flex items-center justify-center text-[#3138A0] shrink-0 transition-colors"
                      title="Bearbeiten"
                      aria-label="Bearbeiten"
                    >
                      <Pencil size={14} />
                    </button>
                  </div>

                  {/* Technische Parameter Badges (z.B. Feilen-Ø 4,8 mm, Teilung .325", Nut 1,3 mm) */}
                  {renderSpecBadges(eq)}

                  {/* Notiz falls vorhanden */}
                  {eq.notes && (
                    <p className="text-[11px] text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-100">
                      {eq.notes}
                    </p>
                  )}

                  {/* Zugeordnetes Zubehör direkt am Hauptgerät anzeigen (in Alle / Geräte) */}
                  {!isZubehoer && activeTab !== 'zubehoer' && linkedAccessories.length > 0 && (
                    <div className="p-2.5 bg-indigo-50/40 border border-indigo-100 rounded-xl space-y-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#3138A0] block">
                        Zugeordnetes Zubehör ({linkedAccessories.length})
                      </span>
                      <div className="space-y-1.5">
                        {linkedAccessories.map((acc) => {
                          const accSpecs = Object.values(acc.specs || {}).filter(Boolean);
                          return (
                            <div
                              key={acc.id}
                              onClick={() => handleOpenEdit(acc.id)}
                              className="p-2 bg-white border border-indigo-100/90 rounded-xl flex items-center justify-between gap-2 cursor-pointer hover:border-[#3138A0] transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {acc.photo ? (
                                  <img
                                    src={acc.photo}
                                    alt={acc.name}
                                    className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0"
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-[#3138A0] flex items-center justify-center shrink-0">
                                    <Package size={14} />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <span className="text-xs font-bold text-slate-900 block truncate">
                                    {acc.name}
                                  </span>
                                  {accSpecs.length > 0 && (
                                    <span className="text-[10px] text-slate-500 block truncate">
                                      {accSpecs.slice(0, 3).join(' · ')}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {acc.quantity !== null && acc.quantity !== undefined && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded-md shrink-0">
                                  {acc.quantity} Stk.
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Wartungs-Kurzinfo & Aktionsleiste für Geräte */}
                  {!isZubehoer && (
                    <>
                      <div className="p-2.5 bg-slate-50 rounded-xl text-[11px] space-y-1">
                        {eq.maintenance_plan && (
                          <div className="flex justify-between gap-2">
                            <span className="text-slate-500 shrink-0">Wartungsplan:</span>
                            <span className="font-semibold text-slate-800 text-right truncate">
                              {eq.maintenance_plan}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-slate-500">Nächste Fälligkeit:</span>
                          <span
                            className={
                              isDue
                                ? 'font-bold text-[#9A1B8D]'
                                : 'font-semibold text-slate-800'
                            }
                          >
                            {eq.next_maintenance} (alle {eq.interval_months} Mon.)
                          </span>
                        </div>
                      </div>

                      <div className="pt-1 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDocumentMaintenance(eq.id)}
                          className="flex-1 min-h-[38px] py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-800 font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5"
                        >
                          <CheckCircle size={14} className="text-[#2C7738]" />
                          <span>Wartung</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenCreateZubehoer(eq.id)}
                          className="flex-1 min-h-[38px] py-1.5 px-2.5 bg-indigo-50 hover:bg-indigo-100 active:scale-98 text-[#3138A0] font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5"
                        >
                          <Plus size={14} />
                          <span>Zubehör dazu</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </SwipeToDeleteRow>
            );
          })
        )}
      </div>

      {/* Vollbild-Profilfoto Vorschau */}
      {previewPhoto && (
        <div
          onClick={() => setPreviewPhoto(null)}
          className="absolute inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4 animate-fade-in"
        >
          <button
            type="button"
            onClick={() => setPreviewPhoto(null)}
            className="absolute top-12 right-4 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center hover:bg-white/25 transition-colors"
            aria-label="Schließen"
          >
            <X size={20} />
          </button>
          <img
            src={previewPhoto.src}
            alt={previewPhoto.title}
            className="max-w-full max-h-[75%] rounded-2xl object-contain shadow-2xl"
          />
          <span className="mt-3 text-sm font-bold text-white">{previewPhoto.title}</span>
        </div>
      )}

      {/* Unterer Bedienbereich fixiert (Pixel 10 Pro Daumenzone) */}
      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-md">
        <div className="px-3.5 pt-2.5 pb-1.5 border-b border-slate-100 space-y-2">
          {usedCategoryIds.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => setSelectedCategoryFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 border transition-colors ${
                  selectedCategoryFilter === 'all'
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}
              >
                Alle Kategorien
              </button>
              {usedCategoryIds.map((catId) => (
                <button
                  key={catId}
                  type="button"
                  onClick={() => setSelectedCategoryFilter(catId)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 border transition-colors ${
                    selectedCategoryFilter === catId
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                >
                  {getCategoryLabel(catId)}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleOpenCreateGeraet}
              className="flex-1 h-9 px-3 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-2xs"
            >
              <Plus size={14} />
              <span>Gerät anlegen</span>
            </button>
            <button
              type="button"
              onClick={() => handleOpenCreateZubehoer()}
              className="flex-1 h-9 px-3 bg-indigo-50 hover:bg-indigo-100 active:scale-98 text-[#3138A0] border border-indigo-200/80 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all"
            >
              <Package size={14} />
              <span>+ Zubehör</span>
            </button>
          </div>
        </div>

        <BottomActionBar>
          <div className="w-full max-w-[260px] flex items-center p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setActiveTab('alle');
                setSelectedCategoryFilter('all');
              }}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all truncate px-1 ${
                activeTab === 'alle'
                  ? 'bg-white text-[#3138A0] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Alle ({equipments.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('geraet');
                setSelectedCategoryFilter('all');
              }}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all truncate px-1 ${
                activeTab === 'geraet'
                  ? 'bg-white text-[#3138A0] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Geräte ({geraeteItems.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('zubehoer');
                setSelectedCategoryFilter('all');
              }}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all truncate px-1 ${
                activeTab === 'zubehoer'
                  ? 'bg-white text-[#3138A0] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Zubehör ({zubehoerItems.length})
            </button>
          </div>
        </BottomActionBar>
        <BottomNav />
      </div>
    </div>
  );
};
