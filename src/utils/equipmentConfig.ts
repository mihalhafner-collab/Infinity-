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
  group: 'garten' | 'allgemein' | 'zubehoer';
  presetNames: string[];
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
  // ================= 1. SCHNITT & BAUMPFLEGE =================
  {
    id: 'motorsaegen',
    label: 'Motorsäge',
    itemType: 'geraet',
    group: 'garten',
    presetNames: [
      'Motorsäge (Benzin)',
      'Akku-Motorsäge (STIHL / Milwaukee M18)',
      'Baumpflegesäge (Top-Handle)',
      'Milwaukee M18 FUEL Hatchet (Ast- & Gehölzsäge)',
      'Hochentaster / Teleskopsäge',
      'Akku-Gehölzschneider',
      'Akku-Astschere (Felco / Milwaukee M12)',
      'Teleskop-Baumschere'
    ],
    defaultMaintenancePlan: 'Kette schärfen, Schwertnut & Luftfilter reinigen, Kettenbremse prüfen',
    defaultIntervalMonths: 3,
    namePlaceholder: 'z. B. STIHL MS 261 C-M / Milwaukee M18 FTHCHS30',
    modelPlaceholder: 'z. B. MS 261 / M18 FTHCHS30-0',
    fields: [
      {
        key: 'feilen_durchmesser',
        label: 'Feilen-Ø',
        placeholder: 'z. B. 4,0 mm / 4,8 mm',
        quickOptions: FILE_DIAMETER_CHIPS
      },
      {
        key: 'kettenteilung',
        label: 'Kettenteilung',
        placeholder: 'z. B. .325" / 3/8" P',
        quickOptions: CHAIN_PITCH_CHIPS
      },
      {
        key: 'nutbreite',
        label: 'Treibgliedstärke / Nut',
        placeholder: 'z. B. 1,1 mm / 1,3 mm',
        quickOptions: GAUGE_CHIPS
      },
      {
        key: 'treibglieder',
        label: 'Treibglieder (TG)',
        placeholder: 'z. B. 51 TG / 67 TG'
      },
      {
        key: 'schwertlaenge',
        label: 'Schwertlänge',
        placeholder: 'z. B. 30 cm / 40 cm',
        quickOptions: BAR_LENGTH_CHIPS
      },
      {
        key: 'antrieb',
        label: 'Antrieb / Kraftstoff',
        placeholder: 'z. B. 2-Takt MotoMix / Milwaukee M18',
        quickOptions: ['2-Takt MotoMix', 'STIHL Akku AP', 'STIHL Akku AK', 'Milwaukee M18', 'Husqvarna Akku']
      }
    ]
  },
  {
    id: 'heckenschere',
    label: 'Heckenschere',
    itemType: 'geraet',
    group: 'garten',
    presetNames: [
      'Akku-Heckenschere (STIHL / Milwaukee M18)',
      'Benzin-Heckenschere',
      'Teleskop-Heckenschneider / Stabheckenschere',
      'Gardena Akku-Gras- & Strauchschere (ComfortCut)',
      'Mechanische Profi-Heckenschere (Okatsune / ARS)'
    ],
    defaultMaintenancePlan: 'Messerbalken reinigen, entharzen, schärfen & Getriebe fetten',
    defaultIntervalMonths: 6,
    namePlaceholder: 'z. B. STIHL HLA 86 / HS 82 R / Milwaukee M18 FHET60',
    modelPlaceholder: 'z. B. HS 82 R / 60 cm',
    fields: [
      {
        key: 'schwertlaenge',
        label: 'Messerlänge',
        placeholder: 'z. B. 60 cm',
        quickOptions: ['45 cm', '50 cm', '60 cm', '75 cm']
      },
      {
        key: 'zahnabstand',
        label: 'Zahnabstand',
        placeholder: 'z. B. 33 mm / 38 mm'
      },
      {
        key: 'antrieb',
        label: 'Antrieb',
        placeholder: 'z. B. Akku AP / 2-Takt / Milwaukee M18',
        quickOptions: ['STIHL Akku AP', 'STIHL Akku AK', 'Milwaukee M18', '2-Takt MotoMix']
      }
    ]
  },
  {
    id: 'felco_silky_schnitt',
    label: 'Handsäge & Schere',
    itemType: 'geraet',
    group: 'garten',
    presetNames: [
      'Felco 2 (Baum-/Gartenschere)',
      'Felco 6 / Felco 8 (Gartenschere)',
      'Felco 7 / Felco 12 (Rollgriff-Schere)',
      'Felco 13 (Zweihand-/Gartenschere)',
      'Felco 211 / Felco 221 (Astschere)',
      'Felco 600 / Felco 611 (Klappsäge / Zugsäge)',
      'Felco 802 / 812 / 822 (Akku-Baumschere)',
      'Silky Gomboy (Klappsäge)',
      'Silky Pocketboy / F180 (Klappsäge)',
      'Silky Bigboy (Klappsäge groß)',
      'Silky Zubat (Astsäge mit Köcher)',
      'Silky Sugoi (Baumpflegesäge)',
      'Silky Tsurugi / Gomtaro (Astsäge)',
      'Silky Hayauchi / Hayate (Teleskop-Gestängesäge)',
      'Teleskop-Baumschere / Raupenschere'
    ],
    defaultMaintenancePlan: 'Klinge entharzen, mit Diamantstein (Felco 903) schärfen, Gelenk ölen & nachstellen, Sägeblatt prüfen',
    defaultIntervalMonths: 3,
    namePlaceholder: 'z. B. Felco 2 / Silky Zubat 330 / Silky Gomboy',
    modelPlaceholder: 'z. B. Blattlänge 330 mm / Zahnung 7,5 / Ersatzklinge 2/3',
    fields: [
      {
        key: 'blatt_klinge',
        label: 'Blattlänge / Klingen-Nr.',
        placeholder: 'z. B. 240 mm / 330 mm / Klinge 2/3',
        quickOptions: ['170 mm', '210 mm', '240 mm', '270 mm', '330 mm', '360 mm', 'Klinge 2/3']
      },
      {
        key: 'zahnung_schnitt',
        label: 'Zahnung / max. Schnitt-Ø',
        placeholder: 'z. B. Grobe Zahnung (7,5 Z/30mm) / Ø 25 mm',
        quickOptions: ['Fein (10)', 'Mittel (8)', 'Grob (7,5)', 'Extra Grob', 'Ø 25 mm', 'Ø 40 mm']
      },
      {
        key: 'antrieb',
        label: 'Ausführung',
        placeholder: 'z. B. Manuell / Teleskop / Akku',
        quickOptions: ['Manuell', 'Mit Köcher', 'Teleskop-Gestänge', 'Akku']
      }
    ]
  },

  // ================= 2. RASEN, WIESE & BODENPFLEGE =================
  {
    id: 'rasenmaeher',
    label: 'Rasenmäher',
    itemType: 'geraet',
    group: 'garten',
    presetNames: [
      'Benzin-Rasenmäher',
      'Akku-Rasenmäher (STIHL / Milwaukee M18)',
      'Mulchmäher',
      'Aufsitzmäher / Rasentraktor',
      'Hochgrasmäher / Wiesenmäher',
      'Balkenmäher',
      'Spindelmäher (Manuell / Akku)',
      'Mähroboter (Gardena Sileno / Husqvarna)'
    ],
    defaultMaintenancePlan: 'Messer schärfen & wuchten, Ölstand / Luftfilter prüfen, Mähdeck reinigen',
    defaultIntervalMonths: 6,
    namePlaceholder: 'z. B. Sabo 54-Pro Vario / Milwaukee M18 F2LM53',
    modelPlaceholder: 'z. B. 54-Pro / Schnittbreite 53 cm',
    fields: [
      {
        key: 'schnittbreite',
        label: 'Schnittbreite',
        placeholder: 'z. B. 54 cm',
        quickOptions: ['46 cm', '48 cm', '53 cm', '54 cm', '80 cm', '102 cm']
      },
      {
        key: 'messer_typ',
        label: 'Messerlänge / Artikel-Nr.',
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
        quickOptions: ['4-Takt Benzin', 'STIHL Akku AP', 'Milwaukee 2x M18', 'Manuell']
      }
    ]
  },
  {
    id: 'freischneider',
    label: 'Freischneider',
    itemType: 'geraet',
    group: 'garten',
    presetNames: [
      'Freischneider / Motorsense (Benzin)',
      'Akku-Freischneider (STIHL / Milwaukee M18)',
      'Rasentrimmer',
      'Wildkrautbürste / Fugenbürste',
      'Rasenkantenschneider',
      'Kreiselschnittkopf / Schere'
    ],
    defaultMaintenancePlan: 'Winkelgetriebe fetten, Luftfilter prüfen, Schneidkopf kontrollieren',
    defaultIntervalMonths: 6,
    namePlaceholder: 'z. B. STIHL FS 261 C-E / Milwaukee M18 BLLT',
    modelPlaceholder: 'z. B. FS 261 / AutoCut 46-2',
    fields: [
      {
        key: 'faden_durchmesser',
        label: 'Mähfaden-Ø',
        placeholder: 'z. B. 2,4 mm / 2,7 mm',
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
        quickOptions: ['2-Takt MotoMix', 'STIHL Akku AP', 'Milwaukee M18']
      }
    ]
  },
  {
    id: 'vertikutierer_boden',
    label: 'Vertikutierer',
    itemType: 'geraet',
    group: 'garten',
    presetNames: [
      'Vertikutierer (Benzin / Akku)',
      'Rasenlüfter / Moosentferner',
      'Gartenfräse / Motorhacke',
      'Umkehrfräse / Einachser',
      'Erdbohrer / Pflanzlochbohrer',
      'Aerifizierer / Rasenspecht',
      'Rasenwalze',
      'Streuwagen / Düngerstreuer (Gardena XL / Profi)'
    ],
    defaultMaintenancePlan: 'Messerwelle / Zinken prüfen, Lager schmieren, Antriebsriemen kontrollieren',
    defaultIntervalMonths: 6,
    namePlaceholder: 'z. B. Sabo 38-BV / Eliet',
    modelPlaceholder: 'z. B. Arbeitsbreite 38 cm',
    fields: [
      {
        key: 'arbeitsbreite',
        label: 'Arbeitsbreite / Ø',
        placeholder: 'z. B. 38 cm / Bohrer Ø 150 mm',
        quickOptions: ['35 cm', '38 cm', '45 cm', '50 cm', 'Ø 100 mm', 'Ø 150 mm', 'Ø 200 mm']
      },
      {
        key: 'werkzeug_welle',
        label: 'Messerwelle / Zinken',
        placeholder: 'z. B. 15 Doppelmesser / Federzinken'
      },
      {
        key: 'antrieb',
        label: 'Antrieb',
        placeholder: 'z. B. 4-Takt Benzin / Akku / Hand',
        quickOptions: ['4-Takt Benzin', '2-Takt MotoMix', 'Akku', 'Manuell']
      }
    ]
  },

  // ================= 3. LAUB, BEWÄSSERUNG & HANDGERÄTE =================
  {
    id: 'blaeser_sonstige',
    label: 'Laubbläser',
    itemType: 'geraet',
    group: 'garten',
    presetNames: [
      'Akku-Laubbläser (STIHL / Milwaukee M18)',
      'Rückentragbarer Laubbläser',
      'Laubsauger / Saugbläser',
      'Laubverlader',
      'Gartenhäcksler / Buschholzhäcksler',
      'Baumstumpffräse / Stubbenfräse'
    ],
    defaultMaintenancePlan: 'Sichtprüfung, Filter reinigen, Häckselmesser / Verschleißteile kontrollieren',
    defaultIntervalMonths: 6,
    namePlaceholder: 'z. B. STIHL BGA 200 / BR 800 / Milwaukee M18 FBL',
    modelPlaceholder: 'z. B. Serien-Nr. / Typ',
    fields: [
      {
        key: 'hauptmass',
        label: 'Wichtiges Maß / Parameter',
        placeholder: 'z. B. Wendemesser 150 mm / Ast-Ø max. 8 cm'
      },
      {
        key: 'verschleissteil',
        label: 'Filter / Riemen / Kerze',
        placeholder: 'z. B. HD2 Filter / CMR6H'
      },
      {
        key: 'antrieb',
        label: 'Antrieb / System',
        placeholder: 'z. B. Akku AP / Milwaukee M18 / 2-Takt',
        quickOptions: ['STIHL Akku AP', 'Milwaukee M18', '2-Takt MotoMix', '4-Takt Benzin', '230V / 400V']
      }
    ]
  },
  {
    id: 'bewaesserung_spritze',
    label: 'Bewässerung',
    itemType: 'geraet',
    group: 'garten',
    presetNames: [
      'Gardena Wand-Schlauchbox (RollUp)',
      'Gardena Schlauchwagen (CleverRoll / Metall)',
      'Gardena Viereckregner (AquaZoom)',
      'Gardena Kreis- / Impuls- / Turbinenregner',
      'Gardena Gießstab / Profi-Brausestab',
      'Gardena Reinigungsspritze / Multifunktionsbrause',
      'Gardena Bewässerungscomputer / Steuerung (Select / Bluetooth)',
      'Gardena Micro-Drip-System / Tropfbewässerung',
      'Gardena Regenfasspumpe / Tauchpumpe / Gartenpumpe',
      'Gardena Pipeline / Wassersteckdose & Versenkregner',
      'Profi-Wasserschlauch (1/2" / 3/4" / Tricoflex)',
      'GEKA Gießgerät / Profi-Gießkopf',
      'Drucksprüher / Rückenspritze (Birchmeier / Gardena / Milwaukee)',
      'Akku-Sprühgerät (Gardena / Birchmeier / STIHL)',
      'Motorpumpe / Schmutzwasserpumpe',
      'Wasserfass / Mobiler Bewässerungstank'
    ],
    defaultMaintenancePlan: 'Düsen, Sieb & Dichtringe prüfen, vor Frostbeginn vollständig entleeren & einlagern',
    defaultIntervalMonths: 6,
    namePlaceholder: 'z. B. Gardena RollUp XL 35m / AquaZoom / Birchmeier Iris 15',
    modelPlaceholder: 'z. B. 1/2" oder 3/4" / Gardena Profi-System / GEKA',
    fields: [
      {
        key: 'anschluss',
        label: 'System / Anschlussgröße',
        placeholder: 'z. B. Gardena Original / Profi-System / GEKA / 3/4"',
        quickOptions: [
          'Gardena Original (1/2")',
          'Gardena Profi-System (3/4")',
          'Gardena Micro-Drip',
          'GEKA Messing',
          '1/2 Zoll (13 mm)',
          '3/4 Zoll (19 mm)',
          '1 Zoll (25 mm)'
        ]
      },
      {
        key: 'volumen_leistung',
        label: 'Schlauchlänge / Fläche / Volumen',
        placeholder: 'z. B. 25 m / 50 m / 15 Liter / 350 m²',
        quickOptions: ['15 l', '20 m', '25 m', '35 m', '50 m']
      },
      {
        key: 'antrieb',
        label: 'Betriebsart',
        placeholder: 'z. B. Wasserdruck / Akku / 230V / Manuell',
        quickOptions: ['Wasserdruck', 'Manuell', 'Akku / 9V Batterie', '230V Netz']
      }
    ]
  },
  {
    id: 'handwerkzeuge_garten',
    label: 'Handgerät',
    itemType: 'geraet',
    group: 'garten',
    presetNames: [
      'Fächerbesen (Metall / Verstellbar)',
      'Fächerbesen (Kunststoff / XXL)',
      'Straßenbesen / Hofbesen (Elaston / Piassava)',
      'Reisigbesen / Bambusbesen',
      'Kokosbesen / Feiner Kehrbesen',
      'Krallenbesen / Stein- & Terrassenbesen',
      'Gardena Combisystem-Stiel (Holz / Alu / Teleskop)',
      'Gardena Aufsatz: Verstellbarer Fächerbesen',
      'Gardena Aufsatz: Straßenbesen / Hofbesen',
      'Gardena Aufsatz: Bogenrechen / Rasenrechen',
      'Gardena Aufsatz: Schneidrechen / Vertikutier-Boy',
      'Gardena Aufsatz: Bügelzughacke / Gartenhacke',
      'Gardena Aufsatz: Grubber / Kleingrubber',
      'Gardena Aufsatz: Fugenkratzer / Unkrautstecher',
      'Gardena Aufsatz: Obstpflücker / Dachrinnenreiniger',
      'Gardena Aufsatz: Stoßscharre / Schneeschieber',
      'Spaten / Rodespaten / Gärtner-Spaten',
      'Grabegabel / Spatengabel',
      'Aluschaufel / Sandschaufel / Holsteiner Schaufel',
      'Eisenrechen / Planierrechen / Alurechen',
      'Laubrechen / Holzrechen',
      'Unkrauthacke / Pendelhacke / Ziehhacke',
      'Spaltaxt / Forstbeil / Wiedehopfhacke',
      'Schubkarre / Muldenkipper / Laubkarre'
    ],
    defaultMaintenancePlan: 'Stielbefestigung / Combisystem-Schraube prüfen, Klingen reinigen & ölen, Borsten/Zinken kontrollieren',
    defaultIntervalMonths: 12,
    namePlaceholder: 'z. B. Gardena Combisystem Fächerbesen / Straßenbesen 40 cm',
    modelPlaceholder: 'z. B. Arbeitsbreite 50 cm / Alu-Stiel 150 cm',
    fields: [
      {
        key: 'ausfuehrung',
        label: 'Breite / System / Stiel',
        placeholder: 'z. B. 40 cm / Gardena Combisystem / Eschenstiel',
        quickOptions: [
          'Gardena Combisystem',
          'Holzstiel',
          'Alu-Stiel 130/150 cm',
          'Teleskopstiel',
          '30 cm',
          '40 cm',
          '50 cm',
          '60 cm'
        ]
      },
      {
        key: 'verschleissteil',
        label: 'Borsten / Material / Bereifung',
        placeholder: 'z. B. Federstahl / Elaston / Pannensicher 4.00-8',
        quickOptions: ['Federstahl', 'Kunststoff', 'Elaston / Naturborsten', 'Edelstahl', 'Alu gehärtet']
      }
    ]
  },

  // ================= 4. MULTITOOL, ELEKTRO, REINIGUNG & BAU =================
  {
    id: 'milwaukee_geraete',
    label: 'Multitool',
    itemType: 'geraet',
    group: 'allgemein',
    presetNames: [
      'Milwaukee M18 FUEL QUIK-LOK Basiseinheit (Multitool)',
      'Milwaukee QUIK-LOK Aufsatz: Freischneider / Motorsense',
      'Milwaukee QUIK-LOK Aufsatz: Heckenschere',
      'Milwaukee QUIK-LOK Aufsatz: Hochentaster / Kettensäge',
      'Milwaukee QUIK-LOK Aufsatz: Rasenkantenschneider',
      'Milwaukee QUIK-LOK Aufsatz: Bürstenwalze / Gummiwalze',
      'Milwaukee QUIK-LOK Aufsatz: Bodenfräse / Kultivator',
      'Milwaukee QUIK-LOK Verlängerung (91 cm)',
      'Milwaukee M18 FUEL Kettensäge (30 / 35 / 40 cm)',
      'Milwaukee M18 / M12 FUEL Hatchet (Ast- & Gehölzsäge)',
      'Milwaukee M18 FUEL Akku-Rasenmäher (2x 18V)',
      'Milwaukee M18 FUEL Akku-Heckenschere (45 / 60 cm)',
      'Milwaukee M18 FUEL Laubbläser / Doppel-Akku-Bläser',
      'Milwaukee M12 BLPRS Akku-Astschere',
      'Milwaukee M18 Switch Tank Rückensprühgerät',
      'Milwaukee PACKOUT Trolley / Werkzeugkoffer-System'
    ],
    defaultMaintenancePlan: 'Akkukontakte & Lüftungsschlitze reinigen, QUIK-LOK Kupplung / Getriebe fetten, Schneidgarnitur prüfen',
    defaultIntervalMonths: 6,
    namePlaceholder: 'z. B. Milwaukee M18 FOPH-0 QUIK-LOK / Aufsatz',
    modelPlaceholder: 'z. B. M18 FUEL / M12 FUEL / Art.-Nr.',
    fields: [
      {
        key: 'akkusystem',
        label: 'Milwaukee System / Akku',
        placeholder: 'z. B. M18 FUEL / FORGE 8.0 / 12.0 Ah',
        quickOptions: [
          'M18 FUEL (18V)',
          '2x M18 (36V)',
          'M12 FUEL (12V)',
          'M18 FORGE 8.0 / 12.0 Ah',
          'M18 HIGH OUTPUT 5.5 / 8.0 Ah',
          'QUIK-LOK Aufsatz',
          'PACKOUT System'
        ]
      },
      {
        key: 'aufnahme_mass',
        label: 'Maß / Aufnahme / Garnitur',
        placeholder: 'z. B. 30 cm Schwert / QUIK-LOK / Ø 125 mm',
        quickOptions: ['15 cm (Hatchet)', '30 cm', '35 cm', '40 cm', '60 cm', 'QUIK-LOK']
      }
    ]
  },
  {
    id: 'elektrowerkzeuge_allgemein',
    label: 'Elektrowerkzeug',
    itemType: 'geraet',
    group: 'allgemein',
    presetNames: [
      'Akku-Bohrschrauber (Milwaukee M18 FPD3)',
      'Akku-Schlagschrauber (Milwaukee M18 FMTIW)',
      'Bohrhammer / Stemmhammer (SDS-plus / SDS-max)',
      'Winkelschleifer / Flex (125 mm / 230 mm)',
      'Säbelsäge / Tigersäge (SAWZALL / HACKZALL)',
      'Stichsäge',
      'Handkreissäge / Kappsäge',
      'Multitool / Oszillierer',
      'Heißluftpistole',
      'Kompressor / Akku-Fettpresse',
      'Stromerzeuger / Notstromaggregat',
      'Baustrahler / LED-Arbeitsleuchte',
      'Kabeltrommel / Verlängerung'
    ],
    defaultMaintenancePlan: 'Sichtprüfung Kabel/Gehäuse, Lüftungsschlitze ausblasen, Werkzeugaufnahme reinigen',
    defaultIntervalMonths: 12,
    namePlaceholder: 'z. B. Milwaukee M18 FPD3 / Winkelschleifer 125 mm',
    modelPlaceholder: 'z. B. 18V / SDS-plus / Ø 125 mm',
    fields: [
      {
        key: 'aufnahme_mass',
        label: 'Aufnahme / Scheiben-Ø',
        placeholder: 'z. B. Ø 125 mm / SDS-plus / 13 mm Futter',
        quickOptions: ['Ø 125 mm', 'Ø 230 mm', 'SDS-plus', 'SDS-max', '1/2" Vierkant']
      },
      {
        key: 'akkusystem',
        label: 'Spannung / Akkusystem',
        placeholder: 'z. B. Milwaukee M18 / 18V / 230V',
        quickOptions: ['Milwaukee M18', 'Milwaukee M12', '18V Akku', '36V / 40V Akku', '230V Netz', 'Benzin']
      }
    ]
  },
  {
    id: 'reinigung_kehrmaschine',
    label: 'Reinigung',
    itemType: 'geraet',
    group: 'allgemein',
    presetNames: [
      'Hochdruckreiniger',
      'Flächenreiniger / Terrassenreiniger',
      'Kehrmaschine (Akku / Benzin)',
      'Handkehrmaschine',
      'Nass-/Trockensauger / Industriesauger (PACKOUT)',
      'Dachrinnenreiniger-Set',
      'Thermischer Unkrautbrenner / Heißwasser'
    ],
    defaultMaintenancePlan: 'Wasserfilter & Düsen prüfen, Bürstenwalzen reinigen, Frostschutz beachten',
    defaultIntervalMonths: 6,
    namePlaceholder: 'z. B. Kärcher HD 5/15 C / STIHL KGA 770',
    modelPlaceholder: 'z. B. 150 bar / Kehrbreite 77 cm',
    fields: [
      {
        key: 'hauptmass',
        label: 'Druck / Kehrbreite / Volumen',
        placeholder: 'z. B. 150 bar / 77 cm / 30 l Behälter'
      },
      {
        key: 'zubehoer_system',
        label: 'Anschluss / System',
        placeholder: 'z. B. EASY!Lock / M22x1,5 / NW 35'
      },
      {
        key: 'antrieb',
        label: 'Antrieb',
        placeholder: 'z. B. 230V / Akku / Benzin',
        quickOptions: ['230V', '400V', 'Akku', 'Benzin', 'Manuell']
      }
    ]
  },
  {
    id: 'bau_pflaster_geraete',
    label: 'Baugerät',
    itemType: 'geraet',
    group: 'allgemein',
    presetNames: [
      'Rüttelplatte / Vibrationsplatte',
      'Vibrationsstampfer / Frosch',
      'Steinsäge / Trennschleifer (Motorflex)',
      'Betonmischer / Rührwerk',
      'Plattenheber / Pflasterzange',
      'Gummihammer / Pflasterhammer',
      'Nivelliergerät / Kreuzlinienlaser'
    ],
    defaultMaintenancePlan: 'Motoröl, Luftfilter & Keilriemen prüfen, Gummimatte & Erregeröl kontrollieren',
    defaultIntervalMonths: 6,
    namePlaceholder: 'z. B. Wacker Neuson / STIHL TS 420',
    modelPlaceholder: 'z. B. 90 kg / Trennscheibe Ø 350 mm',
    fields: [
      {
        key: 'hauptmass',
        label: 'Gewicht / Scheiben-Ø / Maß',
        placeholder: 'z. B. 90 kg / Ø 350 mm / Bohrung 20 mm',
        quickOptions: ['Ø 300 mm', 'Ø 350 mm', 'Bohrung 20 mm', 'Bohrung 25,4 mm']
      },
      {
        key: 'antrieb',
        label: 'Antrieb',
        placeholder: 'z. B. 4-Takt Benzin / 2-Takt / Akku',
        quickOptions: ['4-Takt Benzin', '2-Takt MotoMix', 'Akku', '230V', 'Manuell']
      }
    ]
  },
  {
    id: 'leitern_allgemein',
    label: 'Leiter',
    itemType: 'geraet',
    group: 'allgemein',
    presetNames: [
      'Obstbaumleiter / Dreibeinleiter',
      'Mehrzweckleiter / Schiebeleiter',
      'Teleskopleiter / Stehleiter',
      'Heckenschnitt-Plattform / Arbeitsbühne',
      'Rollgerüst / Kleingerüst',
      'Werkzeugkoffer / Steckschlüsselsatz',
      'Wasserwaage / Richtscheit / Abziehlatte',
      'Maßband / Laser-Entfernungsmesser',
      'Sackkarre / Transporthilfe'
    ],
    defaultMaintenancePlan: 'Sprossen, Holme, Rutschsicherung & Gelenke auf festen Sitz prüfen (Leiternprüfung)',
    defaultIntervalMonths: 12,
    namePlaceholder: 'z. B. Hymer Dreibeinleiter / Zarges 3x9',
    modelPlaceholder: 'z. B. Arbeitshöhe 4,5 m / 12 Sprossen',
    fields: [
      {
        key: 'abmessung',
        label: 'Höhe / Sprossen / Länge',
        placeholder: 'z. B. 3x9 Sprossen / Standhöhe 3,20 m'
      },
      {
        key: 'spezifikation',
        label: 'Ausführung / Zubehör',
        placeholder: 'z. B. Erdspitzen + Gummifüße / Alu'
      }
    ]
  },
  {
    id: 'winterdienst_geraete',
    label: 'Winterdienst',
    itemType: 'geraet',
    group: 'allgemein',
    presetNames: [
      'Schneefräse',
      'Schneeschild / Räumschild',
      'Winter-Kehrmaschine',
      'Kastenstreuer / Salzstreuer',
      'Schneeschaufel / Schneewanne',
      'Eisscharre / Eisstößel'
    ],
    defaultMaintenancePlan: 'Schürfleiste, Abscherbolzen & Seilzüge prüfen, Korrosionsschutz nach Salzeinsatz',
    defaultIntervalMonths: 6,
    namePlaceholder: 'z. B. Honda HSS 655 / Cemo Streuwagen',
    modelPlaceholder: 'z. B. Räumbreite 55 cm / 50 l',
    fields: [
      {
        key: 'raeumbreite',
        label: 'Räumbreite / Volumen',
        placeholder: 'z. B. 55 cm / 100 cm / 50 l Streugut'
      },
      {
        key: 'verschleissteil',
        label: 'Schürfleiste / Abscherstifte',
        placeholder: 'z. B. Gummileiste / Abscherbolzen M6'
      },
      {
        key: 'antrieb',
        label: 'Antrieb',
        placeholder: 'z. B. 4-Takt Benzin / Akku / Manuell',
        quickOptions: ['4-Takt Benzin', 'Akku', 'Manuell']
      }
    ]
  },
  {
    id: 'fahrzeug_anhaenger',
    label: 'Anhänger',
    itemType: 'geraet',
    group: 'allgemein',
    presetNames: [
      'PKW-Anhänger / Kippanhänger',
      'Laubgitter-Aufsatz',
      'Transporter / Pritschenwagen',
      'Auffahrrampen (Paar)',
      'Kombi-Kanister / Betankungssystem',
      'Zurrgurte / Ladungssicherung & Netz'
    ],
    defaultMaintenancePlan: 'Reifendruck, Beleuchtung, Auflaufbremse & §57a Pickerl / HU prüfen',
    defaultIntervalMonths: 6,
    namePlaceholder: 'z. B. Humbaur Kipper / Pongratz Anhänger',
    modelPlaceholder: 'z. B. Kennzeichen / 2.000 kg HzGG',
    fields: [
      {
        key: 'hauptmass',
        label: 'Nutzlast / Kastenmaß / Reifendruck',
        placeholder: 'z. B. 1.500 kg / 250x150 cm / 3,5 bar'
      },
      {
        key: 'prueftermin',
        label: '§57a Pickerl / Service',
        placeholder: 'z. B. Lochung 05/2027'
      }
    ]
  },

  // ================= 5. ZUBEHÖR & VERSCHLEISSTEILE =================
  {
    id: 'zub_kette_schiene',
    label: 'Kette & Schwert',
    itemType: 'zubehoer',
    group: 'zubehoer',
    presetNames: [
      'Sägekette Vollmeißel',
      'Sägekette Halbmeißel',
      'Sägekette Hartmetall',
      'Führungsschiene / Schwert',
      'Kettenrad / Ringkettenrad',
      'Silky Ersatzsägeblatt (Gomboy / Zubat / Sugoi / Hayauchi)',
      'Felco Ersatzklinge & Gegenklinge (z. B. 2/3, 6/3, 8/3)',
      'Felco Ersatzfeder & Bolzenset (z. B. 2/11, 2/91)'
    ],
    namePlaceholder: 'z. B. Oregon 80TXL051E / STIHL Rapid Super / Silky Zubat Blatt',
    modelPlaceholder: 'z. B. Art.-Nr. 3690 000 0067 / Felco 2/3',
    fields: [
      {
        key: 'feilen_durchmesser',
        label: 'Feilen-Ø',
        placeholder: 'z. B. 4,0 mm / 4,8 mm',
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
        placeholder: 'z. B. 1,1 mm / 1,3 mm',
        quickOptions: GAUGE_CHIPS
      },
      {
        key: 'treibglieder',
        label: 'Treibglieder (TG)',
        placeholder: 'z. B. 51 TG / 67 TG'
      },
      {
        key: 'schwertlaenge',
        label: 'Schnitt-/Blattlänge',
        placeholder: 'z. B. 30 cm / 40 cm / 330 mm',
        quickOptions: [...BAR_LENGTH_CHIPS, '240 mm', '330 mm']
      },
      {
        key: 'zahnform',
        label: 'Zahnform / Klingentyp',
        placeholder: 'z. B. Vollmeißel / Halbmeißel / Silky Mirai-Me',
        quickOptions: ['Vollmeißel (RS)', 'Halbmeißel (RM)', 'Hartmetall (RD)', 'Felco Klinge', 'Silky Blatt']
      }
    ]
  },
  {
    id: 'zub_feilen_schaerfen',
    label: 'Feile & Schärfer',
    itemType: 'zubehoer',
    group: 'zubehoer',
    presetNames: [
      'Rundfeile für Sägekette',
      '2-in-1 Feilenhalter',
      'Flachfeile & Tiefenbegrenzerlehre',
      'Felco 902 / 903 Schärfstein (Diamant / Keramik)',
      'Felco 980 Harzlöser-Spray & Felco 990 Fett',
      'Felco 905 Einstellschlüssel',
      'Schärfgitter / Feilbock',
      'Harzlöser & Pflegespray'
    ],
    namePlaceholder: 'z. B. Felco 903 Diamant-Schärfer / STIHL 2-in-1 Feilenhalter',
    modelPlaceholder: 'z. B. Felco 903 / Pferd / STIHL 5605',
    fields: [
      {
        key: 'feilen_durchmesser',
        label: 'Feilen-Ø / Körnung',
        placeholder: 'z. B. 4,8 mm / Diamant beschichtet',
        quickOptions: [...FILE_DIAMETER_CHIPS, 'Diamant (Felco 903)']
      },
      {
        key: 'kettenteilung',
        label: 'Passend für Teilung / Schere',
        placeholder: 'z. B. .325" / Felco Baum-& Astscheren',
        quickOptions: [...CHAIN_PITCH_CHIPS, 'Felco / Gartenschere']
      },
      {
        key: 'schaerfwinkel',
        label: 'Schärfwinkel',
        placeholder: 'z. B. 30° / 23° (Felco)',
        quickOptions: ['23° (Felco)', '25°', '30°', '35°']
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
    label: 'Faden & Messer',
    itemType: 'zubehoer',
    group: 'zubehoer',
    presetNames: [
      'Mähfaden (Rolle / Zuschnitt)',
      'Fadenkopf / Mähkopf AutoCut',
      'Milwaukee EASY LOAD Fadenkopf / Mähfaden',
      'Dickichtmesser / 3-Flügelmesser',
      'Häckselmesser / Mulchmesser',
      'Kreissägeblatt / Meißelzahn',
      'Wildkrautbürsten-Einsatz',
      'Ersatzmesser Rasenmäher / Mähroboter-Klingen'
    ],
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
    id: 'zub_bewaesserung_gardena',
    label: 'Bewässerungszubehör',
    itemType: 'zubehoer',
    group: 'zubehoer',
    presetNames: [
      'Gardena Hahnverbinder / Schlauchstück / Wasserstopp (1/2" & 3/4")',
      'Gardena Profi-System Kupplung / Übergangsstück (3/4")',
      'Gardena 2-Wege- / 4-Wege-Verteiler',
      'Gardena Reparator / L-Stück / Y-Stück',
      'Gardena O-Ringe / Flachdichtungen (Ersatzset)',
      'Gardena Micro-Drip Tropfrohr / Verteilerrohr (13 mm / 4,6 mm)',
      'Gardena Micro-Drip Reihentropfer / Endtropfer / Sprühdüsen',
      'Gardena Combisystem Ersatz-Aufsatz (Besen / Rechen / Hacke)',
      'GEKA Messing-Schnellkupplung / Verschluss / Dichtring',
      'Magnetventil 24V / 9V & Ventilbox',
      'Versenkregner-Düse (Gardena / Hunter / RainBird)',
      'Saugschlauch / Saugfilter / Rückschlagventil'
    ],
    namePlaceholder: 'z. B. Gardena Profi-System Schlauchstück 3/4" / GEKA Kupplung',
    modelPlaceholder: 'z. B. Art.-Nr. / Zollgröße',
    fields: [
      {
        key: 'anschluss',
        label: 'System / Gewinde / Schlauch-Ø',
        placeholder: 'z. B. Gardena Original / Profi-System / GEKA / 3/4"',
        quickOptions: [
          'Gardena Original (1/2")',
          'Gardena Profi-System (3/4")',
          'Gardena Micro-Drip (13 / 4,6 mm)',
          'Gardena Combisystem',
          'GEKA Messing',
          'G 1/2"',
          'G 3/4"',
          'G 1"'
        ]
      },
      {
        key: 'spezifikation',
        label: 'Ausführung / Details',
        placeholder: 'z. B. Mit Wasserstopp / Messing / 10er-Pack Dichtungen'
      }
    ]
  },
  {
    id: 'zub_akku_ladung',
    label: 'Akku & Ladegerät',
    itemType: 'zubehoer',
    group: 'zubehoer',
    presetNames: [
      'Milwaukee M18 FORGE / HIGH OUTPUT Akku (5.5 / 8.0 / 12.0 Ah)',
      'Milwaukee M18 B5 Akku (5.0 Ah)',
      'Milwaukee M12 Akku (2.0 / 4.0 / 6.0 Ah)',
      'Milwaukee M12-18 FC Schnellladegerät / Mehrfachlader',
      'STIHL Akku AP-System (AP 200 / 300 S / 500 S)',
      'STIHL Akku AK-System',
      'STIHL Rückenakku AR',
      'Gardena / POWER FOR ALL 18V Akku & Ladegerät',
      'Felco 880 / 882 Powerpack Akku'
    ],
    namePlaceholder: 'z. B. Milwaukee M18 HB8 / STIHL Akku AP 300 S',
    modelPlaceholder: 'z. B. M18 HIGH OUTPUT / AP-System / AL 500',
    fields: [
      {
        key: 'akkusystem',
        label: 'System',
        placeholder: 'z. B. Milwaukee M18 / STIHL AP',
        quickOptions: [
          'Milwaukee M18',
          'Milwaukee M12',
          'STIHL AP',
          'STIHL AK',
          'Gardena 18V P4A',
          'Husqvarna BLi',
          'Makita 18V',
          'Bosch 18V'
        ]
      },
      {
        key: 'kapazitaet',
        label: 'Energie / Kapazität',
        placeholder: 'z. B. 8,0 Ah / 12,0 Ah / 281 Wh',
        quickOptions: ['4,0 Ah', '5,0 Ah', '5,5 Ah', '8,0 Ah', '12,0 Ah']
      }
    ]
  },
  {
    id: 'zub_bohrer_trennscheiben',
    label: 'Bohrer & Scheibe',
    itemType: 'zubehoer',
    group: 'zubehoer',
    presetNames: [
      'Milwaukee SAWZALL / AX Säbelsägeblätter (Holz / Wurzel / Metall)',
      'Diamant-Trennscheibe (Ø 125 / 230 / 350 mm)',
      'Metall-Trennscheibe / Schruppscheibe',
      'Milwaukee SHOCKWAVE Bit-Satz & Schlagnüsse',
      'Stein- & SDS-plus / SDS-max Bohrer-Satz',
      'Holz- & Metallbohrer-Satz',
      'Multitool-Tauchsägeblätter (Starlock)'
    ],
    namePlaceholder: 'z. B. Milwaukee AX Grünschnitt-Säbelsägeblatt / Diamantscheibe Ø 125',
    modelPlaceholder: 'z. B. 230 mm 5 ZpZ / Aufnahme 22,23 mm / SDS-plus',
    fields: [
      {
        key: 'abmessung',
        label: 'Durchmesser / Länge / Aufnahme',
        placeholder: 'z. B. Ø 125 x 22,23 mm / 230 mm Säbelsägeblatt',
        quickOptions: ['Ø 125 mm', 'Ø 230 mm', 'Ø 350 mm', 'SDS-plus', '1/2" Vierkant', 'S-Schaft']
      },
      {
        key: 'einsatzzweck',
        label: 'Material / Einsatzzweck',
        placeholder: 'z. B. Grünschnitt & Wurzelholz / Beton / Metall'
      }
    ]
  },
  {
    id: 'zub_filter_psa_sonstiges',
    label: 'Betriebsstoff & PSA',
    itemType: 'zubehoer',
    group: 'zubehoer',
    presetNames: [
      'Sonderkraftstoff 2-Takt (MotoMix / Aspen)',
      'Sonderkraftstoff 4-Takt',
      'Sägekettenhaftöl',
      'Luftfilter / HD2-Filter',
      'Zündkerze',
      'Getriebefett / Mehrzweckfett',
      'Forsthelm / Gesichtsschutz & Gehörschutz',
      'Schnittschutzhose / Schnittschutzstiefel',
      'Arbeitshandschuhe (Felco / Milwaukee Cut / Keiler)',
      'Fällkeil (Alu / Kunststoff)'
    ],
    namePlaceholder: 'z. B. Zündkerze / Fällkeil / Forsthelm',
    modelPlaceholder: 'z. B. Teilenummer / Größe',
    fields: [
      {
        key: 'spezifikation',
        label: 'Maß / Größe / Typ',
        placeholder: 'z. B. SW 19 / 5 Liter / Gr. L'
      },
      {
        key: 'teilenummer',
        label: 'Ersatzteil-Nr.',
        placeholder: 'z. B. NGK CMR6H / 1141 120 1604'
      }
    ]
  }
];

export interface FunctionalGroupInfo {
  id: string;
  title: string;
  order: number;
}

export const FUNCTIONAL_GROUPS: FunctionalGroupInfo[] = [
  { id: 'schnitt', title: 'Schnitt & Baumpflege', order: 1 },
  { id: 'rasen_boden', title: 'Rasen, Wiese & Boden', order: 4 },
  { id: 'laub_wasser_hand', title: 'Laub, Bewässerung & Handgeräte', order: 7 },
  { id: 'milwaukee_elektro_bau', title: 'Multitool, Elektro & Bau', order: 10 },
  { id: 'zubehoer', title: 'Zubehör & Verschleißteile', order: 20 }
];

const FUNCTIONAL_GROUP_MAP: Record<string, FunctionalGroupInfo> = {
  // 1. Schnitt & Baumpflege
  motorsaegen: { id: 'schnitt', title: 'Schnitt & Baumpflege', order: 1 },
  heckenschere: { id: 'schnitt', title: 'Schnitt & Baumpflege', order: 2 },
  felco_silky_schnitt: { id: 'schnitt', title: 'Schnitt & Baumpflege', order: 3 },
  // 2. Rasen, Wiese & Boden
  rasenmaeher: { id: 'rasen_boden', title: 'Rasen, Wiese & Boden', order: 4 },
  freischneider: { id: 'rasen_boden', title: 'Rasen, Wiese & Boden', order: 5 },
  vertikutierer_boden: { id: 'rasen_boden', title: 'Rasen, Wiese & Boden', order: 6 },
  // 3. Laub, Bewässerung & Handgeräte
  blaeser_sonstige: { id: 'laub_wasser_hand', title: 'Laub, Bewässerung & Handgeräte', order: 7 },
  bewaesserung_spritze: { id: 'laub_wasser_hand', title: 'Laub, Bewässerung & Handgeräte', order: 8 },
  handwerkzeuge_garten: { id: 'laub_wasser_hand', title: 'Laub, Bewässerung & Handgeräte', order: 9 },
  // 4. Multitool, Elektro, Reinigung & Bau
  milwaukee_geraete: { id: 'milwaukee_elektro_bau', title: 'Multitool, Elektro & Bau', order: 10 },
  elektrowerkzeuge_allgemein: { id: 'milwaukee_elektro_bau', title: 'Multitool, Elektro & Bau', order: 11 },
  reinigung_kehrmaschine: { id: 'milwaukee_elektro_bau', title: 'Multitool, Elektro & Bau', order: 12 },
  bau_pflaster_geraete: { id: 'milwaukee_elektro_bau', title: 'Multitool, Elektro & Bau', order: 13 },
  leitern_allgemein: { id: 'milwaukee_elektro_bau', title: 'Multitool, Elektro & Bau', order: 14 },
  winterdienst_geraete: { id: 'milwaukee_elektro_bau', title: 'Multitool, Elektro & Bau', order: 15 },
  fahrzeug_anhaenger: { id: 'milwaukee_elektro_bau', title: 'Multitool, Elektro & Bau', order: 16 },
  // 5. Zubehör & Verschleißteile
  zub_kette_schiene: { id: 'zubehoer', title: 'Zubehör & Verschleißteile', order: 20 },
  zub_feilen_schaerfen: { id: 'zubehoer', title: 'Zubehör & Verschleißteile', order: 21 },
  zub_faden_messer: { id: 'zubehoer', title: 'Zubehör & Verschleißteile', order: 22 },
  zub_bewaesserung_gardena: { id: 'zubehoer', title: 'Zubehör & Verschleißteile', order: 23 },
  zub_akku_ladung: { id: 'zubehoer', title: 'Zubehör & Verschleißteile', order: 24 },
  zub_bohrer_trennscheiben: { id: 'zubehoer', title: 'Zubehör & Verschleißteile', order: 25 },
  zub_filter_psa_sonstiges: { id: 'zubehoer', title: 'Zubehör & Verschleißteile', order: 26 }
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
  if (categoryId && categoryId.trim()) return categoryId.trim();
  return itemType === 'zubehoer' ? 'Allgemeines Zubehör' : 'Allgemeines Gerät';
}

export function getFunctionalGroupInfo(
  categoryId?: string,
  itemType?: 'geraet' | 'zubehoer'
): FunctionalGroupInfo {
  if (categoryId && FUNCTIONAL_GROUP_MAP[categoryId]) {
    return FUNCTIONAL_GROUP_MAP[categoryId];
  }
  if (itemType === 'zubehoer') {
    return { id: 'zubehoer', title: 'Zubehör & Verschleißteile', order: 29 };
  }
  return { id: 'milwaukee_elektro_bau', title: 'Multitool, Elektro & Bau', order: 19 };
}

export function getSpecFieldLabel(key: string, categoryId?: string): string {
  const catDef = getCategoryDef(categoryId);
  const fromCat = catDef?.fields.find((f) => f.key === key)?.label;
  if (fromCat) return fromCat;

  const trimmed = key.trim();
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



