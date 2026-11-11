export interface SpecFieldDef {
  key: string;
  label: string;
  placeholder: string;
  quickOptions?: string[];
}

export interface EquipmentCategoryDef {
  id: string;
  label: string;
  itemType: 'geraet' | 'zubehoer';
  defaultMaintenancePlan?: string;
  defaultIntervalMonths?: number;
  namePlaceholder: string;
  modelPlaceholder: string;
  fields: SpecFieldDef[];
}

const FILE_DIAMETER_CHIPS = ['3,2 mm', '4,0 mm', '4,5 mm', '4,8 mm', '5,2 mm', '5,5 mm'];
const CHAIN_PITCH_CHIPS = ['1/4" P', '3/8" P', '.325"', '3/8"', '.404"'];
const GAUGE_CHIPS = ['1,1 mm', '1,3 mm', '1,5 mm', '1,6 mm'];
const BAR_LENGTH_CHIPS = ['30 cm', '35 cm', '40 cm', '45 cm', '50 cm'];
const LINE_DIAMETER_CHIPS = ['2,0 mm', '2,4 mm', '2,7 mm', '3,0 mm', '3,3 mm'];

export const EQUIPMENT_CATEGORIES: EquipmentCategoryDef[] = [
  // ================= GERÄTE =================
  {
    id: 'motorsaegen',
    label: 'Motorsäge & Hochentaster',
    itemType: 'geraet',
    defaultMaintenancePlan: 'Kette schärfen, Schwertnut & Luftfilter reinigen, Kettenbremse prüfen',
    defaultIntervalMonths: 3,
    namePlaceholder: 'z. B. STIHL MS 261 C-M',
    modelPlaceholder: 'z. B. MS 261 / Bj. 2025',
    fields: [
      {
        key: 'feilen_durchmesser',
        label: 'Feilen-Ø',
        placeholder: 'z. B. 4,8 mm',
        quickOptions: FILE_DIAMETER_CHIPS
      },
      {
        key: 'kettenteilung',
        label: 'Kettenteilung',
        placeholder: 'z. B. .325"',
        quickOptions: CHAIN_PITCH_CHIPS
      },
      {
        key: 'nutbreite',
        label: 'Treibgliedstärke / Nut',
        placeholder: 'z. B. 1,3 mm',
        quickOptions: GAUGE_CHIPS
      },
      {
        key: 'treibglieder',
        label: 'Treibglieder (TG)',
        placeholder: 'z. B. 67 TG'
      },
      {
        key: 'schwertlaenge',
        label: 'Schwertlänge',
        placeholder: 'z. B. 40 cm',
        quickOptions: BAR_LENGTH_CHIPS
      },
      {
        key: 'antrieb',
        label: 'Antrieb / Kraftstoff',
        placeholder: 'z. B. 2-Takt Sonderkraftstoff / Akku',
        quickOptions: ['2-Takt MotoMix', 'Akku AP', 'Akku AK']
      }
    ]
  },
  {
    id: 'freischneider',
    label: 'Freischneider & Motorsense',
    itemType: 'geraet',
    defaultMaintenancePlan: 'Winkelgetriebe fetten, Luftfilter prüfen, Schneidkopf kontrollieren',
    defaultIntervalMonths: 6,
    namePlaceholder: 'z. B. STIHL FS 261 C-E',
    modelPlaceholder: 'z. B. FS 261 / AutoCut 46-2',
    fields: [
      {
        key: 'faden_durchmesser',
        label: 'Mähfaden-Ø',
        placeholder: 'z. B. 2,7 mm',
        quickOptions: LINE_DIAMETER_CHIPS
      },
      {
        key: 'aufnahme_bohrung',
        label: 'Messer-Aufnahme Ø',
        placeholder: 'z. B. 25,4 mm',
        quickOptions: ['20,0 mm', '25,4 mm']
      },
      {
        key: 'schneidwerkzeug',
        label: 'Standard-Kopf / Messer',
        placeholder: 'z. B. AutoCut / Dickichtmesser 300 mm'
      },
      {
        key: 'antrieb',
        label: 'Antrieb',
        placeholder: 'z. B. 2-Takt MotoMix / Akku',
        quickOptions: ['2-Takt MotoMix', 'Akku AP']
      }
    ]
  },
  {
    id: 'rasenmaeher',
    label: 'Rasenmäher & Mulcher',
    itemType: 'geraet',
    defaultMaintenancePlan: 'Messer schärfen & wuchten, Ölstand / Luftfilter prüfen, Mähdeck reinigen',
    defaultIntervalMonths: 6,
    namePlaceholder: 'z. B. Sabo 54-Pro Vario',
    modelPlaceholder: 'z. B. 54-Pro / Honda GCV',
    fields: [
      {
        key: 'schnittbreite',
        label: 'Schnittbreite',
        placeholder: 'z. B. 54 cm',
        quickOptions: ['46 cm', '48 cm', '53 cm', '54 cm']
      },
      {
        key: 'messer_typ',
        label: 'Messerlänge / Artikelnr.',
        placeholder: 'z. B. 52 cm Highlift'
      },
      {
        key: 'motoroel_kerze',
        label: 'Motoröl / Zündkerze',
        placeholder: 'z. B. SAE 10W-30 / NGK BPR6ES'
      },
      {
        key: 'antrieb',
        label: 'Antrieb',
        placeholder: 'z. B. 4-Takt Benzin / Akku',
        quickOptions: ['4-Takt Benzin', 'Akku']
      }
    ]
  },
  {
    id: 'heckenschere',
    label: 'Heckenschere & Heckenschneider',
    itemType: 'geraet',
    defaultMaintenancePlan: 'Messerbalken reinigen, harzlösen, schärfen & Getriebe fetten',
    defaultIntervalMonths: 6,
    namePlaceholder: 'z. B. STIHL HLA 86 / HS 82 R',
    modelPlaceholder: 'z. B. HS 82 R / 60 cm',
    fields: [
      {
        key: 'schwertlaenge',
        label: 'Messerlänge',
        placeholder: 'z. B. 60 cm',
        quickOptions: ['50 cm', '60 cm', '75 cm']
      },
      {
        key: 'zahnabstand',
        label: 'Zahnabstand',
        placeholder: 'z. B. 38 mm'
      },
      {
        key: 'antrieb',
        label: 'Antrieb',
        placeholder: 'z. B. Akku AP / 2-Takt',
        quickOptions: ['Akku AP', '2-Takt MotoMix']
      }
    ]
  },
  {
    id: 'blaeser_sonstige',
    label: 'Blasgerät, Häcksler & Sonstiges',
    itemType: 'geraet',
    defaultMaintenancePlan: 'Sichtprüfung, Filter reinigen, Verschleißteile kontrollieren',
    defaultIntervalMonths: 6,
    namePlaceholder: 'z. B. STIHL BGA 200 / PKW-Anhänger',
    modelPlaceholder: 'z. B. Seriennr. / Typ',
    fields: [
      {
        key: 'hauptmass',
        label: 'Wichtiges Maß / Parameter',
        placeholder: 'z. B. Wendemesser 150 mm / Reifendruck 3,0 bar'
      },
      {
        key: 'verschleissteil',
        label: 'Filter / Riemen / Kerze',
        placeholder: 'z. B. HD2 Filter / CMR6H'
      },
      {
        key: 'antrieb',
        label: 'Antrieb / System',
        placeholder: 'z. B. Akku AP / Benzin'
      }
    ]
  },

  // ================= ZUBEHÖR =================
  {
    id: 'zub_kette_schiene',
    label: 'Sägekette & Führungsschiene',
    itemType: 'zubehoer',
    namePlaceholder: 'z. B. STIHL Rapid Super .325"',
    modelPlaceholder: 'z. B. Art.-Nr. 3690 000 0067',
    fields: [
      {
        key: 'feilen_durchmesser',
        label: 'Feilen-Ø',
        placeholder: 'z. B. 4,8 mm',
        quickOptions: FILE_DIAMETER_CHIPS
      },
      {
        key: 'kettenteilung',
        label: 'Kettenteilung',
        placeholder: 'z. B. .325"',
        quickOptions: CHAIN_PITCH_CHIPS
      },
      {
        key: 'nutbreite',
        label: 'Treibgliedstärke / Nut',
        placeholder: 'z. B. 1,3 mm',
        quickOptions: GAUGE_CHIPS
      },
      {
        key: 'treibglieder',
        label: 'Treibglieder (TG)',
        placeholder: 'z. B. 67 TG'
      },
      {
        key: 'schwertlaenge',
        label: 'Schnittlänge',
        placeholder: 'z. B. 40 cm',
        quickOptions: BAR_LENGTH_CHIPS
      },
      {
        key: 'zahnform',
        label: 'Zahnform',
        placeholder: 'z. B. Vollmeißel / Halbmeißel',
        quickOptions: ['Vollmeißel (RS)', 'Halbmeißel (RM)', 'Hartmetall (RD)']
      }
    ]
  },
  {
    id: 'zub_feilen_schaerfen',
    label: 'Feilen & Schärfzubehör',
    itemType: 'zubehoer',
    namePlaceholder: 'z. B. Rundfeile + Feilenhalter 2-in-1',
    modelPlaceholder: 'z. B. Pferd / STIHL 5605',
    fields: [
      {
        key: 'feilen_durchmesser',
        label: 'Feilen-Ø',
        placeholder: 'z. B. 4,8 mm',
        quickOptions: FILE_DIAMETER_CHIPS
      },
      {
        key: 'kettenteilung',
        label: 'Passend für Teilung',
        placeholder: 'z. B. .325"',
        quickOptions: CHAIN_PITCH_CHIPS
      },
      {
        key: 'schaerfwinkel',
        label: 'Schärfwinkel',
        placeholder: 'z. B. 30°',
        quickOptions: ['25°', '30°', '35°']
      },
      {
        key: 'tiefenbegrenzer',
        label: 'Tiefenbegrenzer-Abstand',
        placeholder: 'z. B. 0,65 mm',
        quickOptions: ['0,45 mm', '0,65 mm', '0,80 mm']
      }
    ]
  },
  {
    id: 'zub_faden_messer',
    label: 'Mähfaden, Köpfe & Messer',
    itemType: 'zubehoer',
    namePlaceholder: 'z. B. Mähfaden CF3 Pro / Dickichtmesser',
    modelPlaceholder: 'z. B. Art.-Nr. / Ausführung',
    fields: [
      {
        key: 'faden_durchmesser',
        label: 'Faden-Ø / Stärke',
        placeholder: 'z. B. 2,7 mm',
        quickOptions: LINE_DIAMETER_CHIPS
      },
      {
        key: 'aufnahme_bohrung',
        label: 'Aufnahme / Gewinde',
        placeholder: 'z. B. Ø 25,4 mm / M10x1,0 L',
        quickOptions: ['Ø 20,0 mm', 'Ø 25,4 mm', 'M10x1,0 Links', 'M12x1,5 Links']
      },
      {
        key: 'abmessung',
        label: 'Durchmesser / Länge',
        placeholder: 'z. B. 300 mm / 70 m Rolle'
      }
    ]
  },
  {
    id: 'zub_akku_ladung',
    label: 'Akku & Ladegerät',
    itemType: 'zubehoer',
    namePlaceholder: 'z. B. STIHL Akku AP 300 S',
    modelPlaceholder: 'z. B. AP-System / AL 500',
    fields: [
      {
        key: 'akkusystem',
        label: 'System',
        placeholder: 'z. B. STIHL AP',
        quickOptions: ['STIHL AP', 'STIHL AK', 'Husqvarna BLi']
      },
      {
        key: 'kapazitaet',
        label: 'Energie / Kapazität',
        placeholder: 'z. B. 281 Wh / 7,8 Ah'
      }
    ]
  },
  {
    id: 'zub_filter_psa_sonstiges',
    label: 'Verschleißteile, PSA & Sonstiges',
    itemType: 'zubehoer',
    namePlaceholder: 'z. B. Zündkerze / Fällkeil / Forsthelm',
    modelPlaceholder: 'z. B. Teilenummer / Größe',
    fields: [
      {
        key: 'spezifikation',
        label: 'Maß / Größe / Typ',
        placeholder: 'z. B. SW 19 / Hubhöhe 28 mm / Gr. L'
      },
      {
        key: 'teilenummer',
        label: 'Ersatzteil-Nr.',
        placeholder: 'z. B. NGK CMR6H / 1141 120 1604'
      }
    ]
  }
];

export function getCategoriesByType(itemType: 'geraet' | 'zubehoer'): EquipmentCategoryDef[] {
  return EQUIPMENT_CATEGORIES.filter((c) => c.itemType === itemType);
}

export function getCategoryDef(categoryId?: string): EquipmentCategoryDef | undefined {
  if (!categoryId) return undefined;
  return EQUIPMENT_CATEGORIES.find((c) => c.id === categoryId);
}

export function getCategoryLabel(categoryId?: string, itemType?: 'geraet' | 'zubehoer'): string {
  const found = getCategoryDef(categoryId);
  if (found) return found.label;
  return itemType === 'zubehoer' ? 'Allgemeines Zubehör' : 'Allgemeines Gerät';
}
