import type { GoogleCalendarNormalizedItem } from './googleCalendarService.ts';

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
  getPixelTunnelStatusJson?: () => string;
  openPixelTunnelSetup?: () => boolean;
  setPixelTunnelEnabled?: (enabled: boolean) => string;
  setPixelTunnelWriteEnabled?: (writeEnabled: boolean) => string;
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
  sendGmailAutomatically?: (
    requestId: string,
    base64Data: string,
    filename: string,
    recipientEmail: string,
    subject: string,
    bodyText: string,
    invoiceNumber: string,
    webAccessToken: string
  ) => void;
  notifyMailSent?: (recipientEmail: string, invoiceNumber: string) => boolean;
  getGmailConfigJson?: () => string;
  signInWithGoogle?: (requestId: string) => void;
  disconnectGmail?: () => string;
  saveGmailAppPassword?: (senderEmail: string, appPassword: string) => string;
  pasteGmailAppPasswordFromClipboard?: (senderEmail: string) => string;
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
    __onHafnerNativePixelTunnelStatus?: (statusJson: string) => void;
    __onHafnerNativeGmailConfigUpdated?: (configJson: string, autoDetected: boolean) => void;
  }
}

type PendingCallback = {
  resolve: (payload: string) => void;
  reject: (err: Error) => void;
};

type RemoteStateListener = (stateJson: string, revision: number, summary: string) => void;
type PixelTunnelStatusListener = (status: NativePixelTunnelStatus) => void;
type GmailConfigListener = (config: NativeGmailConfig, autoDetected: boolean) => void;

const pendingCallbacks = new Map<string, PendingCallback>();
const remoteStateListeners = new Set<RemoteStateListener>();
const pixelTunnelStatusListeners = new Set<PixelTunnelStatusListener>();
const gmailConfigListeners = new Set<GmailConfigListener>();

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

  window.__onHafnerNativeGmailConfigUpdated = (configJson: string, autoDetected: boolean) => {
    try {
      const parsed = JSON.parse(configJson) as NativeGmailConfig;
      for (const listener of gmailConfigListeners) {
        try {
          listener(parsed, Boolean(autoDetected));
        } catch {
          // Ignore individual listener error
        }
      }
    } catch {
      // Ignore malformed config payload
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

export function subscribeNativeRemoteState(listener: RemoteStateListener): () => void {
  remoteStateListeners.add(listener);
  return () => {
    remoteStateListeners.delete(listener);
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

async function blobToBase64(blob: Blob): Promise<string> {
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
  recipientPhone?: string;
}): Promise<boolean> {
  if (!isNativeAndroidApp() || !window.HafnerNative) {
    return false;
  }
  const base64 = await blobToBase64(params.blob);
  const recipientTarget =
    params.channel === 'whatsapp' || params.channel === 'sms'
      ? params.recipientPhone || params.recipientEmail || ''
      : params.recipientEmail || params.recipientPhone || '';
  return window.HafnerNative.shareDocument(
    base64,
    params.filename,
    params.mimeType || 'application/pdf',
    params.subject,
    params.bodyText,
    params.channel,
    recipientTarget
  );
}

export interface NativeGmailConfig {
  senderEmail: string;
  hasAppPassword: boolean;
  hasOAuthToken: boolean;
}

export function getNativeGmailConfig(): NativeGmailConfig | null {
  if (!isNativeAndroidApp() || !window.HafnerNative?.getGmailConfigJson) {
    return null;
  }
  try {
    const raw = window.HafnerNative.getGmailConfigJson();
    if (!raw) return null;
    return JSON.parse(raw) as NativeGmailConfig;
  } catch {
    return null;
  }
}

export async function signInWithGoogleNatively(): Promise<{
  email: string;
  accessToken: string;
}> {
  if (!isNativeAndroidApp() || !window.HafnerNative?.signInWithGoogle) {
    throw new Error('Native Google-Anmeldung nicht verfügbar.');
  }
  const reqId = nextRequestId('google_signin');
  const rawJson = await new Promise<string>((resolve, reject) => {
    pendingCallbacks.set(reqId, { resolve, reject });
    window.HafnerNative?.signInWithGoogle?.(reqId);
  });
  return JSON.parse(rawJson) as { email: string; accessToken: string };
}

export function disconnectNativeGmail(): NativeGmailConfig | null {
  if (!isNativeAndroidApp() || !window.HafnerNative?.disconnectGmail) {
    return null;
  }
  try {
    const raw = window.HafnerNative.disconnectGmail();
    if (!raw) return null;
    return JSON.parse(raw) as NativeGmailConfig;
  } catch {
    return null;
  }
}

export function saveNativeGmailAppPassword(
  senderEmail: string,
  appPassword: string
): NativeGmailConfig | null {
  if (!isNativeAndroidApp() || !window.HafnerNative?.saveGmailAppPassword) {
    return null;
  }
  try {
    const raw = window.HafnerNative.saveGmailAppPassword(senderEmail, appPassword);
    if (!raw) return null;
    return JSON.parse(raw) as NativeGmailConfig;
  } catch {
    return null;
  }
}

export function pasteNativeGmailAppPasswordFromClipboard(
  senderEmail: string
): NativeGmailConfig | null {
  if (!isNativeAndroidApp() || !window.HafnerNative?.pasteGmailAppPasswordFromClipboard) {
    return null;
  }
  try {
    const raw = window.HafnerNative.pasteGmailAppPasswordFromClipboard(senderEmail);
    if (!raw) return null;
    return JSON.parse(raw) as NativeGmailConfig;
  } catch {
    return null;
  }
}

export function subscribeNativeGmailConfig(listener: GmailConfigListener): () => void {
  gmailConfigListeners.add(listener);
  return () => {
    gmailConfigListeners.delete(listener);
  };
}

export function notifyMailSentNatively(recipientEmail: string, invoiceNumber: string): void {
  if (!isNativeAndroidApp()) return;
  try {
    window.HafnerNative?.notifyMailSent?.(recipientEmail, invoiceNumber);
  } catch {
    // Ignore
  }
}

export async function sendInvoiceEmailAutomaticallyNatively(params: {
  blob: Blob;
  filename: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  invoiceNumber: string;
  webAccessToken?: string | null;
}): Promise<{ ok: boolean; method: string; messageId?: string }> {
  if (!isNativeAndroidApp() || !window.HafnerNative?.sendGmailAutomatically) {
    throw new Error('Nativer automatischer E-Mail-Versand auf diesem Gerät nicht verfügbar.');
  }
  const base64 = await blobToBase64(params.blob);
  const reqId = nextRequestId('gmail_send');
  const rawJson = await new Promise<string>((resolve, reject) => {
    pendingCallbacks.set(reqId, { resolve, reject });
    window.HafnerNative?.sendGmailAutomatically?.(
      reqId,
      base64,
      params.filename,
      params.recipientEmail.trim(),
      params.subject,
      params.bodyText,
      params.invoiceNumber,
      params.webAccessToken || ''
    );
  });
  return JSON.parse(rawJson) as { ok: boolean; method: string; messageId?: string };
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
