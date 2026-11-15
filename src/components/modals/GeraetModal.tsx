import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import {
  X,
  Wrench,
  Calendar,
  Tag,
  Camera,
  ImagePlus,
  Package,
  Sliders,
  Link2,
  Trash2,
  Plus,
  Minus,
  FileText
} from 'lucide-react';
import { compressImageFile } from '../../utils/imageCompress.ts';
import { getTodayLocalIso } from '../../utils/invoicePdf.ts';
import {
  getCategoriesByType,
  getCategoryDef
} from '../../utils/equipmentConfig.ts';

function addMonthsIso(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date(`${getTodayLocalIso()}T00:00:00`);
    fallback.setMonth(fallback.getMonth() + months);
    return fallback.toISOString().slice(0, 10);
  }
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export const GeraetModal: React.FC = () => {
  const {
    activeModal,
    setActiveModal,
    equipments,
    selectedEquipmentId,
    setSelectedEquipmentId,
    addEquipment,
    updateEquipment,
    deleteEquipment
  } = useApp();

  const isCreatingGeraet = activeModal === 'GERAET_ANLEGEN';
  const isCreatingZubehoer = activeModal === 'ZUBEHOER_ANLEGEN';
  const isEditing = activeModal === 'GERAET_BEARBEITEN';
  const isOpen = isCreatingGeraet || isCreatingZubehoer || isEditing;

  const existingItem = isEditing
    ? equipments.find((e) => e.id === selectedEquipmentId) || null
    : null;

  const availableGeraete = equipments.filter(
    (e) => (e.item_type || 'geraet') === 'geraet' && (!isEditing || e.id !== existingItem?.id)
  );

  const [itemType, setItemType] = useState<'geraet' | 'zubehoer'>('geraet');
  const [category, setCategory] = useState<string>('motorsaegen');
  const [parentEquipmentId, setParentEquipmentId] = useState<string>('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState<number>(1);
  const [notes, setNotes] = useState('');

  const [maintenancePlan, setMaintenancePlan] = useState(
    'Kette schärfen, Schwertnut & Luftfilter reinigen, Kettenbremse prüfen'
  );
  const [intervalMonths, setIntervalMonths] = useState('3');
  const [lastMaintenance, setLastMaintenance] = useState(() => getTodayLocalIso());
  const [nextMaintenance, setNextMaintenance] = useState(() => addMonthsIso(getTodayLocalIso(), 3));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setConfirmDelete(false);

    if (isEditing && existingItem) {
      const eType = existingItem.item_type || 'geraet';
      const defaultCat = eType === 'zubehoer' ? 'zub_kette_schiene' : 'motorsaegen';
      setItemType(eType);
      setCategory(existingItem.category || defaultCat);
      setParentEquipmentId(existingItem.parent_equipment_id || '');
      setPhoto(existingItem.photo || null);
      setName(existingItem.name || '');
      setModel(existingItem.model || '');
      setSpecs({ ...(existingItem.specs || {}) });
      setQuantity(existingItem.quantity ?? 1);
      setNotes(existingItem.notes || '');
      setMaintenancePlan(existingItem.maintenance_plan || '');
      setIntervalMonths(String(existingItem.interval_months || 6));
      const todayIso = getTodayLocalIso();
      setLastMaintenance(existingItem.last_maintenance || todayIso);
      setNextMaintenance(existingItem.next_maintenance || addMonthsIso(todayIso, existingItem.interval_months || 6));
    } else if (isCreatingZubehoer) {
      setItemType('zubehoer');
      const preselectedParent = availableGeraete.find((g) => g.id === selectedEquipmentId) || null;
      setParentEquipmentId(preselectedParent?.id || '');

      // Passende Zubehör-Kategorie + Parameter vom Hauptgerät übernehmen
      let initCat = 'zub_kette_schiene';
      if (preselectedParent?.category === 'freischneider') {
        initCat = 'zub_faden_messer';
      } else if (
        preselectedParent?.category === 'bewaesserung_spritze' ||
        preselectedParent?.category === 'handwerkzeuge_garten'
      ) {
        initCat = 'zub_bewaesserung_gardena';
      } else if (preselectedParent?.category === 'felco_silky_schnitt') {
        initCat = 'zub_feilen_schaerfen';
      } else if (preselectedParent?.category === 'milwaukee_geraete') {
        initCat = 'zub_akku_ladung';
      } else if (
        preselectedParent?.category === 'elektrowerkzeuge_allgemein' ||
        preselectedParent?.category === 'bau_pflaster_geraete'
      ) {
        initCat = 'zub_bohrer_trennscheiben';
      } else if (
        preselectedParent?.category &&
        preselectedParent.category !== 'motorsaegen'
      ) {
        initCat = 'zub_filter_psa_sonstiges';
      }
      setCategory(initCat);
      setPhoto(null);
      setName('');
      setModel('');
      setSpecs(preselectedParent?.specs ? { ...preselectedParent.specs } : {});
      setQuantity(1);
      setNotes('');
    } else if (isCreatingGeraet) {
      setItemType('geraet');
      const initCat = 'motorsaegen';
      const catDef = getCategoryDef(initCat);
      setCategory(initCat);
      setParentEquipmentId('');
      setPhoto(null);
      setName('');
      setModel('');
      setSpecs({});
      setQuantity(1);
      setNotes('');
      const defMonths = catDef?.defaultIntervalMonths || 6;
      setMaintenancePlan(catDef?.defaultMaintenancePlan || 'Regelmäßige Prüfung');
      setIntervalMonths(String(defMonths));
      const todayIso = getTodayLocalIso();
      setLastMaintenance(todayIso);
      setNextMaintenance(addMonthsIso(todayIso, defMonths));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModal, selectedEquipmentId]);

  if (!isOpen) return null;

  const typeCategories = getCategoriesByType(itemType);
  const gartenCategories = typeCategories.filter((c) => c.group === 'garten');
  const allgemeinCategories = typeCategories.filter((c) => c.group === 'allgemein');
  const currentCatDef = getCategoryDef(category) || typeCategories[0];

  const handleSwitchType = (nextType: 'geraet' | 'zubehoer') => {
    setItemType(nextType);
    const nextCats = getCategoriesByType(nextType);
    const firstCat = nextCats[0];
    if (firstCat) {
      setCategory(firstCat.id);
      if (nextType === 'geraet' && !isEditing) {
        const m = firstCat.defaultIntervalMonths || 6;
        setMaintenancePlan(firstCat.defaultMaintenancePlan || 'Regelmäßige Prüfung');
        setIntervalMonths(String(m));
        setNextMaintenance(addMonthsIso(lastMaintenance, m));
      }
    }
  };

  const handleSelectCategory = (catId: string) => {
    setCategory(catId);
    const def = getCategoryDef(catId);
    if (def && itemType === 'geraet' && !isEditing) {
      const m = def.defaultIntervalMonths || 6;
      setMaintenancePlan(def.defaultMaintenancePlan || 'Regelmäßige Prüfung');
      setIntervalMonths(String(m));
      setNextMaintenance(addMonthsIso(lastMaintenance, m));
    }
  };

  const handleParentChange = (nextParentId: string) => {
    setParentEquipmentId(nextParentId);
    const parent = availableGeraete.find((g) => g.id === nextParentId);
    if (parent?.specs && Object.keys(specs).every((k) => !specs[k]?.trim())) {
      setSpecs({ ...parent.specs });
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingPhoto(true);
    try {
      const compressed = await compressImageFile(file, 480, 0.76);
      setPhoto(compressed);
    } finally {
      setIsUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const updateSpec = (key: string, val: string) => {
    setSpecs((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = () => {
    if (!name.trim()) return;

    const cleanedSpecs: Record<string, string> = {};
    for (const [k, v] of Object.entries(specs)) {
      if (v && v.trim()) {
        cleanedSpecs[k] = v.trim();
      }
    }

    const payload = {
      item_type: itemType,
      category: currentCatDef?.id || category,
      parent_equipment_id: itemType === 'zubehoer' && parentEquipmentId ? parentEquipmentId : null,
      name: name.trim(),
      model: model.trim(),
      photo,
      specs: cleanedSpecs,
      quantity: itemType === 'zubehoer' ? Math.max(0, quantity) : null,
      notes: notes.trim(),
      maintenance_plan: itemType === 'geraet' ? maintenancePlan.trim() : '',
      interval_months: itemType === 'geraet' ? parseInt(intervalMonths, 10) || 6 : 12,
      last_maintenance: lastMaintenance,
      next_maintenance: nextMaintenance
    };

    if (isEditing && existingItem) {
      updateEquipment(existingItem.id, payload);
    } else {
      addEquipment({
        ...payload,
        status: 'einsatzbereit'
      });
    }

    setSelectedEquipmentId(null);
    setActiveModal(null);
  };

  const handleDelete = () => {
    if (!existingItem) return;
    deleteEquipment(existingItem.id);
    setActiveModal(null);
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
      <div className="flex-1" onClick={() => setActiveModal(null)} />

      <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[92%] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900 leading-tight">
              {isEditing
                ? itemType === 'zubehoer'
                  ? 'Zubehör bearbeiten'
                  : 'Gerät bearbeiten'
                : itemType === 'zubehoer'
                  ? 'Neues Zubehör anlegen'
                  : 'Neues Gerät anlegen'}
            </h2>
            <p className="text-[11px] text-slate-500">
              Profilfoto, Kategorie & technische Parameter
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveModal(null)}
            className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-full hover:bg-slate-100 transition-colors"
            aria-label="Schließen"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3.5 text-xs text-slate-700 overscroll-contain">
          {/* Segmented Toggle: Gerät vs. Zubehör */}
          <div className="flex items-center p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => handleSwitchType('geraet')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                itemType === 'geraet'
                  ? 'bg-white text-[#3138A0] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Wrench size={14} />
              <span>Gerät / Maschine</span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchType('zubehoer')}
              className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                itemType === 'zubehoer'
                  ? 'bg-white text-[#3138A0] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Package size={14} />
              <span>Zubehör / Verschleißteil</span>
            </button>
          </div>

          {/* Profilfoto + Bezeichnung & Modell */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
            <div className="flex items-start gap-3">
              <div
                onClick={() => cameraInputRef.current?.click()}
                className="w-18 h-18 rounded-2xl border-2 border-dashed border-indigo-200 hover:border-[#3138A0] bg-white overflow-hidden flex flex-col items-center justify-center cursor-pointer relative shadow-2xs transition-colors shrink-0"
                title="Mit Kamera aufnehmen"
              >
                {photo ? (
                  <img
                    src={photo}
                    alt="Profilfoto"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-[#3138A0] p-1 text-center">
                    <Camera size={20} />
                    <span className="text-[9px] font-bold mt-0.5 leading-tight">
                      {isUploadingPhoto ? 'Lädt…' : 'Profilfoto'}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 space-y-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-0.5 text-[11px]">
                    {itemType === 'zubehoer' ? 'Zubehör-Bezeichnung *' : 'Gerätebezeichnung *'}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={currentCatDef?.namePlaceholder || 'Bezeichnung'}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full h-10 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-bold text-slate-900"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-600 mb-0.5 text-[11px] flex items-center gap-1">
                    <Tag size={11} className="text-slate-400" />
                    <span>Modell / Artikel-Nr.</span>
                  </label>
                  <input
                    type="text"
                    placeholder={currentCatDef?.modelPlaceholder || 'Typ / Serien- oder Artikelnr.'}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                  />
                </div>
              </div>
            </div>

            {/* Direkte Fotoauswahl: Mit Kamera öffnen oder Aus Galerie */}
            <div className="pt-2 border-t border-slate-200/80 flex items-center gap-2">
              <label
                className={`flex-1 h-10 px-2.5 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer ${
                  isUploadingPhoto ? 'opacity-60 pointer-events-none' : ''
                }`}
              >
                <Camera size={14} />
                <span>Mit Kamera öffnen</span>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={isUploadingPhoto}
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>

              <label
                className={`flex-1 h-10 px-2.5 bg-white hover:bg-slate-100 active:scale-98 border border-slate-200 text-slate-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  isUploadingPhoto ? 'opacity-60 pointer-events-none' : ''
                }`}
              >
                <ImagePlus size={14} className="text-[#3138A0]" />
                <span>Aus Galerie</span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={isUploadingPhoto}
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>

              {photo && (
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  className="w-10 h-10 bg-red-50 hover:bg-red-100 active:scale-95 text-[#B42318] rounded-xl flex items-center justify-center shrink-0 transition-all"
                  title="Profilfoto entfernen"
                  aria-label="Profilfoto entfernen"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>

          {/* Kategorie- & Werkzeugauswahl (Gartengeräte + Allgemeine Geräte) */}
          <div className="space-y-3">
            {itemType === 'geraet' ? (
              <>
                <div>
                  <label className="text-[11px] font-bold text-[#2C7738] uppercase tracking-wider block mb-1.5">
                    Gartengeräte & Forst
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {gartenCategories.map((cat) => {
                      const active = currentCatDef?.id === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => handleSelectCategory(cat.id)}
                          className={`min-h-[36px] px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-all ${
                            active
                              ? 'bg-[#3138A0] text-white border-[#3138A0] shadow-2xs'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {cat.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                    Allgemeine Geräte & Werkzeuge
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {allgemeinCategories.map((cat) => {
                      const active = currentCatDef?.id === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => handleSelectCategory(cat.id)}
                          className={`min-h-[36px] px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-all ${
                            active
                              ? 'bg-[#3138A0] text-white border-[#3138A0] shadow-2xs'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {cat.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="font-semibold text-slate-700 block mb-1.5">
                  Zubehör-Kategorie
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {typeCategories.map((cat) => {
                    const active = currentCatDef?.id === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => handleSelectCategory(cat.id)}
                        className={`min-h-[36px] px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border transition-all ${
                          active
                            ? 'bg-[#3138A0] text-white border-[#3138A0] shadow-2xs'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 1-Tipp Schnellauswahl gängiger Geräte / Zubehörteile der gewählten Kategorie */}
            {currentCatDef?.presetNames && currentCatDef.presetNames.length > 0 && (
              <div className="p-2.5 bg-indigo-50/40 border border-indigo-100 rounded-2xl space-y-1.5">
                <span className="text-[10px] font-bold text-[#3138A0] uppercase tracking-wider block">
                  Schnellauswahl {currentCatDef.label} (1 Tipp)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {currentCatDef.presetNames.map((presetName) => {
                    const isSelected = name.trim() === presetName;
                    return (
                      <button
                        key={presetName}
                        type="button"
                        onClick={() => setName(isSelected ? '' : presetName)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                          isSelected
                            ? 'bg-[#3138A0] text-white border-[#3138A0]'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-[#3138A0]/40'
                        }`}
                      >
                        {presetName}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Bei Zubehör: Zuordnung zu Hauptgerät & Bestand */}
          {itemType === 'zubehoer' && (
            <div className="grid grid-cols-12 gap-2.5 p-3 bg-indigo-50/40 border border-indigo-100 rounded-2xl">
              <div className="col-span-8">
                <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1 text-[11px]">
                  <Link2 size={12} className="text-[#3138A0]" />
                  <span>Passend zu Gerät (optional)</span>
                </label>
                <select
                  value={parentEquipmentId}
                  onChange={(e) => handleParentChange(e.target.value)}
                  className="w-full h-10 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-medium text-slate-900"
                >
                  <option value="">Allgemein / Werkstattbestand</option>
                  {availableGeraete.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} {g.model ? `(${g.model})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-4">
                <label className="font-semibold text-slate-700 mb-1 block text-[11px]">
                  Bestand (Stk.)
                </label>
                <div className="flex items-center h-10 bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(0, q - 1))}
                    className="w-8 h-full flex items-center justify-center text-slate-600 hover:bg-slate-100 active:bg-slate-200"
                  >
                    <Minus size={13} />
                  </button>
                  <span className="flex-1 text-center font-bold text-xs text-slate-900">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => q + 1)}
                    className="w-8 h-full flex items-center justify-center text-[#3138A0] hover:bg-indigo-50 active:bg-indigo-100"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Notwendige Parameter je Kategorie (z. B. Feilen-Ø, Kettenteilung, Nutbreite, TG) */}
          {currentCatDef && currentCatDef.fields.length > 0 && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                  <Sliders size={13} className="text-[#3138A0]" />
                  <span>Technische Parameter ({currentCatDef.label})</span>
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {currentCatDef.fields.map((field) => {
                  const currentVal = specs[field.key] || '';
                  const isWide = !!field.quickOptions && field.quickOptions.length > 3;
                  return (
                    <div
                      key={field.key}
                      className={isWide ? 'col-span-2' : 'col-span-1'}
                    >
                      <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                        {field.label}
                      </label>
                      <input
                        type="text"
                        value={currentVal}
                        onChange={(e) => updateSpec(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className="w-full h-10 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-semibold text-slate-900"
                      />
                      {field.quickOptions && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {field.quickOptions.map((chip) => {
                            const selected = currentVal.trim() === chip;
                            return (
                              <button
                                key={chip}
                                type="button"
                                onClick={() =>
                                  updateSpec(field.key, selected ? '' : chip)
                                }
                                className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border transition-colors ${
                                  selected
                                    ? 'bg-[#3138A0] text-white border-[#3138A0]'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                                }`}
                              >
                                {chip}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Wartungsüberwachung (nur für Geräte) */}
          {itemType === 'geraet' && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
              <label className="font-bold text-slate-800 block text-xs">
                Wartungsplan & Intervall
              </label>
              <input
                type="text"
                value={maintenancePlan}
                onChange={(e) => setMaintenancePlan(e.target.value)}
                placeholder="Regelmäßige Wartungsarbeiten..."
                className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
              />

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Intervall (Monate)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="36"
                    value={intervalMonths}
                    onChange={(e) => {
                      setIntervalMonths(e.target.value);
                      const m = parseInt(e.target.value, 10) || 6;
                      setNextMaintenance(addMonthsIso(lastMaintenance, m));
                    }}
                    className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900 font-semibold"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 mb-1 flex items-center gap-1">
                    <Calendar size={12} className="text-slate-500" />
                    <span>Nächste Fälligkeit</span>
                  </label>
                  <input
                    type="date"
                    value={nextMaintenance}
                    onChange={(e) => setNextMaintenance(e.target.value)}
                    className="w-full h-10 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-semibold text-[#2C7738]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Notiz */}
          <div>
            <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
              <FileText size={12} className="text-slate-500" />
              <span>Bemerkung / Lagerort (optional)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                itemType === 'zubehoer'
                  ? 'z. B. Forst-Kiste im Bus, 1x geschärft auf Reserve'
                  : 'z. B. Haupt-Fällsäge, Ersatzkette im Koffer'
              }
              className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
            />
          </div>

          {/* Löschen beim Bearbeiten */}
          {isEditing && existingItem && (
            <div className="pt-2 border-t border-slate-100">
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="w-full h-10 rounded-xl border border-red-200 bg-red-50/60 hover:bg-red-50 text-[#B42318] font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Trash2 size={14} />
                  <span>{itemType === 'zubehoer' ? 'Zubehör löschen' : 'Gerät löschen'}</span>
                </button>
              ) : (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#B42318]">
                    Eintrag wirklich löschen?
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600"
                    >
                      Nein
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="px-2.5 py-1.5 bg-[#B42318] text-white rounded-lg text-xs font-semibold"
                    >
                      Ja, löschen
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveModal(null)}
            className="flex-1 h-12 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-semibold rounded-xl text-sm transition-all"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex-1 h-12 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-all shadow-xs"
          >
            {isEditing
              ? 'Änderungen speichern'
              : itemType === 'zubehoer'
                ? 'Zubehör speichern'
                : 'Gerät speichern'}
          </button>
        </div>
      </div>
    </div>
  );
};
