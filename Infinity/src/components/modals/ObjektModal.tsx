import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import {
  X,
  Home,
  MapPin,
  KeyRound,
  Ruler,
  Camera,
  Trash2,
  Check,
  Copy,
  FileText
} from 'lucide-react';
import { compressImageFile } from '../../utils/imageCompress.ts';

const PROPERTY_TYPES = [
  'Hausgarten',
  'Wohnanlage',
  'Ferien- / Seehaus',
  'Gewerbeobjekt',
  'Grundstück / Hang'
];

export const SITE_FEATURES = [
  'Zufahrt mit Anhänger',
  'Wasser außen',
  'Strom außen',
  'Grünschnitt mitnehmen',
  'Kompost vor Ort',
  'Mähroboter / Kabel',
  'Steilhang / Böschung',
  'Hund am Gelände'
];

function parseOptionalNumber(val: string): number | null {
  const cleaned = val.replace(',', '.').trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) && num >= 0 ? Math.round(num * 10) / 10 : null;
}

export const ObjektModal: React.FC = () => {
  const {
    activeModal,
    setActiveModal,
    customers,
    properties,
    selectedCustomerId,
    selectedPropertyId,
    setSelectedPropertyId,
    addProperty,
    updateProperty,
    deleteProperty
  } = useApp();

  const isCreating = activeModal === 'OBJEKT_ANLEGEN';
  const isEditing = activeModal === 'OBJEKT_BEARBEITEN';

  const existingProp = isEditing
    ? properties.find((p) => p.id === selectedPropertyId)
    : null;

  const targetCustomerId =
    existingProp?.customer_id || selectedCustomerId || customers[0]?.id || '';
  const customer = customers.find((c) => c.id === targetCustomerId);

  const [name, setName] = useState('Hausgarten');
  const [propertyType, setPropertyType] = useState('Hausgarten');
  const [address, setAddress] = useState('');
  const [areaStr, setAreaStr] = useState('');
  const [hedgeStr, setHedgeStr] = useState('');
  const [accessInfo, setAccessInfo] = useState('');
  const [features, setFeatures] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const formattedCustomerAddress = customer
    ? [customer.street, [customer.zip, customer.city].filter(Boolean).join(' ')]
        .filter((part) => part && part.trim().length > 0)
        .join(', ')
    : '';

  useEffect(() => {
    setConfirmDelete(false);
    if (isEditing && existingProp) {
      setName(existingProp.name || 'Hausgarten');
      setPropertyType(existingProp.property_type || 'Hausgarten');
      setAddress(existingProp.address || '');
      setAreaStr(
        existingProp.area_sqm !== null && existingProp.area_sqm !== undefined
          ? String(existingProp.area_sqm).replace('.', ',')
          : ''
      );
      setHedgeStr(
        existingProp.hedge_length_m !== null && existingProp.hedge_length_m !== undefined
          ? String(existingProp.hedge_length_m).replace('.', ',')
          : ''
      );
      setAccessInfo(existingProp.access_info || '');
      setFeatures(existingProp.features || []);
      setPhotos(existingProp.photos || []);
      setNotes(existingProp.notes || '');
    } else if (isCreating) {
      setName('Hausgarten');
      setPropertyType('Hausgarten');
      setAddress(formattedCustomerAddress);
      setAreaStr('');
      setHedgeStr('');
      setAccessInfo('');
      setFeatures([]);
      setPhotos([]);
      setNotes('');
    }
  }, [activeModal, selectedPropertyId, isEditing, isCreating, existingProp, formattedCustomerAddress]);

  if (!isCreating && !isEditing) return null;

  const toggleFeature = (feat: string) => {
    setFeatures((prev) =>
      prev.includes(feat) ? prev.filter((f) => f !== feat) : [...prev, feat]
    );
  };

  const handleSelectType = (typeLabel: string) => {
    const prevType = propertyType;
    setPropertyType(typeLabel);
    if (!name.trim() || name.trim() === prevType) {
      setName(typeLabel);
    }
  };

  const handlePhotoFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setIsUploading(true);
    try {
      const compressed: string[] = [];
      for (const file of files.slice(0, 6)) {
        const dataUrl = await compressImageFile(file);
        compressed.push(dataUrl);
      }
      setPhotos((prev) => [...prev, ...compressed]);
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const removePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    if (!targetCustomerId) return;
    const payload = {
      customer_id: targetCustomerId,
      name: name.trim() || propertyType || 'Hausgarten',
      property_type: propertyType,
      address: address.trim(),
      area_sqm: parseOptionalNumber(areaStr),
      hedge_length_m: parseOptionalNumber(hedgeStr),
      access_info: accessInfo.trim(),
      features,
      photos,
      notes: notes.trim()
    };

    if (isEditing && existingProp) {
      updateProperty(existingProp.id, payload);
    } else {
      const created = addProperty(payload);
      setSelectedPropertyId(created.id);
    }
    setActiveModal(null);
  };

  const handleDelete = () => {
    if (!existingProp) return;
    deleteProperty(existingProp.id);
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
              {isEditing ? 'Objektinformationen bearbeiten' : 'Neues Objekt anlegen'}
            </h2>
            <p className="text-[11px] text-slate-500">
              {customer ? `Kundenakte: ${customer.name}` : 'Einsatzort & Gegebenheiten vor Ort'}
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

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3.5 text-xs text-slate-700 overscroll-contain">
          {/* Objekttyp Schnellwahl */}
          <div>
            <label className="font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
              <Home size={13} className="text-[#3138A0]" />
              <span>Objektart</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PROPERTY_TYPES.map((t) => {
                const active = propertyType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleSelectType(t)}
                    className={`min-h-[36px] px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                      active
                        ? 'bg-[#3138A0] text-white border-[#3138A0] shadow-2xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Objektname */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Bezeichnung des Objekts *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Hausgarten Hauptwohnsitz, Ferienhaus Ossiacher See..."
              className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm text-slate-900 font-medium"
            />
          </div>

          {/* Einsatzadresse */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold text-slate-700 flex items-center gap-1">
                <MapPin size={13} className="text-slate-500" />
                <span>Einsatzadresse</span>
              </label>
              {formattedCustomerAddress && address !== formattedCustomerAddress && (
                <button
                  type="button"
                  onClick={() => setAddress(formattedCustomerAddress)}
                  className="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] font-semibold rounded-md text-[11px] flex items-center gap-1 transition-colors"
                >
                  <Copy size={11} />
                  <span>Kundenadresse übernehmen</span>
                </button>
              )}
            </div>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Straße, PLZ Ort"
              className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
            />
          </div>

          {/* Maße: Grünfläche & Heckenlänge */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Ruler size={13} className="text-slate-500" />
                <span>Grünfläche (m²)</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={areaStr}
                onChange={(e) => setAreaStr(e.target.value)}
                placeholder="z.B. 450"
                className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 font-medium"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Ruler size={13} className="text-slate-500" />
                <span>Hecke (lfm)</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={hedgeStr}
                onChange={(e) => setHedgeStr(e.target.value)}
                placeholder="z.B. 35"
                className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 font-medium"
              />
            </div>
          </div>

          {/* Zugang / Schlüssel / Torcode */}
          <div>
            <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
              <KeyRound size={13} className="text-amber-600" />
              <span>Zugang / Schlüssel / Torcode</span>
            </label>
            <input
              type="text"
              value={accessInfo}
              onChange={(e) => setAccessInfo(e.target.value)}
              placeholder="z.B. Gartentor links offen, Schlüsselsafe 4812, vorher läuten"
              className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
            />
          </div>

          {/* Gegebenheiten vor Ort (1-Tap Chips) */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1.5">
              Gegebenheiten vor Ort (Antippen)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SITE_FEATURES.map((feat) => {
                const selected = features.includes(feat);
                return (
                  <button
                    key={feat}
                    type="button"
                    onClick={() => toggleFeature(feat)}
                    className={`min-h-[36px] px-2.5 py-1.5 rounded-xl text-[11px] font-semibold border flex items-center gap-1 transition-all ${
                      selected
                        ? 'bg-emerald-50 text-[#2C7738] border-emerald-300'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {selected && <Check size={12} className="shrink-0" />}
                    <span>{feat}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Objektfotos */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-semibold text-slate-700 flex items-center gap-1">
                <Camera size={13} className="text-slate-500" />
                <span>Objektfotos ({photos.length})</span>
              </label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="min-h-[34px] px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] font-semibold rounded-lg text-[11px] flex items-center gap-1 transition-colors"
              >
                <Camera size={12} />
                <span>{isUploading ? 'Wird geladen…' : '+ Foto hinzufügen'}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handlePhotoFiles}
                className="hidden"
              />
            </div>

            {photos.length > 0 && (
              <div className="grid grid-cols-4 gap-2 pt-1">
                {photos.map((src, idx) => (
                  <div
                    key={idx}
                    className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-100"
                  >
                    <img
                      src={src}
                      alt={`Objektfoto ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(idx)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/65 text-white flex items-center justify-center"
                      aria-label="Foto entfernen"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Wichtige Objektnotizen */}
          <div>
            <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
              <FileText size={13} className="text-slate-500" />
              <span>Wichtige Hinweise zum Objekt</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="z.B. Bewässerungsleitungen flach verlegt, empfindliche Hortensien beim Eingang, Grünschnittplatz hinter Garage..."
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 resize-none"
            />
          </div>

          {/* Delete Section when editing */}
          {isEditing && existingProp && (
            <div className="pt-2 border-t border-slate-100">
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="w-full h-10 rounded-xl border border-red-200 bg-red-50/60 hover:bg-red-50 text-[#B42318] font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Trash2 size={14} />
                  <span>Objekt löschen</span>
                </button>
              ) : (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#B42318]">
                    Objekt wirklich entfernen?
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
            disabled={!name.trim() && !propertyType}
            className="flex-1 h-12 bg-[#3138A0] hover:bg-[#272d82] disabled:opacity-50 active:scale-98 text-white font-semibold rounded-xl text-sm transition-all shadow-xs"
          >
            {isEditing ? 'Änderungen speichern' : 'Objekt speichern'}
          </button>
        </div>
      </div>
    </div>
  );
};
