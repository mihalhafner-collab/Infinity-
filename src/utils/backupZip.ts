/**
 * Erzeugt aus einem Voll-Backup das schlanke Notfall-Backup für die Web-App:
 * Alle geschäftsrelevanten Daten (Kunden, Adressen, Telefonnummern, Objekte, Termine,
 * Arbeiten, Rechnungen, Ausgaben, Materialien, Geräte & technische Daten) bleiben zu 100 % erhalten,
 * lediglich schwere Base64-Kamerafotos werden weggelassen.
 */
export function buildLightWebBackupObject<T extends Record<string, unknown>>(fullData: T): T {
  const clone: Record<string, unknown> = { ...fullData, backup_variant: 'webapp_light' };

  if (Array.isArray(fullData.customers)) {
    clone.customers = fullData.customers.map((c) =>
      c && typeof c === 'object' ? { ...(c as Record<string, unknown>), photo: null } : c
    );
  }
  if (Array.isArray(fullData.properties)) {
    clone.properties = fullData.properties.map((p) =>
      p && typeof p === 'object' ? { ...(p as Record<string, unknown>), photos: [] } : p
    );
  }
  if (Array.isArray(fullData.workRecords)) {
    clone.workRecords = fullData.workRecords.map((w) =>
      w && typeof w === 'object' ? { ...(w as Record<string, unknown>), photos: [] } : w
    );
  }
  if (Array.isArray(fullData.equipments)) {
    clone.equipments = fullData.equipments.map((e) =>
      e && typeof e === 'object' ? { ...(e as Record<string, unknown>), photo: null } : e
    );
  }

  return clone as T;
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Browser unterstützt keine ZIP-Dekomprimierung (DecompressionStream fehlt).');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  await writer.write(new Uint8Array(compressed));
  await writer.close();

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      totalLen += value.byteLength;
    }
  }
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Entpackt eine von der Android Infinity App erzeugte `hausgarten-backup.zip`
 * (oder liest eine `.json`-Sicherungsdatei) direkt clientseitig im Browser.
 * Bevorzugt innerhalb der ZIP automatisch `hausgarten_webapp_light.json`
 * (bzw. `hausgarten_backup_v1.json`) und entfernt für die Notfall-Web-App alle Kamerafotos.
 */
export async function extractAndroidBackupForWebApp(
  file: File
): Promise<Record<string, unknown>> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // Prüfen auf ZIP-Signatur "PK\x03\x04"
  const isZip =
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04;

  if (!isZip) {
    const text = new TextDecoder('utf-8').decode(bytes);
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Ungültige JSON-Sicherungsdatei.');
    }
    return buildLightWebBackupObject(parsed as Record<string, unknown>);
  }

  // Suche das End of Central Directory (EOCD, Signatur 0x06054b50) vom Dateiende rückwärts
  const view = new DataView(buf);
  let eocdOffset = -1;
  const minEocdSearch = Math.max(0, bytes.byteLength - 65557);
  for (let i = bytes.byteLength - 22; i >= minEocdSearch; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new Error('ZIP-Verzeichnisstruktur in der Sicherungsdatei nicht gefunden.');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  type ZipEntryMeta = {
    name: string;
    compressionMethod: number;
    compressedSize: number;
    localHeaderOffset: number;
  };

  const entries: ZipEntryMeta[] = [];
  let ptr = cdOffset;
  const decoder = new TextDecoder('utf-8');

  for (let i = 0; i < totalEntries; i++) {
    if (ptr + 46 > bytes.byteLength || view.getUint32(ptr, true) !== 0x02014b50) {
      break;
    }
    const compressionMethod = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      localHeaderOffset
    });

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  const targetEntry =
    entries.find((e) => e.name === 'hausgarten_webapp_light.json') ||
    entries.find((e) => e.name === 'hausgarten_backup_v1.json') ||
    entries.find((e) => e.name.endsWith('.json') && e.name !== 'manifest.json');

  if (!targetEntry) {
    throw new Error('Keine Sicherungsdaten (.json) in der ZIP-Datei gefunden.');
  }

  const lh = targetEntry.localHeaderOffset;
  if (lh + 30 > bytes.byteLength || view.getUint32(lh, true) !== 0x04034b50) {
    throw new Error('Lokaler ZIP-Eintrag beschädigt.');
  }
  const lhNameLen = view.getUint16(lh + 26, true);
  const lhExtraLen = view.getUint16(lh + 28, true);
  const dataStart = lh + 30 + lhNameLen + lhExtraLen;
  const rawSlice = bytes.subarray(dataStart, dataStart + targetEntry.compressedSize);

  let uncompressedBytes: Uint8Array;
  if (targetEntry.compressionMethod === 0) {
    uncompressedBytes = rawSlice;
  } else if (targetEntry.compressionMethod === 8) {
    uncompressedBytes = await inflateRawBytes(rawSlice);
  } else {
    throw new Error(`Nicht unterstützte ZIP-Komprimierung (${targetEntry.compressionMethod}).`);
  }

  const jsonText = decoder.decode(uncompressedBytes);
  const parsed = JSON.parse(jsonText);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Entpackte Sicherung enthält kein gültiges Datenformat.');
  }

  return buildLightWebBackupObject(parsed as Record<string, unknown>);
}
