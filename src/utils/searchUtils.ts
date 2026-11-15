/**
 * Hochperformante, fehlertolerante Such- & Index-Engine für die Infinity App (Pixel 10 Pro).
 * Unterstützt:
 * - Vorberechnete Suchindizes (0ms Latenz beim Tippen)
 * - Gewichtetes Relevanz-Ranking (Exakt-Treffer > Wortanfang > Hauptfeld > Nebenfeld > Notizen)
 * - Mehrfachbegriffe in beliebiger Reihenfolge (UND-Verknüpfung, z.B. "Steiner Rasen Oktober")
 * - Umlaut-Toleranz (ä/ae/a, ö/oe/o, ü/ue/u, ß/ss)
 * - Deutsche & österreichische Monats- und Wochentagsnamen aus ISO-Daten
 * - Betrags-, Kundennummern- (#) und Telefonnummern-Normalisierung
 * - Tippfehler-Toleranz (1 Buchstabe Abweichung ab 4 Zeichen Wortlänge)
 */

const MONTH_KEYWORDS_DE: Record<string, string> = {
  '01': 'jaenner jänner januar jan',
  '02': 'februar feb',
  '03': 'maerz märz mrz',
  '04': 'april apr',
  '05': 'mai',
  '06': 'juni jun',
  '07': 'juli jul',
  '08': 'august aug',
  '09': 'september sep sept',
  '10': 'oktober okt',
  '11': 'november nov',
  '12': 'dezember dez'
};

const WEEKDAY_NAMES_DE = [
  'sonntag so',
  'montag mo',
  'dienstag di',
  'mittwoch mi',
  'donnerstag do',
  'freitag fr',
  'samstag sa'
];

export function normalizeSearchText(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  const raw = String(input).toLowerCase().trim();
  if (!raw) return '';

  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss');
}

export function normalizeSearchWithUmlauts(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  const raw = String(input).toLowerCase().trim();
  if (!raw) return '';

  const expanded = raw
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const stripped = normalizeSearchText(raw);
  return expanded === stripped ? expanded : `${expanded} ${stripped}`;
}

export function extractDigits(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(/\D+/g, '');
}

export function formatIsoToDeSearchable(isoDate: string | null | undefined): string {
  if (!isoDate || !isoDate.includes('-')) return isoDate || '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  const shortYear = year.slice(-2);
  const monthNames = MONTH_KEYWORDS_DE[month] || '';

  let weekday = '';
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (!Number.isNaN(parsed.getTime())) {
    weekday = WEEKDAY_NAMES_DE[parsed.getDay()] || '';
  }

  return `${isoDate} ${day}.${month}.${year} ${day}.${month}.${shortYear} ${day}.${month}. ${month}/${year} ${monthNames} ${weekday}`.trim();
}

export function formatAmountSearchable(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '';
  const fixedDe = amount.toFixed(2).replace('.', ',');
  const fixedDot = amount.toFixed(2);
  const intPart = Math.round(amount).toString();
  return `${fixedDe} ${fixedDot} ${intPart} ${fixedDe}€ ${intPart}€`;
}

function splitWords(normalizedText: string): string[] {
  if (!normalizedText) return [];
  return normalizedText
    .split(/[^a-z0-9#]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

/**
 * Prüft mit maximal 1 Edit-Distanz (Ersetzung, Auslassung, Dreher), ob `token` auf den Wortanfang von `word` passt.
 */
function isFuzzyPrefixMatch(token: string, word: string): boolean {
  if (token.length < 4 || word.length < 3) return false;
  const target = word.slice(0, Math.min(word.length, token.length + 1));
  if (Math.abs(token.length - target.length) > 1) return false;

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < token.length && j < target.length) {
    if (token[i] === target[j]) {
      i++;
      j++;
    } else {
      edits++;
      if (edits > 1) return false;
      // Buchstabendreher (Transposition)
      if (
        i + 1 < token.length &&
        j + 1 < target.length &&
        token[i] === target[j + 1] &&
        token[i + 1] === target[j]
      ) {
        i += 2;
        j += 2;
      } else if (token.length > target.length) {
        i++;
      } else if (token.length < target.length) {
        j++;
      } else {
        i++;
        j++;
      }
    }
  }

  return edits + (token.length - i) <= 1;
}

export interface SearchIndexEntry {
  exactKeys: string[];
  primaryText: string;
  primaryWords: string[];
  secondaryText: string;
  secondaryWords: string[];
  keywordsText: string;
  digits: string;
}

export interface ParsedSearchToken {
  raw: string;
  norm: string;
  expanded: string;
  noHash: string;
  digits: string;
}

export interface ParsedSearchQuery {
  fullNorm: string;
  tokens: ParsedSearchToken[];
}

export function buildSearchIndexEntry(params: {
  exactKeys?: Array<string | number | null | undefined>;
  primary: Array<string | number | null | undefined>;
  secondary?: Array<string | number | null | undefined>;
  keywords?: Array<string | number | null | undefined>;
}): SearchIndexEntry {
  const exactKeys = (params.exactKeys || [])
    .map((k) => normalizeSearchText(k))
    .filter(Boolean)
    .flatMap((k) => (k.startsWith('#') ? [k, k.slice(1)] : [k, `#${k}`]));

  const primaryText = params.primary
    .map((f) => normalizeSearchWithUmlauts(f))
    .filter(Boolean)
    .join(' ');

  const secondaryText = (params.secondary || [])
    .map((f) => normalizeSearchWithUmlauts(f))
    .filter(Boolean)
    .join(' ');

  const keywordsText = (params.keywords || [])
    .map((f) => normalizeSearchWithUmlauts(f))
    .filter(Boolean)
    .join(' ');

  const allRawFields = [
    ...(params.exactKeys || []),
    ...params.primary,
    ...(params.secondary || []),
    ...(params.keywords || [])
  ];

  const digits = allRawFields
    .map((f) => extractDigits(f))
    .filter((d) => d.length >= 2)
    .join(' ');

  return {
    exactKeys,
    primaryText,
    primaryWords: splitWords(primaryText),
    secondaryText,
    secondaryWords: splitWords(secondaryText),
    keywordsText,
    digits
  };
}

export function parseSearchQuery(query: string): ParsedSearchQuery {
  const trimmed = query.trim();
  if (!trimmed) {
    return { fullNorm: '', tokens: [] };
  }

  const fullNorm = normalizeSearchText(trimmed);
  const tokens = trimmed
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((raw) => {
      const norm = normalizeSearchText(raw);
      const expanded = raw
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      const noHash = norm.replace(/^#+/, '');
      const digits = extractDigits(raw);
      return { raw, norm, expanded, noHash, digits };
    });

  return { fullNorm, tokens };
}

function scoreSingleToken(token: ParsedSearchToken, entry: SearchIndexEntry): number {
  const { norm, expanded, noHash, digits } = token;
  if (!norm && !digits) return 0;

  // 1. Exakter Treffer auf Schlüsselnummer (Kundennummer, Rechnungsnummer, PLZ)
  if (
    entry.exactKeys.includes(norm) ||
    (noHash && entry.exactKeys.includes(noHash))
  ) {
    return 1200;
  }

  // 2. Exakter Wort-Treffer oder Präfix-Treffer im Hauptfeld (Name, Titel, Nummer)
  for (const w of entry.primaryWords) {
    if (w === norm || w === expanded || (noHash && w === noHash)) {
      return 850;
    }
    if (
      w.startsWith(norm) ||
      w.startsWith(expanded) ||
      (noHash.length >= 2 && w.startsWith(noHash))
    ) {
      return 550;
    }
  }

  // 3. Teilwort-Treffer im Hauptfeld
  if (entry.primaryText.includes(norm) || entry.primaryText.includes(expanded)) {
    return 320;
  }

  // 4. Wort- oder Präfix-Treffer im Sekundärfeld (Kundenname, Ort, Straße, Objekt)
  for (const w of entry.secondaryWords) {
    if (w === norm || w === expanded || (noHash && w === noHash)) {
      return 260;
    }
    if (w.startsWith(norm) || w.startsWith(expanded)) {
      return 200;
    }
  }

  // 5. Teilwort-Treffer im Sekundärfeld
  if (entry.secondaryText.includes(norm) || entry.secondaryText.includes(expanded)) {
    return 140;
  }

  // 6. Ziffern-Treffer (Telefonnummern, Kundennummern, Beträge, Datumszahlen)
  if (digits.length >= 2 && entry.digits.includes(digits)) {
    return digits.length >= 4 ? 220 : 120;
  }

  // 7. Stichwort- & Zusatzfelder (Materialien, Notizen, Monatsnamen, Status)
  if (entry.keywordsText.includes(norm) || entry.keywordsText.includes(expanded)) {
    return 95;
  }

  // 8. Fehlertoleranter Wortanfang-Treffer (1 Tippfehler ab 4 Zeichen)
  if (norm.length >= 4) {
    for (const w of entry.primaryWords) {
      if (isFuzzyPrefixMatch(norm, w) || isFuzzyPrefixMatch(expanded, w)) {
        return 60;
      }
    }
    for (const w of entry.secondaryWords) {
      if (isFuzzyPrefixMatch(norm, w) || isFuzzyPrefixMatch(expanded, w)) {
        return 45;
      }
    }
  }

  return 0;
}

/**
 * Berechnet den Relevanz-Score eines Eintrags für die übergebene Suchanfrage.
 * Gibt `0` zurück, wenn mindestens ein Suchbegriff nicht passt.
 */
export function scoreSearchIndex(
  parsedQuery: ParsedSearchQuery,
  entry: SearchIndexEntry
): number {
  if (parsedQuery.tokens.length === 0) return 1;

  let totalScore = 0;
  for (const token of parsedQuery.tokens) {
    const tokenScore = scoreSingleToken(token, entry);
    if (tokenScore === 0) {
      return 0;
    }
    totalScore += tokenScore;
  }

  // Bonus für zusammenhängende Mehrwort-Treffer im Haupt- oder Nebenfeld
  if (parsedQuery.tokens.length > 1 && parsedQuery.fullNorm.length >= 4) {
    if (entry.primaryText.includes(parsedQuery.fullNorm)) {
      totalScore += 400;
    } else if (entry.secondaryText.includes(parsedQuery.fullNorm)) {
      totalScore += 200;
    }
  }

  return totalScore;
}

/**
 * Kompatibilitäts-Hilfsfunktion: Prüft direkt, ob alle Tokens von `query` in `fields` matchen.
 */
export function matchesSearchQuery(
  query: string,
  fields: Array<string | number | null | undefined>
): boolean {
  const parsed = parseSearchQuery(query);
  if (parsed.tokens.length === 0) return true;
  const entry = buildSearchIndexEntry({
    primary: fields.slice(0, 3),
    secondary: fields.slice(3, 7),
    keywords: fields.slice(7)
  });
  return scoreSearchIndex(parsed, entry) > 0;
}
