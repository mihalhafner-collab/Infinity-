import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, usePixelBackLayer } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { UndoToast } from '../common/UndoToast.tsx';
import { SwipeToDeleteRow } from '../common/SwipeToDeleteRow.tsx';
import {
  Wrench,
  Plus,
  Package,
  Camera,
  ImagePlus,
  Link2,
  ChevronRight,
  Calendar,
  X
} from 'lucide-react';
import { Equipment, EquipmentImage } from '../../types/index.ts';
import { compressImageFile } from '../../utils/imageCompress.ts';
import {
  getCategoryLabel,
  getFunctionalGroupInfo,
  resolveEquipmentIdentity,
  resolveEquipmentImages,
  resolvePrimaryEquipmentPhoto
} from '../../utils/equipmentConfig.ts';

export const GeraeteView: React.FC = () => {
  const {
    currentScreen,
    equipments,
    setSelectedEquipmentId,
    updateEquipment,
    deleteEquipment,
    setActiveModal
  } = useApp();

  const isKleinteileScreen = currentScreen === 'M14_KLEINTEILE';
  const [activeTab, setActiveTab] = useState<'alle' | 'geraet' | 'zubehoer' | 'kleinteil'>(() =>
    isKleinteileScreen ? 'kleinteil' : 'alle'
  );
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [previewPhoto, setPreviewPhoto] = useState<{
    eqId: string;
    src: string;
    title: string;
  } | null>(null);
  const [photoSourceEq, setPhotoSourceEq] = useState<Equipment | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveTab(isKleinteileScreen ? 'kleinteil' : 'alle');
    setSelectedCategoryFilter('all');
  }, [isKleinteileScreen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activeTab, selectedCategoryFilter]);

  usePixelBackLayer(selectedCategoryFilter !== 'all', () => setSelectedCategoryFilter('all'));
  usePixelBackLayer(Boolean(previewPhoto), () => setPreviewPhoto(null));
  usePixelBackLayer(Boolean(photoSourceEq), () => setPhotoSourceEq(null));

  const geraeteItems = useMemo(
    () => equipments.filter((e) => (e.item_type || 'geraet') === 'geraet'),
    [equipments]
  );
  const zubehoerItems = useMemo(
    () => equipments.filter((e) => e.item_type === 'zubehoer'),
    [equipments]
  );
  const kleinteileItems = useMemo(
    () => equipments.filter((e) => e.item_type === 'kleinteil'),
    [equipments]
  );

  const tabFiltered = useMemo(
    () =>
      equipments.filter((e) => {
        const eType = e.item_type || 'geraet';
        if (activeTab === 'geraet' && eType !== 'geraet') return false;
        if (activeTab === 'zubehoer' && eType !== 'zubehoer') return false;
        if (activeTab === 'kleinteil' && eType !== 'kleinteil') return false;
        return true;
      }),
    [equipments, activeTab]
  );

  // Verfügbare Kategorien innerhalb des aktiven Reiters
  const usedCategoryIds = useMemo(() => {
    const unique = Array.from(
      new Set(
        tabFiltered
          .map((e) => (e.category || '').trim())
          .filter((c): c is string => Boolean(c))
      )
    );
    return unique.sort((a, b) => {
      const infoA = getFunctionalGroupInfo(a);
      const infoB = getFunctionalGroupInfo(b);
      if (infoA.order !== infoB.order) return infoA.order - infoB.order;
      return getCategoryLabel(a).localeCompare(getCategoryLabel(b), 'de');
    });
  }, [tabFiltered]);

  const visibleItems = useMemo(
    () =>
      tabFiltered.filter((e) => {
        if (selectedCategoryFilter !== 'all' && e.category !== selectedCategoryFilter) {
          return false;
        }
        return true;
      }),
    [tabFiltered, selectedCategoryFilter]
  );

  // Einheitliche Ordnung nach Kategorie und Hersteller / Modell / Bezeichnung
  const groupedByFunction = useMemo(() => {
    const sorted = [...visibleItems].sort((a, b) => {
      const gA = getFunctionalGroupInfo(a.category, a.item_type);
      const gB = getFunctionalGroupInfo(b.category, b.item_type);
      if (gA.order !== gB.order) return gA.order - gB.order;
      const catA = getCategoryLabel(a.category, a.item_type);
      const catB = getCategoryLabel(b.category, b.item_type);
      if (catA !== catB) return catA.localeCompare(catB, 'de');
      const idA = resolveEquipmentIdentity(a);
      const idB = resolveEquipmentIdentity(b);
      return idA.title.localeCompare(idB.title, 'de');
    });

    const groups: Array<{
      key: string;
      categoryId: string;
      categoryLabel: string;
      items: Equipment[];
    }> = [];

    for (const eq of sorted) {
      const catId = (eq.category || '').trim() || eq.item_type || 'geraet';
      const catLabel = getCategoryLabel(eq.category, eq.item_type);
      let existing = groups.find((g) => g.categoryId === catId);
      if (!existing) {
        existing = {
          key: catId,
          categoryId: catId,
          categoryLabel: catLabel,
          items: []
        };
        groups.push(existing);
      }
      existing.items.push(eq);
    }

    return groups;
  }, [visibleItems]);

  const handleOpenCreateGeraet = () => {
    setSelectedEquipmentId(null);
    setActiveModal('GERAET_ANLEGEN');
  };

  const handleOpenCreateZubehoer = (parentId?: string) => {
    setSelectedEquipmentId(parentId || null);
    setActiveModal('ZUBEHOER_ANLEGEN');
  };

  const handleOpenCreateKleinteil = (parentId?: string) => {
    setSelectedEquipmentId(parentId || null);
    setActiveModal('KLEINTEIL_ANLEGEN');
  };

  // Antippen öffnet die schreibgeschützte Detailansicht
  const handleOpenDetail = (eqId: string) => {
    setSelectedEquipmentId(eqId);
    setActiveModal('GERAET_BEARBEITEN');
  };

  const handleQuickAvatarUpload = async (
    eqId: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 760, 0.82);
      const targetEq = equipments.find((item) => item.id === eqId);
      const existingImages = targetEq ? resolveEquipmentImages(targetEq) : [];
      const newImage: EquipmentImage = {
        id: `img-${Date.now().toString(36)}`,
        url: compressed,
        caption: file.name ? file.name.replace(/\.[^.]+$/, '') : 'Eigenes Foto',
        source: 'own',
        is_primary: true,
        added_at: new Date().toISOString()
      };
      const updatedImages = [
        newImage,
        ...existingImages.map((img) => ({ ...img, is_primary: false }))
      ];
      updateEquipment(eqId, { photo: compressed, images: updatedImages });
      setPhotoSourceEq(null);
      setPreviewPhoto((prev) =>
        prev && prev.eqId === eqId ? { ...prev, src: compressed } : prev
      );
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
      <Header
        title={
          selectedCategoryFilter !== 'all'
            ? getCategoryLabel(selectedCategoryFilter)
            : isKleinteileScreen || activeTab === 'kleinteil'
              ? 'Kleinteileübersicht'
              : 'Geräte & Zubehör'
        }
        subtitle={
          selectedCategoryFilter !== 'all'
            ? 'Kategorie gewählt · Zurück für Übersicht'
            : isKleinteileScreen || activeTab === 'kleinteil'
              ? 'Einheitliche Kleinteileansicht · Antippen für Details'
              : 'Einheitliche Geräteansicht · Antippen für Details'
        }
        showBack
        onBack={
          selectedCategoryFilter !== 'all'
            ? () => setSelectedCategoryFilter('all')
            : undefined
        }
      />

      <UndoToast />

      {/* Content List */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3.5 py-2.5 space-y-3.5 overscroll-contain"
      >
        {groupedByFunction.length === 0 ? (
          <div className="p-6 bg-white border border-slate-200 rounded-2xl text-center space-y-3 shadow-2xs">
            <div className="w-11 h-11 rounded-2xl bg-indigo-50 text-[#3138A0] flex items-center justify-center mx-auto">
              {activeTab === 'zubehoer' || activeTab === 'kleinteil' ? (
                <Package size={22} />
              ) : (
                <Wrench size={22} />
              )}
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">
                {activeTab === 'kleinteil'
                  ? 'Noch keine Kleinteile erfasst'
                  : activeTab === 'zubehoer'
                    ? 'Noch kein Zubehör erfasst'
                    : 'Noch keine Geräte, Zubehör oder Kleinteile erfasst'}
              </h3>
              <p className="text-xs text-slate-500 max-w-[260px] mx-auto mt-1">
                {activeTab === 'kleinteil'
                  ? 'Erfasse Kleinteile, Verschleißteile und Befestigungen universell manuell oder direkt über ChatGPT & MCP.'
                  : 'Erfasse beliebige Geräte, Zubehör & Kleinteile universell manuell oder direkt über ChatGPT & MCP.'}
              </p>
            </div>
            <div className="flex items-center justify-center flex-wrap gap-2 pt-1">
              {activeTab === 'kleinteil' ? (
                <button
                  type="button"
                  onClick={() => handleOpenCreateKleinteil()}
                  className="px-3.5 py-2 bg-[#3138A0] hover:bg-[#272d82] text-white text-xs font-semibold rounded-xl shadow-2xs transition-colors flex items-center gap-1.5"
                >
                  <Plus size={14} />
                  <span>Kleinteil anlegen</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleOpenCreateGeraet}
                    className="px-3.5 py-2 bg-[#3138A0] hover:bg-[#272d82] text-white text-xs font-semibold rounded-xl shadow-2xs transition-colors flex items-center gap-1.5"
                  >
                    <Plus size={14} />
                    <span>Gerät anlegen</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenCreateZubehoer()}
                    className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5"
                  >
                    <Package size={14} />
                    <span>Zubehör</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenCreateKleinteil()}
                    className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5"
                  >
                    <Plus size={14} />
                    <span>Kleinteil</span>
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          groupedByFunction.map((group) => (
            <div key={group.key} className="space-y-1.5">
              {/* Kategorie-Überschrift */}
              <div className="flex items-center justify-between px-1 pt-0.5">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedCategoryFilter((prev) =>
                      prev === group.categoryId ? 'all' : group.categoryId
                    )
                  }
                  className="text-xs font-bold uppercase tracking-wider text-[#3138A0] truncate text-left hover:underline"
                >
                  {group.categoryLabel}
                </button>
                <div className="flex items-center gap-1.5 shrink-0">
                  {selectedCategoryFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setSelectedCategoryFilter('all')}
                      className="px-2 py-0.5 rounded-md bg-indigo-50 text-[#3138A0] text-[10px] font-bold"
                    >
                      Alle zeigen
                    </button>
                  )}
                  <span className="px-1.5 py-0.5 rounded-md bg-slate-200/70 text-[10px] font-bold text-slate-600 tabular-nums">
                    {group.items.length}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {group.items.map((eq) => {
                  const isZubehoer = eq.item_type === 'zubehoer';
                  const isKleinteil = eq.item_type === 'kleinteil';
                  const isSubPart = isZubehoer || isKleinteil;
                  const isDue = !isSubPart && eq.status === 'faellig';
                  const isInMaint = !isSubPart && eq.status === 'wartung';
                  const parentGeraet =
                    isSubPart && eq.parent_equipment_id
                      ? equipments.find((p) => p.id === eq.parent_equipment_id)
                      : null;
                  const linkedAccessories = !isSubPart
                    ? zubehoerItems.filter((z) => z.parent_equipment_id === eq.id)
                    : [];
                  const linkedKleinteile = !isSubPart
                    ? kleinteileItems.filter((k) => k.parent_equipment_id === eq.id)
                    : [];
                  const identity = resolveEquipmentIdentity(eq);
                  const photoSrc = resolvePrimaryEquipmentPhoto(eq);
                  const imageList = resolveEquipmentImages(eq);

                  return (
                    <SwipeToDeleteRow
                      key={eq.id}
                      onDelete={() => deleteEquipment(eq.id)}
                      deleteLabel={
                        isKleinteil
                          ? 'Kleinteil löschen'
                          : isZubehoer
                            ? 'Zubehör löschen'
                            : 'Gerät löschen'
                      }
                    >
                      <div
                        onClick={() => handleOpenDetail(eq.id)}
                        className="p-3 bg-white border border-slate-200 hover:border-[#3138A0]/50 active:bg-slate-50/70 rounded-2xl shadow-2xs transition-colors cursor-pointer flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {/* Einheitliches Geräte-/Kleinteilfoto (Hauptbild) mit Galerie-Zähler */}
                          {photoSrc ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewPhoto({
                                  eqId: eq.id,
                                  src: photoSrc,
                                  title: identity.title
                                });
                              }}
                              className="w-16 h-16 rounded-2xl overflow-hidden border border-slate-200 shrink-0 bg-white shadow-2xs relative"
                              title="Foto vergrößern"
                            >
                              <img
                                src={photoSrc}
                                alt={identity.title}
                                className="w-full h-full object-cover"
                              />
                              {imageList.length > 1 && (
                                <span className="absolute bottom-1 right-1 px-1 py-0.2 rounded bg-black/70 text-white text-[9px] font-bold tabular-nums">
                                  {imageList.length}
                                </span>
                              )}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPhotoSourceEq(eq);
                              }}
                              className={`w-16 h-16 rounded-2xl border border-dashed flex flex-col items-center justify-center shrink-0 transition-colors ${
                                isSubPart
                                  ? 'bg-indigo-50/50 border-indigo-200 text-[#3138A0]'
                                  : isDue
                                    ? 'bg-fuchsia-50 border-fuchsia-200 text-[#9A1B8D]'
                                    : 'bg-emerald-50/60 border-emerald-200 text-[#2C7738]'
                              }`}
                              title="Foto hinzufügen"
                            >
                              <Camera size={18} />
                              <span className="text-[9px] font-bold mt-0.5">Foto</span>
                            </button>
                          )}

                          {/* Einheitlicher Aufbau: Hersteller, Modell, Bezeichnung & Status */}
                          <div className="min-w-0 flex-1">
                            {identity.manufacturer && (
                              <span className="text-[10px] font-bold uppercase tracking-wider text-[#3138A0] block truncate">
                                {identity.manufacturer}
                              </span>
                            )}
                            <h3 className="text-sm font-bold text-slate-900 leading-snug truncate">
                              {identity.model
                                ? identity.manufacturer
                                  ? identity.model
                                  : identity.title
                                : identity.title}
                            </h3>

                            {identity.subtitle ? (
                              <p className="text-xs font-medium text-slate-600 truncate mt-0.5">
                                {identity.subtitle}
                              </p>
                            ) : (
                              eq.serial_number && (
                                <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                  {isKleinteil ? 'Art.-Nr.: ' : 'SN: '}
                                  {eq.serial_number}
                                </p>
                              )
                            )}

                            {/* Status, Bestand & Wartungstermin kompakt in einer Zeile */}
                            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                              {!isSubPart ? (
                                <span
                                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                                    isDue
                                      ? 'bg-fuchsia-50 text-[#9A1B8D]'
                                      : isInMaint
                                        ? 'bg-amber-50 text-[#B4470B]'
                                        : 'bg-emerald-50 text-[#2C7738]'
                                  }`}
                                >
                                  {isDue
                                    ? 'Wartung fällig'
                                    : isInMaint
                                      ? 'In Wartung'
                                      : 'Einsatzbereit'}
                                </span>
                              ) : isKleinteil ? (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-50 text-[#3138A0]">
                                  Kleinteil
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-50 text-[#3138A0]">
                                  Zubehör
                                </span>
                              )}

                              {eq.quantity !== null &&
                                eq.quantity !== undefined &&
                                (isSubPart || eq.quantity > 1) && (
                                  <span
                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums ${
                                      eq.quantity === 0
                                        ? 'bg-red-50 text-[#B42318]'
                                        : 'bg-slate-100 text-slate-700'
                                    }`}
                                  >
                                    {eq.quantity} Stk.
                                  </span>
                                )}

                              {!isSubPart && eq.next_maintenance && (
                                <span className="text-[11px] text-slate-500 inline-flex items-center gap-1 tabular-nums">
                                  <Calendar size={11} className="text-slate-400" />
                                  <span>{eq.next_maintenance}</span>
                                </span>
                              )}

                              {linkedAccessories.length > 0 && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-50 text-[#3138A0]">
                                  +{linkedAccessories.length} Zubehör
                                </span>
                              )}

                              {linkedKleinteile.length > 0 && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-50 text-[#3138A0]">
                                  +{linkedKleinteile.length} Kleinteile
                                </span>
                              )}

                              {parentGeraet && (
                                <span className="text-[10px] font-semibold text-[#3138A0] inline-flex items-center gap-0.5 truncate max-w-[150px]">
                                  <Link2 size={10} className="shrink-0" />
                                  <span className="truncate">{parentGeraet.name}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <ChevronRight size={18} className="text-slate-400 shrink-0" />
                      </div>
                    </SwipeToDeleteRow>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Schnellauswahl Fotoquelle */}
      {photoSourceEq && (
        <div className="absolute inset-0 z-50 bg-black/45 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
          <div className="flex-1" onClick={() => setPhotoSourceEq(null)} />
          <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 space-y-3 animate-slide-up">
            <div className="w-11 h-1.5 bg-slate-300 rounded-full mx-auto -mt-1" />
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-950 truncate">
                  Foto hinzufügen
                </h3>
                <p className="text-xs text-slate-600 truncate">{photoSourceEq.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setPhotoSourceEq(null)}
                className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-600"
                aria-label="Schließen"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-2 pt-1">
              <label className="w-full h-12 px-4 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 text-white font-bold rounded-2xl text-sm flex items-center justify-center gap-2.5 shadow-xs transition-all cursor-pointer">
                <Camera size={18} />
                <span>Mit Kamera öffnen</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => handleQuickAvatarUpload(photoSourceEq.id, e)}
                  className="hidden"
                />
              </label>

              <label className="w-full h-12 px-4 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-900 font-bold rounded-2xl text-sm flex items-center justify-center gap-2.5 transition-all cursor-pointer">
                <ImagePlus size={18} className="text-[#3138A0]" />
                <span>Aus Galerie wählen</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleQuickAvatarUpload(photoSourceEq.id, e)}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Vollbild-Profilfoto Vorschau */}
      {previewPhoto && (
        <div
          onClick={() => setPreviewPhoto(null)}
          className="absolute inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4 animate-fade-in"
        >
          <button
            type="button"
            onClick={() => setPreviewPhoto(null)}
            className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/15 text-white flex items-center justify-center hover:bg-white/25 transition-colors"
            aria-label="Schließen"
          >
            <X size={22} />
          </button>
          <img
            src={previewPhoto.src}
            alt={previewPhoto.title}
            className="w-full max-h-[74%] rounded-2xl object-contain bg-white/5 shadow-2xl"
          />
          <span className="mt-3 text-base font-bold text-white">{previewPhoto.title}</span>

          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-4 flex items-center gap-2.5 w-full max-w-[320px]"
          >
            <label className="flex-1 h-11 px-3 bg-[#3138A0] hover:bg-[#272d82] text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-colors">
              <Camera size={15} />
              <span>Kamera öffnen</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => handleQuickAvatarUpload(previewPhoto.eqId, e)}
                className="hidden"
              />
            </label>
            <label className="flex-1 h-11 px-3 bg-white/15 hover:bg-white/25 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-colors">
              <ImagePlus size={15} />
              <span>Aus Galerie</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleQuickAvatarUpload(previewPhoto.eqId, e)}
                className="hidden"
              />
            </label>
          </div>
        </div>
      )}

      {/* Unterer Bedienbereich fixiert (kompakt für Pixel 10 Pro Daumenzone) */}
      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-md">
        {usedCategoryIds.length > 1 && (
          <div className="px-3.5 pt-2 pb-1.5 border-b border-slate-100 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setSelectedCategoryFilter('all')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold shrink-0 border transition-colors ${
                selectedCategoryFilter === 'all'
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}
            >
              Alle
            </button>
            {usedCategoryIds.map((catId) => (
              <button
                key={catId}
                type="button"
                onClick={() =>
                  setSelectedCategoryFilter((prev) => (prev === catId ? 'all' : catId))
                }
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

        <BottomActionBar>
          <div className="w-full flex items-center gap-2">
            <div className="flex-1 flex items-center p-1 bg-slate-100 rounded-2xl min-w-0">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('alle');
                  setSelectedCategoryFilter('all');
                }}
                className={`flex-1 py-1.5 text-[10px] font-bold rounded-xl transition-all truncate px-1 ${
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
                className={`flex-1 py-1.5 text-[10px] font-bold rounded-xl transition-all truncate px-1 ${
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
                className={`flex-1 py-1.5 text-[10px] font-bold rounded-xl transition-all truncate px-1 ${
                  activeTab === 'zubehoer'
                    ? 'bg-white text-[#3138A0] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Zubehör ({zubehoerItems.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('kleinteil');
                  setSelectedCategoryFilter('all');
                }}
                className={`flex-1 py-1.5 text-[10px] font-bold rounded-xl transition-all truncate px-1 ${
                  activeTab === 'kleinteil'
                    ? 'bg-white text-[#3138A0] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Kleinteile ({kleinteileItems.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() =>
                activeTab === 'kleinteil'
                  ? handleOpenCreateKleinteil()
                  : activeTab === 'zubehoer'
                    ? handleOpenCreateZubehoer()
                    : handleOpenCreateGeraet()
              }
              className="h-9 px-3 bg-[#3138A0] hover:bg-[#272d82] active:scale-97 text-white text-xs font-bold rounded-xl flex items-center gap-1 shrink-0 shadow-2xs"
            >
              <Plus size={14} />
              <span>Neu</span>
            </button>
          </div>
        </BottomActionBar>
        <BottomNav />
      </div>
    </div>
  );
};
