import type { GoogleCalendarNormalizedItem } from './googleCalendarService.ts';

interface HafnerNativeInterface {
  isNativeAndroid: () => boolean;
  getDeviceProfile: () => string;
  loadStateJson: () => string | null;
  saveStateJson: (json: string) => boolean;
  getBackupMetaJson: () => string;
  saveDocumentToDevice: (
    requestId: string,
    base64Data: string,
    filename: string,
    mimeType: string
  ) => void;
  shareDocument: (
    base64Data: string,
    filename: string,
    mimeType: string,
    subject: string,
    bodyText: string,
    channel: string,
    recipientEmail: string
  ) => boolean;
  readDeviceCalendar: (requestId: string, startDateIso: string, endDateIso: string) => void;
  runVerifiedZipBackup: (
    requestId: string,
    jsonPayload: string,
    forcePickTarget: boolean
  ) => void;
  restoreVerifiedZipBackup: (requestId: string, pickExternalFile: boolean) => void;
  openExternalUrl: (url: string) => boolean;
}

declare global {
  interface Window {
    HafnerNative?: HafnerNativeInterface;
    __onHafnerNativeCallback?: (requestId: string, ok: boolean, payloadOrError: string) => void;
    __hafnerNativeBack?: () => boolean;
  }
}

type PendingCallback = {
  resolve: (payload: string) => void;
  reject: (err: Error) => void;
};

const pendingCallbacks = new Map<string, PendingCallback>();

if (typeof window !== 'undefined') {
  window.__onHafnerNativeCallback = (requestId: string, ok: boolean, payloadOrError: string) => {
    const entry = pendingCallbacks.get(requestId);
    if (!entry) return;
    pendingCallbacks.delete(requestId);
    if (ok) {
      entry.resolve(payloadOrError);
    } else {
      entry.reject(new Error(payloadOrError || 'Nativer Vorgang fehlgeschlagen.'));
    }
  };
}

function nextRequestId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isNativeAndroidApp(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.HafnerNative?.isNativeAndroid?.());
  } catch {
    return false;
  }
}

export function loadNativeStoreJson(): string | null {
  if (!isNativeAndroidApp()) return null;
  try {
    return window.HafnerNative?.loadStateJson() ?? null;
  } catch {
    return null;
  }
}

export function saveNativeStoreJson(json: string): void {
  if (!isNativeAndroidApp()) return;
  try {
    window.HafnerNative?.saveStateJson(json);
  } catch {
    // localStorage remains active as secondary mirror
  }
}

export interface NativeBackupMeta {
  hasExternalTarget: boolean;
  targetLabel: string;
  lastBackupDate: string | null;
  hasInternalBackup: boolean;
}

export function getNativeBackupMeta(): NativeBackupMeta | null {
  if (!isNativeAndroidApp()) return null;
  try {
    const raw = window.HafnerNative?.getBackupMetaJson();
    if (!raw) return null;
    return JSON.parse(raw) as NativeBackupMeta;
  } catch {
    return null;
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function downloadOrSaveBlob(
  blob: Blob,
  filename: string,
  mimeType = 'application/pdf'
): Promise<boolean> {
  if (isNativeAndroidApp() && window.HafnerNative) {
    const base64 = await blobToBase64(blob);
    const reqId = nextRequestId('save_doc');
    return new Promise<boolean>((resolve) => {
      pendingCallbacks.set(reqId, {
        resolve: () => resolve(true),
        reject: () => resolve(false)
      });
      window.HafnerNative?.saveDocumentToDevice(reqId, base64, filename, mimeType);
    });
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function shareDocumentNatively(params: {
  blob: Blob;
  filename: string;
  mimeType?: string;
  subject: string;
  bodyText: string;
  channel: 'gmail' | 'whatsapp' | 'sms' | 'share';
  recipientEmail?: string;
}): Promise<boolean> {
  if (!isNativeAndroidApp() || !window.HafnerNative) {
    return false;
  }
  const base64 = await blobToBase64(params.blob);
  return window.HafnerNative.shareDocument(
    base64,
    params.filename,
    params.mimeType || 'application/pdf',
    params.subject,
    params.bodyText,
    params.channel,
    params.recipientEmail || ''
  );
}

export async function readNativeDeviceCalendar(
  startDateIso: string,
  endDateIso: string
): Promise<GoogleCalendarNormalizedItem[]> {
  if (!isNativeAndroidApp() || !window.HafnerNative) {
    return [];
  }
  const reqId = nextRequestId('cal');
  const rawJson = await new Promise<string>((resolve, reject) => {
    pendingCallbacks.set(reqId, { resolve, reject });
    window.HafnerNative?.readDeviceCalendar(reqId, startDateIso, endDateIso);
  });
  return JSON.parse(rawJson) as GoogleCalendarNormalizedItem[];
}

export interface NativeVerifiedBackupResult {
  ok: boolean;
  isoTimestamp: string;
  targetLabel: string;
  verifiedBytes: number;
}

export async function runNativeVerifiedBackup(
  jsonPayload: string,
  forcePickTarget = false
): Promise<NativeVerifiedBackupResult> {
  const reqId = nextRequestId('backup');
  const raw = await new Promise<string>((resolve, reject) => {
    pendingCallbacks.set(reqId, { resolve, reject });
    window.HafnerNative?.runVerifiedZipBackup(reqId, jsonPayload, forcePickTarget);
  });
  return JSON.parse(raw) as NativeVerifiedBackupResult;
}

export async function restoreNativeVerifiedBackup(
  pickExternalFile = false
): Promise<string | null> {
  const reqId = nextRequestId('restore');
  return new Promise<string | null>((resolve, reject) => {
    pendingCallbacks.set(reqId, {
      resolve: (json) => resolve(json),
      reject: (err) => reject(err)
    });
    window.HafnerNative?.restoreVerifiedZipBackup(reqId, pickExternalFile);
  });
}

export function registerNativeBackHandler(handler: () => boolean): () => void {
  if (typeof window === 'undefined') return () => {};
  window.__hafnerNativeBack = handler;
  return () => {
    if (window.__hafnerNativeBack === handler) {
      delete window.__hafnerNativeBack;
    }
  };
}

const REMOTE_SERVER_URL_KEY = 'hafner_remote_mcp_base_url';
const REMOTE_SERVER_TOKEN_KEY = 'hafner_remote_mcp_token';

export interface RemoteSyncConfig {
  baseUrl: string;
  token: string;
}

export function getRemoteSyncConfig(): RemoteSyncConfig {
  if (typeof window === 'undefined') return { baseUrl: '', token: '' };
  return {
    baseUrl: (localStorage.getItem(REMOTE_SERVER_URL_KEY) || '').trim().replace(/\/+$/, ''),
    token: (localStorage.getItem(REMOTE_SERVER_TOKEN_KEY) || '').trim()
  };
}

export function setRemoteSyncConfig(baseUrl: string, token: string): void {
  if (typeof window === 'undefined') return;
  const cleanUrl = baseUrl.trim().replace(/\/mcp.*$/i, '').replace(/\/+$/, '');
  localStorage.setItem(REMOTE_SERVER_URL_KEY, cleanUrl);
  localStorage.setItem(REMOTE_SERVER_TOKEN_KEY, token.trim());
}

export function resolveBackendEndpoint(path: string): {
  url: string | null;
  headers: Record<string, string>;
} {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (!isNativeAndroidApp()) {
    return { url: cleanPath, headers: {} };
  }
  const { baseUrl, token } = getRemoteSyncConfig();
  if (!baseUrl) {
    return { url: null, headers: {} };
  }
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return {
    url: `${baseUrl}${cleanPath}`,
    headers
  };
}
