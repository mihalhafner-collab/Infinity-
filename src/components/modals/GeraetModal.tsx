import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useApp, usePixelBackLayer } from '../../context/AppContext.tsx';
import {
  X,
  Calendar,
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
  History,
  Star,
  ChevronDown,
  ChevronUp,
  FolderPlus,
  Paperclip,
  ExternalLink,
  Globe
} from 'lucide-react';
import {
  EquipmentDocument,
  EquipmentDynamicField,
  EquipmentFieldType,
  EquipmentImage
} from '../../types/index.ts';
import { compressImageFile, normalizePhotoSrc } from '../../utils/imageCompress.ts';
import { getTodayLocalIso } from '../../utils/invoicePdf.ts';
import {
  DEFAULT_SECTION_NAMES,
  SUGGESTED_CATEGORIES_GERAET,
  SUGGESTED_CATEGORIES_KLEINTEIL,
  SUGGESTED_CATEGORIES_ZUBEHOER,
  formatDynamicFieldValue,
  getCategoryLabel,
  isDynamicFieldValueEmpty,
  resolveEquipmentDocuments,
  resolveEquipmentDynamicFields,
  resolveEquipmentIdentity,
  resolveEquipmentImages,
  resolvePrimaryEquipmentPhoto,
  syncSpecsFromDynamicFields
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

function formatDateDe(iso?: string | null): string {
  const clean = String(iso || '').trim();
  if (!clean) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const [y, m, d] = clean.split('-');
    return `${d}.${m}.${y}`;
  }
  return clean;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
    reader.readAsDataURL(file);
  });
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
  const isCreatingKleinteil = activeModal === 'KLEINTEIL_ANLEGEN';
  const isEditing = activeModal === 'GERAET_BEARBEITEN';
  const isOpen = isCreatingGeraet || isCreatingZubehoer || isCreatingKleinteil || isEditing;

  const existingItem = isEditing
    ? equipments.find((e) => e.id === selectedEquipmentId) || null
    : null;

  // Schreibgeschützte Detailansicht zuerst beim Antippen eines bestehenden Geräts
  const [isEditMode, setIsEditMode] = useState<boolean>(!isEditing);
  const [activeGalleryIdx, setActiveGalleryIdx] = useState<number>(0);
  const [enlargePhoto, setEnlargePhoto] = useState<boolean>(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const availableGeraete = useMemo(
    () =>
      equipments.filter(
        (e) => (e.item_type || 'geraet') === 'geraet' && (!isEditing || e.id !== existingItem?.id)
      ),
    [equipments, isEditing, existingItem?.id]
  );

  // Universelle Standardfelder (alle optional)
  const [itemType, setItemType] = useState<'geraet' | 'zubehoer' | 'kleinteil'>('geraet');
  const [category, setCategory] = useState<string>('');
  const [manufacturer, setManufacturer] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [serialNumber, setSerialNumber] = useState<string>('');
  const [purchaseDate, setPurchaseDate] = useState<string>('');
  const [purchasePriceStr, setPurchasePriceStr] = useState<string>('');
  const [dealer, setDealer] = useState<string>('');
  const [status, setStatus] = useState<'einsatzbereit' | 'faellig' | 'wartung'>('einsatzbereit');
  const [parentEquipmentId, setParentEquipmentId] = useState<string>('');
  const [quantityStr, setQuantityStr] = useState<string>('1');
  const [notes, setNotes] = useState<string>('');

  // Bilder & Dokumente
  const [images, setImages] = useState<EquipmentImage[]>([]);
  const [newImageUrl, setNewImageUrl] = useState<string>('');
  const [newImageSource, setNewImageSource] = useState<'own' | 'manufacturer'>('own');
  const [documents, setDocuments] = useState<EquipmentDocument[]>([]);
  const [newDocType, setNewDocType] = useState<'rechnung' | 'anleitung' | 'sonstiges'>('rechnung');
  const [newDocTitle, setNewDocTitle] = useState<string>('');

  // Dynamische Felder & Bereiche
  const [dynamicFields, setDynamicFields] = useState<EquipmentDynamicField[]>([]);
  const [customSections, setCustomSections] = useState<string[]>([]);
  const [newSectionInput, setNewSectionInput] = useState<string>('');
  const [showNewSectionBox, setShowNewSectionBox] = useState<boolean>(false);

  // Neues dynamisches Feld anlegen
  const [draftFieldLabel, setDraftFieldLabel] = useState<string>('');
  const [draftFieldType, setDraftFieldType] = useState<EquipmentFieldType>('text');
  const [draftFieldValue, setDraftFieldValue] = useState<string>('');
  const [draftFieldUnit, setDraftFieldUnit] = useState<string>('');
  const [draftFieldSection, setDraftFieldSection] = useState<string>('Technische Daten');
  const [draftFieldSource, setDraftFieldSource] = useState<'manufacturer' | 'individual'>('individual');

  // Wartung
  const [maintenancePlan, setMaintenancePlan] = useState<string>('');
  const [intervalMonths, setIntervalMonths] = useState<string>('6');
  const [lastMaintenance, setLastMaintenance] = useState<string>(() => getTodayLocalIso());
  const [nextMaintenance, setNextMaintenance] = useState<string>(() =>
    addMonthsIso(getTodayLocalIso(), 6)
  );

  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState<boolean>(false);

  const initializedModalKeyRef = useRef<string | null>(null);

  const allSectionOptions = useMemo(() => {
    const fromFields = dynamicFields
      .map((f) => (f.section || '').trim())
      .filter(Boolean);
    return Array.from(
      new Set([...DEFAULT_SECTION_NAMES, ...customSections, ...fromFields])
    );
  }, [dynamicFields, customSections]);

  const categorySuggestions = useMemo(() => {
    const existingCats = equipments
      .filter((e) => (e.item_type || 'geraet') === itemType)
      .map((e) => getCategoryLabel(e.category, e.item_type))
      .filter(Boolean);
    const defaults =
      itemType === 'kleinteil'
        ? SUGGESTED_CATEGORIES_KLEINTEIL
        : itemType === 'zubehoer'
          ? SUGGESTED_CATEGORIES_ZUBEHOER
          : SUGGESTED_CATEGORIES_GERAET;
    return Array.from(new Set([...existingCats, ...defaults]));
  }, [equipments, itemType]);

  const populateFromExisting = (item: NonNullable<typeof existingItem>) => {
    const eType = item.item_type || 'geraet';
    setItemType(eType);
    setCategory(item.category ? getCategoryLabel(item.category, eType) : '');
    setManufacturer(item.manufacturer || '');
    setModel(item.model || '');
    setName(item.name || '');
    setSerialNumber(item.serial_number || '');
    setPurchaseDate(item.purchase_date || '');
    setPurchasePriceStr(
      item.purchase_price !== null && item.purchase_price !== undefined
        ? String(item.purchase_price)
        : ''
    );
    setDealer(item.dealer || '');
    setStatus(item.status || 'einsatzbereit');
    setParentEquipmentId(item.parent_equipment_id || '');
    setQuantityStr(
      item.quantity !== null && item.quantity !== undefined ? String(item.quantity) : '1'
    );
    setNotes(item.notes || '');

    const resolvedImgs = resolveEquipmentImages(item);
    setImages(resolvedImgs);
    setActiveGalleryIdx(0);
    setDocuments(resolveEquipmentDocuments(item));

    const resolvedFields = resolveEquipmentDynamicFields(item);
    setDynamicFields(resolvedFields);
    setCustomSections(Array.isArray(item.custom_sections) ? item.custom_sections : []);

    setMaintenancePlan(item.maintenance_plan || '');
    setIntervalMonths(String(item.interval_months || 6));
    const todayIso = getTodayLocalIso();
    setLastMaintenance(item.last_maintenance || todayIso);
    setNextMaintenance(
      item.next_maintenance || addMonthsIso(todayIso, item.interval_months || 6)
    );
  };

  useEffect(() => {
    if (!isOpen) {
      initializedModalKeyRef.current = null;
      return;
    }

    const modalKey = `${activeModal}:${selectedEquipmentId || 'new'}`;
    if (initializedModalKeyRef.current === modalKey) {
      return;
    }
    initializedModalKeyRef.current = modalKey;

    setConfirmDelete(false);
    setEnlargePhoto(false);
    setActiveGalleryIdx(0);
    setCollapsedSections({});
    setDraftFieldLabel('');
    setDraftFieldValue('');
    setDraftFieldUnit('');
    setNewImageUrl('');
    setNewDocTitle('');

    if (isEditing && existingItem) {
      setIsEditMode(false);
      populateFromExisting(existingItem);
    } else if (isCreatingKleinteil) {
      setIsEditMode(true);
      setItemType('kleinteil');
      const preselectedParent =
        availableGeraete.find((g) => g.id === selectedEquipmentId) || null;
      setParentEquipmentId(preselectedParent?.id || '');
      setCategory('Kleinteil / Ersatzteil');
      setManufacturer(preselectedParent?.manufacturer || '');
      setModel('');
      setName('');
      setSerialNumber('');
      setPurchaseDate('');
      setPurchasePriceStr('');
      setDealer('');
      setStatus('einsatzbereit');
      setImages([]);
      setDocuments([]);
      setDynamicFields([]);
      setCustomSections([]);
      setQuantityStr('1');
      setNotes('');
    } else if (isCreatingZubehoer) {
      setIsEditMode(true);
      setItemType('zubehoer');
      const preselectedParent =
        availableGeraete.find((g) => g.id === selectedEquipmentId) || null;
      setParentEquipmentId(preselectedParent?.id || '');
      setCategory('Ersatzteil / Zubehör');
      setManufacturer(preselectedParent?.manufacturer || '');
      setModel('');
      setName('');
      setSerialNumber('');
      setPurchaseDate('');
      setPurchasePriceStr('');
      setDealer('');
      setStatus('einsatzbereit');
      setImages([]);
      setDocuments([]);
      setDynamicFields([]);
      setCustomSections([]);
      setQuantityStr('1');
      setNotes('');
    } else if (isCreatingGeraet) {
      setIsEditMode(true);
      setItemType('geraet');
      setCategory('');
      setParentEquipmentId('');
      setManufacturer('');
      setModel('');
      setName('');
      setSerialNumber('');
      setPurchaseDate('');
      setPurchasePriceStr('');
      setDealer('');
      setStatus('einsatzbereit');
      setImages([]);
      setDocuments([]);
      setDynamicFields([]);
      setCustomSections([]);
      setQuantityStr('1');
      setNotes('');
      setMaintenancePlan('');
      setIntervalMonths('6');
      const todayIso = getTodayLocalIso();
      setLastMaintenance(todayIso);
      setNextMaintenance(addMonthsIso(todayIso, 6));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeModal, selectedEquipmentId, existingItem?.id]);

  // Synchronisiere Zustand im Hintergrund, solange die Detailansicht schreibgeschützt offen ist (z.B. bei MCP-Updates durch ChatGPT)
  useEffect(() => {
    if (isEditing && existingItem && !isEditMode) {
      populateFromExisting(existingItem);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isEditMode,
    existingItem?.updated_at,
    existingItem?.photo,
    existingItem?.name,
    existingItem?.manufacturer,
    existingItem?.model,
    existingItem?.status,
    existingItem?.last_maintenance,
    existingItem?.next_maintenance
  ]);

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

  usePixelBackLayer(Boolean(isOpen && isEditing && isEditMode), handleCancelEdit);
  usePixelBackLayer(Boolean(isOpen && enlargePhoto), () => setEnlargePhoto(false));

  if (!isOpen) return null;

  const toggleSectionCollapse = (secKey: string) => {
    setCollapsedSections((prev) => ({ ...prev, [secKey]: !prev[secKey] }));
  };

  // Multi-Image Handler (Kamera / Galerie / URL)
  const handleImageFilesUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    sourceType: 'own' | 'manufacturer' = 'own'
  ) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setIsUploadingPhoto(true);
    try {
      const added: EquipmentImage[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const compressed = await compressImageFile(file, 760, 0.82);
        added.push({
          id: `img-${Date.now().toString(36)}-${i}`,
          url: compressed,
          caption: file.name ? file.name.replace(/\.[^.]+$/, '') : 'Gerätebild',
          source: sourceType,
          is_primary: images.length === 0 && i === 0,
          added_at: new Date().toISOString()
        });
      }
      const nextImages = [...images, ...added];
      if (!nextImages.some((img) => img.is_primary) && nextImages.length > 0) {
        nextImages[0].is_primary = true;
      }
      setImages(nextImages);
      const primary = nextImages.find((img) => img.is_primary) || nextImages[0];
      if (isEditing && existingItem) {
        updateEquipment(existingItem.id, {
          images: nextImages,
          photo: primary ? primary.url : null
        });
      }
    } finally {
      setIsUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const handleAddImageUrl = () => {
    const cleanUrl = normalizePhotoSrc(newImageUrl.trim());
    if (!cleanUrl) return;
    const newImg: EquipmentImage = {
      id: `img-${Date.now().toString(36)}`,
      url: cleanUrl,
      caption: newImageSource === 'manufacturer' ? 'Herstellerbild' : 'Gerätebild',
      source: newImageSource,
      is_primary: images.length === 0,
      added_at: new Date().toISOString()
    };
    const nextImages = [...images, newImg];
    setImages(nextImages);
    setNewImageUrl('');
    if (isEditing && existingItem && !isEditMode) {
      const primary = nextImages.find((img) => img.is_primary) || nextImages[0];
      updateEquipment(existingItem.id, {
        images: nextImages,
        photo: primary ? primary.url : null
      });
    }
  };

  const handleSetPrimaryImage = (imgId: string) => {
    const nextImages = images.map((img) => ({
      ...img,
      is_primary: img.id === imgId
    }));
    setImages(nextImages);
    const primary = nextImages.find((img) => img.is_primary) || nextImages[0];
    if (isEditing && existingItem) {
      updateEquipment(existingItem.id, {
        images: nextImages,
        photo: primary ? primary.url : null
      });
    }
  };

  const handleRemoveImage = (imgId: string) => {
    const filtered = images.filter((img) => img.id !== imgId);
    if (filtered.length > 0 && !filtered.some((img) => img.is_primary)) {
      filtered[0].is_primary = true;
    }
    setImages(filtered);
    const primary = filtered.find((img) => img.is_primary) || filtered[0];
    if (isEditing && existingItem && !isEditMode) {
      updateEquipment(existingItem.id, {
        images: filtered,
        photo: primary ? primary.url : null
      });
    }
  };

  // Dokument-Upload (Rechnungen & Bedienungsanleitungen)
  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const isImage = file.type.startsWith('image/');
      const dataUrl = isImage
        ? await compressImageFile(file, 1200, 0.85)
        : await readFileAsDataUrl(file);
      const docTitle =
        newDocTitle.trim() ||
        file.name ||
        (newDocType === 'rechnung'
          ? 'Kaufbeleg / Rechnung'
          : newDocType === 'anleitung'
            ? 'Bedienungsanleitung'
            : 'Dokument');
      const newDoc: EquipmentDocument = {
        id: `doc-${Date.now().toString(36)}`,
        title: docTitle,
        type: newDocType,
        url: dataUrl,
        mime_type: file.type || 'application/octet-stream',
        added_at: new Date().toISOString()
      };
      const nextDocs = [...documents, newDoc];
      setDocuments(nextDocs);
      setNewDocTitle('');
      if (isEditing && existingItem && !isEditMode) {
        updateEquipment(existingItem.id, { documents: nextDocs });
      }
    } finally {
      e.target.value = '';
    }
  };

  const handleRemoveDocument = (docId: string) => {
    const nextDocs = documents.filter((d) => d.id !== docId);
    setDocuments(nextDocs);
    if (isEditing && existingItem && !isEditMode) {
      updateEquipment(existingItem.id, { documents: nextDocs });
    }
  };

  // Dynamische Felder verwalten
  const handleAddCustomSection = () => {
    const clean = newSectionInput.trim();
    if (!clean) return;
    if (!customSections.includes(clean)) {
      setCustomSections((prev) => [...prev, clean]);
    }
    setDraftFieldSection(clean);
    setNewSectionInput('');
    setShowNewSectionBox(false);
  };

  const handleAddDynamicField = () => {
    const cleanLabel = draftFieldLabel.trim();
    if (!cleanLabel) return;

    let normalizedVal: string | number | boolean = draftFieldValue.trim();
    if (draftFieldType === 'boolean') {
      normalizedVal =
        draftFieldValue === 'true' ||
        draftFieldValue.toLowerCase() === 'ja' ||
        draftFieldValue === '1';
    } else if (draftFieldType === 'number' || draftFieldType === 'unit') {
      const parsed = Number(String(draftFieldValue).replace(',', '.'));
      if (!Number.isNaN(parsed) && String(draftFieldValue).trim() !== '') {
        normalizedVal = parsed;
      }
    }

    const newField: EquipmentDynamicField = {
      id: `cf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      label: cleanLabel,
      type: draftFieldType,
      value: normalizedVal,
      unit: draftFieldType === 'unit' ? draftFieldUnit.trim() : undefined,
      section: draftFieldSection.trim() || 'Technische Daten',
      source: draftFieldSource
    };

    setDynamicFields((prev) => [...prev, newField]);
    setDraftFieldLabel('');
    setDraftFieldValue('');
    setDraftFieldUnit('');
  };

  const handleUpdateDynamicField = (
    fieldId: string,
    patch: Partial<EquipmentDynamicField>
  ) => {
    setDynamicFields((prev) =>
      prev.map((f) => (f.id === fieldId ? { ...f, ...patch } : f))
    );
  };

  const handleRemoveDynamicField = (fieldId: string) => {
    setDynamicFields((prev) => prev.filter((f) => f.id !== fieldId));
  };

  const handleSave = () => {
    // Falls noch ein neues Feld im Entwurf steht, automatisch übernehmen
    let finalDynamicFields = [...dynamicFields];
    if (draftFieldLabel.trim() && draftFieldValue.trim()) {
      const newField: EquipmentDynamicField = {
        id: `cf-${Date.now().toString(36)}`,
        label: draftFieldLabel.trim(),
        type: draftFieldType,
        value:
          draftFieldType === 'boolean'
            ? draftFieldValue === 'true' || draftFieldValue.toLowerCase() === 'ja'
            : draftFieldValue.trim(),
        unit: draftFieldType === 'unit' ? draftFieldUnit.trim() : undefined,
        section: draftFieldSection.trim() || 'Technische Daten',
        source: draftFieldSource
      };
      finalDynamicFields.push(newField);
    }

    const cleanManufacturer = manufacturer.trim();
    const cleanModel = model.trim();
    const cleanCategory =
      category.trim() ||
      (itemType === 'kleinteil'
        ? 'Kleinteil'
        : itemType === 'zubehoer'
          ? 'Zubehör'
          : 'Allgemein');
    const autoTitle = [cleanManufacturer, cleanModel].filter(Boolean).join(' ');
    const effectiveName =
      name.trim() ||
      autoTitle ||
      existingItem?.name?.trim() ||
      cleanCategory ||
      (itemType === 'kleinteil'
        ? 'Kleinteil'
        : itemType === 'zubehoer'
          ? 'Zubehör'
          : 'Gerät');

    const parsedPrice =
      purchasePriceStr.trim() === ''
        ? null
        : Number(purchasePriceStr.replace(',', '.'));
    const normalizedPrice =
      parsedPrice !== null && Number.isFinite(parsedPrice) ? parsedPrice : null;

    const parsedQty =
      quantityStr.trim() === '' ? null : Math.max(0, parseInt(quantityStr, 10));
    const normalizedQty =
      parsedQty !== null && !Number.isNaN(parsedQty)
        ? parsedQty
        : itemType === 'zubehoer' || itemType === 'kleinteil'
          ? 1
          : null;

    const primaryImg = images.find((img) => img.is_primary) || images[0] || null;
    const syncedSpecs = syncSpecsFromDynamicFields(finalDynamicFields);

    const payload = {
      item_type: itemType,
      category: cleanCategory,
      parent_equipment_id:
        (itemType === 'zubehoer' || itemType === 'kleinteil') && parentEquipmentId
          ? parentEquipmentId
          : null,
      manufacturer: cleanManufacturer,
      model: cleanModel,
      name: effectiveName,
      serial_number: serialNumber.trim(),
      purchase_date: purchaseDate.trim(),
      purchase_price: normalizedPrice,
      dealer: dealer.trim(),
      photo: primaryImg ? primaryImg.url : null,
      images,
      documents,
      status: itemType === 'geraet' ? status : ('einsatzbereit' as const),
      custom_fields: finalDynamicFields,
      custom_sections: customSections,
      specs: syncedSpecs,
      quantity: normalizedQty,
      notes: notes.trim(),
      maintenance_plan: itemType === 'geraet' ? maintenancePlan.trim() : '',
      interval_months:
        itemType === 'geraet' ? Math.max(1, parseInt(intervalMonths, 10) || 6) : 12,
      last_maintenance: lastMaintenance,
      next_maintenance: nextMaintenance
    };

    if (isEditing && existingItem) {
      updateEquipment(existingItem.id, payload);
      setName(effectiveName);
      setDynamicFields(finalDynamicFields);
      setDraftFieldLabel('');
      setDraftFieldValue('');
      setDraftFieldUnit('');
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

  // ============================================================================
  // 1. SCHREIBGESCHÜTZTE DETAILANSICHT (Einheitlich, leere Felder ausgeblendet)
  // ============================================================================
  if (isEditing && existingItem && !isEditMode) {
    const isZubehoer = existingItem.item_type === 'zubehoer';
    const isKleinteil = existingItem.item_type === 'kleinteil';
    const isSubPart = isZubehoer || isKleinteil;
    const catLabel = getCategoryLabel(existingItem.category, existingItem.item_type);
    const identity = resolveEquipmentIdentity(existingItem);
    const galleryImages = resolveEquipmentImages(existingItem);
    const activeImage =
      galleryImages[Math.min(activeGalleryIdx, Math.max(0, galleryImages.length - 1))] ||
      null;
    const detailPhotoSrc = activeImage?.url || resolvePrimaryEquipmentPhoto(existingItem);
    const docList = resolveEquipmentDocuments(existingItem);

    const parentDevice = existingItem.parent_equipment_id
      ? equipments.find((g) => g.id === existingItem.parent_equipment_id) || null
      : null;
    const linkedAccessories = !isSubPart
      ? equipments.filter(
          (z) => z.item_type === 'zubehoer' && z.parent_equipment_id === existingItem.id
        )
      : [];
    const linkedKleinteile = !isSubPart
      ? equipments.filter(
          (k) => k.item_type === 'kleinteil' && k.parent_equipment_id === existingItem.id
        )
      : [];

    // Nur nicht-leere dynamische Felder in der normalen Ansicht anzeigen!
    const nonEmptyFields = resolveEquipmentDynamicFields(existingItem).filter(
      (f) => !isDynamicFieldValueEmpty(f)
    );

    // Gruppierung nach Bereich (Section)
    const groupedSections: Array<{
      sectionName: string;
      fields: EquipmentDynamicField[];
    }> = [];
    for (const f of nonEmptyFields) {
      const sec = (f.section || 'Technische Daten').trim() || 'Technische Daten';
      let group = groupedSections.find((g) => g.sectionName === sec);
      if (!group) {
        group = { sectionName: sec, fields: [] };
        groupedSections.push(group);
      }
      group.fields.push(f);
    }

    const isDue = existingItem.status === 'faellig';
    const isInMaintenance = existingItem.status === 'wartung';

    // Basisdaten-Paare (leere Werte werden ausgeblendet)
    const baseInfoItems: Array<{ label: string; value: string }> = [];
    if (identity.manufacturer) {
      baseInfoItems.push({ label: 'Hersteller', value: identity.manufacturer });
    }
    if (identity.model) {
      baseInfoItems.push({ label: 'Modell', value: identity.model });
    }
    if (existingItem.serial_number?.trim()) {
      baseInfoItems.push({
        label: isKleinteil ? 'Artikel- / Teilenummer' : 'Seriennummer',
        value: existingItem.serial_number.trim()
      });
    }
    if (existingItem.purchase_date?.trim()) {
      baseInfoItems.push({
        label: 'Kaufdatum',
        value: formatDateDe(existingItem.purchase_date)
      });
    }
    if (
      existingItem.purchase_price !== null &&
      existingItem.purchase_price !== undefined &&
      Number.isFinite(Number(existingItem.purchase_price))
    ) {
      baseInfoItems.push({
        label: 'Kaufpreis',
        value: `${Number(existingItem.purchase_price).toFixed(2)} €`
      });
    }
    if (existingItem.dealer?.trim()) {
      baseInfoItems.push({ label: 'Händler', value: existingItem.dealer.trim() });
    }
    if (
      existingItem.quantity !== null &&
      existingItem.quantity !== undefined &&
      (isSubPart || existingItem.quantity > 1)
    ) {
      baseInfoItems.push({
        label: 'Bestand / Anzahl',
        value: `${existingItem.quantity} Stk.`
      });
    }

    return (
      <div className="absolute inset-0 z-50 bg-black/45 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
        <div
          className="flex-1"
          onClick={() => {
            setSelectedEquipmentId(null);
            setActiveModal(null);
          }}
        />

        <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[92%] flex flex-col animate-slide-up">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100 shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-[#3138A0] text-[10px] font-bold">
                  {catLabel}
                </span>
                {!isSubPart ? (
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
                ) : isKleinteil ? (
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold">
                    Kleinteil
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold">
                    Zubehör / Teil
                  </span>
                )}
              </div>

              {identity.manufacturer && (
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#3138A0] block">
                  {identity.manufacturer}
                </span>
              )}
              <h2 className="text-base font-bold text-slate-900 leading-snug break-words">
                {identity.model
                  ? identity.manufacturer
                    ? identity.model
                    : identity.title
                  : identity.title}
              </h2>
              {identity.subtitle && (
                <p className="text-xs font-semibold text-slate-600 mt-0.5">
                  {identity.subtitle}
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
            {/* 1. Hauptbild, Galerie & Basisdaten */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
              {detailPhotoSrc && enlargePhoto && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setEnlargePhoto(false)}
                    className="w-full focus:outline-hidden"
                    title="Foto verkleinern"
                  >
                    <img
                      src={detailPhotoSrc}
                      alt={identity.title}
                      className="w-full max-h-64 rounded-2xl object-contain bg-white border border-slate-200 p-1 shadow-xs transition-all"
                    />
                  </button>
                  {activeImage && (
                    <div className="flex items-center justify-between px-1 text-[11px]">
                      <span className="text-slate-600 font-semibold truncate">
                        {activeImage.caption ||
                          (activeImage.source === 'manufacturer'
                            ? 'Herstellerbild'
                            : 'Eigenes Foto')}
                      </span>
                      {!activeImage.is_primary && (
                        <button
                          type="button"
                          onClick={() => handleSetPrimaryImage(activeImage.id)}
                          className="px-2 py-0.5 rounded-lg bg-indigo-50 text-[#3138A0] font-bold flex items-center gap-1"
                        >
                          <Star size={11} />
                          <span>Als Hauptbild</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-start gap-3">
                {detailPhotoSrc ? (
                  !enlargePhoto && (
                    <button
                      type="button"
                      onClick={() => setEnlargePhoto(true)}
                      className="shrink-0 focus:outline-hidden relative"
                      title="Gerätefoto groß anzeigen"
                    >
                      <img
                        src={detailPhotoSrc}
                        alt={identity.title}
                        className="w-24 h-24 rounded-2xl object-cover border border-slate-200 bg-white shadow-2xs transition-all"
                      />
                      {activeImage?.source === 'manufacturer' && (
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[9px] font-bold">
                          Hersteller
                        </span>
                      )}
                    </button>
                  )
                ) : (
                  <label
                    className={`w-24 h-24 rounded-2xl flex flex-col items-center justify-center shrink-0 border border-dashed cursor-pointer transition-colors ${
                      isSubPart
                        ? 'bg-indigo-50/70 border-indigo-200 text-[#3138A0]'
                        : 'bg-emerald-50/70 border-emerald-200 text-[#2C7738]'
                    }`}
                    title="Foto direkt aufnehmen"
                  >
                    <Camera size={22} />
                    <span className="text-[10px] font-bold mt-1">Foto +</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => handleImageFilesUpload(e, 'own')}
                      className="hidden"
                    />
                  </label>
                )}

                <div className="flex-1 min-w-0 space-y-2">
                  {baseInfoItems.length > 0 ? (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                      {baseInfoItems.map((item) => (
                        <div key={item.label} className="min-w-0">
                          <span className="text-slate-400 block text-[10px]">
                            {item.label}
                          </span>
                          <span className="font-bold text-slate-800 truncate block">
                            {item.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500">
                      Kategorie: <strong className="text-slate-800">{catLabel}</strong>
                    </div>
                  )}

                  {parentDevice && (
                    <div className="pt-0.5 text-[11px]">
                      <span className="text-slate-400 block text-[10px]">
                        Zugeordnetes Hauptgerät
                      </span>
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

                  {/* Direkte Kamera & Galerie Buttons zum schnellen Ergänzen weiterer Bilder */}
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <label
                      className={`flex-1 h-8 px-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer shadow-2xs ${
                        isUploadingPhoto ? 'opacity-60 pointer-events-none' : ''
                      }`}
                    >
                      <Camera size={12} className="text-[#3138A0]" />
                      <span>Kamera +</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        disabled={isUploadingPhoto}
                        onChange={(e) => handleImageFilesUpload(e, 'own')}
                        className="hidden"
                      />
                    </label>
                    <label
                      className={`flex-1 h-8 px-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer shadow-2xs ${
                        isUploadingPhoto ? 'opacity-60 pointer-events-none' : ''
                      }`}
                    >
                      <ImagePlus size={12} className="text-[#3138A0]" />
                      <span>Galerie +</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={isUploadingPhoto}
                        onChange={(e) => handleImageFilesUpload(e, 'own')}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Bildergalerie (wenn mehrere Bilder vorhanden sind) */}
              {galleryImages.length > 1 && (
                <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold">
                    <span>Bildergalerie ({galleryImages.length} Bilder)</span>
                    <span>Antippen für Vorschau · Stern = Hauptbild</span>
                  </div>
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {galleryImages.map((img, idx) => {
                      const isSelected = idx === activeGalleryIdx;
                      return (
                        <div key={img.id} className="relative shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveGalleryIdx(idx);
                              setEnlargePhoto(true);
                            }}
                            className={`w-14 h-14 rounded-xl overflow-hidden border-2 transition-all block ${
                              isSelected
                                ? 'border-[#3138A0] shadow-xs'
                                : 'border-slate-200 opacity-85 hover:opacity-100'
                            }`}
                          >
                            <img
                              src={img.url}
                              alt={img.caption || `Bild ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSetPrimaryImage(img.id);
                            }}
                            className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center shadow-xs ${
                              img.is_primary
                                ? 'bg-amber-400 text-slate-950'
                                : 'bg-white/90 text-slate-400 hover:text-slate-700 border border-slate-200'
                            }`}
                            title={
                              img.is_primary ? 'Hauptbild' : 'Als Hauptbild festlegen'
                            }
                          >
                            <Star size={10} fill={img.is_primary ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 2. Dynamische Bereiche & Felder (wachsen automatisch mit den vorhandenen Daten, aufklappbar) */}
            {groupedSections.map((group, secIdx) => {
              const secKey = `sec_${group.sectionName}`;
              const isCollapsed = Boolean(collapsedSections[secKey]);
              return (
                <div
                  key={group.sectionName}
                  className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggleSectionCollapse(secKey)}
                    className="w-full p-3 flex items-center justify-between text-left hover:bg-slate-50/70 transition-colors"
                  >
                    <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <Sliders
                        size={12}
                        className={secIdx === 0 ? 'text-[#3138A0]' : 'text-emerald-700'}
                      />
                      <span>
                        {group.sectionName} ({group.fields.length})
                      </span>
                    </span>
                    {isCollapsed ? (
                      <ChevronDown size={15} className="text-slate-400" />
                    ) : (
                      <ChevronUp size={15} className="text-slate-400" />
                    )}
                  </button>

                  {!isCollapsed && (
                    <div className="px-3 pb-3 grid grid-cols-2 gap-1.5">
                      {group.fields.map((field) => {
                        const formatted = formatDynamicFieldValue(field);
                        const isWide =
                          formatted.length > 22 || field.label.length > 22;
                        return (
                          <div
                            key={field.id}
                            className={`px-2.5 py-2 bg-slate-50 border border-slate-100 rounded-xl ${
                              isWide ? 'col-span-2' : 'col-span-1'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10px] font-semibold text-slate-500 truncate">
                                {field.label}
                              </span>
                              {field.source === 'manufacturer' && (
                                <span
                                  className="text-[9px] font-bold px-1 py-0.2 rounded bg-indigo-50 text-[#3138A0] shrink-0"
                                  title="Herstellerangabe"
                                >
                                  Hersteller
                                </span>
                              )}
                            </div>
                            <span className="text-xs font-bold text-slate-900 break-words leading-snug block mt-0.5">
                              {formatted}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* 3. Dokumente (Rechnungen & Bedienungsanleitungen) – nur wenn vorhanden oder direkt zum Anhängen */}
            {docList.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSectionCollapse('sec_docs')}
                  className="w-full p-3 flex items-center justify-between text-left hover:bg-slate-50/70 transition-colors"
                >
                  <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Paperclip size={12} className="text-[#3138A0]" />
                    <span>Rechnungen & Anleitungen ({docList.length})</span>
                  </span>
                  {collapsedSections.sec_docs ? (
                    <ChevronDown size={15} className="text-slate-400" />
                  ) : (
                    <ChevronUp size={15} className="text-slate-400" />
                  )}
                </button>
                {!collapsedSections.sec_docs && (
                  <div className="px-3 pb-3 space-y-1.5">
                    {docList.map((doc) => (
                      <a
                        key={doc.id}
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={doc.title}
                        className="p-2.5 bg-slate-50 hover:bg-indigo-50/50 border border-slate-200 rounded-xl flex items-center justify-between gap-2 transition-colors"
                      >
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-slate-900 block truncate">
                            {doc.title}
                          </span>
                          <span className="text-[10px] font-semibold text-slate-500 uppercase">
                            {doc.type === 'rechnung'
                              ? 'Rechnung / Kaufbeleg'
                              : doc.type === 'anleitung'
                                ? 'Bedienungsanleitung'
                                : 'Dokument'}
                          </span>
                        </div>
                        <ExternalLink size={14} className="text-[#3138A0] shrink-0" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 4. Wartung & Wartungshistorie (für Geräte) */}
            {!isSubPart && (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="p-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSectionCollapse('sec_maint')}
                    className="flex items-center gap-1.5 text-left"
                  >
                    <Calendar size={12} className="text-[#2C7738]" />
                    <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider">
                      Wartung & Historie
                    </span>
                    {collapsedSections.sec_maint ? (
                      <ChevronDown size={14} className="text-slate-400" />
                    ) : (
                      <ChevronUp size={14} className="text-slate-400" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveModal('WARTUNG_DOKUMENTIEREN')}
                    className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-[#2C7738] border border-emerald-200 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-colors"
                  >
                    <CheckCircle2 size={12} />
                    <span>Wartung dokumentieren</span>
                  </button>
                </div>

                {!collapsedSections.sec_maint && (
                  <div className="px-3 pb-3 space-y-2.5">
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
                        <span className="text-[10px] text-slate-500 block">
                          Letzte Wartung
                        </span>
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
                        <span className="text-[10px] opacity-75 block">
                          Nächste Fälligkeit
                        </span>
                        <span className="font-bold tabular-nums">
                          {existingItem.next_maintenance || '–'}
                        </span>
                      </div>
                    </div>

                    {existingItem.history && existingItem.history.length > 0 && (
                      <div className="pt-1.5 border-t border-slate-100 space-y-1.5">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                          <History size={11} />
                          <span>Wartungsverlauf ({existingItem.history.length})</span>
                        </span>
                        <div className="max-h-36 overflow-y-auto space-y-1 pr-1 overscroll-contain">
                          {existingItem.history.map((h, idx) => (
                            <div
                              key={`${h.date}-${idx}`}
                              className="p-2 bg-slate-50 rounded-lg border border-slate-100 text-[11px]"
                            >
                              <div className="flex items-center justify-between font-bold text-slate-800">
                                <span>{h.plan || 'Wartung'}</span>
                                <span className="text-[10px] text-slate-500 tabular-nums">
                                  {h.date}
                                </span>
                              </div>
                              {h.note && (
                                <p className="text-[10px] text-slate-600 mt-0.5">
                                  {h.note}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 5. Zugeordnetes Zubehör & Kleinteile (für Geräte) */}
            {!isSubPart && (
              <div className="p-3 bg-white border border-slate-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Package size={12} className="text-[#3138A0]" />
                    <span>
                      Zubehör & Kleinteile ({linkedAccessories.length + linkedKleinteile.length})
                    </span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEquipmentId(existingItem.id);
                        setActiveModal('ZUBEHOER_ANLEGEN');
                      }}
                      className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] border border-indigo-200 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
                    >
                      <Plus size={11} />
                      <span>Zubehör</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEquipmentId(existingItem.id);
                        setActiveModal('KLEINTEIL_ANLEGEN');
                      }}
                      className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] border border-indigo-200 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
                    >
                      <Plus size={11} />
                      <span>Kleinteil</span>
                    </button>
                  </div>
                </div>

                {linkedAccessories.length === 0 && linkedKleinteile.length === 0 ? (
                  <p className="text-[11px] text-slate-400 italic">
                    Noch kein Zubehör oder Kleinteil zugeordnet.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                    {[...linkedAccessories, ...linkedKleinteile].map((acc) => {
                      const accIdentity = resolveEquipmentIdentity(acc);
                      const accFields = resolveEquipmentDynamicFields(acc)
                        .filter((f) => !isDynamicFieldValueEmpty(f))
                        .map((f) => formatDynamicFieldValue(f));
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => setSelectedEquipmentId(acc.id)}
                          className="w-full p-2.5 bg-slate-50/70 hover:bg-indigo-50/40 flex items-center justify-between gap-2 text-left transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-900 truncate">
                                {accIdentity.title}
                              </span>
                              <span className="px-1.5 py-0.2 rounded bg-indigo-50 text-[#3138A0] text-[9px] font-bold shrink-0">
                                {acc.item_type === 'kleinteil' ? 'Kleinteil' : 'Zubehör'}
                              </span>
                            </div>
                            {accFields.length > 0 && (
                              <span className="text-[10px] text-slate-500 block truncate">
                                {accFields.join(' · ')}
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

            {/* 6. Notizen */}
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

            {/* Eindeutige MCP-ID */}
            <div className="px-1 pt-0.5 flex items-center justify-between text-[10px] text-slate-400">
              <span>Eindeutige ID (MCP)</span>
              <span className="font-mono select-all">{existingItem.id}</span>
            </div>
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
              onClick={() => {
                populateFromExisting(existingItem);
                setIsEditMode(true);
              }}
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
  // 2. UNIVERSELLE BEARBEITEN- / ANLEGEN-ANSICHT (Alle Angaben optional & flexibel)
  // ============================================================================
  const primaryImageObj = images.find((img) => img.is_primary) || images[0] || null;

  return (
    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
      <div className="flex-1" onClick={handleCancelEdit} />

      <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[92%] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900 leading-tight">
              {isEditing
                ? itemType === 'kleinteil'
                  ? 'Kleinteil bearbeiten'
                  : itemType === 'zubehoer'
                    ? 'Zubehör bearbeiten'
                    : 'Gerät bearbeiten'
                : itemType === 'kleinteil'
                  ? 'Neues Kleinteil anlegen'
                  : itemType === 'zubehoer'
                    ? 'Neues Zubehör anlegen'
                    : 'Neues Gerät anlegen'}
            </h2>
            <p className="text-[11px] text-slate-500">
              Universelle Erfassung · Alle Angaben optional & jederzeit erweiterbar
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
        <div className="flex-1 overflow-y-auto py-3 space-y-3.5 text-xs text-slate-700 overscroll-contain">
          {/* 1. Bilder & Galerie (Hauptbild + weitere eigene Fotos / Herstellerbilder) */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider">
                Bilder ({images.length})
              </span>
              {images.length > 0 && (
                <span className="text-[10px] text-slate-500">
                  Stern = Hauptbild in der Liste
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {primaryImageObj ? (
                <img
                  src={primaryImageObj.url}
                  alt="Hauptbild"
                  className="w-20 h-20 rounded-2xl object-cover border border-slate-200 shrink-0 bg-white shadow-2xs"
                />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-white border border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 shrink-0">
                  <Camera size={22} />
                  <span className="text-[9px] font-bold mt-0.5">Kein Bild</span>
                </div>
              )}

              <div className="flex-1 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label
                    className={`flex-1 h-9 px-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer shadow-2xs ${
                      isUploadingPhoto ? 'opacity-60 pointer-events-none' : ''
                    }`}
                  >
                    <Camera size={13} className="text-[#3138A0]" />
                    <span>Kamera</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      disabled={isUploadingPhoto}
                      onChange={(e) => handleImageFilesUpload(e, 'own')}
                      className="hidden"
                    />
                  </label>

                  <label
                    className={`flex-1 h-9 px-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer shadow-2xs ${
                      isUploadingPhoto ? 'opacity-60 pointer-events-none' : ''
                    }`}
                  >
                    <ImagePlus size={13} className="text-[#3138A0]" />
                    <span>Galerie</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={isUploadingPhoto}
                      onChange={(e) => handleImageFilesUpload(e, 'own')}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* Externe Bild-URL (z.B. Herstellerbild) */}
                <div className="flex items-center gap-1">
                  <input
                    type="url"
                    value={newImageUrl}
                    onChange={(e) => setNewImageUrl(e.target.value)}
                    placeholder="Bild-URL (z. B. Herstellerbild)..."
                    className="flex-1 h-8 px-2 bg-white border border-slate-200 rounded-lg text-[11px] text-slate-900 outline-hidden focus:border-[#3138A0]"
                  />
                  <select
                    value={newImageSource}
                    onChange={(e) =>
                      setNewImageSource(e.target.value as 'own' | 'manufacturer')
                    }
                    className="h-8 px-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-semibold text-slate-700"
                  >
                    <option value="own">Eigenes</option>
                    <option value="manufacturer">Hersteller</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleAddImageUrl}
                    disabled={!newImageUrl.trim()}
                    className="h-8 px-2 bg-[#3138A0] disabled:opacity-40 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 shrink-0"
                  >
                    <Globe size={11} />
                    <span>+</span>
                  </button>
                </div>
              </div>
            </div>

            {images.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pt-1 pb-0.5 no-scrollbar">
                {images.map((img, idx) => (
                  <div
                    key={img.id}
                    className="relative shrink-0 p-1 bg-white border border-slate-200 rounded-xl flex flex-col items-center gap-1"
                  >
                    <img
                      src={img.url}
                      alt={img.caption || `Bild ${idx + 1}`}
                      className="w-14 h-14 rounded-lg object-cover"
                    />
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleSetPrimaryImage(img.id)}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-0.5 ${
                          img.is_primary
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                        title="Als Hauptbild festlegen"
                      >
                        <Star size={9} fill={img.is_primary ? 'currentColor' : 'none'} />
                        <span>{img.is_primary ? 'Haupt' : 'Wählen'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(img.id)}
                        className="p-0.5 text-[#B42318] hover:bg-red-50 rounded"
                        title="Bild entfernen"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 2. Standardfelder: Hersteller, Modell, Kategorie, Bezeichnung, Status */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
            <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider block">
              Basisdaten (optional)
            </span>

            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-5">
                <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                  Eintragstyp
                </label>
                <select
                  value={itemType}
                  onChange={(e) =>
                    setItemType(e.target.value as 'geraet' | 'zubehoer' | 'kleinteil')
                  }
                  className="w-full h-9 px-2 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-bold text-slate-900"
                >
                  <option value="geraet">Gerät / Maschine</option>
                  <option value="zubehoer">Zubehör / Teil</option>
                  <option value="kleinteil">Kleinteil</option>
                </select>
              </div>

              <div className="col-span-7">
                <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                  Kategorie (frei wählbar)
                </label>
                <input
                  type="text"
                  list="equipment-category-suggestions"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="z. B. Motorsäge, Zündkerze, Luftfilter..."
                  className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-semibold text-slate-900"
                />
                <datalist id="equipment-category-suggestions">
                  {categorySuggestions.map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                  Hersteller
                </label>
                <input
                  type="text"
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                  placeholder="z. B. STIHL, Sabo, NGK, Bosch..."
                  className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-semibold text-slate-900"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                  Modell / Typ
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="z. B. MS 261 C-M, BPMR7A..."
                  className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-semibold text-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-7">
                <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                  Anzeigename / Kurzbezeichnung
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    [manufacturer.trim(), model.trim()].filter(Boolean).join(' ') ||
                    'Wird automatisch aus Hersteller & Modell gebildet'
                  }
                  className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                />
              </div>

              <div className="col-span-5">
                <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                  {itemType === 'kleinteil' ? 'Artikel- / Teilenr.' : 'Seriennummer'}
                </label>
                <input
                  type="text"
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  placeholder={itemType === 'kleinteil' ? 'Art.-Nr. / OEM' : 'SN / Gerätenr.'}
                  className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                />
              </div>
            </div>

            {/* Kaufdatum, Kaufpreis, Händler */}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                  Kaufdatum
                </label>
                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  className="w-full h-9 px-2 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-[11px] text-slate-900"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                  Kaufpreis (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={purchasePriceStr}
                  onChange={(e) => setPurchasePriceStr(e.target.value)}
                  placeholder="0,00"
                  className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                  Händler
                </label>
                <input
                  type="text"
                  value={dealer}
                  onChange={(e) => setDealer(e.target.value)}
                  placeholder="z. B. Lagerhaus"
                  className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                />
              </div>
            </div>

            {/* Gerätestatus, Anzahl & ggf. Hauptgerät */}
            <div className="grid grid-cols-12 gap-2">
              {itemType === 'geraet' ? (
                <div className="col-span-8">
                  <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                    Gerätestatus
                  </label>
                  <select
                    value={status}
                    onChange={(e) =>
                      setStatus(
                        e.target.value as 'einsatzbereit' | 'faellig' | 'wartung'
                      )
                    }
                    className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-bold text-slate-900"
                  >
                    <option value="einsatzbereit">Einsatzbereit</option>
                    <option value="faellig">Wartung fällig</option>
                    <option value="wartung">In Wartung / Werkstatt</option>
                  </select>
                </div>
              ) : (
                <div className="col-span-8">
                  <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                    Zugeordnetes Hauptgerät
                  </label>
                  <select
                    value={parentEquipmentId}
                    onChange={(e) => setParentEquipmentId(e.target.value)}
                    className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-semibold text-slate-900"
                  >
                    <option value="">Keinem bestimmten Gerät zugeordnet</option>
                    {availableGeraete.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                        {g.model ? ` (${g.model})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="col-span-4">
                <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                  Anzahl (Stk.)
                </label>
                <input
                  type="number"
                  min={0}
                  value={quantityStr}
                  onChange={(e) => setQuantityStr(e.target.value)}
                  className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-bold text-slate-900"
                />
              </div>
            </div>
          </div>

          {/* 3. Dynamische Eingabefelder & Eigene Bereiche */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Sliders size={12} className="text-[#3138A0]" />
                  <span>Dynamische Felder & Bereiche ({dynamicFields.length})</span>
                </span>
                <p className="text-[10px] text-slate-500">
                  Beliebige eigene oder von ChatGPT recherchierte Felder (Text, Zahl, Einheit, Datum, Ja/Nein)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewSectionBox((prev) => !prev)}
                className="px-2 py-1 bg-white hover:bg-indigo-50 text-[#3138A0] border border-slate-200 rounded-lg text-[10px] font-bold flex items-center gap-1 shrink-0"
              >
                <FolderPlus size={11} />
                <span>+ Bereich</span>
              </button>
            </div>

            {showNewSectionBox && (
              <div className="p-2 bg-white border border-indigo-200 rounded-xl flex items-center gap-1.5">
                <input
                  type="text"
                  value={newSectionInput}
                  onChange={(e) => setNewSectionInput(e.target.value)}
                  placeholder="Name des neuen Bereichs (z. B. Motor, Schneidgarnitur, Akku)..."
                  className="flex-1 h-8 px-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 outline-hidden focus:border-[#3138A0]"
                />
                <button
                  type="button"
                  onClick={handleAddCustomSection}
                  className="h-8 px-2.5 bg-[#3138A0] text-white rounded-lg text-[11px] font-bold"
                >
                  Erstellen
                </button>
              </div>
            )}

            {/* Bestehende dynamische Felder bearbeiten oder entfernen */}
            {dynamicFields.length > 0 && (
              <div className="space-y-2">
                {dynamicFields.map((field) => (
                  <div
                    key={field.id}
                    className="p-2 bg-white border border-slate-200 rounded-xl space-y-1.5"
                  >
                    <div className="grid grid-cols-12 gap-1.5 items-center">
                      <input
                        type="text"
                        value={field.label}
                        onChange={(e) =>
                          handleUpdateDynamicField(field.id, { label: e.target.value })
                        }
                        placeholder="Feldname"
                        className="col-span-5 h-8 px-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-900"
                      />
                      <select
                        value={field.section || 'Technische Daten'}
                        onChange={(e) =>
                          handleUpdateDynamicField(field.id, { section: e.target.value })
                        }
                        className="col-span-4 h-8 px-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-semibold text-slate-700"
                      >
                        {allSectionOptions.map((sec) => (
                          <option key={sec} value={sec}>
                            {sec}
                          </option>
                        ))}
                      </select>
                      <select
                        value={field.type}
                        onChange={(e) =>
                          handleUpdateDynamicField(field.id, {
                            type: e.target.value as EquipmentFieldType
                          })
                        }
                        className="col-span-2 h-8 px-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-semibold text-slate-700"
                      >
                        <option value="text">Text</option>
                        <option value="number">Zahl</option>
                        <option value="unit">Einheit</option>
                        <option value="date">Datum</option>
                        <option value="boolean">Ja/Nein</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => handleRemoveDynamicField(field.id)}
                        className="col-span-1 h-8 flex items-center justify-center text-slate-400 hover:text-[#B42318]"
                        title="Feld löschen"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div className="grid grid-cols-12 gap-1.5 items-center">
                      {field.type === 'boolean' ? (
                        <select
                          value={
                            field.value === true ||
                            String(field.value).toLowerCase() === 'true' ||
                            String(field.value).toLowerCase() === 'ja'
                              ? 'true'
                              : 'false'
                          }
                          onChange={(e) =>
                            handleUpdateDynamicField(field.id, {
                              value: e.target.value === 'true'
                            })
                          }
                          className="col-span-8 h-8 px-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-900"
                        >
                          <option value="true">Ja</option>
                          <option value="false">Nein</option>
                        </select>
                      ) : (
                        <input
                          type={
                            field.type === 'date'
                              ? 'date'
                              : field.type === 'number' || field.type === 'unit'
                                ? 'number'
                                : 'text'
                          }
                          step="any"
                          value={String(field.value ?? '')}
                          onChange={(e) =>
                            handleUpdateDynamicField(field.id, { value: e.target.value })
                          }
                          placeholder="Wert (leer = wird in Ansicht ausgeblendet)"
                          className={`${
                            field.type === 'unit' ? 'col-span-5' : 'col-span-8'
                          } h-8 px-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900`}
                        />
                      )}

                      {field.type === 'unit' && (
                        <input
                          type="text"
                          value={field.unit || ''}
                          onChange={(e) =>
                            handleUpdateDynamicField(field.id, { unit: e.target.value })
                          }
                          placeholder="Einheit (cm, PS...)"
                          className="col-span-3 h-8 px-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900"
                        />
                      )}

                      <select
                        value={field.source || 'individual'}
                        onChange={(e) =>
                          handleUpdateDynamicField(field.id, {
                            source: e.target.value as 'manufacturer' | 'individual'
                          })
                        }
                        className="col-span-4 h-8 px-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-semibold text-slate-600"
                      >
                        <option value="individual">Individuell</option>
                        <option value="manufacturer">Herstellerangabe</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Neues dynamisches Feld hinzufügen */}
            <div className="p-2.5 bg-white border border-dashed border-slate-300 rounded-xl space-y-2">
              <span className="text-[10px] font-bold text-slate-600 block">
                + Neues Feld hinzufügen
              </span>
              <div className="grid grid-cols-12 gap-1.5">
                <input
                  type="text"
                  value={draftFieldLabel}
                  onChange={(e) => setDraftFieldLabel(e.target.value)}
                  placeholder="Bezeichnung (z. B. Schnittlänge, Leistung, Gewicht)"
                  className="col-span-7 h-8 px-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900"
                />
                <select
                  value={draftFieldType}
                  onChange={(e) =>
                    setDraftFieldType(e.target.value as EquipmentFieldType)
                  }
                  className="col-span-5 h-8 px-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800"
                >
                  <option value="text">Typ: Text</option>
                  <option value="number">Typ: Zahl</option>
                  <option value="unit">Typ: Zahl + Einheit</option>
                  <option value="date">Typ: Datum</option>
                  <option value="boolean">Typ: Ja / Nein</option>
                </select>
              </div>

              <div className="grid grid-cols-12 gap-1.5">
                {draftFieldType === 'boolean' ? (
                  <select
                    value={draftFieldValue || 'true'}
                    onChange={(e) => setDraftFieldValue(e.target.value)}
                    className="col-span-6 h-8 px-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-900"
                  >
                    <option value="true">Ja</option>
                    <option value="false">Nein</option>
                  </select>
                ) : (
                  <input
                    type={
                      draftFieldType === 'date'
                        ? 'date'
                        : draftFieldType === 'number' || draftFieldType === 'unit'
                          ? 'number'
                          : 'text'
                    }
                    step="any"
                    value={draftFieldValue}
                    onChange={(e) => setDraftFieldValue(e.target.value)}
                    placeholder="Wert eingeben..."
                    className={`${
                      draftFieldType === 'unit' ? 'col-span-4' : 'col-span-6'
                    } h-8 px-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900`}
                  />
                )}

                {draftFieldType === 'unit' && (
                  <input
                    type="text"
                    value={draftFieldUnit}
                    onChange={(e) => setDraftFieldUnit(e.target.value)}
                    placeholder="Einheit (kW, cm...)"
                    className="col-span-2 h-8 px-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900"
                  />
                )}

                <select
                  value={draftFieldSection}
                  onChange={(e) => setDraftFieldSection(e.target.value)}
                  className="col-span-4 h-8 px-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-semibold text-slate-700"
                >
                  {allSectionOptions.map((sec) => (
                    <option key={sec} value={sec}>
                      {sec}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleAddDynamicField}
                  disabled={!draftFieldLabel.trim()}
                  className="col-span-2 h-8 bg-[#3138A0] disabled:opacity-40 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1"
                >
                  <Plus size={13} />
                  <span>Feld</span>
                </button>
              </div>

              <div className="flex items-center justify-between pt-0.5">
                <span className="text-[10px] text-slate-400">Datenquelle:</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDraftFieldSource('individual')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      draftFieldSource === 'individual'
                        ? 'bg-slate-800 text-white'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    Individuell
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftFieldSource('manufacturer')}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      draftFieldSource === 'manufacturer'
                        ? 'bg-[#3138A0] text-white'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    Herstellerangabe
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 4. Dokumente (Rechnungen & Bedienungsanleitungen) */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
            <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Paperclip size={12} className="text-[#3138A0]" />
              <span>Rechnungen & Bedienungsanleitungen ({documents.length})</span>
            </span>

            {documents.length > 0 && (
              <div className="space-y-1.5">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="p-2 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-slate-900 block truncate">
                        {doc.title}
                      </span>
                      <span className="text-[10px] text-slate-500 uppercase">
                        {doc.type}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveDocument(doc.id)}
                      className="p-1 text-slate-400 hover:text-[#B42318]"
                      title="Dokument entfernen"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-12 gap-1.5 items-center pt-1">
              <select
                value={newDocType}
                onChange={(e) =>
                  setNewDocType(
                    e.target.value as 'rechnung' | 'anleitung' | 'sonstiges'
                  )
                }
                className="col-span-4 h-9 px-2 bg-white border border-slate-200 rounded-xl text-[11px] font-semibold text-slate-800"
              >
                <option value="rechnung">Rechnung</option>
                <option value="anleitung">Anleitung</option>
                <option value="sonstiges">Sonstiges</option>
              </select>
              <input
                type="text"
                value={newDocTitle}
                onChange={(e) => setNewDocTitle(e.target.value)}
                placeholder="Titel (optional)"
                className="col-span-4 h-9 px-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900"
              />
              <label className="col-span-4 h-9 px-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-[11px] font-bold text-[#3138A0] flex items-center justify-center gap-1 cursor-pointer shadow-2xs">
                <Paperclip size={12} />
                <span>Datei wählen</span>
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={handleDocumentUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* 5. Wartung (für Geräte) */}
          {itemType === 'geraet' && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
              <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Calendar size={12} className="text-[#2C7738]" />
                <span>Wartung & Intervall (optional)</span>
              </span>

              <div>
                <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                  Wartungsplan / Prüfpunkte
                </label>
                <input
                  type="text"
                  value={maintenancePlan}
                  onChange={(e) => setMaintenancePlan(e.target.value)}
                  placeholder="z. B. Luftfilter, Zündkerze, Messer schärfen..."
                  className="w-full h-9 px-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                    Intervall (Mon.)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={intervalMonths}
                    onChange={(e) => {
                      const val = e.target.value;
                      setIntervalMonths(val);
                      const m = Math.max(1, parseInt(val, 10) || 6);
                      setNextMaintenance(addMonthsIso(lastMaintenance, m));
                    }}
                    className="w-full h-9 px-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                    Letzte Wartung
                  </label>
                  <input
                    type="date"
                    value={lastMaintenance}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLastMaintenance(val);
                      const m = Math.max(1, parseInt(intervalMonths, 10) || 6);
                      setNextMaintenance(addMonthsIso(val, m));
                    }}
                    className="w-full h-9 px-2 bg-white border border-slate-200 rounded-xl text-[11px] text-slate-900"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
                    Nächste Wartung
                  </label>
                  <input
                    type="date"
                    value={nextMaintenance}
                    onChange={(e) => setNextMaintenance(e.target.value)}
                    className="w-full h-9 px-2 bg-white border border-slate-200 rounded-xl text-[11px] text-slate-900"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 6. Notizen */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1 text-[11px]">
              Notiz / Lagerort / Besonderheiten
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optionale Hinweise..."
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
            />
          </div>

          {/* Löschen-Option im Bearbeiten-Modus */}
          {isEditing && existingItem && (
            <div className="pt-1">
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="w-full h-9 border border-red-200 text-[#B42318] bg-red-50/60 hover:bg-red-100/70 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Trash2 size={14} />
                  <span>Eintrag löschen</span>
                </button>
              ) : (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-[#B42318]">
                    Wirklich unwiderruflich löschen?
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-700"
                    >
                      Nein
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="px-2.5 py-1 bg-[#B42318] text-white rounded-lg text-[11px] font-bold"
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
            onClick={handleCancelEdit}
            className="flex-1 h-11 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-semibold rounded-xl text-xs transition-all"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 h-11 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 text-white font-bold rounded-xl text-xs transition-all shadow-xs"
          >
            {isEditing ? 'Änderungen speichern' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
};
