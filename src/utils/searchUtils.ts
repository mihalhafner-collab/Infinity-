/**
 * Gemeinsame, fehlertolerante Such-Hilfsfunktionen für die Infinity App (Pixel 10 Pro).
 * Unterstützt:
 * - Mehrfachbegriffe in beliebiger Reihenfolge (z.B. "Müller Graz" oder "Hecke Mai")
 * - Umlaut-Toleranz (ä/ae, ö/oe, ü/ue, ß/ss)
 * - Telefonnummern-Normalisierung (findet "0664123" auch in "+43 664 / 123 45")
 * - Deutsches Datumsformat (findet "13.11.2026" auch bei gespeichertem "2026-11-13")
 */

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

export function extractDigits(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(/\D+/g, '');
}

export function formatIsoToDeSearchable(isoDate: string | null | undefined): string {
  if (!isoDate || !isoDate.includes('-')) return isoDate || '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${isoDate} ${parts[2]}.${parts[1]}.${parts[0]} ${parts[2]}.${parts[1]}.`;
}

/**
 * Prüft, ob alle Suchbegriffe (Tokens) von `query` in den übergebenen `fields` vorkommen.
 */
export function matchesSearchQuery(
  query: string,
  fields: Array<string | number | null | undefined>
): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;

  const tokens = trimmed
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) return true;

  const combinedText = fields
    .map((f) => normalizeSearchWithUmlauts(f))
    .filter(Boolean)
    .join(' ');

  const combinedDigits = fields
    .map((f) => (typeof f === 'string' ? extractDigits(f) : ''))
    .filter((d) => d.length >= 3)
    .join(' ');

  return tokens.every((token) => {
    const normToken = normalizeSearchText(token);
    const expandedToken = token
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss');

    if (combinedText.includes(normToken) || combinedText.includes(expandedToken)) {
      return true;
    }

    const tokenDigits = extractDigits(token);
    if (tokenDigits.length >= 3 && combinedDigits.includes(tokenDigits)) {
      return true;
    }

    return false;
  });
}
