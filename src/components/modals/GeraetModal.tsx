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
  FileText,
  Edit2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  History
} from 'lucide-react';
import { compressImageFile } from '../../utils/imageCompress.ts';
import { getTodayLocalIso } from '../../utils/invoicePdf.ts';
import {
  EQUIPMENT_CATEGORIES,
  FUNCTIONAL_GROUPS,
  getCategoriesByType,
  getCategoryDef,
  getFunctionalGroupInfo,
  getSpecFieldLabel
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

  // Schreibgeschützte Detailansicht zuerst beim Antippen eines bestehenden Geräts/Zubehörs
  const [isEditMode, setIsEditMode] = useState<boolean>(!isEditing);
  const [enlargePhoto, setEnlargePhoto] = useState<boolean>(false);

  const availableGeraete = equipments.filter(
    (e) => (e.item_type || 'geraet') === 'geraet' && (!isEditing || e.id !== existingItem?.id)
  );

  const [itemType, setItemType] = useState<'geraet' | 'zubehoer'>('geraet');
  const [category, setCategory] = useState<string>('motorsaegen');
  const [parentEquipmentId, setParentEquipmentId] = useState<string>('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState<'einsatzbereit' | 'faellig' | 'wartung'>('einsatzbereit');
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [customSpecKey, setCustomSpecKey] = useState('');
  const [customSpecVal, setCustomSpecVal] = useState('');
  const [quantityStr, setQuantityStr] = useState<string>('1');
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

  const populateFromExisting = (item: NonNullable<typeof existingItem>) => {
    const eType = item.item_type || 'geraet';
    const defaultCat = eType === 'zubehoer' ? 'zub_kette_schiene' : 'motorsaegen';
    setItemType(eType);
    setCategory(item.category || defaultCat);
    setParentEquipmentId(item.parent_equipment_id || '');
    setPhoto(item.photo || null);
    setName(item.name || '');
    setModel(item.model || '');
    setStatus(item.status || 'einsatzbereit');
    setSpecs({ ...(item.specs || {}) });
    setCustomSpecKey('');
    setCustomSpecVal('');
    setQuantityStr(item.quantity !== null && item.quantity !== undefined ? String(item.quantity) : '1');
    setNotes(item.notes || '');
    setMaintenancePlan(item.maintenance_plan || '');
    setIntervalMonths(String(item.interval_months || 6));
    const todayIso = getTodayLocalIso();
    setLastMaintenance(item.last_maintenance || todayIso);
    setNextMaintenance(item.next_maintenance || addMonthsIso(todayIso, item.interval_months || 6));
  };

  useEffect(() => {
    if (!isOpen) return;
    setConfirmDelete(false);
    setEnlargePhoto(false);

    if (isEditing && existingItem) {
      setIsEditMode(false);
      populateFromExisting(existingItem);
    } else if (isCreatingZubehoer) {
      setIsEditMode(true);
      setItemType('zubehoer');
      const preselectedParent = availableGeraete.find((g) => g.id === selectedEquipmentId) || null;
      setParentEquipmentId(preselectedParent?.id || '');

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
      setStatus('einsatzbereit');
      setSpecs(preselectedParent?.specs ? { ...preselectedParent.specs } : {});
      setCustomSpecKey('');
      setCustomSpecVal('');
      setQuantityStr('1');
      setNotes('');
    } else if (isCreatingGeraet) {
      setIsEditMode(true);
      setItemType('geraet');
      const initCat = 'motorsaegen';
      const catDef = getCategoryDef(initCat);
      setCategory(initCat);
      setParentEquipmentId('');
      setPhoto(null);
      setName('');
      setModel('');
      setStatus('einsatzbereit');
      setSpecs({});
      setCustomSpecKey('');
      setCustomSpecVal('');
      setQuantityStr('1');
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
  const currentCatDef = getCategoryDef(category) || typeCategories[0];

  // Kategorien nach Funktionsgruppe für das übersichtliche Select-Feld gruppieren
  const categoriesByFunction = FUNCTIONAL_GROUPS.map((groupInfo) => ({
    groupInfo,
    cats: EQUIPMENT_CATEGORIES.filter(
      (c) =>
        c.itemType === itemType &&
        getFunctionalGroupInfo(c.id, c.itemType).id === groupInfo.id
    )
  })).filter((g) => g.cats.length > 0);

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

  const removeSpecKey = (key: string) => {
    setSpecs((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  };

  const handleAddCustomSpec = () => {
    const cleanKey = customSpecKey.trim();
    const cleanVal = customSpecVal.trim();
    if (!cleanKey || !cleanVal) return;
    setSpecs((prev) => ({ ...prev, [cleanKey]: cleanVal }));
    setCustomSpecKey('');
    setCustomSpecVal('');
  };

  const handleCancelEdit = () => {
    if (isEditing && existingItem) {
      populateFromExisting(existingItem);
      setConfirmDelete(false);
      setIsEditMode(false);
    } else {
      setSelectedEquipmentId(null);
      setActiveModal(null);
    }
  };

  const handleSave = () => {
    if (!name.trim()) return;

    const cleanedSpecs: Record<string, string> = {};
    for (const [k, v] of Object.entries(specs)) {
      if (v !== undefined && v !== null && String(v).trim()) {
        cleanedSpecs[k.trim()] = String(v).trim();
      }
    }
    if (customSpecKey.trim() && customSpecVal.trim()) {
      cleanedSpecs[customSpecKey.trim()] = customSpecVal.trim();
    }

    const parsedQty = quantityStr.trim() === '' ? null : Math.max(0, parseInt(quantityStr, 10));
    const normalizedQty =
      parsedQty !== null && !Number.isNaN(parsedQty)
        ? parsedQty
        : itemType === 'zubehoer'
          ? 1
          : null;

    const payload = {
      item_type: itemType,
      category: currentCatDef?.id || category,
      parent_equipment_id: itemType === 'zubehoer' && parentEquipmentId ? parentEquipmentId : null,
      name: name.trim(),
      model: model.trim(),
      photo,
      status: itemType === 'geraet' ? status : 'einsatzbereit',
      specs: cleanedSpecs,
      quantity: normalizedQty,
      notes: notes.trim(),
      maintenance_plan: itemType === 'geraet' ? maintenancePlan.trim() : '',
      interval_months: itemType === 'geraet' ? Math.max(1, parseInt(intervalMonths, 10) || 6) : 12,
      last_maintenance: lastMaintenance,
      next_maintenance: nextMaintenance
    };

    if (isEditing && existingItem) {
      updateEquipment(existingItem.id, payload);
      setCustomSpecKey('');
      setCustomSpecVal('');
      setIsEditMode(false);
    } else {
      addEquipment(payload);
      setSelectedEquipmentId(null);
      setActiveModal(null);
    }
  };

  const handleDelete = () => {
    if (!existingItem) return;
    deleteEquipment(existingItem.id);
    setSelectedEquipmentId(null);
    setActiveModal(null);
  };

  // Alle anzuzeigenden Spec-Felder im Bearbeiten-Modus (Kategorie-Felder + evtl. zusätzliche MCP-Felder)
  const standardFieldKeys = new Set((currentCatDef?.fields || []).map((f) => f.key));
  const extraSpecKeys = Object.keys(specs).filter((k) => !standardFieldKeys.has(k));

  // ============================================================================
  // 1. SCHREIBGESCHÜTZTE DETAILANSICHT (beim Antippen eines bestehenden Geräts)
  // ============================================================================
  if (isEditing && existingItem && !isEditMode) {
    const isZubehoer = existingItem.item_type === 'zubehoer';
    const catDef = getCategoryDef(existingItem.category);
    const funcGroup = getFunctionalGroupInfo(existingItem.category, existingItem.item_type);
    const parentDevice = existingItem.parent_equipment_id
      ? equipments.find((g) => g.id === existingItem.parent_equipment_id) || null
      : null;
    const linkedAccessories = !isZubehoer
      ? equipments.filter(
          (z) => z.item_type === 'zubehoer' && z.parent_equipment_id === existingItem.id
        )
      : [];
    const specEntries = Object.entries(existingItem.specs || {}).filter(
      ([, val]) => val !== undefined && val !== null && String(val).trim() !== ''
    );
    const isDue = existingItem.status === 'faellig';
    const isInMaintenance = existingItem.status === 'wartung';

    return (
      <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
        <div
          className="flex-1"
          onClick={() => {
            setSelectedEquipmentId(null);
            setActiveModal(null);
          }}
        />

        <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[90%] flex flex-col animate-slide-up">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100 shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold">
                  {funcGroup.title}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-[#3138A0] text-[10px] font-bold">
                  {catDef?.label || (isZubehoer ? 'Zubehör' : 'Gerät')}
                </span>
                {!isZubehoer && (
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1 ${
                      isDue
                        ? 'bg-fuchsia-100 text-[#9A1B8D]'
                        : isInMaintenance
                          ? 'bg-amber-100 text-[#B54708]'
                          : 'bg-emerald-50 text-[#2C7738]'
                    }`}
                  >
                    {isDue ? (
                      <>
                        <AlertTriangle size={10} />
                        <span>Wartung fällig</span>
                      </>
                    ) : isInMaintenance ? (
                      <>
                        <Clock size={10} />
                        <span>In Wartung</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={10} />
                        <span>Einsatzbereit</span>
                      </>
                    )}
                  </span>
                )}
              </div>
              <h2 className="text-base font-bold text-slate-900 leading-snug break-words">
                {existingItem.name}
              </h2>
              {existingItem.model && (
                <p className="text-xs font-medium text-slate-500 mt-0.5">
                  Modell / Art.-Nr.: <span className="text-slate-800 font-semibold">{existingItem.model}</span>
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setSelectedEquipmentId(null);
                setActiveModal(null);
              }}
              className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-full hover:bg-slate-100 transition-colors shrink-0"
              aria-label="Schließen"
            >
              <X size={20} />
            </button>
          </div>

          {/* Read-Only Content */}
          <div className="flex-1 overflow-y-auto py-3 space-y-3 text-xs text-slate-700 overscroll-contain">
            {/* Bild + Basisdaten */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-start gap-3">
              {existingItem.photo ? (
                <button
                  type="button"
                  onClick={() => setEnlargePhoto((prev) => !prev)}
                  className="shrink-0 focus:outline-hidden"
                  title="Foto vergrößern"
                >
                  <img
                    src={existingItem.photo}
                    alt={existingItem.name}
                    className={`${
                      enlargePhoto ? 'w-36 h-36' : 'w-16 h-16'
                    } rounded-xl object-cover border border-slate-200 bg-white shadow-2xs transition-all`}
                  />
                </button>
              ) : (
                <div
                  className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 border ${
                    isZubehoer
                      ? 'bg-indigo-50/70 border-indigo-100 text-[#3138A0]'
                      : 'bg-emerald-50/70 border-emerald-100 text-[#2C7738]'
                  }`}
                >
                  {isZubehoer ? <Package size={22} /> : <Wrench size={22} />}
                </div>
              )}

              <div className="flex-1 min-w-0 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <div>
                  <span className="text-slate-400 block">Typ</span>
                  <span className="font-bold text-slate-800">
                    {isZubehoer ? 'Zubehör / Verschleißteil' : 'Gerät / Maschine'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Bestand / Anzahl</span>
                  <span className="font-bold text-slate-800">
                    {existingItem.quantity ?? 1} Stk.
                  </span>
                </div>
                {parentDevice && (
                  <div className="col-span-2 pt-0.5">
                    <span className="text-slate-400 block">Zugeordnetes Hauptgerät</span>
                    <button
                      type="button"
                      onClick={() => setSelectedEquipmentId(parentDevice.id)}
                      className="font-bold text-[#3138A0] hover:underline flex items-center gap-1 text-left"
                    >
                      <Link2 size={11} />
                      <span>
                        {parentDevice.name}
                        {parentDevice.model ? ` (${parentDevice.model})` : ''}
                      </span>
                    </button>
                  </div>
                )}
                <div className="col-span-2 pt-0.5">
                  <span className="text-slate-400 block">MCP-Kennung (ID)</span>
                  <span className="font-mono text-[10px] text-slate-600 select-all">
                    {existingItem.id}
                  </span>
                </div>
              </div>
            </div>

            {/* Technische Daten & Parameter */}
            <div className="p-3 bg-white border border-slate-200 rounded-2xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Sliders size={12} className="text-[#3138A0]" />
                  <span>Technische Daten & Parameter</span>
                </span>
              </div>

              {specEntries.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic">
                  Keine technischen Parameter hinterlegt. Über „Bearbeiten“ oder ChatGPT (MCP) ergänzbar.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {specEntries.map(([key, val]) => (
                    <div
                      key={key}
                      className="p-2 bg-slate-50 border border-slate-100 rounded-xl"
                    >
                      <span className="text-[10px] font-semibold text-slate-500 block">
                        {getSpecFieldLabel(key, existingItem.category)}
                      </span>
                      <span className="text-xs font-bold text-slate-900 break-words">
                        {val}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Wartung & Intervall (für Geräte) */}
            {!isZubehoer && (
              <div className="p-3 bg-white border border-slate-200 rounded-2xl space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar size={12} className="text-[#2C7738]" />
                    <span>Wartung & Intervall</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveModal('WARTUNG_DOKUMENTIEREN')}
                    className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-[#2C7738] border border-emerald-200 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors"
                  >
                    <CheckCircle2 size={12} />
                    <span>Wartung dokumentieren</span>
                  </button>
                </div>

                {existingItem.maintenance_plan && (
                  <div className="p-2 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[10px] font-semibold text-slate-500 block">
                      Wartungsplan
                    </span>
                    <span className="text-xs font-medium text-slate-900">
                      {existingItem.maintenance_plan}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div className="p-2 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[10px] text-slate-500 block">Intervall</span>
                    <span className="font-bold text-slate-900">
                      alle {existingItem.interval_months || 6} Mon.
                    </span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[10px] text-slate-500 block">Letzte Wartung</span>
                    <span className="font-bold text-slate-900 tabular-nums">
                      {existingItem.last_maintenance || '–'}
                    </span>
                  </div>
                  <div
                    className={`p-2 rounded-xl border ${
                      isDue
                        ? 'bg-fuchsia-50 border-fuchsia-200 text-[#9A1B8D]'
                        : 'bg-slate-50 border-slate-100 text-slate-900'
                    }`}
                  >
                    <span className="text-[10px] opacity-75 block">Nächste Fälligkeit</span>
                    <span className="font-bold tabular-nums">
                      {existingItem.next_maintenance || '–'}
                    </span>
                  </div>
                </div>

                {/* Bisherige Wartungshistorie */}
                {existingItem.history && existingItem.history.length > 0 && (
                  <div className="pt-1.5 border-t border-slate-100 space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <History size={11} />
                      <span>Wartungsverlauf ({existingItem.history.length})</span>
                    </span>
                    <div className="max-h-32 overflow-y-auto space-y-1 pr-1 overscroll-contain">
                      {existingItem.history.map((h, idx) => (
                        <div
                          key={`${h.date}-${idx}`}
                          className="p-2 bg-slate-50 rounded-lg border border-slate-100 text-[11px]"
                        >
                          <div className="flex items-center justify-between font-bold text-slate-800">
                            <span>{h.plan || 'Wartung'}</span>
                            <span className="text-[10px] text-slate-500 tabular-nums">{h.date}</span>
                          </div>
                          {h.note && (
                            <p className="text-[10px] text-slate-600 mt-0.5">{h.note}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Zugeordnetes Zubehör (für Geräte) */}
            {!isZubehoer && (
              <div className="p-3 bg-white border border-slate-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Package size={12} className="text-[#3138A0]" />
                    <span>Passendes Zubehör ({linkedAccessories.length})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEquipmentId(existingItem.id);
                      setActiveModal('ZUBEHOER_ANLEGEN');
                    }}
                    className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] border border-indigo-200 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors"
                  >
                    <Plus size={12} />
                    <span>Zubehör dazu</span>
                  </button>
                </div>

                {linkedAccessories.length === 0 ? (
                  <p className="text-[11px] text-slate-400 italic">
                    Noch kein Zubehör direkt zugeordnet.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                    {linkedAccessories.map((acc) => {
                      const accSpecs = Object.values(acc.specs || {}).filter(Boolean);
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => setSelectedEquipmentId(acc.id)}
                          className="w-full p-2.5 bg-slate-50/70 hover:bg-indigo-50/40 flex items-center justify-between gap-2 text-left transition-colors"
                        >
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-slate-900 block truncate">
                              {acc.name}
                            </span>
                            {accSpecs.length > 0 && (
                              <span className="text-[10px] text-slate-500 block truncate">
                                {accSpecs.join(' · ')}
                              </span>
                            )}
                          </div>
                          <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-bold text-slate-800 shrink-0">
                            {acc.quantity ?? 1} Stk.
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Notizen / Lagerort */}
            {existingItem.notes && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <FileText size={11} />
                  <span>Notiz / Lagerort</span>
                </span>
                <p className="text-xs text-slate-800 whitespace-pre-wrap">
                  {existingItem.notes}
                </p>
              </div>
            )}
          </div>

          {/* Footer (Schreibgeschützte Ansicht: Schließen & Bearbeiten) */}
          <div className="pt-3 border-t border-slate-100 flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setSelectedEquipmentId(null);
                setActiveModal(null);
              }}
              className="flex-1 h-11 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-semibold rounded-xl text-xs transition-all"
            >
              Schließen
            </button>
            <button
              type="button"
              onClick={() => setIsEditMode(true)}
              className="flex-1 h-11 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs"
            >
              <Edit2 size={14} />
              <span>Bearbeiten</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // 2. BEARBEITEN- / ANLEGEN-ANSICHT (Einfache Text-, Zahlen- & Auswahlfelder)
  // ============================================================================
  return (
    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
      <div className="flex-1" onClick={handleCancelEdit} />

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
              Alle Felder direkt als Text, Zahl oder Auswahl bearbeitbar
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancelEdit}
            className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-full hover:bg-slate-100 transition-colors"
            aria-label="Abbrechen"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3 text-xs text-slate-700 overscroll-contain">
          {/* 1. Typ & Funktions-Kategorie */}
          <div className="grid grid-cols-12 gap-2.5">
            <div className="col-span-5">
              <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                Eintragstyp
              </label>
              <select
                value={itemType}
                onChange={(e) => handleSwitchType(e.target.value as 'geraet' | 'zubehoer')}
                className="w-full h-10 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs font-bold text-slate-900"
              >
                <option value="geraet">Gerät / Maschine</option>
                <option value="zubehoer">Zubehör / Teil</option>
              </select>
            </div>

            <div className="col-span-7">
              <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                Funktion / Kategorie
              </label>
              <select
                value={currentCatDef?.id || category}
                onChange={(e) => handleSelectCategory(e.target.value)}
                className="w-full h-10 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs font-bold text-slate-900"
              >
                {categoriesByFunction.map(({ groupInfo, cats }) => (
                  <optgroup key={groupInfo.id} label={groupInfo.title}>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {/* 2. Bezeichnung & Modell / Artikel-Nr. (Freitext mit Datalist-Vorschlägen) */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
            <div>
              <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                Bezeichnung *
              </label>
              <input
                type="text"
                required
                list="equipment-preset-names"
                placeholder={currentCatDef?.namePlaceholder || 'Geräte- oder Zubehörname eingeben'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-bold text-slate-900"
              />
              {currentCatDef?.presetNames && currentCatDef.presetNames.length > 0 && (
                <datalist id="equipment-preset-names">
                  {currentCatDef.presetNames.map((preset) => (
                    <option key={preset} value={preset} />
                  ))}
                </datalist>
              )}
            </div>

            <div className="grid grid-cols-12 gap-2.5">
              <div className="col-span-8">
                <label className="font-semibold text-slate-600 mb-1 text-[11px] flex items-center gap-1">
                  <Tag size={11} className="text-slate-400" />
                  <span>Modell / Artikel- oder Serien-Nr.</span>
                </label>
                <input
                  type="text"
                  placeholder={currentCatDef?.modelPlaceholder || 'Freitext / Nummer'}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                />
              </div>

              <div className="col-span-4">
                <label className="font-semibold text-slate-600 mb-1 block text-[11px]">
                  Anzahl (Stk.)
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={quantityStr}
                  onChange={(e) => setQuantityStr(e.target.value)}
                  className="w-full h-10 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-bold text-slate-900 text-center tabular-nums"
                />
              </div>
            </div>

            {/* Status (für Gerät) oder Hauptgerät-Zuordnung (für Zubehör) */}
            {itemType === 'geraet' ? (
              <div>
                <label className="font-semibold text-slate-600 mb-1 block text-[11px]">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as 'einsatzbereit' | 'faellig' | 'wartung')
                  }
                  className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-semibold text-slate-900"
                >
                  <option value="einsatzbereit">Einsatzbereit</option>
                  <option value="faellig">Wartung fällig</option>
                  <option value="wartung">In Wartung / Werkstatt</option>
                </select>
              </div>
            ) : (
              <div>
                <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1 text-[11px]">
                  <Link2 size={12} className="text-[#3138A0]" />
                  <span>Zugeordnetes Hauptgerät (optional)</span>
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
            )}
          </div>

          {/* 3. Technische Daten (specs) – einfache Text-/Zahlenfelder */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
            <span className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
              <Sliders size={13} className="text-[#3138A0]" />
              <span>Technische Daten & Maße</span>
            </span>

            {currentCatDef && currentCatDef.fields.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {currentCatDef.fields.map((field) => {
                  const listId = `spec-opts-${field.key}`;
                  return (
                    <div key={field.key}>
                      <label className="text-[11px] font-semibold text-slate-600 block mb-1 truncate">
                        {field.label}
                      </label>
                      <input
                        type="text"
                        list={field.quickOptions ? listId : undefined}
                        value={specs[field.key] || ''}
                        onChange={(e) => updateSpec(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                      />
                      {field.quickOptions && (
                        <datalist id={listId}>
                          {field.quickOptions.map((opt) => (
                            <option key={opt} value={opt} />
                          ))}
                        </datalist>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Zusätzliche benutzerdefinierte / MCP-Felder */}
            {extraSpecKeys.length > 0 && (
              <div className="space-y-1.5 pt-1 border-t border-slate-200/70">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Weitere Parameter (MCP / Eigene)
                </span>
                {extraSpecKeys.map((k) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <span className="w-28 text-[11px] font-semibold text-slate-700 truncate shrink-0">
                      {getSpecFieldLabel(k, category)}
                    </span>
                    <input
                      type="text"
                      value={specs[k] || ''}
                      onChange={(e) => updateSpec(k, e.target.value)}
                      className="flex-1 h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => removeSpecKey(k)}
                      className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-[#B42318] rounded-lg"
                      title="Feld entfernen"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Neues eigenes Feld hinzufügen */}
            <div className="pt-1.5 border-t border-slate-200/70">
              <span className="text-[10px] font-semibold text-slate-500 block mb-1">
                Eigenes Datenfeld ergänzen (optional)
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Feld (z. B. Gewicht)"
                  value={customSpecKey}
                  onChange={(e) => setCustomSpecKey(e.target.value)}
                  className="w-32 h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                />
                <input
                  type="text"
                  placeholder="Wert (z. B. 4,9 kg)"
                  value={customSpecVal}
                  onChange={(e) => setCustomSpecVal(e.target.value)}
                  className="flex-1 h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                />
                <button
                  type="button"
                  onClick={handleAddCustomSpec}
                  disabled={!customSpecKey.trim() || !customSpecVal.trim()}
                  className="h-9 px-2.5 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 text-[#3138A0] font-bold rounded-xl text-xs flex items-center justify-center shrink-0"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* 4. Wartungsplan & Termine (für Geräte) */}
          {itemType === 'geraet' && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
              <label className="font-bold text-slate-800 block text-xs">
                Wartung & Intervall
              </label>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Wartungsplan (Freitext)
                </label>
                <input
                  type="text"
                  value={maintenancePlan}
                  onChange={(e) => setMaintenancePlan(e.target.value)}
                  placeholder="Regelmäßige Wartungsarbeiten..."
                  className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Intervall (Mon.)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="60"
                    value={intervalMonths}
                    onChange={(e) => {
                      setIntervalMonths(e.target.value);
                      const m = parseInt(e.target.value, 10) || 6;
                      setNextMaintenance(addMonthsIso(lastMaintenance, m));
                    }}
                    className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900 font-semibold tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Letzte Wartung
                  </label>
                  <input
                    type="date"
                    value={lastMaintenance}
                    onChange={(e) => {
                      setLastMaintenance(e.target.value);
                      const m = parseInt(intervalMonths, 10) || 6;
                      setNextMaintenance(addMonthsIso(e.target.value, m));
                    }}
                    className="w-full h-9 px-2 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-[11px] font-semibold text-slate-900"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                    Fällig am
                  </label>
                  <input
                    type="date"
                    value={nextMaintenance}
                    onChange={(e) => setNextMaintenance(e.target.value)}
                    className="w-full h-9 px-2 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-[11px] font-semibold text-[#2C7738]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 5. Notiz / Lagerort */}
          <div>
            <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1 text-[11px]">
              <FileText size={12} className="text-slate-500" />
              <span>Notiz / Lagerort</span>
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                itemType === 'zubehoer'
                  ? 'z. B. Forst-Kiste im Bus, 1x geschärft auf Reserve'
                  : 'z. B. Lagerort, Besonderheiten, Seriennummer...'
              }
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 resize-none"
            />
          </div>

          {/* 6. Profilfoto (kompakt) */}
          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-2xl flex items-center gap-2.5">
            {photo ? (
              <img
                src={photo}
                alt="Foto"
                className="w-11 h-11 rounded-xl object-cover border border-slate-200 shrink-0"
              />
            ) : (
              <div className="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                <Camera size={18} />
              </div>
            )}

            <div className="flex-1 flex items-center gap-1.5">
              <label
                className={`flex-1 h-9 px-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                  isUploadingPhoto ? 'opacity-60 pointer-events-none' : ''
                }`}
              >
                <Camera size={13} className="text-[#3138A0]" />
                <span>Kamera</span>
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
                className={`flex-1 h-9 px-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                  isUploadingPhoto ? 'opacity-60 pointer-events-none' : ''
                }`}
              >
                <ImagePlus size={13} className="text-[#3138A0]" />
                <span>Galerie</span>
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
                  className="w-9 h-9 bg-red-50 hover:bg-red-100 text-[#B42318] rounded-xl flex items-center justify-center shrink-0"
                  title="Foto entfernen"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          {/* 7. Löschen beim Bearbeiten */}
          {isEditing && existingItem && (
            <div className="pt-1 border-t border-slate-100">
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="w-full h-9 rounded-xl border border-red-200 bg-red-50/60 hover:bg-red-50 text-[#B42318] font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Trash2 size={13} />
                  <span>{itemType === 'zubehoer' ? 'Zubehör löschen' : 'Gerät löschen'}</span>
                </button>
              ) : (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#B42318]">
                    Wirklich endgültig löschen?
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600"
                    >
                      Nein
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="px-2.5 py-1 bg-[#B42318] text-white rounded-lg text-xs font-semibold"
                    >
                      Ja, löschen
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer: Abbrechen & Speichern */}
        <div className="pt-3 border-t border-slate-100 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCancelEdit}
            className="flex-1 h-11 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-semibold rounded-xl text-xs transition-all"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex-1 h-11 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-all shadow-xs"
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
};
