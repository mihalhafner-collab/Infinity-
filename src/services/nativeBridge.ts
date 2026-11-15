import type { GoogleCalendarNormalizedItem } from './googleCalendarService.ts';

export type NativeMcpConnectionState =
  | 'connected'
  | 'reconnecting'
  | 'offline_queued'
  | 'offline'
  | 'unpaired'
  | 'auth_error';

export interface NativeMcpSyncStatus {
  state: NativeMcpConnectionState;
  statusLabel: string;
  configured: boolean;
  baseUrl: string;
  mcpEndpointUrl: string;
  maskedToken: string;
  revealedToken?: string;
  deviceToken?: string;
  keystoreProtected: boolean;
  networkOnline: boolean;
  pendingLocalChanges: boolean;
  pendingSyncCount: number;
  syncInFlight: boolean;
  revision: number;
  lastSyncAt: string | null;
  lastError: string | null;
  totalMcpCalls: number;
  lastMcpAccessAt: string | null;
  activeOAuthGrants: number;
}

export interface NativePixelTunnelStatus {
  running: boolean;
  state: string;
  label: string;
  detail: string;
  battery_exempt: boolean;
  configured: boolean;
  enabled: boolean;
  write_enabled: boolean;
  tunnel_id_masked: string;
  organization: string;
  last_contact_at: number;
  last_response_at: number;
  transport_confirmed: boolean;
  local_revision: number;
  dataset_id: string;
}

interface HafnerNativeInterface {
  isNativeAndroid: () => boolean;
  getDeviceProfile: () => string;
  loadStateJson: () => string | null;
  saveStateJson: (json: string) => boolean;
  getBackupMetaJson: () => string;
  getMcpSyncStatusJson?: () => string;
  getPixelTunnelStatusJson?: () => string;
  openPixelTunnelSetup?: () => boolean;
  setPixelTunnelEnabled?: (enabled: boolean) => string;
  setPixelTunnelWriteEnabled?: (writeEnabled: boolean) => string;
  getRevealedMcpToken?: () => string;
  copyToClipboard?: (label: string, text: string) => boolean;
  configureMcpSync?: (baseUrl: string, token: string) => string;
  pairMcpWithCode?: (baseUrl: string, code: string) => string;
  triggerMcpSyncNow?: () => boolean;
  disconnectMcpSync?: () => string;
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
  upsertDeviceCalendarEvent?: (requestId: string, payloadJson: string) => void;
  deleteDeviceCalendarEvent?: (requestId: string, googleEventId: string) => void;
  readDeviceLocation?: (requestId: string) => void;
  runVerifiedZipBackup: (
    requestId: string,
    jsonPayload: string,
    forcePickTarget: boolean
  ) => void;
  restoreVerifiedZipBackup: (requestId: string, pickExternalFile: boolean) => void;
  openExternalUrl: (url: string) => boolean;
  setCanGoBackInApp?: (canGoBack: boolean) => void;
}

declare global {
  interface Window {
    HafnerNative?: HafnerNativeInterface;
    __onHafnerNativeCallback?: (requestId: string, ok: boolean, payloadOrError: string) => void;
    __hafnerNativeBack?: () => boolean;
    __onHafnerNativeRemoteState?: (stateJson: string, revision: number, summary: string) => void;
    __onHafnerNativeMcpStatus?: (statusJson: string) => void;
    __onHafnerNativePixelTunnelStatus?: (statusJson: string) => void;
  }
}

type PendingCallback = {
  resolve: (payload: string) => void;
  reject: (err: Error) => void;
};

type RemoteStateListener = (stateJson: string, revision: number, summary: string) => void;
type McpStatusListener = (status: NativeMcpSyncStatus) => void;
type PixelTunnelStatusListener = (status: NativePixelTunnelStatus) => void;

const pendingCallbacks = new Map<string, PendingCallback>();
const remoteStateListeners = new Set<RemoteStateListener>();
const mcpStatusListeners = new Set<McpStatusListener>();
const pixelTunnelStatusListeners = new Set<PixelTunnelStatusListener>();

const LEGACY_REMOTE_URL_KEY = 'hafner_remote_mcp_base_url';
const LEGACY_REMOTE_TOKEN_KEY = 'hafner_remote_mcp_token';
export const DEFAULT_INFINITY_CLOUD_URL =
  'https://hafner-gruenraum-523881801839.europe-west1.run.app';

export function normalizeInfinityCloudBaseUrl(raw?: string | null): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return DEFAULT_INFINITY_CLOUD_URL;
  const withoutMcp = trimmed.replace(/\/mcp.*$/i, '').replace(/\/+$/, '');
  if (
    withoutMcp.toLowerCase().includes('infinity-hafner.ai.studio') ||
    withoutMcp.toLowerCase().includes('hafner-gruenraum.ai.studio')
  ) {
    return DEFAULT_INFINITY_CLOUD_URL;
  }
  return withoutMcp || DEFAULT_INFINITY_CLOUD_URL;
}

function normalizeSyncStatusUrls(status: NativeMcpSyncStatus): NativeMcpSyncStatus {
  const cleanBase = normalizeInfinityCloudBaseUrl(status.baseUrl);
  return {
    ...status,
    baseUrl: cleanBase,
    mcpEndpointUrl: `${cleanBase}/mcp`
  };
}

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

  window.__onHafnerNativeRemoteState = (stateJson: string, revision: number, summary: string) => {
    for (const listener of remoteStateListeners) {
      try {
        listener(stateJson, revision, summary);
      } catch {
        // Ignore individual listener error
      }
    }
  };

  window.__onHafnerNativeMcpStatus = (statusJson: string) => {
    try {
      const parsed = normalizeSyncStatusUrls(JSON.parse(statusJson) as NativeMcpSyncStatus);
      for (const listener of mcpStatusListeners) {
        try {
          listener(parsed);
        } catch {
          // Ignore individual listener error
        }
      }
    } catch {
      // Ignore malformed status payload
    }
  };

  window.__onHafnerNativePixelTunnelStatus = (statusJson: string) => {
    try {
      const parsed = JSON.parse(statusJson) as NativePixelTunnelStatus;
      for (const listener of pixelTunnelStatusListeners) {
        try {
          listener(parsed);
        } catch {
          // Ignore individual listener error
        }
      }
    } catch {
      // Ignore malformed status payload
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

// Bereinigt etwaige frühere Klartext-Einträge aus localStorage auf dem Pixel 10 Pro
export function migrateLegacyWebStorageCredentialsIfNeeded(): void {
  if (typeof window === 'undefined' || !isNativeAndroidApp()) return;
  try {
    localStorage.removeItem(LEGACY_REMOTE_URL_KEY);
    localStorage.removeItem(LEGACY_REMOTE_TOKEN_KEY);
  } catch {
    // Ignore storage cleanup error
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

export function getNativeMcpSyncStatus(): NativeMcpSyncStatus | null {
  if (!isNativeAndroidApp()) return null;
  migrateLegacyWebStorageCredentialsIfNeeded();
  try {
    const raw = window.HafnerNative?.getMcpSyncStatusJson?.();
    if (!raw) return null;
    return normalizeSyncStatusUrls(JSON.parse(raw) as NativeMcpSyncStatus);
  } catch {
    return null;
  }
}

export function getNativePixelTunnelStatus(): NativePixelTunnelStatus | null {
  if (!isNativeAndroidApp()) return null;
  try {
    const raw = window.HafnerNative?.getPixelTunnelStatusJson?.();
    if (!raw) return null;
    return JSON.parse(raw) as NativePixelTunnelStatus;
  } catch {
    return null;
  }
}

export function openNativePixelTunnelSetup(): boolean {
  if (!isNativeAndroidApp()) return false;
  try {
    return Boolean(window.HafnerNative?.openPixelTunnelSetup?.());
  } catch {
    return false;
  }
}

export function setNativePixelTunnelEnabled(enabled: boolean): NativePixelTunnelStatus | null {
  if (!isNativeAndroidApp()) return null;
  try {
    const raw = window.HafnerNative?.setPixelTunnelEnabled?.(enabled);
    if (!raw) return null;
    return JSON.parse(raw) as NativePixelTunnelStatus;
  } catch {
    return null;
  }
}

export function setNativePixelTunnelWriteEnabled(
  writeEnabled: boolean
): NativePixelTunnelStatus | null {
  if (!isNativeAndroidApp()) return null;
  try {
    const raw = window.HafnerNative?.setPixelTunnelWriteEnabled?.(writeEnabled);
    if (!raw) return null;
    return JSON.parse(raw) as NativePixelTunnelStatus;
  } catch {
    return null;
  }
}

export function subscribeNativePixelTunnelStatus(
  listener: PixelTunnelStatusListener
): () => void {
  pixelTunnelStatusListeners.add(listener);
  return () => {
    pixelTunnelStatusListeners.delete(listener);
  };
}

export function pairNativeMcpWithCode(
  baseUrl: string,
  code: string
): NativeMcpSyncStatus | null {
  if (!isNativeAndroidApp()) return null;
  try {
    const cleanUrl = normalizeInfinityCloudBaseUrl(baseUrl);
    const raw = window.HafnerNative?.pairMcpWithCode?.(cleanUrl, code.trim());
    if (!raw) return null;
    return normalizeSyncStatusUrls(JSON.parse(raw) as NativeMcpSyncStatus);
  } catch {
    return null;
  }
}

export function configureNativeMcpSync(
  baseUrl: string,
  token: string
): NativeMcpSyncStatus | null {
  if (!isNativeAndroidApp()) return null;
  try {
    const cleanUrl = normalizeInfinityCloudBaseUrl(baseUrl);
    const raw = window.HafnerNative?.configureMcpSync?.(cleanUrl, token.trim());
    if (!raw) return null;
    return normalizeSyncStatusUrls(JSON.parse(raw) as NativeMcpSyncStatus);
  } catch {
    return null;
  }
}

export function triggerNativeMcpSyncNow(): void {
  if (!isNativeAndroidApp()) return;
  try {
    window.HafnerNative?.triggerMcpSyncNow?.();
  } catch {
    // Ignore
  }
}

export function disconnectNativeMcpSync(): NativeMcpSyncStatus | null {
  if (!isNativeAndroidApp()) return null;
  try {
    const raw = window.HafnerNative?.disconnectMcpSync?.();
    if (!raw) return null;
    return normalizeSyncStatusUrls(JSON.parse(raw) as NativeMcpSyncStatus);
  } catch {
    return null;
  }
}

export function subscribeNativeRemoteState(listener: RemoteStateListener): () => void {
  remoteStateListeners.add(listener);
  return () => {
    remoteStateListeners.delete(listener);
  };
}

export function subscribeNativeMcpStatus(listener: McpStatusListener): () => void {
  mcpStatusListeners.add(listener);
  return () => {
    mcpStatusListeners.delete(listener);
  };
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

export async function upsertNativeDeviceCalendarEvent(payload: {
  googleEventId?: string | null;
  title: string;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  duration_minutes?: number | null;
  address?: string | null;
  notes?: string | null;
}): Promise<string | null> {
  if (!isNativeAndroidApp() || !window.HafnerNative?.upsertDeviceCalendarEvent) {
    return null;
  }
  const reqId = nextRequestId('cal_write');
  const rawJson = await new Promise<string>((resolve, reject) => {
    pendingCallbacks.set(reqId, { resolve, reject });
    window.HafnerNative?.upsertDeviceCalendarEvent?.(reqId, JSON.stringify(payload));
  });
  const parsed = JSON.parse(rawJson) as { googleEventId?: string };
  return parsed.googleEventId || null;
}

export async function deleteNativeDeviceCalendarEvent(googleEventId: string): Promise<boolean> {
  if (!isNativeAndroidApp() || !window.HafnerNative?.deleteDeviceCalendarEvent) {
    return false;
  }
  const reqId = nextRequestId('cal_del');
  const rawJson = await new Promise<string>((resolve, reject) => {
    pendingCallbacks.set(reqId, { resolve, reject });
    window.HafnerNative?.deleteDeviceCalendarEvent?.(reqId, googleEventId);
  });
  const parsed = JSON.parse(rawJson) as { deleted?: boolean };
  return Boolean(parsed.deleted);
}

export async function readNativeDeviceLocation(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  if (!isNativeAndroidApp() || !window.HafnerNative?.readDeviceLocation) {
    return null;
  }
  const reqId = nextRequestId('loc');
  const rawJson = await new Promise<string>((resolve, reject) => {
    pendingCallbacks.set(reqId, { resolve, reject });
    window.HafnerNative?.readDeviceLocation?.(reqId);
  });
  const parsed = JSON.parse(rawJson) as { latitude?: number; longitude?: number };
  if (typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number') {
    return { latitude: parsed.latitude, longitude: parsed.longitude };
  }
  return null;
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

export function openExternalUrlNatively(url: string): boolean {
  if (isNativeAndroidApp() && window.HafnerNative?.openExternalUrl) {
    return window.HafnerNative.openExternalUrl(url);
  }
  return false;
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

export function syncNativeCanGoBack(canGoBack: boolean): void {
  if (!isNativeAndroidApp()) return;
  try {
    window.HafnerNative?.setCanGoBackInApp?.(canGoBack);
  } catch {
    // Ignore if running on older bridge
  }
}

let webSessionToken: string | null = null;

export function setWebSessionToken(token: string | null): void {
  webSessionToken = token && token.trim() ? token.trim() : null;
}

export function getWebSessionToken(): string | null {
  return webSessionToken;
}

export function resolveBackendEndpoint(path: string): {
  url: string | null;
  headers: Record<string, string>;
} {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (isNativeAndroidApp()) {
    // Im nativen Android-Betrieb übernimmt Kotlin NativeMcpSyncManager alle Daten-Synchronisationen
    return { url: null, headers: {} };
  }
  const headers: Record<string, string> = {};
  let finalUrl = cleanPath;
  if (webSessionToken) {
    headers['Authorization'] = `Bearer ${webSessionToken}`;
    if (cleanPath.startsWith('/api/internal/events')) {
      const sep = cleanPath.includes('?') ? '&' : '?';
      finalUrl = `${cleanPath}${sep}session_token=${encodeURIComponent(webSessionToken)}`;
    }
  }
  return { url: finalUrl, headers };
}

export function getRevealedNativeMcpToken(): string | null {
  if (!isNativeAndroidApp()) return null;
  try {
    const direct = window.HafnerNative?.getRevealedMcpToken?.()?.trim();
    if (direct && direct.length >= 16) return direct;
    const status = getNativeMcpSyncStatus();
    const fromStatus = status?.revealedToken?.trim() || status?.deviceToken?.trim();
    if (fromStatus && fromStatus.length >= 16) return fromStatus;
  } catch {
    // Ignore
  }
  return null;
}

export async function copyTextRobustly(label: string, text: string): Promise<boolean> {
  const cleanText = text.trim();
  if (!cleanText) return false;

  if (isNativeAndroidApp() && window.HafnerNative?.copyToClipboard) {
    try {
      const ok = window.HafnerNative.copyToClipboard(label, cleanText);
      if (ok) return true;
    } catch {
      // Fallback to web clipboard below
    }
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(cleanText);
      return true;
    }
  } catch {
    // Fallback to textarea execCommand below
  }

  if (typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = cleanText;
      ta.setAttribute('readonly', 'true');
      ta.className = 'fixed -top-96 left-0 opacity-0 pointer-events-none';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(ta);
      if (copied) return true;
    } catch {
      // Ignore
    }
  }

  return false;
}

export function resolveMcpAdminEndpoint(
  path: string,
  overrideBaseUrl?: string
): {
  url: string;
  headers: Record<string, string>;
} {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (isNativeAndroidApp()) {
    const status = getNativeMcpSyncStatus();
    const normalizedBase = normalizeInfinityCloudBaseUrl(
      overrideBaseUrl?.trim() || status?.baseUrl?.trim() || DEFAULT_INFINITY_CLOUD_URL
    );
    const authToken =
      status?.deviceToken?.trim() ||
      status?.revealedToken?.trim() ||
      getRevealedNativeMcpToken();
    const headers: Record<string, string> = {
      'X-Device-Model': 'Google Pixel 10 Pro'
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    return {
      url: `${normalizedBase}${cleanPath}`,
      headers
    };
  }
  return { url: cleanPath, headers: {} };
}

