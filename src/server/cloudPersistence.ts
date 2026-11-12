import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface FirebaseAppletConfig {
  projectId?: string;
  firestoreDatabaseId?: string;
}

export interface PersistenceDiagnostics {
  atomicDiskActive: boolean;
  dataDir: string;
  firestoreConfigured: boolean;
  firestoreDatabaseId: string | null;
  firestoreCloudActive: boolean;
  lastDiskWriteAt: string | null;
  lastCloudSyncAt: string | null;
}

const CHUNK_CHAR_SIZE = 600_000;

let cachedToken: { accessToken: string; expiresAtMs: number } | null = null;
let firestoreCloudActive = false;
let firestoreRetryAfterMs = 0;
let lastDiskWriteAt: string | null = null;
let lastCloudSyncAt: string | null = null;
const inFlightCloudWrites = new Set<Promise<void>>();

export function getDataDir(): string {
  const custom = process.env.HAFNER_DATA_DIR?.trim();
  return custom ? path.resolve(custom) : path.resolve(process.cwd(), 'data');
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

export function resolveDataFilePath(fileName: string): string {
  return path.join(ensureDataDir(), fileName);
}

function loadFirebaseAppletConfig(): FirebaseAppletConfig {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(cfgPath)) return {};
    return JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as FirebaseAppletConfig;
  } catch {
    return {};
  }
}

function resolveFirestoreRestBaseUrl(): {
  baseUrl: string | null;
  databaseId: string | null;
} {
  const overrideBase = process.env.FIRESTORE_REST_BASE_URL?.trim();
  if (overrideBase) {
    return {
      baseUrl: overrideBase.replace(/\/+$/, ''),
      databaseId: 'override-db'
    };
  }

  const cfg = loadFirebaseAppletConfig();
  const projectId = (process.env.FIREBASE_PROJECT_ID || cfg.projectId || '').trim();
  const databaseId = (
    process.env.FIRESTORE_DATABASE_ID ||
    cfg.firestoreDatabaseId ||
    '(default)'
  ).trim();

  if (!projectId) {
    return { baseUrl: null, databaseId: null };
  }

  return {
    baseUrl: `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents`,
    databaseId
  };
}

async function getCloudIamAccessToken(): Promise<string | null> {
  const overrideToken = process.env.FIRESTORE_BEARER_TOKEN_OVERRIDE?.trim();
  if (overrideToken) {
    return overrideToken;
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs - 60_000 > now) {
    return cachedToken.accessToken;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: controller.signal
      }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    cachedToken = {
      accessToken: json.access_token,
      expiresAtMs: now + Math.max(60, Number(json.expires_in || 300)) * 1000
    };
    return cachedToken.accessToken;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function writeLocalJsonAtomic(fileName: string, data: unknown): void {
  const targetPath = resolveDataFilePath(fileName);
  const tmpPath = `${targetPath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  const serialized = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, serialized, { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.chmodSync(tmpPath, 0o600);
  } catch {
    // Non-POSIX fallback
  }
  fs.renameSync(tmpPath, targetPath);
  lastDiskWriteAt = new Date().toISOString();
}

export function readLocalJsonSync<T>(fileName: string): T | null {
  const targetPath = resolveDataFilePath(fileName);
  if (!fs.existsSync(targetPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

interface FirestoreFieldMap {
  [key: string]: { stringValue?: string; integerValue?: string };
}

interface FirestoreDocResponse {
  fields?: FirestoreFieldMap;
}

async function writeToCloudFirestore(storeKey: string, serializedJson: string): Promise<boolean> {
  if (Date.now() < firestoreRetryAfterMs) {
    return false;
  }
  const { baseUrl } = resolveFirestoreRestBaseUrl();
  if (!baseUrl) return false;

  const token = await getCloudIamAccessToken();
  if (!token) {
    firestoreRetryAfterMs = Date.now() + 60_000;
    return false;
  }

  const chunks: string[] = [];
  for (let i = 0; i < serializedJson.length; i += CHUNK_CHAR_SIZE) {
    chunks.push(serializedJson.slice(i, i + CHUNK_CHAR_SIZE));
  }
  if (chunks.length === 0) {
    chunks.push('{}');
  }

  const nowIso = new Date().toISOString();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  try {
    // 1. Write chunks first so readers never observe incomplete chunk references
    for (let idx = 0; idx < chunks.length; idx++) {
      const chunkId = `${storeKey}_${idx}`;
      const chunkRes = await fetch(
        `${baseUrl}/_mcp_server_chunks/${encodeURIComponent(chunkId)}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            fields: {
              storeKey: { stringValue: storeKey },
              chunkIndex: { integerValue: String(idx) },
              payload: { stringValue: chunks[idx] },
              updatedAt: { stringValue: nowIso }
            }
          })
        }
      );
      if (chunkRes.status === 401 || chunkRes.status === 403) {
        firestoreCloudActive = false;
        firestoreRetryAfterMs = Date.now() + 5 * 60_000;
        return false;
      }
      if (!chunkRes.ok) {
        return false;
      }
    }

    // 2. Commit atomic pointer metadata document
    const metaRes = await fetch(
      `${baseUrl}/_mcp_server_state/${encodeURIComponent(storeKey)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          fields: {
            storeKey: { stringValue: storeKey },
            chunkCount: { integerValue: String(chunks.length) },
            sha256: { stringValue: sha256Hex(serializedJson) },
            updatedAt: { stringValue: nowIso }
          }
        })
      }
    );

    if (metaRes.status === 401 || metaRes.status === 403) {
      firestoreCloudActive = false;
      firestoreRetryAfterMs = Date.now() + 5 * 60_000;
      return false;
    }
    if (!metaRes.ok) {
      return false;
    }

    firestoreCloudActive = true;
    lastCloudSyncAt = nowIso;
    return true;
  } catch {
    return false;
  }
}

async function readFromCloudFirestore<T>(
  storeKey: string
): Promise<{ status: 'found'; data: T } | { status: 'not_found' } | { status: 'unavailable' }> {
  const { baseUrl } = resolveFirestoreRestBaseUrl();
  if (!baseUrl) return { status: 'unavailable' };

  const token = await getCloudIamAccessToken();
  if (!token) return { status: 'unavailable' };

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json'
  };

  try {
    const metaRes = await fetch(
      `${baseUrl}/_mcp_server_state/${encodeURIComponent(storeKey)}`,
      { headers }
    );
    if (metaRes.status === 404) {
      firestoreCloudActive = true;
      return { status: 'not_found' };
    }
    if (metaRes.status === 401 || metaRes.status === 403) {
      firestoreCloudActive = false;
      firestoreRetryAfterMs = Date.now() + 5 * 60_000;
      return { status: 'unavailable' };
    }
    if (!metaRes.ok) {
      return { status: 'unavailable' };
    }

    const metaDoc = (await metaRes.json()) as FirestoreDocResponse;
    const chunkCount = Number(metaDoc.fields?.chunkCount?.integerValue || '0');
    const expectedSha = metaDoc.fields?.sha256?.stringValue || '';
    if (!Number.isFinite(chunkCount) || chunkCount <= 0) {
      return { status: 'not_found' };
    }

    const parts: string[] = [];
    for (let idx = 0; idx < chunkCount; idx++) {
      const chunkId = `${storeKey}_${idx}`;
      const chunkRes = await fetch(
        `${baseUrl}/_mcp_server_chunks/${encodeURIComponent(chunkId)}`,
        { headers }
      );
      if (!chunkRes.ok) {
        return { status: 'unavailable' };
      }
      const chunkDoc = (await chunkRes.json()) as FirestoreDocResponse;
      parts.push(chunkDoc.fields?.payload?.stringValue || '');
    }

    const joined = parts.join('');
    if (expectedSha && sha256Hex(joined) !== expectedSha) {
      return { status: 'unavailable' };
    }

    firestoreCloudActive = true;
    lastCloudSyncAt = metaDoc.fields?.updatedAt?.stringValue || new Date().toISOString();
    return {
      status: 'found',
      data: JSON.parse(joined) as T
    };
  } catch {
    return { status: 'unavailable' };
  }
}

export function persistStoreToDiskAndCloud(
  storeKey: string,
  fileName: string,
  data: unknown
): void {
  writeLocalJsonAtomic(fileName, data);
  const serialized = JSON.stringify(data);
  const task = writeToCloudFirestore(storeKey, serialized)
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      inFlightCloudWrites.delete(task);
    });
  inFlightCloudWrites.add(task);
}

export async function hydrateStoreFromCloudOrDisk<T>(
  storeKey: string,
  fileName: string,
  preferHigherRevision = false
): Promise<T | null> {
  const localData = readLocalJsonSync<T>(fileName);
  const cloudOutcome = await readFromCloudFirestore<T>(storeKey);

  if (cloudOutcome.status === 'found') {
    if (localData && preferHigherRevision) {
      const localRev = Number((localData as Record<string, unknown>).revision ?? -1);
      const cloudRev = Number((cloudOutcome.data as Record<string, unknown>).revision ?? -1);
      if (localRev > cloudRev) {
        await writeToCloudFirestore(storeKey, JSON.stringify(localData));
        return localData;
      }
    }
    writeLocalJsonAtomic(fileName, cloudOutcome.data);
    return cloudOutcome.data;
  }

  if (cloudOutcome.status === 'not_found' && localData) {
    await writeToCloudFirestore(storeKey, JSON.stringify(localData));
  }

  return localData;
}

export async function flushPendingCloudWrites(): Promise<void> {
  if (inFlightCloudWrites.size === 0) return;
  await Promise.allSettled(Array.from(inFlightCloudWrites));
}

export function getPersistenceDiagnostics(): PersistenceDiagnostics {
  const { baseUrl, databaseId } = resolveFirestoreRestBaseUrl();
  return {
    atomicDiskActive: true,
    dataDir: getDataDir(),
    firestoreConfigured: Boolean(baseUrl),
    firestoreDatabaseId: databaseId,
    firestoreCloudActive,
    lastDiskWriteAt,
    lastCloudSyncAt
  };
}
