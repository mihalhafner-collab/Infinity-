import { jsPDF } from 'jspdf';
import type {
  Customer,
  CustomerProperty,
  Invoice,
  InvoiceLineItem,
  WorkRecord
} from '../types/index.ts';

export const HAFNER_LOGO_URL = '/assets/aistudio/Hafner_Rechnungslogo_Original_236f7b3b.png';

export const ISSUER_COMPANY = 'Hafner Michael – Grünraum Handwerk';
export const ISSUER_NAME = 'Hafner Michael';
export const ISSUER_CONTACT_PERSON = 'Michael Hafner';
export const ISSUER_RETURN_LINE =
  'Hafner Michael - Goethestrasse 2 - 9560 Feldkirchen in Kärnten';
export const ISSUER_STREET = 'Goethestrasse 2';
export const ISSUER_CITY = '9560 Feldkirchen in Kärnten';
export const ISSUER_COUNTRY = 'Österreich';
export const ISSUER_PHONE = '06802376503';
export const ISSUER_EMAIL = 'hafnerm@gmx.at';
export const ISSUER_COURT = 'Amtsgericht Feldkirchen';
export const ISSUER_TAX_NR = '59 0640553';
export const ISSUER_BANK_NAME = 'Bank N26';
export const ISSUER_IBAN = 'DE41100110012348393811';
export const ISSUER_BIC = 'NTSBDEB1XXX';

export const TAX_EXEMPTION_CLAUSE =
  'Der Rechnungsbetrag enthält gem. §6 Abs. 1 Z 27 UStG 1994 keine Umsatzsteuer';
export const PAYMENT_TERMS_CLAUSE =
  'Zahlungsbedingungen: Zahlung innerhalb von 14 Tagen ab Rechnungseingang ohne Abzüge.';

let cachedLogoDataUrl: string | null = null;
let logoLoadPromise: Promise<string | null> | null = null;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Logo konnte nicht gelesen werden'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function ensureHafnerLogoLoaded(): Promise<string | null> {
  if (cachedLogoDataUrl) {
    return Promise.resolve(cachedLogoDataUrl);
  }
  if (!logoLoadPromise && typeof window !== 'undefined') {
    logoLoadPromise = fetch(HAFNER_LOGO_URL)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => (blob ? blobToDataUrl(blob) : null))
      .then((dataUrl) => {
        cachedLogoDataUrl = dataUrl;
        return dataUrl;
      })
      .catch(() => null);
  }
  return logoLoadPromise || Promise.resolve(null);
}

// Sofort beim App-Start im Hintergrund vorladen
if (typeof window !== 'undefined') {
  void ensureHafnerLogoLoaded();
}

export const DEFAULT_INVOICE_INTRO_BODY =
  'vielen Dank für Ihren Auftrag und das damit verbundene Vertrauen!\nHiermit stelle ich Ihnen die folgenden Leistungen in Rechnung:';

export const DEFAULT_PAUSCHAL_INTRO_BODY =
  'vielen Dank für Ihren Auftrag und das damit verbundene Vertrauen!\nVereinbarungsgemäß stelle ich Ihnen für die durchgeführten Arbeiten folgende Pauschale in Rechnung:';

export const DEFAULT_INVOICE_INTRO_TEXT = `Sehr geehrte Damen und Herren,\n${DEFAULT_INVOICE_INTRO_BODY}`;

export const DEFAULT_PAUSCHAL_INTRO_TEXT = `Sehr geehrte Damen und Herren,\n${DEFAULT_PAUSCHAL_INTRO_BODY}`;

const FEMALE_FIRST_NAMES = new Set([
  'adelheid', 'agnes', 'alexandra', 'alice', 'alma', 'amalia', 'amelie', 'andrea', 'anett', 'anette',
  'angela', 'angelika', 'anita', 'anja', 'anna', 'annalena', 'anne', 'anneliese', 'annemarie', 'anni',
  'annika', 'antonia', 'astrid', 'barbara', 'beate', 'beatrix', 'bernadette', 'bettina', 'bianca',
  'birgit', 'brigitte', 'britta', 'carina', 'carmen', 'carola', 'carolin', 'caroline', 'charlotte',
  'christa', 'christiana', 'christiane', 'christina', 'christine', 'clara', 'claudia', 'constanze',
  'cordula', 'corinna', 'cornelia', 'dagmar', 'daniela', 'deborah', 'denise', 'diana', 'dora', 'doris',
  'dorothea', 'edith', 'eleonore', 'elfriede', 'elisa', 'elisabeth', 'elke', 'ella', 'ellen', 'elsa',
  'else', 'elvira', 'emilia', 'emilie', 'emma', 'erika', 'erna', 'esther', 'eva', 'eveline', 'evelyn',
  'felicitas', 'franziska', 'frieda', 'friederike', 'gabi', 'gabriele', 'gerda', 'gerlinde', 'isabella',
  'gertraud', 'gertrud', 'gertrude', 'gisela', 'grete', 'gudrun', 'hanna', 'hannah', 'hannelore',
  'hedwig', 'heide', 'heidemarie', 'heidi', 'heike', 'helena', 'helene', 'helga', 'henriette', 'herma',
  'hermine', 'herta', 'hertha', 'hilde', 'hildegard', 'ilona', 'ilse', 'ines', 'inge', 'ingeborg',
  'ingrid', 'irene', 'iris', 'irma', 'irmgard', 'isabel', 'ivonne', 'jacqueline', 'jana', 'janine',
  'jasmin', 'jennifer', 'jessica', 'johanna', 'josefa', 'josefine', 'judith', 'julia', 'juliane',
  'jutta', 'karin', 'karla', 'karoline', 'arina', 'katharina', 'kathi', 'kathrin', 'katja', 'katrin',
  'kerstin', 'klara', 'klaudia', 'kornelia', 'kristina', 'lara', 'larissa', 'laura', 'lea', 'lena',
  'leonie', 'liane', 'lidia', 'lieselotte', 'lili', 'lilli', 'lina', 'linda', 'lisa', 'lotte', 'lucia',
  'luise', 'luzia', 'lydia', 'magdalena', 'maja', 'manuela', 'margareta', 'margarete', 'margarethe',
  'margit', 'margret', 'margrit', 'maria', 'marianna', 'marianne', 'marie', 'marina', 'marion',
  'marlies', 'marlene', 'martha', 'martina', 'mathilde', 'melanie', 'melissa', 'michaela', 'michelle',
  'miriam', 'monika', 'nadine', 'nadja', 'natalie', 'natascha', 'nicole', 'nina', 'nora', 'olga',
  'olivia', 'patricia', 'patrizia', 'paula', 'pauline', 'petra', 'pia', 'ramona', 'rebekka', 'regina',
  'renate', 'rita', 'romana', 'rosa', 'rosalia', 'rosalie', 'rosemarie', 'rosina', 'rosmarie',
  'roswitha', 'ruth', 'sabina', 'sabine', 'sabrina', 'sandra', 'sara', 'sarah', 'selina', 'sibylle',
  'sieglinde', 'sigrid', 'silke', 'silvia', 'simone', 'sofia', 'sofie', 'sonja', 'sophia', 'sophie',
  'stefanie', 'stella', 'stephanie', 'susanna', 'susanne', 'susi', 'svenja', 'sylvia', 'tamara',
  'tanja', 'tatjana', 'teresa', 'theresa', 'therese', 'theresia', 'traude', 'traudl', 'ulrike',
  'ursula', 'ute', 'valentina', 'vanessa', 'vera', 'verena', 'veronika', 'victoria', 'viktoria',
  'viola', 'walburga', 'walpurga', 'waltraud', 'waltraut', 'yvonne'
]);

const MALE_FIRST_NAMES = new Set([
  'achim', 'adalbert', 'adam', 'adolf', 'adrian', 'albert', 'alexander', 'alfons', 'alfred', 'alois',
  'andreas', 'anton', 'armin', 'arnold', 'arthur', 'august', 'axel', 'bastian', 'benedikt', 'benjamin',
  'bernd', 'bernhard', 'berthold', 'björn', 'bruno', 'burkhard', 'carl', 'carsten', 'christian',
  'christoph', 'christopher', 'claus', 'clemens', 'daniel', 'david', 'dennis', 'detlef', 'dieter',
  'dietmar', 'dietrich', 'dirk', 'dominik', 'ebehard', 'eberhard', 'eckhard', 'edgar', 'eduard',
  'edwin', 'egon', 'ekkehard', 'elmar', 'emanuel', 'emil', 'engelbert', 'erich', 'ernst', 'erwin',
  'eugen', 'ewald', 'fabian', 'felix', 'ferdinand', 'florian', 'frank', 'franz', 'friedhelm',
  'friedrich', 'fritz', 'georg', 'gerald', 'gerd', 'gerhard', 'gernot', 'gerold', 'gottfried',
  'gotthard', 'gottlieb', 'gregor', 'guido', 'gunter', 'gunther', 'günter', 'günther', 'gustav',
  'hannes', 'hans', 'hansjörg', 'harald', 'hartmut', 'hartwig', 'heinrich', 'heinz', 'helmut',
  'helmuth', 'hendrik', 'henning', 'herbert', 'heribert', 'hermann', 'herwig', 'holger', 'horst',
  'hubert', 'hubertus', 'hugo', 'ignaz', 'ingo', 'ingemar', 'jakob', 'jan', 'jens', 'joachim',
  'jochen', 'johann', 'johannes', 'jonas', 'jonathan', 'jörg', 'josef', 'joseph', 'julian', 'julius',
  'jürgen', 'kai', 'karl', 'karlheinz', 'karsten', 'kaspar', 'kevin', 'kilian', 'klaus', 'klemens',
  'konrad', 'konstantin', 'kurt', 'lars', 'leo', 'leon', 'leonhard', 'leopold', 'lorenz', 'lothar',
  'ludwig', 'lukas', 'lutz', 'manfred', 'manuel', 'marc', 'marcel', 'marco', 'marcus', 'mario',
  'marius', 'mark', 'marko', 'markus', 'martin', 'mathias', 'matthias', 'max', 'maximilian', 'meinhard',
  'michael', 'mihael', 'mihal', 'moritz', 'nikolaus', 'niko', 'norbert', 'olaf', 'oliver', 'oskar',
  'oswald', 'otmar', 'othmar', 'otto', 'pascal', 'patrick', 'paul', 'peter', 'philipp', 'phillip',
  'raimund', 'rainer', 'ralf', 'ralph', 'reimund', 'reinhard', 'reinhold', 'rené', 'rene', 'richard',
  'robert', 'roland', 'rolf', 'roman', 'ronald', 'rüdiger', 'rudolf', 'rupert', 'sascha', 'sebastian',
  'sepp', 'siegfried', 'sieghard', 'sigmund', 'simon', 'stefan', 'stephan', 'steffen', 'sven', 'theo',
  'theodor', 'thomas', 'thorsten', 'tilo', 'tim', 'timo', 'tobias', 'tom', 'torsten', 'udo', 'ulrich',
  'uwe', 'valentin', 'viktor', 'vinzenz', 'volker', 'walter', 'walther', 'werner', 'wilfried',
  'wilhelm', 'willi', 'willy', 'winfried', 'wolfgang', 'wolfram'
]);

// Rechtsformen (AT / DE) – dürfen niemals als Nachname oder Familie interpretiert werden
const LEGAL_FORM_REGEX =
  /\b(gesbr|ges\.?\s*b\.?\s*r\.?|gbr|gmbh|gesmbh|ges\.?\s*m\.?\s*b\.?\s*h\.?|kg|og|ag|e\.?\s*u\.?|keg|ohg|se|weg|arge|co\.?|&\s*co|&\s*partner|ges\.?\s*n\.?\s*b\.?\s*r\.?|genmbh|reg\.?\s*gen\.?|inc\.?|ltd\.?)\b/i;

// Firmen-, Praxis-, Kanzlei- & Institutionsbegriffe inkl. deutscher Komposita (z.B. Zahnarztpraxis, Gemeinschaftspraxis, Hausverwaltung)
const COMPANY_COMPOUND_REGEX =
  /(?:[a-zäöüß]*)(praxis|praxisgemeinschaft|ordination|ordinationsgemeinschaft|ambulatorium|ambulanz|klinik|klinikum|krankenhaus|sanatorium|apotheke|kanzlei|notariat|steuerberatung|wirtschaftstreuhand|hausverwaltung|gebäudeverwaltung|liegenschaftsverwaltung|gutsverwaltung|immobilienverwaltung|verwaltung|hausbetreuung|objektbetreuung|gartenbau|landschaftsbau|forstbetrieb|holzbau|metallbau|wohnbau|hochbau|tiefbau|erdbau|baufirma|bauunternehmen|werkstatt|werkstätte|autohaus|lagerhaus|gärtnerei|baumschule|tischlerei|zimmerei|schlosserei|spenglerei|malerei|bäckerei|fleischerei|metzgerei|reinigung|gebäudereinigung|spedition|agentur|studio|institut|zentrum|center|holding|stiftung|genossenschaft|verband|verein|gemeinde|stadtgemeinde|marktgemeinde|ortsgemeinde|pfarre|kirche|schule|kindergarten|pflegeheim|seniorenheim|gasthof|gasthaus|wirtshaus|restaurant|hotel|pension)\b/i;

const COMPANY_STANDALONE_REGEX =
  /\b(firma|betrieb|unternehmen|gesellschaft|service|technik|elektro|sanitär|handel|immobilien|immo|wohnungseigentum|wohnanlage|wohnhausanlage|bau|forst|kfz|bank|sparkasse|raiffeisen|volksbank|versicherung|caritas|diakonie|hilfswerk|rotes\s+kreuz|lebenshilfe|stadt|land|bund|kammer|innung|team|group)\b/i;

// Berufs-, Rollen- & Fachbezeichnungen, die keine Nachnamen sind (z.B. "Mag. Dr. Matthias Gabriel – Zahnarzt")
const PROFESSION_DESCRIPTOR_REGEX =
  /^(zahnarzt|zahnärztin|zahnärzte|zahnarztpraxis|zahnmedizin|arzt|ärztin|ärzte|arztpraxis|facharzt|fachärztin|hausarzt|hausärztin|tierarzt|tierärztin|wahlarzt|wahlärztin|kassenarzt|primar|primarius|oberarzt|oberärztin|ordination|praxis|gemeinschaftspraxis|gruppenpraxis|praxisgemeinschaft|kieferorthopäde|kieferorthopädin|kieferorthopädie|oralchirurgie|physiotherapeut|physiotherapeutin|physiotherapie|psychotherapeut|psychotherapeutin|psychotherapie|therapie|apotheker|apothekerin|rechtsanwalt|rechtsanwältin|rechtsanwälte|anwalt|anwältin|notar|notarin|steuerberater|steuerberaterin|wirtschaftsprüfer|architekt|architektin|baumeister|baumeisterin|ziviltechniker|sachverständiger|gutachter|inhaber|inhaberin|inh|geschäftsführer|geschäftsführerin|gf|partner|kollegen)$/i;

const ACADEMIC_TITLE_MAP: Record<string, string> = {
  'dr': 'Dr.',
  'ddr': 'DDr.',
  'mag': 'Mag.',
  'mmag': 'MMag.',
  'di': 'DI',
  'dipl-ing': 'Dipl.-Ing.',
  'dipl.ing': 'Dipl.-Ing.',
  'ing': 'Ing.',
  'prof': 'Prof.',
  'univ-prof': 'Univ.-Prof.',
  'med': 'med.',
  'univ': 'univ.',
  'dent': 'dent.',
  'dkfm': 'Dkfm.',
  'kommr': 'KommR',
  'ökr': 'ÖkR',
  'bgm': 'Bgm.'
};

const IGNORED_DEGREE_TOKENS = new Set([
  'ba', 'ma', 'bsc', 'msc', 'mba', 'llm', 'll.m', 'fh', '(fh)', 'bed', 'phd', 'jun', 'sen', 'jr', 'sr'
]);

export interface SalutationContext {
  company?: string | null;
  notes?: string | null;
  email?: string | null;
}

export interface DetectedSalutation {
  type: 'female' | 'male' | 'family' | 'company' | 'unknown';
  title: string;
  firstName: string;
  lastName: string;
  salutationLine: string;
  frauLine: string;
  herrLine: string;
  familyLine: string;
  duLine: string;
  companyLine: string;
}

function checkFirstNameGender(rawToken: string): 'female' | 'male' | null {
  const cleaned = rawToken
    .toLowerCase()
    .replace(/[^a-zäöüß-]/g, '')
    .trim();
  if (!cleaned || cleaned.length < 2) return null;
  if (FEMALE_FIRST_NAMES.has(cleaned)) return 'female';
  if (MALE_FIRST_NAMES.has(cleaned)) return 'male';
  if (cleaned.includes('-')) {
    const firstPart = cleaned.split('-')[0];
    if (FEMALE_FIRST_NAMES.has(firstPart)) return 'female';
    if (MALE_FIRST_NAMES.has(firstPart)) return 'male';
  }
  return null;
}

function isNonSurnameToken(rawToken: string): boolean {
  const cleaned = rawToken.replace(/^[,.\-–—|/()]+|[,.\-–—|/()]+$/g, '').trim();
  if (!cleaned) return true;
  if (LEGAL_FORM_REGEX.test(cleaned)) return true;
  if (COMPANY_COMPOUND_REGEX.test(cleaned)) return true;
  if (COMPANY_STANDALONE_REGEX.test(cleaned)) return true;
  if (PROFESSION_DESCRIPTOR_REGEX.test(cleaned)) return true;
  return false;
}

export function detectRecipientSalutation(
  recipientName: string,
  context?: SalutationContext | null
): DetectedSalutation {
  const raw = (recipientName || '').trim();
  const companyField = (context?.company || '').trim();
  const notesField = (context?.notes || '').trim();
  const isPrivateCategory = /^(privatkunde|privat)$/i.test(companyField);
  const combinedContextText = [raw, !isPrivateCategory ? companyField : '']
    .filter(Boolean)
    .join(' ');

  const defaultResult: DetectedSalutation = {
    type: 'unknown',
    title: '',
    firstName: '',
    lastName: raw || 'Kunde',
    salutationLine: 'Sehr geehrte Damen und Herren,',
    frauLine: 'Sehr geehrte Frau,',
    herrLine: 'Sehr geehrter Herr,',
    familyLine: 'Sehr geehrte Familie,',
    duLine: 'Guten Tag,',
    companyLine: 'Sehr geehrte Damen und Herren,'
  };

  if (!raw) return defaultResult;

  // Entferne Klammerzusätze wie "(Hauptkunde)" oder "(Objekt ...)"
  const withoutParens = raw.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

  // Prüfe auf Rechtsformen (GesbR, GmbH, OG, KG, e.U., WEG etc.) und Institutionen/Praxen
  const hasLegalForm = LEGAL_FORM_REGEX.test(combinedContextText);
  const hasCompanyOrPracticeKeyword =
    COMPANY_COMPOUND_REGEX.test(combinedContextText) ||
    COMPANY_STANDALONE_REGEX.test(combinedContextText);

  // 1. Explizite Präfixe prüfen: "Familie ...", "Ehepaar ..." (nur wenn keine Rechtsform/Firma wie GesbR vorliegt!)
  const famMatch = withoutParens.match(/^(?:familie|fam\.?|ehepaar)\s+(.+)$/i);
  if (famMatch && !hasLegalForm && !hasCompanyOrPracticeKeyword) {
    const famRest = famMatch[1].trim();
    const parts = famRest
      .split(/\s+/)
      .map((p) => p.replace(/,/g, ''))
      .filter((p) => p && !isNonSurnameToken(p));
    const lastName = parts[parts.length - 1] || famRest;
    return {
      type: 'family',
      title: '',
      firstName: '',
      lastName,
      salutationLine: `Sehr geehrte Familie ${lastName},`,
      frauLine: `Sehr geehrte Frau ${lastName},`,
      herrLine: `Sehr geehrter Herr ${lastName},`,
      familyLine: `Sehr geehrte Familie ${lastName},`,
      duLine: `Liebe Familie ${lastName},`,
      companyLine: 'Sehr geehrte Damen und Herren,'
    };
  }

  // 2. Explizite Anrede "Frau ..." oder "Herr ..." am Anfang
  const frauMatch = withoutParens.match(/^(?:frau|fr\.?)\s+(.+)$/i);
  if (frauMatch && !hasLegalForm) {
    const rest = frauMatch[1].trim();
    const parts = rest
      .split(/\s+/)
      .map((p) => p.replace(/,/g, ''))
      .filter((p) => p && !isNonSurnameToken(p));
    const lastName = parts[parts.length - 1] || rest;
    const firstName = parts.length > 1 ? parts[0] : '';
    return {
      type: 'female',
      title: '',
      firstName,
      lastName,
      salutationLine: `Sehr geehrte Frau ${lastName},`,
      frauLine: `Sehr geehrte Frau ${lastName},`,
      herrLine: `Sehr geehrter Herr ${lastName},`,
      familyLine: `Sehr geehrte Familie ${lastName},`,
      duLine: firstName ? `Liebe ${firstName},` : `Guten Tag Frau ${lastName},`,
      companyLine: 'Sehr geehrte Damen und Herren,'
    };
  }

  const herrMatch = withoutParens.match(/^(?:herrn?|hr\.?)\s+(.+)$/i);
  if (herrMatch && !hasLegalForm) {
    const rest = herrMatch[1].trim();
    const parts = rest
      .split(/\s+/)
      .map((p) => p.replace(/,/g, ''))
      .filter((p) => p && !isNonSurnameToken(p));
    const lastName = parts[parts.length - 1] || rest;
    const firstName = parts.length > 1 ? parts[0] : '';
    return {
      type: 'male',
      title: '',
      firstName,
      lastName,
      salutationLine: `Sehr geehrter Herr ${lastName},`,
      frauLine: `Sehr geehrte Frau ${lastName},`,
      herrLine: `Sehr geehrter Herr ${lastName},`,
      familyLine: `Sehr geehrte Familie ${lastName},`,
      duLine: firstName ? `Lieber ${firstName},` : `Guten Tag Herr ${lastName},`,
      companyLine: 'Sehr geehrte Damen und Herren,'
    };
  }

  // 3. Segmente bei Trennzeichen ("Mag. Dr. Matthias Gabriel – Zahnarzt", "Dr. Kogler | Ordination") aufbereiten
  const segments = withoutParens
    .split(/\s+(?:[-–—|/])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Falls im Kundennamen keine Person steht, aber in companyField oder notes ("Ansprechpartner: ...")
  const candidateSources = [...segments];
  if (
    companyField &&
    !isPrivateCategory &&
    !LEGAL_FORM_REGEX.test(companyField) &&
    !COMPANY_COMPOUND_REGEX.test(companyField)
  ) {
    candidateSources.push(companyField);
  }
  const contactMatch = notesField.match(
    /(?:ansprechpartner(?:in)?|kontakt|inhaber(?:in)?|z\.?\s*hd\.?)\s*[:\-]?\s*([^\n,;]+)/i
  );
  if (contactMatch?.[1]) {
    candidateSources.push(contactMatch[1].trim());
  }

  // Prüfe, ob eine echte Paarkonstellation ("Hans und Maria Gruber") vorliegt (und KEINE GesbR / Praxisgemeinschaft / Firma)
  const hasConjunction = /\s+(?:und|&|\+)\s+/i.test(withoutParens);
  const hasMultipleDoctors = (withoutParens.match(/\b(?:d?dr|mag|ing|di)\b/gi) || []).length >= 2;

  if (
    hasConjunction &&
    !hasLegalForm &&
    !hasCompanyOrPracticeKeyword &&
    !hasMultipleDoctors
  ) {
    const tokens = withoutParens
      .split(/\s+/)
      .map((t) => t.replace(/,/g, ''))
      .filter((t) => t && !/^(und|&|\+)$/i.test(t) && !isNonSurnameToken(t));
    const hasRecognizedGivenName = tokens
      .slice(0, -1)
      .some((t) => checkFirstNameGender(t) !== null);
    const lastCandidate = tokens[tokens.length - 1];
    if (hasRecognizedGivenName && lastCandidate && !isNonSurnameToken(lastCandidate)) {
      return {
        type: 'family',
        title: '',
        firstName: '',
        lastName: lastCandidate,
        salutationLine: `Sehr geehrte Familie ${lastCandidate},`,
        frauLine: `Sehr geehrte Frau ${lastCandidate},`,
        herrLine: `Sehr geehrter Herr ${lastCandidate},`,
        familyLine: `Sehr geehrte Familie ${lastCandidate},`,
        duLine: `Liebe Familie ${lastCandidate},`,
        companyLine: 'Sehr geehrte Damen und Herren,'
      };
    }
  }

  // 4. Extrahiere akademische Titel sowie Vor- und Nachname aus den bereinigten Token
  const primaryText = segments[0] || withoutParens;
  const rawTokens = primaryText.split(/\s+/).filter(Boolean);
  const foundTitles: string[] = [];
  const personTokens: string[] = [];

  for (const tok of rawTokens) {
    const cleanedTok = tok.replace(/^[,.\-–—|/()]+|[,.\-–—|/()]+$/g, '');
    if (!cleanedTok || /^(und|&|\+)$/i.test(cleanedTok)) continue;
    const norm = cleanedTok.toLowerCase().replace(/\./g, '');
    if (ACADEMIC_TITLE_MAP[norm]) {
      foundTitles.push(ACADEMIC_TITLE_MAP[norm]);
    } else if (IGNORED_DEGREE_TOKENS.has(norm)) {
      // nachgestellte Grade wie BSc/MSc ignorieren
    } else if (!isNonSurnameToken(cleanedTok)) {
      personTokens.push(tok.replace(/\.$/, ''));
    }
  }

  // Falls im Hauptsegment keine Personentoken übrig blieben (z.B. "Zahnarztpraxis GesbR"), prüfe weitere Segmente/Kontext
  if (personTokens.length === 0 && candidateSources.length > 1) {
    for (const src of candidateSources.slice(1)) {
      for (const tok of src.split(/\s+/).filter(Boolean)) {
        const cleanedTok = tok.replace(/^[,.\-–—|/()]+|[,.\-–—|/()]+$/g, '');
        if (!cleanedTok || /^(und|&|\+)$/i.test(cleanedTok)) continue;
        const norm = cleanedTok.toLowerCase().replace(/\./g, '');
        if (ACADEMIC_TITLE_MAP[norm]) {
          if (!foundTitles.includes(ACADEMIC_TITLE_MAP[norm])) {
            foundTitles.push(ACADEMIC_TITLE_MAP[norm]);
          }
        } else if (!IGNORED_DEGREE_TOKENS.has(norm) && !isNonSurnameToken(cleanedTok)) {
          personTokens.push(cleanedTok);
        }
      }
      if (personTokens.length > 0) break;
    }
  }

  const titlePrefix = foundTitles.length > 0 ? `${foundTitles.join(' ')} ` : '';

  // Bestimme Vorname / Nachname / Geschlecht aus personTokens
  let detectedGender: 'female' | 'male' | null = null;
  let firstName = '';
  let lastName = '';

  if (personTokens.length === 1) {
    const single = personTokens[0].replace(/,/g, '');
    lastName = single;
    // Einzelwort ohne weiteren Nachnamen ist nur dann eine Person, wenn kein Firmenkontext vorliegt
    if (!hasLegalForm && !hasCompanyOrPracticeKeyword) {
      const g = checkFirstNameGender(single);
      if (g) {
        detectedGender = g;
        firstName = single;
      }
    }
  } else if (personTokens.length >= 2) {
    const firstTok = personTokens[0];
    const lastTok = personTokens[personTokens.length - 1].replace(/,/g, '');
    const hasCommaAfterFirst = firstTok.endsWith(',');
    const cleanFirstTok = firstTok.replace(/,/g, '');

    const firstGender = checkFirstNameGender(cleanFirstTok);
    const lastGender = checkFirstNameGender(lastTok);

    if (hasCommaAfterFirst && lastGender) {
      // "Pirker, Johann"
      detectedGender = lastGender;
      lastName = cleanFirstTok;
      firstName = lastTok;
    } else if (firstGender) {
      // Standard "Matthias Gabriel" oder "Barbara Todoroff"
      detectedGender = firstGender;
      firstName = cleanFirstTok;
      lastName = lastTok;
    } else if (lastGender) {
      // Österreichische Reihenfolge "Pirker Johann"
      detectedGender = lastGender;
      lastName = cleanFirstTok;
      firstName = lastTok;
    } else {
      lastName = lastTok;
      firstName = cleanFirstTok;
    }
  }

  // Fallback-Label für die 1-Tipp-Buttons, falls überhaupt kein Personenname enthalten ist (z.B. "Zahnarztpraxis GesbR")
  const safePersonLastName = lastName || withoutParens.replace(LEGAL_FORM_REGEX, '').trim() || 'Kunde';
  const frauOptionLine = lastName
    ? `Sehr geehrte Frau ${titlePrefix}${lastName},`
    : 'Sehr geehrte Damen und Herren,';
  const herrOptionLine = lastName
    ? `Sehr geehrter Herr ${titlePrefix}${lastName},`
    : 'Sehr geehrte Damen und Herren,';
  const familyOptionLine = lastName
    ? `Sehr geehrte Familie ${lastName},`
    : 'Sehr geehrte Damen und Herren,';

  // 5. Wenn eine Gesellschaftsform (GesbR, GmbH, OG, KG, AG, WEG) oder mehrere Ärzte/Partner vorliegen -> IMMER "Sehr geehrte Damen und Herren,"
  const startsWithCompanyOrPractice =
    COMPANY_COMPOUND_REGEX.test(rawTokens[0] || '') ||
    COMPANY_STANDALONE_REGEX.test(rawTokens[0] || '');

  if (
    hasLegalForm ||
    hasMultipleDoctors ||
    (hasCompanyOrPracticeKeyword && (startsWithCompanyOrPractice || !detectedGender))
  ) {
    return {
      type: 'company',
      title: foundTitles.join(' '),
      firstName,
      lastName: safePersonLastName,
      salutationLine: 'Sehr geehrte Damen und Herren,',
      frauLine: frauOptionLine,
      herrLine: herrOptionLine,
      familyLine: familyOptionLine,
      duLine: firstName ? `Hallo ${firstName},` : `Guten Tag,`,
      companyLine: 'Sehr geehrte Damen und Herren,'
    };
  }

  // 6. Einzelperson (auch mit Berufsbezeichnung wie "Mag. Dr. Matthias Gabriel – Zahnarzt")
  if (detectedGender === 'female' && lastName) {
    return {
      type: 'female',
      title: foundTitles.join(' '),
      firstName,
      lastName,
      salutationLine: `Sehr geehrte Frau ${titlePrefix}${lastName},`,
      frauLine: `Sehr geehrte Frau ${titlePrefix}${lastName},`,
      herrLine: `Sehr geehrter Herr ${titlePrefix}${lastName},`,
      familyLine: `Sehr geehrte Familie ${lastName},`,
      duLine: firstName ? `Liebe ${firstName},` : `Guten Tag Frau ${titlePrefix}${lastName},`,
      companyLine: 'Sehr geehrte Damen und Herren,'
    };
  }

  if (detectedGender === 'male' && lastName) {
    return {
      type: 'male',
      title: foundTitles.join(' '),
      firstName,
      lastName,
      salutationLine: `Sehr geehrter Herr ${titlePrefix}${lastName},`,
      frauLine: `Sehr geehrte Frau ${titlePrefix}${lastName},`,
      herrLine: `Sehr geehrter Herr ${titlePrefix}${lastName},`,
      familyLine: `Sehr geehrte Familie ${lastName},`,
      duLine: firstName ? `Lieber ${firstName},` : `Guten Tag Herr ${titlePrefix}${lastName},`,
      companyLine: 'Sehr geehrte Damen und Herren,'
    };
  }

  // 7. Explizite Kategorie "Familie" im Kundenstamm
  if (/^(familie|ehepaar)$/i.test(companyField) && lastName) {
    return {
      type: 'family',
      title: foundTitles.join(' '),
      firstName,
      lastName,
      salutationLine: `Sehr geehrte Familie ${lastName},`,
      frauLine: `Sehr geehrte Frau ${titlePrefix}${lastName},`,
      herrLine: `Sehr geehrter Herr ${titlePrefix}${lastName},`,
      familyLine: `Sehr geehrte Familie ${lastName},`,
      duLine: `Liebe Familie ${lastName},`,
      companyLine: 'Sehr geehrte Damen und Herren,'
    };
  }

  // 8. Sicherer Standard-Fallback bei unklarem Geschlecht / unbekannter Bezeichnung:
  // Niemals blind "Sehr geehrte Familie ..." raten, sondern seriös "Sehr geehrte Damen und Herren," verwenden!
  return {
    type: hasCompanyOrPracticeKeyword ? 'company' : 'unknown',
    title: foundTitles.join(' '),
    firstName,
    lastName: safePersonLastName,
    salutationLine: 'Sehr geehrte Damen und Herren,',
    frauLine: frauOptionLine,
    herrLine: herrOptionLine,
    familyLine: familyOptionLine,
    duLine: `Guten Tag,`,
    companyLine: 'Sehr geehrte Damen und Herren,'
  };
}

export function replaceIntroSalutation(introText: string, newSalutationLine: string): string {
  const trimmed = (introText || '').trim();
  const salutation = newSalutationLine.trim().endsWith(',')
    ? newSalutationLine.trim()
    : `${newSalutationLine.trim()},`;
  if (!trimmed) {
    return `${salutation}\n${DEFAULT_INVOICE_INTRO_BODY}`;
  }
  const lines = trimmed.split(/\r?\n/);
  if (
    lines.length > 0 &&
    /^(sehr\s+geehrte|liebe|guten\s+tag|hallo)/i.test(lines[0].trim())
  ) {
    lines[0] = salutation;
    return lines.join('\n');
  }
  return `${salutation}\n${trimmed}`;
}

/**
 * Prüft einen gespeicherten Einleitungstext auf fehlerhafte Anreden
 * (z.B. "Sehr geehrte Familie GesbR," oder "Sehr geehrte Familie ..." bei einer Praxis/Firma)
 * und korrigiert die erste Zeile automatisch anhand des Empfängerkontexts.
 */
export function sanitizeIntroTextSalutation(
  introText: string,
  recipientName: string,
  context?: SalutationContext | null
): string {
  const trimmed = (introText || '').trim();
  const detected = detectRecipientSalutation(recipientName, context);
  if (!trimmed) {
    return `${detected.salutationLine}\n${DEFAULT_INVOICE_INTRO_BODY}`;
  }
  const firstLine = trimmed.split(/\r?\n/)[0]?.trim() || '';

  // Wenn die gespeicherte Anrede eine Rechtsform oder einen Firmen-/Praxisbegriff als Namen verwendet (z.B. "Sehr geehrte Familie GesbR,")
  const hasFalseEntityInSalutation =
    /^(?:sehr\s+geehrte\s+(?:familie|frau|herr)|liebe|hallo)\b/i.test(firstLine) &&
    (LEGAL_FORM_REGEX.test(firstLine) ||
      COMPANY_COMPOUND_REGEX.test(firstLine) ||
      COMPANY_STANDALONE_REGEX.test(firstLine) ||
      /\bzahnarzt\b/i.test(firstLine));

  // Oder wenn eine Praxis/Firma fälschlicherweise mit "Sehr geehrte Familie ..." angesprochen wurde
  const isCompanyAddressedAsFamily =
    detected.type === 'company' && /^sehr\s+geehrte\s+familie\b/i.test(firstLine);

  // Oder wenn eine eindeutig erkannte Person noch die generische Standardanrede hat
  const isPersonWithGenericDefault =
    (detected.type === 'female' || detected.type === 'male' || detected.type === 'family') &&
    /^sehr\s+geehrte\s+damen\s+und\s+herren,/i.test(firstLine);

  if (hasFalseEntityInSalutation || isCompanyAddressedAsFamily || isPersonWithGenericDefault) {
    return replaceIntroSalutation(trimmed, detected.salutationLine);
  }

  return trimmed;
}

export function buildPersonalizedIntroText(
  recipientName: string,
  isPauschal = false,
  context?: SalutationContext | null
): string {
  const { salutationLine } = detectRecipientSalutation(recipientName, context);
  const body = isPauschal ? DEFAULT_PAUSCHAL_INTRO_BODY : DEFAULT_INVOICE_INTRO_BODY;
  return `${salutationLine}\n${body}`;
}

export interface ResolvedInvoiceData {
  invoiceNumber: string;
  issueDateIso: string;
  issueDateFormatted: string;
  dueDateIso: string;
  dueDateFormatted: string;
  customerNumber: string;
  contactPerson: string;
  recipientName: string;
  recipientStreet: string;
  recipientZip: string;
  recipientCity: string;
  recipientCountry: string;
  servicePeriod: string;
  subjectText?: string;
  introText?: string;
  closingText?: string;
  isPauschal?: boolean;
  lineItems: InvoiceLineItem[];
  totalAmount: number;
  isStorno: boolean;
  stornoReason: string | null;
  paymentTermsText?: string;
  isPaidInCash?: boolean;
}

export function getTodayLocalIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDateDE(isoDate?: string | null): string {
  if (!isoDate) return '';
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[3]}.${match[2]}.${match[1]}`;
  }
  return isoDate;
}

export function addDaysIso(isoDate: string, days: number): string {
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days);
  if (Number.isNaN(d.getTime())) return isoDate;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function computeNextInvoiceNumber(
  invoices: Invoice[],
  issueDateIso: string
): { seq: number; year: string; formatted: string } {
  const year = issueDateIso.slice(0, 4) || String(new Date().getFullYear());
  const existingSeqs = invoices
    .filter((i) => !i.is_storno)
    .map((i) => {
      const slashMatch = i.invoice_number.trim().match(/^RE-(\d+)\/(\d{4})$/i);
      if (slashMatch && slashMatch[2] === year) {
        return parseInt(slashMatch[1], 10);
      }
      return 0;
    });
  const baseMax = existingSeqs.length > 0 ? Math.max(...existingSeqs, 74) : 74;
  const seq = baseMax + 1;
  return { seq, year, formatted: `RE-${seq}/${year}` };
}

export function buildPaymentTermsClause(dueDays: number, isPaidInCash = false): string {
  if (isPaidInCash) {
    return 'Zahlungsbedingungen: Rechnungsbetrag dankend bar erhalten.';
  }
  if (dueDays <= 0) {
    return 'Zahlungsbedingungen: Sofort nach Rechnungseingang ohne Abzüge fällig.';
  }
  return `Zahlungsbedingungen: Zahlung innerhalb von ${dueDays} Tagen ab Rechnungseingang ohne Abzüge.`;
}

export function formatEuro(amount: number): string {
  return `${amount.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} EUR`;
}

export function formatQtyTwoDecimals(val: number): string {
  return val.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function formatQtyNumber(val: number): string {
  return val.toLocaleString('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

export function computeServicePeriod(records: WorkRecord[], fallbackIsoDate: string): string {
  const dates = records
    .map((r) => r.work_date)
    .filter(Boolean)
    .sort();
  if (dates.length === 0) {
    return formatDateDE(fallbackIsoDate);
  }
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === last) {
    return formatDateDE(first);
  }
  return `${formatDateDE(first)} - ${formatDateDE(last)}`;
}

export function computeNextCustomerNumber(customers: Customer[]): string {
  let maxNum = 1000 + customers.length;
  for (const c of customers) {
    const raw = c.customer_number?.trim();
    if (raw) {
      const m = raw.match(/(\d+)$/);
      if (m) {
        const parsed = parseInt(m[1], 10);
        if (!Number.isNaN(parsed) && parsed > maxNum) {
          maxNum = parsed;
        }
      }
    }
  }
  return String(maxNum + 1);
}

export function resolveCustomerNumber(customerId: string, customers: Customer[]): string {
  const cust = customers.find((c) => c.id === customerId);
  if (cust?.customer_number?.trim()) {
    return cust.customer_number.trim();
  }
  const idx = customers.findIndex((c) => c.id === customerId);
  if (idx >= 0) {
    return String(1001 + idx);
  }
  const digits = customerId.replace(/\D/g, '');
  return digits ? String(1000 + (parseInt(digits.slice(-3), 10) % 900)) : '1001';
}

export function getCustomerBillingRecipient(
  customer: Customer | undefined | null,
  customers: Customer[]
): Customer | null {
  if (!customer) return null;
  if (
    customer.billing_mode === 'divergent_recipient' &&
    customer.default_billing_customer_id &&
    customer.default_billing_customer_id !== customer.id
  ) {
    return customers.find((c) => c.id === customer.default_billing_customer_id) || null;
  }
  return null;
}

export function getEffectiveBillingCustomerId(
  rec: WorkRecord,
  customers: Customer[]
): string {
  const workCust = customers.find((c) => c.id === rec.customer_id);
  const divergent = getCustomerBillingRecipient(workCust, customers);
  if (divergent) {
    return divergent.id;
  }
  if (
    rec.billing_customer_id &&
    customers.some((c) => c.id === rec.billing_customer_id)
  ) {
    return rec.billing_customer_id;
  }
  return rec.customer_id;
}

export function buildLineItemsFromRecords(
  records: WorkRecord[],
  extraItems: InvoiceLineItem[] = [],
  context?: {
    billingCustomerId?: string;
    customers?: Customer[];
    properties?: CustomerProperty[];
  }
): InvoiceLineItem[] {
  const items: InvoiceLineItem[] = [];

  const sortedRecords = [...records].sort((a, b) => a.work_date.localeCompare(b.work_date));

  for (const rec of sortedRecords) {
    const workAmount =
      rec.hourly_rate !== null
        ? Math.round(rec.hours * rec.hourly_rate * 100) / 100
        : rec.accounting_amount || 0;

    let itemDescription = rec.title;
    const isSubRecord =
      !!context?.billingCustomerId && rec.customer_id !== context.billingCustomerId;
    if (isSubRecord) {
      const origCust = context?.customers?.find((c) => c.id === rec.customer_id);
      const prop = rec.property_id
        ? context?.properties?.find((p) => p.id === rec.property_id)
        : undefined;
      if (origCust && prop && prop.name !== origCust.name) {
        itemDescription = `${rec.title} (${origCust.name} – ${prop.name})`;
      } else if (prop) {
        itemDescription = `${rec.title} (${prop.name})`;
      } else if (origCust) {
        itemDescription = `${rec.title} (${origCust.name})`;
      }
    }

    items.push({
      id: `li-${rec.id}`,
      description: itemDescription,
      quantity_label: `${formatQtyTwoDecimals(rec.hours)} Std`,
      unit_price_label: rec.hourly_rate !== null ? formatEuro(rec.hourly_rate) : 'Pauschal',
      amount: workAmount
    });

    if (rec.materials && rec.materials.length > 0) {
      for (const mat of rec.materials) {
        const matTotal =
          mat.total !== null
            ? mat.total
            : mat.price_per_unit !== null
              ? Math.round(mat.quantity * mat.price_per_unit * 100) / 100
              : 0;
        items.push({
          id: `li-mat-${rec.id}-${mat.material_id}`,
          description: mat.name,
          quantity_label: `${formatQtyTwoDecimals(mat.quantity)} ${mat.unit}`,
          unit_price_label:
            mat.price_per_unit !== null ? formatEuro(mat.price_per_unit) : 'inkl.',
          amount: matTotal
        });
      }
    }
  }

  for (const extra of extraItems) {
    items.push(extra);
  }

  return items;
}

export function resolveInvoiceDisplayData(
  invoice: Invoice,
  customers: Customer[],
  workRecords: WorkRecord[]
): ResolvedInvoiceData {
  const customer = customers.find((c) => c.id === invoice.customer_id);
  const boundRecords = workRecords.filter(
    (w) => invoice.work_record_ids.includes(w.id) || w.settlement_id === invoice.id
  );

  let lineItems: InvoiceLineItem[] = [];
  if (invoice.line_items && invoice.line_items.length > 0) {
    lineItems = invoice.line_items.map((item) => ({
      ...item,
      unit_price_label: item.unit_price_label.replace(/\s*€$/, ' EUR'),
      quantity_label: item.quantity_label.replace(/\s*Std\.$/, ' Std')
    }));
  } else if (boundRecords.length > 0) {
    lineItems = buildLineItemsFromRecords(boundRecords).map((item) =>
      invoice.is_storno ? { ...item, amount: -Math.abs(item.amount) } : item
    );
  } else {
    lineItems = [
      {
        id: `li-fallback-${invoice.id}`,
        description: invoice.is_storno
          ? `Storno (${invoice.storno_reason || 'Korrektur'})`
          : 'Gartenpflege',
        quantity_label: '1,00 Psch',
        unit_price_label: formatEuro(invoice.total_amount),
        amount: invoice.total_amount
      }
    ];
  }

  const servicePeriod =
    invoice.service_period || computeServicePeriod(boundRecords, invoice.issue_date);

  const dueIso = invoice.due_date || addDaysIso(invoice.issue_date, 14);
  const recipientName = invoice.billing_customer_name || customer?.name || 'Kunde';

  let resolvedIntroText = invoice.intro_text?.trim() || '';
  if (!resolvedIntroText) {
    resolvedIntroText = buildPersonalizedIntroText(
      recipientName,
      Boolean(invoice.is_pauschal),
      customer
    );
  } else {
    resolvedIntroText = sanitizeIntroTextSalutation(
      resolvedIntroText,
      recipientName,
      customer
    );
  }

  return {
    invoiceNumber: invoice.invoice_number,
    issueDateIso: invoice.issue_date,
    issueDateFormatted: formatDateDE(invoice.issue_date),
    dueDateIso: dueIso,
    dueDateFormatted: formatDateDE(dueIso),
    customerNumber:
      invoice.customer_number?.trim() ||
      customer?.customer_number?.trim() ||
      resolveCustomerNumber(invoice.customer_id, customers),
    contactPerson: ISSUER_CONTACT_PERSON,
    recipientName,
    recipientStreet: invoice.recipient_street ?? customer?.street ?? '',
    recipientZip: invoice.recipient_zip ?? customer?.zip ?? '',
    recipientCity: invoice.recipient_city ?? customer?.city ?? '',
    recipientCountry: 'Österreich',
    servicePeriod,
    subjectText: invoice.subject_text?.trim() || undefined,
    introText: resolvedIntroText,
    closingText: invoice.closing_text?.trim() || undefined,
    isPauschal: invoice.is_pauschal,
    lineItems,
    totalAmount: invoice.total_amount,
    isStorno: invoice.is_storno,
    stornoReason: invoice.storno_reason,
    paymentTermsText: invoice.payment_terms_text,
    isPaidInCash: invoice.paid_in_cash
  };
}

export function buildInvoiceFilename(
  invoiceNumber: string,
  issueDateIso: string,
  isStorno = false
): string {
  const safeNum = invoiceNumber
    .trim()
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  const docType = isStorno ? 'Storno' : 'Rechnung';
  const datePrefix = issueDateIso || getTodayLocalIso();
  return `${datePrefix}_${docType}_${safeNum || 'Beleg'}.pdf`;
}

function drawDinMarksAndFooter(
  doc: jsPDF,
  pageNum: number,
  totalPages: number
) {
  // DIN 5008 Falzmarken & Lochmarke links
  doc.setDrawColor(45, 45, 45);
  doc.setLineWidth(0.5);
  doc.line(0, 105, 4, 105);
  doc.setLineWidth(0.65);
  doc.line(0, 148.5, 6.5, 148.5);
  doc.setLineWidth(0.5);
  doc.line(0, 210, 4, 210);

  // Seitenzahl rechts über Fußzeile (z.B. 1/1)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(35, 35, 35);
  doc.text(`${pageNum}/${totalPages}`, 192, 267, { align: 'right' });

  // 4-spaltige Original-Fußzeile
  const fy = 275;
  const lh = 3.5;
  doc.setFontSize(7.2);
  doc.setTextColor(40, 40, 40);

  // Spalte 1: Adresse
  doc.text(ISSUER_NAME, 20, fy);
  doc.text(ISSUER_STREET, 20, fy + lh);
  doc.text(ISSUER_CITY, 20, fy + lh * 2);
  doc.text(ISSUER_COUNTRY, 20, fy + lh * 3);

  // Spalte 2: Kontakt
  doc.text(`Tel. ${ISSUER_PHONE}`, 63, fy);
  doc.text(`E-Mail ${ISSUER_EMAIL}`, 63, fy + lh);

  // Spalte 3: Amtsgericht & Steuernummer
  doc.text(ISSUER_COURT, 105, fy);
  doc.text(`Steuer-Nr. ${ISSUER_TAX_NR}`, 105, fy + lh);
  doc.text(`Inhaber/-in ${ISSUER_CONTACT_PERSON}`, 105, fy + lh * 2);

  // Spalte 4: Bankverbindung
  doc.text(ISSUER_BANK_NAME, 149, fy);
  doc.text(`IBAN ${ISSUER_IBAN}`, 149, fy + lh);
  doc.text(`BIC ${ISSUER_BIC}`, 149, fy + lh * 2);

  doc.setTextColor(0, 0, 0);
}

export function generateInvoicePdf(
  data: ResolvedInvoiceData,
  explicitLogoDataUrl?: string | null
): {
  blob: Blob;
  file: File;
  filename: string;
} {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const logoUrlToUse = explicitLogoDataUrl !== undefined ? explicitLogoDataUrl : cachedLogoDataUrl;

  // Original-Logo rechts oben (HAFNER GRÜNRAUM HANDWERK, 250x250 Quadrat)
  if (logoUrlToUse) {
    try {
      doc.addImage(logoUrlToUse, 'PNG', 150, 6, 42, 42);
    } catch {
      // Fallback Textmarke falls Bilddaten nicht lesbar
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(34, 122, 59);
      doc.text('HAFNER', 171, 36, { align: 'center' });
      doc.setFontSize(8);
      doc.text('GRÜNRAUM HANDWERK', 171, 41, { align: 'center' });
      doc.setTextColor(0, 0, 0);
    }
  }

  // Absender-Rücksendeangabe über dem Adressfeld
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.text(ISSUER_RETURN_LINE, 20, 49);

  // Empfängeradresse links (DIN-Sichtfenster)
  let addrY = 61;
  doc.setFontSize(10);
  doc.setTextColor(15, 15, 15);
  doc.text(data.recipientName, 20, addrY);

  if (data.recipientStreet.trim()) {
    addrY += 4.6;
    doc.text(data.recipientStreet.trim(), 20, addrY);
  }

  const cityLine = [data.recipientZip.trim(), data.recipientCity.trim()].filter(Boolean).join(' ');
  if (cityLine) {
    addrY += 4.6;
    doc.text(cityLine, 20, addrY);
  }

  if (data.recipientStreet.trim() || cityLine) {
    addrY += 4.6;
    doc.text(data.recipientCountry, 20, addrY);
  }

  // Rechnungs-Metadatenblock rechts
  const metaLeftX = 128;
  const metaRightX = 192;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(15, 15, 15);
  doc.text('Rechnungs-Nr.', metaLeftX, 56.5);
  doc.text(data.invoiceNumber, metaRightX, 56.5, { align: 'right' });

  doc.setFontSize(8.2);
  doc.setTextColor(35, 35, 35);
  doc.text('Rechnungsdatum', metaLeftX, 61.5);
  doc.text(data.issueDateFormatted, metaRightX, 61.5, { align: 'right' });

  doc.text('Leistungszeitraum', metaLeftX, 65.5);
  doc.text(data.servicePeriod, metaRightX, 65.5, { align: 'right' });

  doc.text('Ihre Kundennummer', metaLeftX, 73);
  doc.text(data.customerNumber, metaRightX, 73, { align: 'right' });

  doc.text('Ihr Ansprechpartner', metaLeftX, 77);
  doc.text(data.contactPerson, metaRightX, 77, { align: 'right' });

  // Betreffzeile
  const contentLeftX = 22;
  const contentRightX = 192;
  const tableWidth = contentRightX - contentLeftX;

  let y = 97;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.setTextColor(10, 10, 10);
  const resolvedSubject =
    data.subjectText?.trim() ||
    (data.isStorno
      ? `Stornorechnung Nr. ${data.invoiceNumber}`
      : data.isPauschal
        ? `Pauschalrechnung Nr. ${data.invoiceNumber}`
        : `Rechnungs Nr. ${data.invoiceNumber}`);
  doc.text(resolvedSubject, contentLeftX, y);

  // Anschreiben / Einleitungstext mit direkter Empfänger-Ansprache
  y = 109;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(20, 20, 20);
  const recipientSalutationLine = detectRecipientSalutation(data.recipientName).salutationLine;

  if (data.isStorno) {
    doc.text(recipientSalutationLine, contentLeftX, y);
    y += 7.5;
    doc.text(
      `hiermit stornieren wir die betreffende Abrechnung (${data.stornoReason || 'Korrektur'}):`,
      contentLeftX,
      y
    );
    y += 7;
  } else if (data.introText?.trim()) {
    const paragraphs = data.introText.trim().split(/\r?\n/);
    for (let i = 0; i < paragraphs.length; i++) {
      const line = paragraphs[i].trim();
      if (!line) {
        y += 3;
        continue;
      }
      const wrapped = doc.splitTextToSize(line, tableWidth) as string[];
      doc.text(wrapped, contentLeftX, y);
      y += wrapped.length * 4.5 + (i === 0 && line.endsWith(',') ? 2.5 : 0.5);
    }
    y += 3;
  } else {
    doc.text(recipientSalutationLine, contentLeftX, y);
    y += 7.5;
    doc.text('vielen Dank für Ihren Auftrag und das damit verbundene Vertrauen!', contentLeftX, y);
    y += 4.5;
    doc.text('Hiermit stelle ich Ihnen die folgenden Leistungen in Rechnung:', contentLeftX, y);
    y += 7;
  }

  // Positionstabelle (hellgraue Balken, ohne harte Rahmenlinien wie im Original)
  const colPosX = contentLeftX + 1.5;
  const colDescX = contentLeftX + 11;
  const colMengeRightX = contentLeftX + 113;
  const colUnitRightX = contentLeftX + 140;
  const colTotalRightX = contentRightX - 1.5;

  doc.setFillColor(230, 232, 235);
  doc.rect(contentLeftX, y, tableWidth, 6.8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(10, 10, 10);
  doc.text('Pos.', colPosX, y + 4.7);
  doc.text('Beschreibung', colDescX, y + 4.7);
  doc.text('Menge', colMengeRightX, y + 4.7, { align: 'right' });
  doc.text('Einzelpreis', colUnitRightX, y + 4.7, { align: 'right' });
  doc.text('Gesamtpreis', colTotalRightX, y + 4.7, { align: 'right' });

  y += 8.5;

  data.lineItems.forEach((item, index) => {
    const descLines = doc.splitTextToSize(item.description, 75) as string[];
    const rowH = Math.max(8.5, descLines.length * 4.5 + 4);

    if (y + rowH > 230) {
      doc.addPage();
      y = 25;
    }

    const rowBaseline = y + 4.2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(`${index + 1}.`, colPosX, rowBaseline);

    doc.setFont('helvetica', 'bold');
    doc.text(descLines, colDescX, rowBaseline);

    doc.setFont('helvetica', 'normal');
    doc.text(item.quantity_label, colMengeRightX, rowBaseline, { align: 'right' });
    doc.text(item.unit_price_label, colUnitRightX, rowBaseline, { align: 'right' });
    doc.text(formatEuro(item.amount), colTotalRightX, rowBaseline, { align: 'right' });

    y += rowH;
  });

  // Summenblock: Gesamtbetrag netto -> Kleinunternehmer-Zeile -> Gesamtbetrag brutto
  y += 2;
  if (y + 52 > 258) {
    doc.addPage();
    y = 25;
  }

  // Zeile 1: Gesamtbetrag netto (grauer Balken)
  doc.setFillColor(230, 232, 235);
  doc.rect(contentLeftX, y, tableWidth, 6.5, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Gesamtbetrag netto', colDescX, y + 4.5);
  doc.text(formatEuro(data.totalAmount), colTotalRightX, y + 4.5, { align: 'right' });

  y += 6.5;

  // Zeile 2: §6 Abs. 1 Z 27 UStG 1994 (weiß)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(TAX_EXEMPTION_CLAUSE, colDescX, y + 4.6);

  y += 6.8;

  // Zeile 3: Gesamtbetrag brutto (grauer Balken, fett)
  doc.setFillColor(230, 232, 235);
  doc.rect(contentLeftX, y, tableWidth, 6.8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Gesamtbetrag brutto', colDescX, y + 4.7);
  doc.text(formatEuro(data.totalAmount), colTotalRightX, y + 4.7, { align: 'right' });

  // Zahlungsbedingungen & Grußformel
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.2);
  doc.setTextColor(20, 20, 20);

  if (!data.isStorno) {
    if (data.isPaidInCash) {
      const cashTerms =
        data.paymentTermsText || 'Zahlungsbedingungen: Rechnungsbetrag dankend bar erhalten.';
      const wrappedCash = doc.splitTextToSize(cashTerms, tableWidth) as string[];
      doc.text(wrappedCash, contentLeftX, y);
      y += wrappedCash.length * 4.5 + 4;
    } else {
      const termsLines = doc.splitTextToSize(
        data.paymentTermsText || PAYMENT_TERMS_CLAUSE,
        tableWidth
      ) as string[];
      doc.text(termsLines, contentLeftX, y);
      y += termsLines.length * 4.5 + 3;

      if (data.closingText?.trim()) {
        const closingLines = doc.splitTextToSize(data.closingText.trim(), tableWidth) as string[];
        doc.text(closingLines, contentLeftX, y);
        y += closingLines.length * 4.5 + 4;
      } else {
        doc.text(
          'Bitte überweisen Sie den Rechnungsbetrag unter Angabe der Rechnungsnummer auf das unten angegebene',
          contentLeftX,
          y
        );
        y += 4.3;
        doc.text('Konto.', contentLeftX, y);
        y += 4.5;
        doc.text(
          `Der Rechnungsbetrag ist bis zum ${data.dueDateFormatted} fällig.`,
          contentLeftX,
          y
        );
        y += 8.5;
      }
    }
  } else {
    y += 4;
  }

  doc.text('Mit freundlichen Grüßen', contentLeftX, y);
  y += 4.5;
  doc.text(ISSUER_CONTACT_PERSON, contentLeftX, y);

  // DIN-Marken, Seitenzahlen & 4-spaltige Fußzeile auf allen Seiten rendern
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawDinMarksAndFooter(doc, p, totalPages);
  }

  const filename = buildInvoiceFilename(data.invoiceNumber, data.issueDateIso, data.isStorno);
  const blob = doc.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });

  return { blob, file, filename };
}

export async function generateInvoicePdfAsync(data: ResolvedInvoiceData): Promise<{
  blob: Blob;
  file: File;
  filename: string;
}> {
  const logoDataUrl = await ensureHafnerLogoLoaded();
  return generateInvoicePdf(data, logoDataUrl);
}
