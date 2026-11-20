import type {
  Equipment,
  EquipmentDocument,
  EquipmentDynamicField,
  EquipmentFieldType,
  EquipmentImage
} from '../types/index.ts';
import { normalizePhotoSrc } from './imageCompress.ts';

export interface FunctionalGroupInfo {
  id: string;
  title: string;
  order: number;
}

/**
 * Rückwärtskompatible Übersetzung bestehender Kategorie-Kennungen in lesbare Bezeichnungen,
 * damit vorhandene Geräte ohne Datenverlust sauber gruppiert werden.
 * Neue Kategorien können völlig frei als Text vergeben werden (keine starre Datenbank).
 */
const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  motorsaegen: 'Motorsäge',
  heckenschere: 'Heckenschere',
  felco_silky_schnitt: 'Handsäge & Schere',
  rasenmaeher: 'Rasenmäher',
  freischneider: 'Freischneider',
  vertikutierer_boden: 'Vertikutierer & Bodenpflege',
  blaeser_sonstige: 'Laubbläser & Häcksler',
  bewaesserung_spritze: 'Bewässerung',
  handwerkzeuge_garten: 'Handgerät',
  milwaukee_geraete: 'Multitool & Akku-System',
  elektrowerkzeuge_allgemein: 'Elektrowerkzeug',
  reinigung_kehrmaschine: 'Reinigung',
  bau_pflaster_geraete: 'Baugerät',
  leitern_allgemein: 'Leiter & Gerüst',
  winterdienst_geraete: 'Winterdienst',
  fahrzeug_anhaenger: 'Fahrzeug & Anhänger',
  zub_kette_schiene: 'Kette & Schwert',
  zub_feilen_schaerfen: 'Feile & Schärfer',
  zub_faden_messer: 'Faden & Messer',
  zub_bewaesserung_gardena: 'Bewässerungszubehör',
  zub_akku_ladung: 'Akku & Ladegerät',
  zub_bohrer_trennscheiben: 'Bohrer & Scheibe',
  zub_filter_psa_sonstiges: 'Betriebsstoff & PSA',
  allgemein: 'Allgemein',
  geraet: 'Allgemeines Gerät',
  zubehoer: 'Zubehör & Ersatzteile',
  kleinteil: 'Kleinteile',
  kleinteile: 'Kleinteile'
};

const GLOBAL_SPEC_LABELS: Record<string, string> = {
  feilen_durchmesser: 'Feilen-Ø',
  feilen_ø: 'Feilen-Ø',
  kettenteilung: 'Kettenteilung',
  ketten_teilung: 'Kettenteilung',
  nutbreite: 'Treibgliedstärke / Nut',
  ketten_treibgliedstaerke: 'Treibgliedstärke',
  ketten_treibgliedstärke: 'Treibgliedstärke',
  treibgliedstaerke: 'Treibgliedstärke',
  treibgliedstärke: 'Treibgliedstärke',
  treibglieder: 'Treibglieder (TG)',
  treibglieder_tg: 'Treibglieder (TG)',
  schwertlaenge: 'Schwert- / Messerlänge',
  schwertlänge: 'Schwert- / Messerlänge',
  schienenlaenge: 'Schienenlänge',
  schienenlänge: 'Schienenlänge',
  kettengeschwindigkeit: 'Kettengeschwindigkeit',
  kette: 'Kette',
  ketten_bestellnummer: 'Ketten-Bestellnummer',
  milwaukee_ketten_ersatzteilnummer: 'Ketten-Ersatzteilnummer',
  ersatzteilnummer: 'Ersatzteilnummer',
  bestellnummer: 'Bestellnummer',
  artikelnummer: 'Artikelnummer',
  seriennummer: 'Seriennummer',
  baujahr: 'Baujahr',
  gewicht: 'Gewicht',
  leistung: 'Leistung',
  antrieb: 'Antrieb / Kraftstoff',
  faden_durchmesser: 'Mähfaden-Ø',
  aufnahme_bohrung: 'Aufnahme / Bohrung',
  schneidwerkzeug: 'Schneidwerkzeug',
  schnittbreite: 'Schnittbreite',
  messer_typ: 'Messerlänge / Typ',
  motoroel_kerze: 'Motoröl / Zündkerze',
  arbeitsbreite: 'Arbeitsbreite / Ø',
  werkzeug_welle: 'Messerwelle / Zinken',
  zahnabstand: 'Zahnabstand',
  hauptmass: 'Maß / Parameter',
  verschleissteil: 'Verschleißteil / Ersatzteil',
  blatt_klinge: 'Blattlänge / Klinge',
  zahnung_schnitt: 'Zahnung / Schnitt-Ø',
  ausfuehrung: 'Breite / Ausführung',
  anschluss: 'System / Anschluss',
  volumen_leistung: 'Länge / Volumen',
  akkusystem: 'Akkusystem / Spannung',
  aufnahme_mass: 'Aufnahme / Maß',
  zubehoer_system: 'Anschluss / System',
  abmessung: 'Abmessung / Länge',
  spezifikation: 'Ausführung / Größe',
  raeumbreite: 'Räumbreite / Volumen',
  prueftermin: 'Prüftermin / §57a',
  zahnform: 'Zahnform / Klingentyp',
  schaerfwinkel: 'Schärfwinkel',
  schärfwinkel: 'Schärfwinkel',
  tiefenbegrenzer: 'Tiefenbegrenzer',
  kapazitaet: 'Kapazität / Energie',
  einsatzzweck: 'Einsatzzweck',
  teilenummer: 'Ersatzteil-Nr.'
};

export const DEFAULT_SECTION_NAMES = [
  'Technische Daten',
  'Schneidgarnitur & Werkzeug',
  'Motor, Akku & Antrieb',
  'Maße & Gewicht',
  'Individuelle Angaben'
] as const;

export const SUGGESTED_CATEGORIES_GERAET = [
  'Motorsäge',
  'Heckenschere',
  'Rasenmäher',
  'Freischneider',
  'Laubbläser & Häcksler',
  'Vertikutierer & Bodenpflege',
  'Handsäge & Schere',
  'Multitool & Akku-System',
  'Elektrowerkzeug',
  'Bewässerung',
  'Handgerät',
  'Reinigung',
  'Baugerät',
  'Leiter & Gerüst',
  'Winterdienst',
  'Fahrzeug & Anhänger'
] as const;

export const SUGGESTED_CATEGORIES_ZUBEHOER = [
  'Kette & Schwert',
  'Feile & Schärfer',
  'Faden & Messer',
  'Akku & Ladegerät',
  'Bohrer & Scheibe',
  'Bewässerungszubehör',
  'Betriebsstoff & PSA',
  'Ersatzteil / Zubehör'
] as const;

export const SUGGESTED_CATEGORIES_KLEINTEIL = [
  'Schrauben & Muttern',
  'Dichtungen & O-Ringe',
  'Filter & Zündkerzen',
  'Splinte, Stifte & Federn',
  'Schlauchverbinder & Schellen',
  'Klingen & Ersatzmesser',
  'Elektro- & Kabelkleinteile',
  'Befestigung & Montage',
  'Lager, Buchsen & Ringe',
  'Kleinteil / Ersatzteil'
] as const;

export function getCategoryLabel(
  categoryId?: string,
  itemType?: 'geraet' | 'zubehoer' | 'kleinteil'
): string {
  if (!categoryId || !categoryId.trim()) {
    if (itemType === 'kleinteil') return 'Kleinteile';
    if (itemType === 'zubehoer') return 'Zubehör & Ersatzteile';
    return 'Allgemein';
  }
  const trimmed = categoryId.trim();
  const lower = trimmed.toLowerCase();
  if (LEGACY_CATEGORY_LABELS[trimmed]) return LEGACY_CATEGORY_LABELS[trimmed];
  if (LEGACY_CATEGORY_LABELS[lower]) return LEGACY_CATEGORY_LABELS[lower];
  return trimmed;
}

export function getFunctionalGroupInfo(
  categoryId?: string,
  itemType?: 'geraet' | 'zubehoer' | 'kleinteil'
): FunctionalGroupInfo {
  const label = getCategoryLabel(categoryId, itemType);
  if (itemType === 'kleinteil') {
    return { id: `kt:${label}`, title: label, order: 30 };
  }
  if (itemType === 'zubehoer') {
    return { id: `zub:${label}`, title: label, order: 20 };
  }
  return { id: `cat:${label}`, title: label, order: 10 };
}

function getSpecFieldLabel(key: string, _categoryId?: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';
  const normalizedKey = trimmed
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[\s/-]+/g, '_');

  if (GLOBAL_SPEC_LABELS[trimmed]) return GLOBAL_SPEC_LABELS[trimmed];
  if (GLOBAL_SPEC_LABELS[trimmed.toLowerCase()]) return GLOBAL_SPEC_LABELS[trimmed.toLowerCase()];
  if (GLOBAL_SPEC_LABELS[normalizedKey]) return GLOBAL_SPEC_LABELS[normalizedKey];

  return trimmed
    .replace(/_/g, ' ')
    .replace(/laenge/gi, 'länge')
    .replace(/staerke/gi, 'stärke')
    .replace(/groesse/gi, 'größe')
    .replace(/schaerf/gi, 'schärf')
    .replace(/saege/gi, 'säge')
    .replace(/geraet/gi, 'gerät')
    .replace(/zubehoer/gi, 'zubehör')
    .replace(/oel/gi, 'öl')
    .replace(/pruef/gi, 'prüf')
    .replace(/hoehe/gi, 'höhe')
    .replace(/ausfuehrung/gi, 'ausführung')
    .replace(/kapazitaet/gi, 'kapazität')
    .replace(/raeumbreite/gi, 'räumbreite')
    .replace(/verschleissteil/gi, 'verschleißteil')
    .replace(/hauptmass/gi, 'hauptmaß')
    .replace(/fuellmenge/gi, 'füllmenge')
    .replace(/zaehne/gi, 'zähne')
    .replace(/buerste/gi, 'bürste')
    .replace(/duese/gi, 'düse')
    .replace(/duenger/gi, 'dünger')
    .replace(/(^|[\s/-])([a-zäöüß])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

const IGNORED_SPEC_META_KEYS = new Set([
  'created_at',
  'updated_at',
  'has_photo',
  'photo_count',
  'image_count',
  'document_count',
  'remove_photo'
]);

function normalizeFieldKey(labelOrKey: string): string {
  return labelOrKey
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function inferFieldFromRawSpec(
  rawKey: string,
  rawVal: unknown,
  defaultSection = 'Technische Daten',
  defaultSource: 'manufacturer' | 'individual' = 'manufacturer'
): EquipmentDynamicField | null {
  const cleanKey = rawKey.trim();
  if (!cleanKey || IGNORED_SPEC_META_KEYS.has(cleanKey)) return null;
  if (rawVal === null || rawVal === undefined) return null;

  const label = getSpecFieldLabel(cleanKey);

  if (typeof rawVal === 'boolean') {
    return {
      id: `fld-${normalizeFieldKey(cleanKey)}`,
      key: cleanKey,
      label,
      type: 'boolean',
      value: rawVal,
      section: defaultSection,
      source: defaultSource
    };
  }

  if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
    return {
      id: `fld-${normalizeFieldKey(cleanKey)}`,
      key: cleanKey,
      label,
      type: 'number',
      value: rawVal,
      section: defaultSection,
      source: defaultSource
    };
  }

  const str = String(rawVal).trim();
  if (!str) return null;

  if (str.toLowerCase() === 'ja' || str.toLowerCase() === 'true') {
    return {
      id: `fld-${normalizeFieldKey(cleanKey)}`,
      key: cleanKey,
      label,
      type: 'boolean',
      value: true,
      section: defaultSection,
      source: defaultSource
    };
  }
  if (str.toLowerCase() === 'nein' || str.toLowerCase() === 'false') {
    return {
      id: `fld-${normalizeFieldKey(cleanKey)}`,
      key: cleanKey,
      label,
      type: 'boolean',
      value: false,
      section: defaultSection,
      source: defaultSource
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return {
      id: `fld-${normalizeFieldKey(cleanKey)}`,
      key: cleanKey,
      label,
      type: 'date',
      value: str,
      section: defaultSection,
      source: defaultSource
    };
  }

  // Prüfe Zahl + Einheit (z. B. "4,9 kg", "40 cm", "3.0 kW", "281 Wh")
  const unitMatch = str.match(
    /^([+-]?\d+(?:[.,]\d+)?)\s*(mm|cm|m|km|g|kg|t|ml|l|W|kW|PS|V|Ah|Wh|bar|U\/min|rpm|dB|dB\(A\)|°|°C|TG|Stk\.?|%|Zoll|")$/i
  );
  if (unitMatch) {
    return {
      id: `fld-${normalizeFieldKey(cleanKey)}`,
      key: cleanKey,
      label,
      type: 'unit',
      value: unitMatch[1].replace(',', '.'),
      unit: unitMatch[2],
      section: defaultSection,
      source: defaultSource
    };
  }

  if (/^[+-]?\d+(?:[.,]\d+)?$/.test(str)) {
    const num = Number(str.replace(',', '.'));
    if (Number.isFinite(num)) {
      return {
        id: `fld-${normalizeFieldKey(cleanKey)}`,
        key: cleanKey,
        label,
        type: 'number',
        value: num,
        section: defaultSection,
        source: defaultSource
      };
    }
  }

  return {
    id: `fld-${normalizeFieldKey(cleanKey)}`,
    key: cleanKey,
    label,
    type: 'text',
    value: str,
    section: defaultSection,
    source: defaultSource
  };
}

export function isDynamicFieldValueEmpty(field: EquipmentDynamicField): boolean {
  if (field.value === null || field.value === undefined) return true;
  if (field.type === 'boolean') return false;
  return String(field.value).trim() === '';
}

export function formatDynamicFieldValue(field: EquipmentDynamicField): string {
  if (isDynamicFieldValueEmpty(field)) return '';
  if (field.type === 'boolean') {
    const b =
      field.value === true ||
      String(field.value).toLowerCase() === 'true' ||
      String(field.value).toLowerCase() === 'ja';
    return b ? 'Ja' : 'Nein';
  }
  if (field.type === 'date') {
    const s = String(field.value).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    return s;
  }
  if (field.type === 'number') {
    const n = Number(String(field.value).replace(',', '.'));
    if (Number.isFinite(n)) {
      return n.toLocaleString('de-AT', { maximumFractionDigits: 3 });
    }
    return String(field.value).trim();
  }
  if (field.type === 'unit') {
    const rawStr = String(field.value).trim();
    const n = Number(rawStr.replace(',', '.'));
    const formattedVal = Number.isFinite(n)
      ? n.toLocaleString('de-AT', { maximumFractionDigits: 3 })
      : rawStr;
    const u = (field.unit || '').trim();
    return u ? `${formattedVal} ${u}` : formattedVal;
  }
  return String(field.value).trim();
}

/**
 * Führt strukturierte `custom_fields` und bestehende `specs` verlustfrei zusammen.
 * Bestehende Gerätedaten bleiben vollständig erhalten; Duplikate werden anhand des Schlüssels zusammengeführt.
 */
export function resolveEquipmentDynamicFields(
  eq: Partial<Equipment> | null | undefined
): EquipmentDynamicField[] {
  if (!eq) return [];
  const result: EquipmentDynamicField[] = [];
  const seenKeys = new Set<string>();

  if (Array.isArray(eq.custom_fields)) {
    for (const f of eq.custom_fields) {
      if (!f || typeof f !== 'object') continue;
      const label = String(f.label || f.key || '').trim();
      if (!label) continue;
      const normKey = normalizeFieldKey(f.key || label);
      const validType: EquipmentFieldType =
        f.type === 'number' ||
        f.type === 'unit' ||
        f.type === 'date' ||
        f.type === 'boolean' ||
        f.type === 'text'
          ? f.type
          : 'text';
      const normalizedField: EquipmentDynamicField = {
        id: f.id || `fld-${normKey || Date.now()}`,
        key: f.key || normKey || label,
        label,
        type: validType,
        value: f.value ?? '',
        unit: f.unit ? String(f.unit).trim() : undefined,
        section: f.section?.trim() || 'Technische Daten',
        source: f.source === 'individual' ? 'individual' : 'manufacturer'
      };
      result.push(normalizedField);
      if (normKey) seenKeys.add(normKey);
      if (f.key) seenKeys.add(f.key.trim().toLowerCase());
      seenKeys.add(label.toLowerCase());
    }
  }

  if (eq.specs && typeof eq.specs === 'object') {
    for (const [k, v] of Object.entries(eq.specs)) {
      const cleanK = k.trim();
      if (!cleanK || IGNORED_SPEC_META_KEYS.has(cleanK)) continue;
      const normK = normalizeFieldKey(cleanK);
      const labelK = getSpecFieldLabel(cleanK).toLowerCase();
      if (seenKeys.has(normK) || seenKeys.has(cleanK.toLowerCase()) || seenKeys.has(labelK)) {
        continue;
      }
      const inferred = inferFieldFromRawSpec(cleanK, v, 'Technische Daten', 'manufacturer');
      if (inferred) {
        result.push(inferred);
        seenKeys.add(normK);
      }
    }
  }

  return result;
}

export function syncSpecsFromDynamicFields(
  fields: EquipmentDynamicField[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (!f || !f.label.trim() || isDynamicFieldValueEmpty(f)) continue;
    const formatted = formatDynamicFieldValue(f);
    if (!formatted) continue;
    const key = (f.key || normalizeFieldKey(f.label) || f.label).trim();
    out[key] = formatted;
  }
  return out;
}

/**
 * Liefert alle Bilder eines Geräts (migriert `eq.photo` nahtlos in `images`, falls noch nicht enthalten)
 * und stellt sicher, dass genau ein Bild als Hauptbild (`is_primary = true`) markiert ist.
 */
export function resolveEquipmentImages(
  eq: Partial<Equipment> | null | undefined
): EquipmentImage[] {
  if (!eq) return [];
  const list: EquipmentImage[] = [];
  const seenUrls = new Set<string>();

  const primaryPhoto = normalizePhotoSrc(eq.photo);

  if (Array.isArray(eq.images)) {
    for (let i = 0; i < eq.images.length; i++) {
      const img = eq.images[i];
      if (!img || typeof img !== 'object') continue;
      const cleanUrl = normalizePhotoSrc(img.url);
      if (!cleanUrl || seenUrls.has(cleanUrl)) continue;
      seenUrls.add(cleanUrl);
      const captionOrTitle = (img.caption || img.title || '').trim() || undefined;
      list.push({
        id: img.id || `img-${i}-${Date.now()}`,
        url: cleanUrl,
        title: captionOrTitle,
        caption: captionOrTitle,
        is_primary: Boolean(img.is_primary),
        source:
          img.source === 'manufacturer' || img.source === 'mcp' || img.source === 'own'
            ? img.source
            : 'own',
        license_note: img.license_note?.trim() || undefined,
        created_at: img.created_at || img.added_at,
        added_at: img.added_at || img.created_at
      });
    }
  }

  if (primaryPhoto && !seenUrls.has(primaryPhoto)) {
    list.unshift({
      id: 'img-primary-main',
      url: primaryPhoto,
      title: eq.name || 'Hauptbild',
      caption: eq.name || 'Hauptbild',
      is_primary: true,
      source: 'own'
    });
  }

  if (list.length > 0 && !list.some((img) => img.is_primary)) {
    list[0] = { ...list[0], is_primary: true };
  } else if (list.filter((img) => img.is_primary).length > 1) {
    let foundFirst = false;
    for (let i = 0; i < list.length; i++) {
      if (list[i].is_primary) {
        if (!foundFirst) {
          foundFirst = true;
        } else {
          list[i] = { ...list[i], is_primary: false };
        }
      }
    }
  }

  return list;
}

export function resolvePrimaryEquipmentPhoto(
  eq: Partial<Equipment> | null | undefined
): string | null {
  const images = resolveEquipmentImages(eq);
  const primary = images.find((i) => i.is_primary) || images[0];
  return primary?.url || normalizePhotoSrc(eq?.photo) || null;
}

export function resolveEquipmentDocuments(
  eq: Partial<Equipment> | null | undefined
): EquipmentDocument[] {
  if (!eq || !Array.isArray(eq.documents)) return [];
  const out: EquipmentDocument[] = [];
  for (let i = 0; i < eq.documents.length; i++) {
    const d = eq.documents[i];
    if (!d || typeof d !== 'object') continue;
    const rawUrl = String(d.url || d.data_url || '').trim();
    if (!rawUrl) continue;
    const docType =
      d.type === 'rechnung' || d.type === 'anleitung'
        ? d.type
        : d.doc_type === 'rechnung' || d.doc_type === 'anleitung'
          ? d.doc_type
          : 'sonstiges';
    const docTitle =
      String(d.title || d.name || '').trim() ||
      (docType === 'rechnung'
        ? 'Rechnung'
        : docType === 'anleitung'
          ? 'Bedienungsanleitung'
          : 'Dokument');
    out.push({
      id: d.id || `doc-${i}-${Date.now()}`,
      name: docTitle,
      title: docTitle,
      doc_type: docType,
      type: docType,
      data_url: rawUrl,
      url: rawUrl,
      mime_type: d.mime_type,
      size_bytes: d.size_bytes,
      created_at: d.created_at || d.added_at,
      added_at: d.added_at || d.created_at
    });
  }
  return out;
}

/**
 * Erzeugt die einheitliche Anzeige-Überschrift und Unterzeile für jedes Gerät (Hersteller + Modell / Bezeichnung).
 */
export function resolveEquipmentIdentity(eq: Partial<Equipment> | null | undefined): {
  manufacturer: string;
  model: string;
  displayName: string;
  title: string;
  subtitle: string;
} {
  const manufacturer = (eq?.manufacturer || '').trim();
  const model = (eq?.model || '').trim();
  const rawName = (eq?.name || '').trim();

  let displayName = rawName;
  if (!displayName) {
    displayName = [manufacturer, model].filter(Boolean).join(' ').trim() || 'Unbenanntes Gerät';
  }

  let subtitle = '';
  if (manufacturer && model) {
    subtitle = `${manufacturer} · ${model}`;
  } else if (manufacturer && !displayName.toLowerCase().includes(manufacturer.toLowerCase())) {
    subtitle = manufacturer;
  } else if (model && !displayName.toLowerCase().includes(model.toLowerCase())) {
    subtitle = model;
  } else if (manufacturer || model) {
    subtitle = [manufacturer, model].filter(Boolean).join(' · ');
  }

  return {
    manufacturer,
    model,
    displayName,
    title: displayName,
    subtitle
  };
}
