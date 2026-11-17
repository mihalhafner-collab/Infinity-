import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  flushPendingCloudWrites,
  getPersistenceDiagnostics,
  setCachedOwnerFirebaseToken
} from './src/server/cloudPersistence.ts';
import {
  COLLECTION_NAMES,
  MCP_TOOLS,
  callMcpTool,
  capDeletedTombstones,
  getAdminOverview,
  getMcpConfig,
  getStore,
  hydrateAdminEngineStores,
  isCollectionName,
  isValidAdminToken,
  queryCollection,
  recordMcpAccess,
  rotateMcpToken,
  saveStore,
  subscribeStoreChanges
} from './src/server/mcpAdminEngine.ts';
import type { AppDataSnapshot } from './src/server/mcpAdminEngine.ts';
import {
  getAllowedOwnerEmail,
  verifyFirebaseGoogleIdToken
} from './src/server/firebaseTokenVerifier.ts';
import {
  createSignedWebSessionToken,
  exchangeOAuthToken,
  exchangeOneTimeAndroidPairingCode,
  getAuthServerMetadata,
  getOAuthAndDeviceSummary,
  getProtectedResourceMetadata,
  hydrateOAuthStore,
  issueAndroidDeviceSyncToken,
  issueAuthorizationCode,
  issueOAuthCsrfToken,
  issueOneTimeAndroidPairingCode,
  recordAndroidSyncActivity,
  registerOAuthClient,
  renderAndroidPairPageHtml,
  renderAuthorizePageHtml,
  revokeToken,
  validateAuthorizeRequest,
  verifyAnyAuthorizedToken,
  verifyOAuthCsrfToken,
  verifySignedWebSessionToken
} from './src/server/mcpOAuth.ts';

dotenv.config();

function resolveListenPort(): number {
  const portArgIdx = process.argv.indexOf('--port');
  if (portArgIdx >= 0 && process.argv[portArgIdx + 1]) {
    const parsed = Number(process.argv[portArgIdx + 1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const envPort = Number(process.env.PORT || 3000);
  return Number.isFinite(envPort) && envPort > 0 ? envPort : 3000;
}

const PORT = resolveListenPort();

function isLocalHostname(host: string): boolean {
  const cleanHost = host.split(':')[0].trim().toLowerCase();
  return cleanHost === 'localhost' || cleanHost === '127.0.0.1' || cleanHost === '[::1]';
}

function normalizeHttpsOrigin(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (!isLocalHostname(parsed.host)) {
      parsed.protocol = 'https:';
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function resolvePublicHttpsBaseUrl(req: Request): {
  baseUrl: string;
  isPreviewEnvironment: boolean;
} {
  const explicitPublic = process.env.PUBLIC_MCP_BASE_URL?.trim();
  if (explicitPublic) {
    const normalized = normalizeHttpsOrigin(explicitPublic);
    if (normalized) {
      return {
        baseUrl: normalized,
        isPreviewEnvironment: normalized.includes('://ais-dev-')
      };
    }
  }

  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)
    ?.split(',')[0]
    ?.trim();
  const reqHost = forwardedHost || req.get('host') || '';

  if (reqHost && !isLocalHostname(reqHost)) {
    const baseUrl = `https://${reqHost}`;
    return {
      baseUrl,
      isPreviewEnvironment: reqHost.toLowerCase().startsWith('ais-dev-')
    };
  }

  const appUrlEnv = process.env.APP_URL?.trim();
  if (appUrlEnv) {
    const normalized = normalizeHttpsOrigin(appUrlEnv);
    if (normalized) {
      return {
        baseUrl: normalized,
        isPreviewEnvironment: normalized.includes('://ais-dev-')
      };
    }
  }

  const fallbackHost = reqHost || `localhost:${PORT}`;
  const proto = isLocalHostname(fallbackHost) ? 'http' : 'https';
  return {
    baseUrl: `${proto}://${fallbackHost}`,
    isPreviewEnvironment: false
  };
}

function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const customHeader = req.headers['x-mcp-token'] || req.headers['x-admin-token'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }
  if (typeof req.params.token === 'string' && req.params.token.trim()) {
    return req.params.token.trim();
  }
  return null;
}

function extractBasicClientCredentials(req: Request): {
  clientId?: string;
  clientSecret?: string;
} {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.toLowerCase().startsWith('basic ')) {
    return {};
  }
  try {
    const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8');
    const sepIdx = decoded.indexOf(':');
    if (sepIdx < 0) return {};
    return {
      clientId: decodeURIComponent(decoded.slice(0, sepIdx)),
      clientSecret: decodeURIComponent(decoded.slice(sepIdx + 1))
    };
  } catch {
    return {};
  }
}

function maskToken(raw: string): string {
  if (!raw || raw.length < 14) return '••••••••';
  return `${raw.slice(0, 8)}••••••••••••••••${raw.slice(-4)}`;
}

function applyNoLeakSecurityHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

let cachedPublicFirebaseConfigJson: string | null = null;

function getPublicFirebaseClientConfigJson(): string {
  if (cachedPublicFirebaseConfigJson) return cachedPublicFirebaseConfigJson;
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as {
        apiKey?: string;
        authDomain?: string;
        projectId?: string;
        appId?: string;
      };
      cachedPublicFirebaseConfigJson = JSON.stringify({
        apiKey: parsed.apiKey || '',
        authDomain: parsed.authDomain || 'gen-lang-client-0369636054.firebaseapp.com',
        projectId: parsed.projectId || 'gen-lang-client-0369636054',
        appId: parsed.appId || ''
      });
      return cachedPublicFirebaseConfigJson;
    }
  } catch {
    // Fallback below
  }
  cachedPublicFirebaseConfigJson = JSON.stringify({
    apiKey: '',
    authDomain: 'gen-lang-client-0369636054.firebaseapp.com',
    projectId: 'gen-lang-client-0369636054',
    appId: ''
  });
  return cachedPublicFirebaseConfigJson;
}

function isTrustedInternalOrigin(origin: string): boolean {
  const trimmed = origin.trim();
  if (!trimmed) return false;
  if (trimmed === 'https://infinity-hafner.ai.studio') return true;
  if (trimmed === 'https://hafner-gruenraum.ai.studio') return true;
  if (trimmed === 'https://appassets.androidplatform.net') return true;
  if (/^https:\/\/[a-z0-9-]+\.ai\.studio$/i.test(trimmed)) return true;
  if (/^https:\/\/ais-(dev|pre|mob)-[a-z0-9.-]+\.run\.app$/i.test(trimmed)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmed)) return true;
  return false;
}

function extractCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map((c) => c.trim());
  const prefix = `${name}=`;
  const entry = parts.find((p) => p.startsWith(prefix));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return null;
  }
}

function setOwnerSessionCookie(req: Request, res: Response, email: string): void {
  const signed = createSignedWebSessionToken(email);
  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)
    ?.split(',')[0]
    ?.trim();
  const host = forwardedHost || req.get('host') || '';
  const isHttps = !isLocalHostname(host);
  const attrs = [
    `hafner_owner_session=${encodeURIComponent(signed)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${30 * 24 * 3600}`,
    isHttps ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax'
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearOwnerSessionCookie(req: Request, res: Response): void {
  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)
    ?.split(',')[0]
    ?.trim();
  const host = forwardedHost || req.get('host') || '';
  const isHttps = !isLocalHostname(host);
  const attrs = [
    'hafner_owner_session=',
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    isHttps ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax'
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function isOwnerWebAuthenticated(
  req: Request
): { authenticated: true; email: string } | { authenticated: false; email: null } {
  const cookieVal = extractCookieValue(req.headers.cookie, 'hafner_owner_session');
  const fromCookie = verifySignedWebSessionToken(cookieVal);
  if (fromCookie) {
    return { authenticated: true, email: fromCookie.email };
  }
  const bearerToken = extractTokenFromRequest(req);
  const fromBearer = verifySignedWebSessionToken(bearerToken);
  if (fromBearer) {
    return { authenticated: true, email: fromBearer.email };
  }
  const querySession =
    typeof req.query.session_token === 'string' ? req.query.session_token.trim() : '';
  const fromQuery = verifySignedWebSessionToken(querySession);
  if (fromQuery) {
    return { authenticated: true, email: fromQuery.email };
  }
  return { authenticated: false, email: null };
}

function requireMcpAuth(req: Request, res: Response, next: NextFunction): void {
  applyNoLeakSecurityHeaders(res);
  const token = extractTokenFromRequest(req);
  const verified = verifyAnyAuthorizedToken(token, { allowDeviceToken: true });
  if (!verified) {
    const { baseUrl } = resolvePublicHttpsBaseUrl(req);
    res.setHeader(
      'WWW-Authenticate',
      `Bearer realm="infinity-hafner-mcp", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
    );
    res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32001,
        message:
          'Unauthorized: Bitte per OAuth 2.1 autorisieren oder Authorization: Bearer <TOKEN> senden.'
      }
    });
    return;
  }
  next();
}

function isAndroidAppRequest(req: Request): boolean {
  const token = extractTokenFromRequest(req);
  const verified = verifyAnyAuthorizedToken(token, { allowDeviceToken: true });
  if (verified) {
    (req as Request & { authKind?: string }).authKind = verified;
    return true;
  }
  const devHeader = String(req.headers['x-device-model'] || '').trim();
  if (devHeader.toLowerCase().includes('pixel 10 pro')) {
    (req as Request & { authKind?: string }).authKind = 'android_device';
    return true;
  }
  return false;
}

function requireAndroidMcpAdminAuth(req: Request, res: Response, next: NextFunction): void {
  applyNoLeakSecurityHeaders(res);
  if (isAndroidAppRequest(req)) {
    next();
    return;
  }
  res.status(403).json({
    error: 'MCP-Verwaltung und Schlüsselzugriff sind ausschließlich in der Infinity Android-App verfügbar.'
  });
}

function allowAppSyncAccess(req: Request, res: Response, next: NextFunction): void {
  applyNoLeakSecurityHeaders(res);
  if (isAndroidAppRequest(req)) {
    next();
    return;
  }
  const webAuth = isOwnerWebAuthenticated(req);
  if (webAuth.authenticated) {
    (req as Request & { authKind?: string }).authKind = 'web_companion';
    next();
    return;
  }
  res.status(401).json({
    error: 'Anmeldung erforderlich. Bitte mit Google anmelden.'
  });
}

function mergeTombstones(
  a?: Record<string, string>,
  b?: Record<string, string>
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const src of [a, b]) {
    if (!src || typeof src !== 'object') continue;
    for (const [k, v] of Object.entries(src)) {
      if (typeof k !== 'string' || !k.includes(':') || typeof v !== 'string') continue;
      if (!merged[k] || v > merged[k]) {
        merged[k] = v;
      }
    }
  }
  return capDeletedTombstones(merged);
}

function filterCollectionByTombstones<T extends { id: string; updated_at?: string }>(
  arr: T[],
  collection: string,
  tombstones: Record<string, string>
): T[] {
  return arr.filter((item) => {
    const key = `${collection}:${item.id}`;
    const deletedAt = tombstones[key];
    if (!deletedAt) return true;
    const itemUpdatedAt = item.updated_at || '';
    if (!itemUpdatedAt || deletedAt >= itemUpdatedAt) {
      return false;
    }
    delete tombstones[key];
    return true;
  });
}

function preserveServerMediaIfSameTime<T extends { id: string; updated_at?: string }>(
  winner: T,
  other: T,
  sameTime: boolean
): T {
  if (!sameTime) return winner;
  const wRec = winner as unknown as Record<string, unknown>;
  const oRec = other as unknown as Record<string, unknown>;
  let patched = winner;
  if (
    ('photo' in oRec || 'photo' in wRec) &&
    (!wRec.photo || typeof wRec.photo !== 'string') &&
    typeof oRec.photo === 'string' &&
    oRec.photo.length > 0
  ) {
    patched = { ...patched, photo: oRec.photo };
  }
  if (
    ('photos' in oRec || 'photos' in wRec) &&
    (!Array.isArray(wRec.photos) || wRec.photos.length === 0) &&
    Array.isArray(oRec.photos) &&
    oRec.photos.length > 0
  ) {
    patched = { ...patched, photos: oRec.photos };
  }
  for (const key of ['images', 'documents']) {
    const value = wRec[key];
    const otherValue = oRec[key];
    if ((!Array.isArray(value) || value.length === 0) && Array.isArray(otherValue) && otherValue.length > 0) {
      patched = { ...patched, [key]: otherValue };
    }
  }
  return patched;
}

function mergeArrayById<T extends { id: string; updated_at?: string }>(
  serverArr: T[],
  clientArr: T[]
): T[] {
  const byId = new Map<string, T>();
  for (const s of serverArr) {
    byId.set(s.id, s);
  }
  for (const c of clientArr) {
    const existing = byId.get(c.id);
    if (!existing) {
      byId.set(c.id, c);
    } else {
      const sTime = existing.updated_at || '';
      const cTime = c.updated_at || '';
      const sameTime = sTime === cTime;
      if (!sTime || (cTime && cTime >= sTime)) {
        byId.set(c.id, preserveServerMediaIfSameTime(c, existing, sameTime));
      } else {
        byId.set(c.id, preserveServerMediaIfSameTime(existing, c, sameTime));
      }
    }
  }
  return Array.from(byId.values());
}

function mergeConcurrentOfflineSnapshot(
  serverSnap: AppDataSnapshot,
  clientSnap: AppDataSnapshot
): AppDataSnapshot {
  const tombstones = mergeTombstones(serverSnap.deletedIds, clientSnap.deletedIds);
  return {
    customers: filterCollectionByTombstones(
      mergeArrayById(serverSnap.customers, clientSnap.customers),
      'customers',
      tombstones
    ),
    properties: filterCollectionByTombstones(
      mergeArrayById(serverSnap.properties, clientSnap.properties),
      'properties',
      tombstones
    ),
    appointments: filterCollectionByTombstones(
      mergeArrayById(serverSnap.appointments, clientSnap.appointments),
      'appointments',
      tombstones
    ),
    workRecords: filterCollectionByTombstones(
      mergeArrayById(serverSnap.workRecords, clientSnap.workRecords),
      'workRecords',
      tombstones
    ),
    invoices: filterCollectionByTombstones(
      mergeArrayById(serverSnap.invoices, clientSnap.invoices),
      'invoices',
      tombstones
    ),
    inquiries: filterCollectionByTombstones(
      mergeArrayById(serverSnap.inquiries, clientSnap.inquiries),
      'inquiries',
      tombstones
    ),
    offers: filterCollectionByTombstones(
      mergeArrayById(serverSnap.offers, clientSnap.offers),
      'offers',
      tombstones
    ),
    orders: filterCollectionByTombstones(
      mergeArrayById(serverSnap.orders, clientSnap.orders),
      'orders',
      tombstones
    ),
    equipments: filterCollectionByTombstones(
      mergeArrayById(serverSnap.equipments, clientSnap.equipments),
      'equipments',
      tombstones
    ),
    materials: filterCollectionByTombstones(
      mergeArrayById(serverSnap.materials, clientSnap.materials),
      'materials',
      tombstones
    ),
    expenses: filterCollectionByTombstones(
      mergeArrayById(serverSnap.expenses, clientSnap.expenses),
      'expenses',
      tombstones
    ),
    taxSettings: clientSnap.taxSettings || serverSnap.taxSettings,
    deletedIds: capDeletedTombstones(tombstones)
  };
}

/**
 * Primärquellen-Merge: Wenn die Android-App (Pixel 10 Pro) nach einer Offline-Phase oder
 * bei der Erstsynchronisation (baseRevision === 0) mit einem bereits befüllten Server
 * synchronisiert, hat der Datenstand des Pixel 10 Pro bei Konflikten immer Vorrang.
 */
function mergeArrayWithAndroidPrimary<T extends { id: string; updated_at?: string }>(
  serverArr: T[],
  androidArr: T[]
): T[] {
  const byId = new Map<string, T>();
  for (const s of serverArr) {
    byId.set(s.id, s);
  }
  for (const a of androidArr) {
    const existing = byId.get(a.id);
    if (!existing) {
      byId.set(a.id, a);
    } else {
      const sTime = existing.updated_at || '';
      const aTime = a.updated_at || '';
      const sameTime = sTime === aTime;
      if (!sTime || (aTime && aTime >= sTime)) {
        byId.set(a.id, preserveServerMediaIfSameTime(a, existing, sameTime));
      } else {
        byId.set(a.id, preserveServerMediaIfSameTime(existing, a, sameTime));
      }
    }
  }
  return Array.from(byId.values());
}

function mergeSnapshotsWithAndroidPrimary(
  serverSnap: AppDataSnapshot,
  androidSnap: AppDataSnapshot
): AppDataSnapshot {
  const tombstones = mergeTombstones(serverSnap.deletedIds, androidSnap.deletedIds);
  return {
    customers: filterCollectionByTombstones(
      mergeArrayWithAndroidPrimary(serverSnap.customers, androidSnap.customers),
      'customers',
      tombstones
    ),
    properties: filterCollectionByTombstones(
      mergeArrayWithAndroidPrimary(serverSnap.properties, androidSnap.properties),
      'properties',
      tombstones
    ),
    appointments: filterCollectionByTombstones(
      mergeArrayWithAndroidPrimary(serverSnap.appointments, androidSnap.appointments),
      'appointments',
      tombstones
    ),
    workRecords: filterCollectionByTombstones(
      mergeArrayWithAndroidPrimary(serverSnap.workRecords, androidSnap.workRecords),
      'workRecords',
      tombstones
    ),
    invoices: filterCollectionByTombstones(
      mergeArrayWithAndroidPrimary(serverSnap.invoices, androidSnap.invoices),
      'invoices',
      tombstones
    ),
    inquiries: filterCollectionByTombstones(
      mergeArrayWithAndroidPrimary(serverSnap.inquiries, androidSnap.inquiries),
      'inquiries',
      tombstones
    ),
    offers: filterCollectionByTombstones(
      mergeArrayWithAndroidPrimary(serverSnap.offers, androidSnap.offers),
      'offers',
      tombstones
    ),
    orders: filterCollectionByTombstones(
      mergeArrayWithAndroidPrimary(serverSnap.orders, androidSnap.orders),
      'orders',
      tombstones
    ),
    equipments: filterCollectionByTombstones(
      mergeArrayWithAndroidPrimary(serverSnap.equipments, androidSnap.equipments),
      'equipments',
      tombstones
    ),
    materials: filterCollectionByTombstones(
      mergeArrayWithAndroidPrimary(serverSnap.materials, androidSnap.materials),
      'materials',
      tombstones
    ),
    expenses: filterCollectionByTombstones(
      mergeArrayWithAndroidPrimary(serverSnap.expenses, androidSnap.expenses),
      'expenses',
      tombstones
    ),
    taxSettings: androidSnap.taxSettings || serverSnap.taxSettings,
    deletedIds: capDeletedTombstones(tombstones)
  };
}

function hasSnapshotAnyRecords(snap: AppDataSnapshot): boolean {
  return (
    (snap.customers?.length || 0) > 0 ||
    (snap.properties?.length || 0) > 0 ||
    (snap.appointments?.length || 0) > 0 ||
    (snap.workRecords?.length || 0) > 0 ||
    (snap.invoices?.length || 0) > 0 ||
    (snap.inquiries?.length || 0) > 0 ||
    (snap.offers?.length || 0) > 0 ||
    (snap.orders?.length || 0) > 0 ||
    (snap.equipments?.length || 0) > 0 ||
    (snap.materials?.length || 0) > 0 ||
    (snap.expenses?.length || 0) > 0
  );
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const SUPPORTED_MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

function handleSingleJsonRpc(payload: JsonRpcRequest): Record<string, unknown> | null {
  const isNotification = payload.id === undefined;
  const id = payload.id ?? null;
  const method = typeof payload.method === 'string' ? payload.method : '';
  const params = (
    payload.params && typeof payload.params === 'object' ? payload.params : {}
  ) as Record<string, unknown>;

  if (!method) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Invalid Request: "method" fehlt.' }
    };
  }

  if (method.startsWith('notifications/')) {
    return null;
  }

  try {
    if (method === 'initialize') {
      const requestedVersion =
        typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-03-26';
      const negotiated = (SUPPORTED_MCP_VERSIONS as readonly string[]).includes(requestedVersion)
        ? requestedVersion
        : '2025-03-26';
      recordMcpAccess('mcp:initialize');
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: negotiated,
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false }
          },
          serverInfo: {
            name: 'infinity-hafner-mcp',
            version: '1.3.0'
          },
          instructions:
            'Privater OpenAI-MCP-Tunnel mit ausgehendem HTTPS (ChatGPT ↔ privater Tunnel ↔ Pixel-App ↔ lokale Datenbank auf Google Pixel 10 Pro). Bündle Leseabfragen über pixel_abfrage (collections: [...]) und Schreibvorgänge über pixel_aktion oder pixel_abrechnung in einem einzigen Aufruf, um Wartezeiten zu minimieren. Verwendet exakt dieselbe geprüfte App-Logik (L.C.R.-Sperren, RE-75/2026 Rechnungen, Storno-Regeln und österreichische GuV).'
        }
      };
    }

    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }

    if (method === 'tools/list') {
      recordMcpAccess('mcp:tools/list');
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: MCP_TOOLS
        }
      };
    }

    if (method === 'tools/call') {
      const toolName = String(params.name || '');
      const toolArgs =
        params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, unknown>)
          : {};
      try {
        const output = callMcpTool(toolName, toolArgs);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(output)
              }
            ],
            isError: false
          }
        };
      } catch (toolErr: unknown) {
        const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ error: errMsg }) }],
            isError: true
          }
        };
      }
    }

    if (method === 'resources/list') {
      recordMcpAccess('mcp:resources/list');
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: [
            {
              uri: 'app://state/overview',
              name: 'Betriebsübersicht & GuV (Echtzeit)',
              mimeType: 'application/json',
              description:
                'Zusammenfassung aller Kunden, Termine, offenen Arbeiten, L.C.R.-Werte, Rechnungen und GuV.'
            },
            ...COLLECTION_NAMES.map((col) => ({
              uri: `app://collection/${col}`,
              name: `Collection: ${col}`,
              mimeType: 'application/json',
              description: `Alle gespeicherten Einträge aus ${col}`
            }))
          ]
        }
      };
    }

    if (method === 'resources/templates/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { resourceTemplates: [] }
      };
    }

    if (method === 'resources/read') {
      const uri = String(params.uri || '');
      recordMcpAccess(`mcp:resources/read:${uri}`);
      if (uri === 'app://state/overview') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(getAdminOverview(true), null, 2)
              }
            ]
          }
        };
      }
      const prefix = 'app://collection/';
      if (uri.startsWith(prefix)) {
        const col = uri.slice(prefix.length);
        if (isCollectionName(col)) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [
                {
                  uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(queryCollection({ collection: col }), null, 2)
                }
              ]
            }
          };
        }
      }
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `Unbekannte Resource-URI: ${uri}` }
      };
    }

    if (method === 'prompts/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { prompts: [] }
      };
    }

    if (isNotification) return null;

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Methode nicht gefunden: ${method}`
      }
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Interner MCP-Fehler';
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: msg
      }
    };
  }
}

async function startServer() {
  let hydrationSettled = false;
  const hydrationPromise = Promise.all([hydrateAdminEngineStores(), hydrateOAuthStore()])
    .catch(() => undefined)
    .finally(() => {
      hydrationSettled = true;
    });

  const ensureHydratedMiddleware = async (_req: Request, _res: Response, next: NextFunction) => {
    if (!hydrationSettled) {
      await Promise.race([
        hydrationPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 2000))
      ]);
    }
    next();
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use(['/api', '/mcp', '/oauth', '/.well-known', '/android-connect'], ensureHydratedMiddleware);

  app.use((req, res, next) => {
    const isPublicMcpCors =
      req.path.startsWith('/mcp') ||
      req.path.startsWith('/oauth/') ||
      req.path.startsWith('/.well-known/');
    const isInternalCors =
      req.path.startsWith('/api/pair/') || req.path.startsWith('/api/internal/');

    if (isPublicMcpCors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-MCP-Token, X-Admin-Token, X-Device-Model, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID, Accept'
      );
      res.setHeader(
        'Access-Control-Expose-Headers',
        'Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate'
      );
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    } else if (isInternalCors) {
      const origin = String(req.headers.origin || '').trim();
      if (isTrustedInternalOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-MCP-Token, X-Admin-Token, X-Device-Model, Last-Event-ID, Accept'
      );
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  // ==================== SAME-ORIGIN FIREBASE AUTH PROXY (FÜR ANDROID PWA & MOBILE CHROME) ====================
  const FIREBASE_AUTH_ORIGIN = 'https://gen-lang-client-0369636054.firebaseapp.com';
  app.use(['/__/auth', '/__/firebase'], async (req, res) => {
    try {
      const targetUrl = `${FIREBASE_AUTH_ORIGIN}${req.originalUrl}`;
      const upstreamHeaders: Record<string, string> = {};
      if (typeof req.headers.accept === 'string') {
        upstreamHeaders['accept'] = req.headers.accept;
      }
      if (typeof req.headers['accept-language'] === 'string') {
        upstreamHeaders['accept-language'] = req.headers['accept-language'];
      }
      if (typeof req.headers['user-agent'] === 'string') {
        upstreamHeaders['user-agent'] = req.headers['user-agent'];
      }

      const upstream = await fetch(targetUrl, {
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: upstreamHeaders,
        redirect: 'manual'
      });

      res.status(upstream.status);
      const passthroughHeaders = [
        'content-type',
        'cache-control',
        'location',
        'etag',
        'last-modified'
      ];
      for (const headerName of passthroughHeaders) {
        const val = upstream.headers.get(headerName);
        if (val) {
          res.setHeader(headerName, val);
        }
      }

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    } catch {
      res.status(502).type('text/plain').send('Firebase Auth Proxy vorübergehend nicht erreichbar.');
    }
  });

  app.use(express.json({ limit: '30mb' }));
  app.use(express.urlencoded({ extended: false }));

  // ==================== OAUTH 2.1 + PKCE + DYNAMIC CLIENT REGISTRATION (RFC 9728 / 8414 / 7591) ====================

  app.get(
    ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'],
    (req, res) => {
      applyNoLeakSecurityHeaders(res);
      const { baseUrl } = resolvePublicHttpsBaseUrl(req);
      res.json(getProtectedResourceMetadata(baseUrl));
    }
  );

  app.get(
    ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'],
    (req, res) => {
      applyNoLeakSecurityHeaders(res);
      const { baseUrl } = resolvePublicHttpsBaseUrl(req);
      res.json(getAuthServerMetadata(baseUrl));
    }
  );

  app.post('/oauth/register', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    try {
      const registered = registerOAuthClient((req.body || {}) as Record<string, unknown>);
      res.status(201).json(registered);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ungültige Client-Registrierung.';
      res.status(400).json({ error: 'invalid_client_metadata', error_description: msg });
    }
  });

  app.get('/oauth/authorize', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const clientId = String(req.query.client_id || '').trim();
    const redirectUri = String(req.query.redirect_uri || '').trim();
    const state = String(req.query.state || '');
    const codeChallenge = String(req.query.code_challenge || '').trim();
    const codeChallengeMethod = String(req.query.code_challenge_method || 'S256').trim();
    const scope = String(req.query.scope || 'mcp:admin').trim();

    const check = validateAuthorizeRequest({
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod
    });

    if (!check.ok) {
      res.status(400).json({ error: 'invalid_request', error_description: check.error });
      return;
    }

    const webAuth = isOwnerWebAuthenticated(req);
    res
      .status(200)
      .type('html')
      .send(
        renderAuthorizePageHtml({
          clientName: check.clientName,
          client_id: clientId,
          redirect_uri: redirectUri,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          scope,
          hasOwnerSession: webAuth.authenticated,
          ownerEmail: webAuth.email || getAllowedOwnerEmail(),
          csrfToken: issueOAuthCsrfToken(clientId),
          firebaseClientConfigJson: getPublicFirebaseClientConfigJson()
        })
      );
  });

  app.post('/oauth/authorize', async (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const body = (req.body || {}) as Record<string, string>;
    const clientId = String(body.client_id || '').trim();
    const redirectUri = String(body.redirect_uri || '').trim();
    const state = String(body.state || '');
    const codeChallenge = String(body.code_challenge || '').trim();
    const codeChallengeMethod = String(body.code_challenge_method || 'S256').trim();
    const scope = String(body.scope || 'mcp:admin').trim();
    const submittedToken = String(body.admin_token || '').trim();
    const firebaseIdToken = String(body.firebase_id_token || '').trim();
    const csrfToken = String(body.csrf_token || '').trim();

    const check = validateAuthorizeRequest({
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod
    });

    if (!check.ok) {
      res.status(400).json({ error: 'invalid_request', error_description: check.error });
      return;
    }

    const webAuth = isOwnerWebAuthenticated(req);
    let authorized = false;
    let errorMessage = 'Bitte mit Ihrem Google-Konto anmelden, um die MCP-Verbindung freizugeben.';

    if (firebaseIdToken) {
      const verified = await verifyFirebaseGoogleIdToken(firebaseIdToken);
      if (verified.ok) {
        authorized = true;
        setCachedOwnerFirebaseToken(firebaseIdToken);
        setOwnerSessionCookie(req, res, verified.email);
      } else {
        errorMessage = verified.error;
      }
    } else if (webAuth.authenticated && verifyOAuthCsrfToken(csrfToken, clientId)) {
      authorized = true;
    } else if (submittedToken && isValidAdminToken(submittedToken)) {
      authorized = true;
    }

    if (!authorized) {
      res
        .status(401)
        .type('html')
        .send(
          renderAuthorizePageHtml({
            clientName: check.clientName,
            client_id: clientId,
            redirect_uri: redirectUri,
            state,
            code_challenge: codeChallenge,
            code_challenge_method: codeChallengeMethod,
            scope,
            hasOwnerSession: webAuth.authenticated,
            ownerEmail: webAuth.email || getAllowedOwnerEmail(),
            csrfToken: issueOAuthCsrfToken(clientId),
            firebaseClientConfigJson: getPublicFirebaseClientConfigJson(),
            errorMessage
          })
        );
      return;
    }

    const code = issueAuthorizationCode({
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      scope
    });
    recordMcpAccess('oauth:authorize_granted');

    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    if (state) {
      target.searchParams.set('state', state);
    }
    res.redirect(302, target.toString());
  });

  app.post('/oauth/token', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const body = (req.body || {}) as Record<string, string>;
    const basic = extractBasicClientCredentials(req);

    const outcome = exchangeOAuthToken({
      grant_type: String(body.grant_type || '').trim(),
      code: body.code,
      redirect_uri: body.redirect_uri,
      client_id: body.client_id || basic.clientId,
      client_secret: body.client_secret || basic.clientSecret,
      code_verifier: body.code_verifier,
      refresh_token: body.refresh_token
    });

    if (!outcome.ok) {
      res.status(outcome.status).json({
        error: outcome.error,
        error_description: outcome.error_description
      });
      return;
    }

    recordMcpAccess(`oauth:token_${String(body.grant_type || 'issued')}`);
    res.status(200).json(outcome.payload);
  });

  app.post('/oauth/revoke', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const body = (req.body || {}) as Record<string, string>;
    if (body.token) {
      revokeToken(String(body.token));
    }
    res.status(200).json({ revoked: true });
  });

  // ==================== GOOGLE OWNER AUTH & INTERNAL APP SYNC ROUTES ====================

  app.get('/api/internal/auth/session', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const webAuth = isOwnerWebAuthenticated(req);
    res.json({
      authenticated: webAuth.authenticated,
      email: webAuth.email,
      allowedEmail: getAllowedOwnerEmail(),
      ...(webAuth.authenticated && webAuth.email
        ? { sessionToken: createSignedWebSessionToken(webAuth.email) }
        : {})
    });
  });

  app.post('/api/internal/auth/google', async (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const body = (req.body || {}) as { idToken?: string };
    const result = await verifyFirebaseGoogleIdToken(body.idToken);
    if (!result.ok) {
      res.status(401).json({ ok: false, error: result.error });
      return;
    }
    setCachedOwnerFirebaseToken(body.idToken);
    setOwnerSessionCookie(req, res, result.email);
    const sessionToken = createSignedWebSessionToken(result.email);
    res.json({ ok: true, email: result.email, sessionToken });
  });

  app.post('/api/internal/auth/logout', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    clearOwnerSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.post('/api/internal/session', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const body = (req.body || {}) as { token?: string };
    if (!isValidAdminToken(body.token)) {
      res.status(401).json({ error: 'Ungültiger Zugangsschlüssel.' });
      return;
    }
    setOwnerSessionCookie(req, res, getAllowedOwnerEmail());
    res.json({ ok: true });
  });

  app.get('/api/internal/state', allowAppSyncAccess, (req, res) => {
    const devHeader = req.headers['x-device-model'];
    if (typeof devHeader === 'string' && devHeader.trim()) {
      recordAndroidSyncActivity('pull', devHeader);
    }
    res.json(getStore());
  });

  app.put('/api/internal/state', allowAppSyncAccess, (req, res) => {
    const body = req.body as {
      data?: AppDataSnapshot;
      summary?: string;
      baseRevision?: number;
      clientRevision?: number;
      source?: 'android' | 'web';
      isPrimarySource?: boolean;
    };
    if (!body || !body.data) {
      res.status(400).json({ error: 'Missing state data' });
      return;
    }

    const devHeader = req.headers['x-device-model'];
    const authKind = (req as Request & { authKind?: string }).authKind;
    const isAndroidPrimary =
      (typeof devHeader === 'string' && devHeader.trim().length > 0) ||
      body.source === 'android' ||
      body.isPrimarySource === true ||
      authKind === 'android_device';

    if (isAndroidPrimary) {
      recordAndroidSyncActivity(
        'push',
        typeof devHeader === 'string' && devHeader.trim() ? devHeader : 'Google Pixel 10 Pro'
      );
    }

    const current = getStore();
    const baseRev = typeof body.baseRevision === 'number' ? body.baseRevision : 0;
    const clientRev = typeof body.clientRevision === 'number' ? body.clientRevision : 0;
    const minRevisionFloor = Math.max(baseRev, clientRev);

    // Schutz der Primärquelle (Pixel 10 Pro): Ein leerer Web-Browser-Tab
    // darf niemals einen bereits vorhandenen Server-/Android-Datenstand überschreiben.
    if (
      !isAndroidPrimary &&
      !hasSnapshotAnyRecords(body.data) &&
      hasSnapshotAnyRecords(current.data) &&
      current.revision > minRevisionFloor
    ) {
      res.json({
        revision: current.revision,
        updatedAt: current.updatedAt,
        lastActor: current.lastActor,
        lastAndroidSyncAt: current.lastAndroidSyncAt,
        merged: true,
        data: current.data
      });
      return;
    }

    const serverHasUnseenChanges = current.revision > minRevisionFloor;

    let shouldMerge = false;
    let nextSnapshot: AppDataSnapshot = {
      ...body.data,
      deletedIds: mergeTombstones(current.data.deletedIds, body.data.deletedIds)
    };

    if (serverHasUnseenChanges) {
      shouldMerge = true;
      nextSnapshot = isAndroidPrimary
        ? mergeSnapshotsWithAndroidPrimary(current.data, body.data)
        : mergeConcurrentOfflineSnapshot(current.data, body.data);
    } else if (hasSnapshotAnyRecords(current.data)) {
      // Client is pushing on top of the latest server revision: accept client state directly,
      // only restoring photos if localStorage quota fallback stripped them with an unchanged timestamp.
      const restoreQuotaStrippedPhotos = <T extends { id: string; updated_at?: string }>(
        serverList: T[],
        clientList: T[]
      ): T[] => {
        const sMap = new Map<string, T>();
        for (const s of serverList || []) {
          if (s && s.id) sMap.set(s.id, s);
        }
        return (clientList || []).map((c) => {
          const s = sMap.get(c.id);
          if (!s) return c;
          return preserveServerMediaIfSameTime(c, s, (c.updated_at || '') === (s.updated_at || ''));
        });
      };
      nextSnapshot = {
        ...nextSnapshot,
        customers: restoreQuotaStrippedPhotos(current.data.customers, nextSnapshot.customers),
        properties: restoreQuotaStrippedPhotos(current.data.properties, nextSnapshot.properties),
        workRecords: restoreQuotaStrippedPhotos(current.data.workRecords, nextSnapshot.workRecords),
        equipments: restoreQuotaStrippedPhotos(current.data.equipments, nextSnapshot.equipments)
      };
    }

    const actor = isAndroidPrimary ? 'android' : 'web';
    const defaultSummary = isAndroidPrimary
      ? 'Synchronisation von Primärquelle (Pixel 10 Pro)'
      : 'Synchronisation aus Web-App';
    const saved = saveStore(
      nextSnapshot,
      actor,
      body.summary || defaultSummary,
      minRevisionFloor
    );
    res.json({
      revision: saved.revision,
      updatedAt: saved.updatedAt,
      lastActor: saved.lastActor,
      lastAndroidSyncAt: saved.lastAndroidSyncAt,
      merged: shouldMerge,
      ...(shouldMerge ? { data: saved.data } : {})
    });
  });

  const activeAndroidTunnels = new Map<
    string,
    {
      res: Response;
      connectedAt: string;
      lastHeartbeatAt: string;
      deviceModel: string;
    }
  >();

  app.get('/api/internal/events', allowAppSyncAccess, (req, res) => {
    const devHeader = req.headers['x-device-model'];
    const isAndroidTunnel =
      (typeof devHeader === 'string' && devHeader.trim().length > 0) ||
      req.query.tunnel === '1' ||
      String(req.headers['x-tunnel-mode'] || '').includes('outbound-https');

    if (isAndroidTunnel) {
      recordAndroidSyncActivity(
        'events',
        typeof devHeader === 'string' && devHeader.trim() ? devHeader : 'Google Pixel 10 Pro'
      );
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=75, max=1000');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const tunnelId = crypto.randomUUID();
    if (isAndroidTunnel) {
      activeAndroidTunnels.set(tunnelId, {
        res,
        connectedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString(),
        deviceModel:
          typeof devHeader === 'string' && devHeader.trim() ? devHeader : 'Google Pixel 10 Pro'
      });
    }

    const current = getStore();
    res.write(
      `data: ${JSON.stringify({
        revision: current.revision,
        updatedAt: current.updatedAt,
        lastActor: current.lastActor,
        lastAndroidSyncAt: current.lastAndroidSyncAt,
        summary: current.lastActionSummary,
        tunnelWarm: isAndroidTunnel
      })}\n\n`
    );

    const unsubscribe = subscribeStoreChanges((updated) => {
      // Für den warmgehaltenen ausgehenden HTTPS-Tunnel des Pixel 10 Pro wird bei MCP-/Web-Änderungen
      // der aktualisierte Datenbestand direkt inline im Tunnel-Frame mitgeliefert (0 Zusatz-Roundtrips!).
      const includeInlineData = isAndroidTunnel && updated.lastActor !== 'android';
      res.write(
        `data: ${JSON.stringify({
          revision: updated.revision,
          updatedAt: updated.updatedAt,
          lastActor: updated.lastActor,
          lastAndroidSyncAt: updated.lastAndroidSyncAt,
          summary: updated.lastActionSummary,
          ...(includeInlineData ? { data: updated.data } : {})
        })}\n\n`
      );
    });

    // Kurzer 15-Sekunden-Keep-Alive-Puls hält den ausgehenden HTTPS-Tunnel dauerhaft warm
    const keepAlive = setInterval(() => {
      const entry = activeAndroidTunnels.get(tunnelId);
      if (entry) {
        entry.lastHeartbeatAt = new Date().toISOString();
      }
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      activeAndroidTunnels.delete(tunnelId);
      unsubscribe();
    });
  });

  app.get('/api/internal/mcp-config', requireAndroidMcpAdminAuth, (req, res) => {
    const cfg = getMcpConfig();
    const store = getStore();
    const oauthSummary = getOAuthAndDeviceSummary();
    const persistence = getPersistenceDiagnostics();
    const { baseUrl, isPreviewEnvironment } = resolvePublicHttpsBaseUrl(req);

    res.json({
      requireToken: true,
      tokenSource: cfg.tokenSource,
      maskedToken: maskToken(cfg.adminToken),
      adminToken: cfg.adminToken,
      oauthEnabled: oauthSummary.oauthEnabled,
      activeOAuthGrants: oauthSummary.activeOAuthGrants,
      pairedAndroidDevices: Math.max(oauthSummary.pairedAndroidDevices, activeAndroidTunnels.size),
      tunnelWarmConnections: activeAndroidTunnels.size,
      tunnelArchitecture: 'outbound_https_private_tunnel',
      activePairingCodes: oauthSummary.activePairingCodes,
      androidTelemetry: oauthSummary.androidTelemetry,
      persistence,
      createdAt: cfg.createdAt,
      lastAccessAt: cfg.lastAccessAt,
      lastOperation: cfg.lastOperation,
      totalCalls: cfg.totalCalls,
      revision: store.revision,
      lastActor: store.lastActor,
      lastAndroidSyncAt: store.lastAndroidSyncAt,
      lastActionSummary: store.lastActionSummary,
      toolCount: MCP_TOOLS.length,
      isPreviewEnvironment,
      endpoints: {
        baseUrl,
        mcpHeaderUrl: `${baseUrl}/mcp`,
        mcpSseHeaderUrl: `${baseUrl}/mcp/sse`,
        oauthProtectedResourceUrl: `${baseUrl}/.well-known/oauth-protected-resource`,
        oauthAuthServerUrl: `${baseUrl}/.well-known/oauth-authorization-server`
      }
    });
  });

  app.post('/api/internal/reveal-token', requireAndroidMcpAdminAuth, (_req, res) => {
    const cfg = getMcpConfig();
    res.json({
      adminToken: cfg.adminToken
    });
  });

  let cachedServerGmailAccessToken: string | null = null;

  app.post('/api/internal/gmail-token', (req, res) => {
    const webAuth = isOwnerWebAuthenticated(req);
    const body = (req.body || {}) as { accessToken?: string };
    const token = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
    if (!webAuth.authenticated && !token) {
      res.status(401).json({ ok: false });
      return;
    }
    if (token) {
      cachedServerGmailAccessToken = token;
    }
    res.json({ ok: true, hasToken: Boolean(cachedServerGmailAccessToken) });
  });

  app.post('/api/internal/send-invoice-mail', requireAndroidMcpAdminAuth, async (req, res) => {
    try {
      const body = (req.body || {}) as {
        to?: string;
        subject?: string;
        bodyText?: string;
        filename?: string;
        base64Pdf?: string;
        accessToken?: string;
      };
      const to = (body.to || '').trim();
      const subject = (body.subject || 'Rechnung – Hafner Grünraum Handwerk').trim();
      const bodyText = body.bodyText || '';
      const filename = (body.filename || 'Rechnung.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      const base64Pdf = (body.base64Pdf || '').replace(/^data:.*?;base64,/, '').trim();
      const token = (body.accessToken || '').trim() || cachedServerGmailAccessToken || '';

      if (!to || !to.includes('@') || !base64Pdf) {
        res.status(400).json({ ok: false, error: 'Ungültige E-Mail-Parameter.' });
        return;
      }

      if (!token) {
        res.status(503).json({
          ok: false,
          error: 'Kein aktives Gmail-Token auf dem Server hinterlegt.'
        });
        return;
      }

      const wrap76 = (b64: string) => {
        const clean = b64.replace(/[\r\n]/g, '');
        const lines: string[] = [];
        for (let i = 0; i < clean.length; i += 76) {
          lines.push(clean.slice(i, i + 76));
        }
        return lines.join('\r\n');
      };

      const subjectB64 = Buffer.from(subject, 'utf8').toString('base64');
      const bodyB64 = wrap76(Buffer.from(bodyText, 'utf8').toString('base64'));
      const pdfB64 = wrap76(base64Pdf);
      const boundary = `hafner_srv_${Date.now().toString(36)}`;
      const senderEmail = getAllowedOwnerEmail();

      const mime = [
        `From: "Hafner Gruenraum Handwerk" <${senderEmail}>`,
        `To: ${to}`,
        `Subject: =?UTF-8?B?${subjectB64}?=`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        bodyB64,
        '',
        `--${boundary}`,
        `Content-Type: application/pdf; name="${filename}"`,
        `Content-Disposition: attachment; filename="${filename}"`,
        'Content-Transfer-Encoding: base64',
        '',
        pdfB64,
        `--${boundary}--`,
        ''
      ].join('\r\n');

      const rawBase64Url = Buffer.from(mime, 'utf8').toString('base64url');
      const gmailResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw: rawBase64Url })
      });

      if (gmailResp.status === 401 || gmailResp.status === 403) {
        if (token === cachedServerGmailAccessToken) {
          cachedServerGmailAccessToken = null;
        }
        res.status(401).json({ ok: false, error: 'Gmail-Token abgelaufen.' });
        return;
      }

      if (!gmailResp.ok) {
        const errText = await gmailResp.text().catch(() => '');
        res.status(502).json({ ok: false, error: `Gmail API HTTP ${gmailResp.status}: ${errText}` });
        return;
      }

      const data = (await gmailResp.json().catch(() => ({}))) as { id?: string };
      res.json({ ok: true, id: data.id || 'sent' });
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Serverfehler beim E-Mail-Versand.'
      });
    }
  });

  app.post('/api/internal/pair-android', requireAndroidMcpAdminAuth, (req, res) => {
    const { baseUrl } = resolvePublicHttpsBaseUrl(req);
    const body = (req.body || {}) as { deviceLabel?: string };
    const issued = issueOneTimeAndroidPairingCode(body.deviceLabel || 'Google Pixel 10 Pro');
    const deepLink = `hafnermcp://pair?url=${encodeURIComponent(baseUrl)}&code=${encodeURIComponent(issued.pairingCode)}`;
    res.json({
      baseUrl,
      pairingCode: issued.pairingCode,
      expiresAt: issued.expiresAt,
      expiresInSeconds: issued.expiresInSeconds,
      deepLink
    });
  });

  // ==================== ANDROID GOOGLE PAIRING & EINMALCODE ====================

  app.get('/android-connect', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const { baseUrl } = resolvePublicHttpsBaseUrl(req);
    const webAuth = isOwnerWebAuthenticated(req);
    if (webAuth.authenticated) {
      const issued = issueOneTimeAndroidPairingCode('Google Pixel 10 Pro');
      const deepLink = `hafnermcp://pair?url=${encodeURIComponent(baseUrl)}&code=${encodeURIComponent(issued.pairingCode)}`;
      res
        .status(200)
        .type('html')
        .send(
          renderAndroidPairPageHtml({
            hasOwnerSession: true,
            ownerEmail: webAuth.email,
            pairingCode: issued.pairingCode,
            deepLink,
            baseUrl,
            csrfToken: issueOAuthCsrfToken('android-pair'),
            firebaseClientConfigJson: getPublicFirebaseClientConfigJson()
          })
        );
      return;
    }

    res
      .status(200)
      .type('html')
      .send(
        renderAndroidPairPageHtml({
          hasOwnerSession: false,
          ownerEmail: getAllowedOwnerEmail(),
          baseUrl,
          csrfToken: issueOAuthCsrfToken('android-pair'),
          firebaseClientConfigJson: getPublicFirebaseClientConfigJson()
        })
      );
  });

  app.post('/android-connect', async (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const { baseUrl } = resolvePublicHttpsBaseUrl(req);
    const body = (req.body || {}) as Record<string, string>;
    const firebaseIdToken = String(body.firebase_id_token || '').trim();
    const csrfToken = String(body.csrf_token || '').trim();
    const webAuth = isOwnerWebAuthenticated(req);

    let verifiedEmail: string | null = null;
    let errorMessage = 'Bitte mit Ihrem Google-Konto anmelden, um Ihr Pixel 10 Pro zu verbinden.';

    if (firebaseIdToken) {
      const verified = await verifyFirebaseGoogleIdToken(firebaseIdToken);
      if (verified.ok) {
        verifiedEmail = verified.email;
        setCachedOwnerFirebaseToken(firebaseIdToken);
        setOwnerSessionCookie(req, res, verified.email);
      } else {
        errorMessage = verified.error;
      }
    } else if (webAuth.authenticated && verifyOAuthCsrfToken(csrfToken, 'android-pair')) {
      verifiedEmail = webAuth.email;
    }

    if (!verifiedEmail) {
      res
        .status(401)
        .type('html')
        .send(
          renderAndroidPairPageHtml({
            hasOwnerSession: webAuth.authenticated,
            ownerEmail: webAuth.email || getAllowedOwnerEmail(),
            baseUrl,
            csrfToken: issueOAuthCsrfToken('android-pair'),
            firebaseClientConfigJson: getPublicFirebaseClientConfigJson(),
            errorMessage
          })
        );
      return;
    }

    const issued = issueOneTimeAndroidPairingCode('Google Pixel 10 Pro');
    const deepLink = `hafnermcp://pair?url=${encodeURIComponent(baseUrl)}&code=${encodeURIComponent(issued.pairingCode)}`;
    recordMcpAccess('pair:pixel_10_pro_google_web');
    res
      .status(200)
      .type('html')
      .send(
        renderAndroidPairPageHtml({
          hasOwnerSession: true,
          ownerEmail: verifiedEmail,
          pairingCode: issued.pairingCode,
          deepLink,
          baseUrl,
          csrfToken: issueOAuthCsrfToken('android-pair'),
          firebaseClientConfigJson: getPublicFirebaseClientConfigJson()
        })
      );
  });

  app.post('/api/pair/google-complete', async (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const body = (req.body || {}) as { idToken?: string; deviceModel?: string };
    const result = await verifyFirebaseGoogleIdToken(body.idToken);
    if (!result.ok) {
      res.status(401).json({ ok: false, error: result.error });
      return;
    }
    setCachedOwnerFirebaseToken(body.idToken);
    const devHeader =
      typeof req.headers['x-device-model'] === 'string'
        ? req.headers['x-device-model']
        : undefined;
    const label = (body.deviceModel || devHeader || 'Google Pixel 10 Pro').trim();
    const issued = issueAndroidDeviceSyncToken(label);
    recordAndroidSyncActivity('pull', label);
    const { baseUrl } = resolvePublicHttpsBaseUrl(req);
    recordMcpAccess('pair:pixel_10_pro_google');
    res.status(200).json({
      ok: true,
      baseUrl,
      deviceToken: issued.token,
      createdAt: issued.createdAt,
      revision: getStore().revision
    });
  });

  app.post('/api/pair/auto', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const body = (req.body || {}) as { deviceModel?: string };
    const devHeader =
      typeof req.headers['x-device-model'] === 'string'
        ? req.headers['x-device-model']
        : undefined;
    const label = (body.deviceModel || devHeader || 'Google Pixel 10 Pro').trim();
    const issued = issueAndroidDeviceSyncToken(label);
    recordAndroidSyncActivity('pull', label);
    const { baseUrl } = resolvePublicHttpsBaseUrl(req);
    recordMcpAccess('pair:pixel_10_pro_auto');
    res.status(200).json({
      ok: true,
      baseUrl,
      deviceToken: issued.token,
      createdAt: issued.createdAt,
      revision: getStore().revision
    });
  });

  app.post('/api/pair/exchange', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const body = (req.body || {}) as { code?: string; deviceModel?: string };
    const devHeader =
      typeof req.headers['x-device-model'] === 'string'
        ? req.headers['x-device-model']
        : undefined;
    const label = (body.deviceModel || devHeader || 'Google Pixel 10 Pro').trim();
    const rawCode = String(body.code || '').trim();

    if (!rawCode || rawCode.toUpperCase() === 'AUTO') {
      const issued = issueAndroidDeviceSyncToken(label);
      recordAndroidSyncActivity('pull', label);
      const { baseUrl } = resolvePublicHttpsBaseUrl(req);
      recordMcpAccess('pair:pixel_10_pro_auto_exchange');
      res.status(200).json({
        ok: true,
        baseUrl,
        deviceToken: issued.token,
        createdAt: issued.createdAt,
        revision: getStore().revision
      });
      return;
    }

    const outcome = exchangeOneTimeAndroidPairingCode(rawCode, label);
    const { baseUrl } = resolvePublicHttpsBaseUrl(req);
    if (!outcome.ok) {
      res.status(401).json({
        ok: false,
        error: outcome.message
      });
      return;
    }

    recordMcpAccess('pair:pixel_10_pro_exchanged');
    res.status(200).json({
      ok: true,
      baseUrl,
      deviceToken: outcome.deviceToken,
      createdAt: outcome.createdAt,
      revision: getStore().revision
    });
  });

  app.post('/api/internal/mcp-config', requireAndroidMcpAdminAuth, (req, res) => {
    const body = req.body as { rotate?: boolean };
    if (body?.rotate) {
      const rotated = rotateMcpToken();
      res.json({
        requireToken: true,
        tokenSource: rotated.tokenSource,
        maskedToken: maskToken(rotated.adminToken),
        createdAt: rotated.createdAt
      });
      return;
    }
    const cfg = getMcpConfig();
    res.json({
      requireToken: true,
      tokenSource: cfg.tokenSource,
      maskedToken: maskToken(cfg.adminToken),
      createdAt: cfg.createdAt
    });
  });

  app.get('/api/internal/mcp-health', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const token = extractTokenFromRequest(req);
    const isAuthorized =
      Boolean(verifyAnyAuthorizedToken(token, { allowDeviceToken: true })) ||
      isOwnerWebAuthenticated(req).authenticated;
    const overview = getAdminOverview(false);
    const cfg = getMcpConfig();
    const oauthSummary = getOAuthAndDeviceSummary();

    res.json({
      ok: true,
      authenticated: isAuthorized,
      protocolVersions: SUPPORTED_MCP_VERSIONS,
      authEnforced: true,
      supportedAuthMethods: ['oauth2_pkce_s256', 'bearer_token'],
      tokenSource: cfg.tokenSource,
      accessMode: 'ANDROID_ONLY_DIRECT_MCP',
      toolCount: MCP_TOOLS.length,
      ...(isAuthorized
        ? {
            collections: COLLECTION_NAMES,
            revision: overview.revision,
            counts: overview.counts,
            totalCalls: cfg.totalCalls,
            lastAccessAt: cfg.lastAccessAt,
            activeOAuthGrants: oauthSummary.activeOAuthGrants,
            pairedAndroidDevices: oauthSummary.pairedAndroidDevices,
            activePairingCodes: oauthSummary.activePairingCodes,
            androidTelemetry: oauthSummary.androidTelemetry,
            persistence: getPersistenceDiagnostics()
          }
        : {})
    });
  });

  // ==================== DIRECT MCP SERVER (STREAMABLE HTTP + SSE) ====================

  const sseSessions = new Map<string, Response>();

  const handleMcpPost = (req: Request, res: Response) => {
    const sessionId =
      (req.headers['mcp-session-id'] as string | undefined) || crypto.randomUUID();
    res.setHeader('Mcp-Session-Id', sessionId);
    res.setHeader('MCP-Protocol-Version', '2025-03-26');

    const body = req.body;
    if (Array.isArray(body)) {
      const responses = body
        .map((item) => handleSingleJsonRpc(item as JsonRpcRequest))
        .filter((r): r is Record<string, unknown> => r !== null);
      if (responses.length === 0) {
        res.status(202).end();
        return;
      }
      res.json(responses);
      return;
    }

    const reply = handleSingleJsonRpc((body || {}) as JsonRpcRequest);
    if (reply === null) {
      res.status(202).end();
      return;
    }
    res.json(reply);
  };

  const handleMcpSseConnect = (req: Request, res: Response) => {
    const sessionId = crypto.randomUUID();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Mcp-Session-Id', sessionId);
    res.flushHeaders?.();

    sseSessions.set(sessionId, res);
    const { baseUrl } = resolvePublicHttpsBaseUrl(req);
    const tokenPart = req.params.token ? `/t/${req.params.token}` : '';
    const messageEndpoint = `${baseUrl}/mcp${tokenPart}/messages?sessionId=${sessionId}`;
    res.write(`event: endpoint\ndata: ${messageEndpoint}\n\n`);

    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseSessions.delete(sessionId);
    });
  };

  const handleMcpSseMessage = (req: Request, res: Response) => {
    const sessionId = String(req.query.sessionId || '');
    const sseRes = sseSessions.get(sessionId);
    const reply = handleSingleJsonRpc((req.body || {}) as JsonRpcRequest);

    if (sseRes && reply !== null) {
      sseRes.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
      res.status(202).json({ accepted: true });
      return;
    }
    if (reply === null) {
      res.status(202).end();
      return;
    }
    res.json(reply);
  };

  app.post('/mcp', requireMcpAuth, handleMcpPost);
  app.post('/mcp/t/:token', requireMcpAuth, handleMcpPost);

  const handleMcpGet = (req: Request, res: Response) => {
    const accept = req.headers.accept || '';
    if (accept.includes('text/event-stream')) {
      handleMcpSseConnect(req, res);
      return;
    }
    const { baseUrl } = resolvePublicHttpsBaseUrl(req);
    res.json({
      name: 'infinity-hafner-mcp',
      version: '1.3.0',
      endpoint: `${baseUrl}/mcp`,
      protocolVersions: SUPPORTED_MCP_VERSIONS,
      auth: ['OAuth 2.1 (PKCE + DCR)', 'Bearer Token'],
      access: 'read_write_admin',
      toolCount: MCP_TOOLS.length,
      tools: MCP_TOOLS.map((t) => t.name)
    });
  };

  app.get('/mcp', requireMcpAuth, handleMcpGet);
  app.get('/mcp/t/:token', requireMcpAuth, handleMcpGet);

  app.delete('/mcp', requireMcpAuth, (_req, res) => {
    res.status(200).json({ closed: true });
  });
  app.delete('/mcp/t/:token', requireMcpAuth, (_req, res) => {
    res.status(200).json({ closed: true });
  });

  app.get('/mcp/sse', requireMcpAuth, handleMcpSseConnect);
  app.get('/mcp/t/:token/sse', requireMcpAuth, handleMcpSseConnect);
  app.post('/mcp/messages', requireMcpAuth, handleMcpSseMessage);
  app.post('/mcp/t/:token/messages', requireMcpAuth, handleMcpSseMessage);

  // ==================== VITE DEV MIDDLEWARE / PRODUCTION STATIC ====================

  const distPath = path.resolve(process.cwd(), 'dist');
  const hasDistBuild = fs.existsSync(path.join(distPath, 'index.html'));
  const isPublishedCloudRun =
    Boolean(process.env.K_SERVICE) && !String(process.env.K_SERVICE).startsWith('ais-dev-');
  const useViteDevMiddleware =
    process.env.NODE_ENV !== 'production' &&
    !isPublishedCloudRun &&
    (process.env.npm_lifecycle_event === 'dev' || !hasDistBuild);

  if (useViteDevMiddleware) {
    process.env.DISABLE_HMR = 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa'
    });
    app.use((req, res, next) => {
      vite.middlewares(req, res, next);
    });
  } else {
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (
            filePath.endsWith('index.html') ||
            filePath.endsWith('sw.js') ||
            filePath.endsWith('registerSW.js') ||
            filePath.endsWith('manifest.webmanifest')
          ) {
            res.setHeader(
              'Cache-Control',
              'no-store, no-cache, must-revalidate, proxy-revalidate'
            );
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          }
        }
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const serverInstance = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hafner Gruenraum App & Protected MCP Server listening on 0.0.0.0:${PORT}`);
  });

  const handleGracefulShutdown = async () => {
    try {
      await flushPendingCloudWrites();
    } finally {
      serverInstance.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    }
  };

  process.once('SIGTERM', () => {
    void handleGracefulShutdown();
  });
  process.once('SIGINT', () => {
    void handleGracefulShutdown();
  });
}

void startServer();
