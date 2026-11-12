import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  flushPendingCloudWrites,
  getPersistenceDiagnostics
} from './src/server/cloudPersistence.ts';
import {
  COLLECTION_NAMES,
  MCP_TOOLS,
  callMcpTool,
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
  createSignedWebSessionCookie,
  exchangeOAuthToken,
  exchangeOneTimeAndroidPairingCode,
  getAuthServerMetadata,
  getOAuthAndDeviceSummary,
  getProtectedResourceMetadata,
  hydrateOAuthStore,
  issueAndroidDeviceSyncToken,
  issueAuthorizationCode,
  issueOneTimeAndroidPairingCode,
  recordAndroidSyncActivity,
  registerOAuthClient,
  renderAuthorizePageHtml,
  revokeToken,
  validateAuthorizeRequest,
  verifyAnyAuthorizedToken,
  verifySignedWebSessionCookie
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

function setOwnerSessionCookie(req: Request, res: Response): void {
  const signed = createSignedWebSessionCookie();
  const host = req.get('host') || '';
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

function isTrustedOwnerBrowserContext(req: Request): boolean {
  if (verifySignedWebSessionCookie(req.headers.cookie)) {
    return true;
  }
  const { isPreviewEnvironment } = resolvePublicHttpsBaseUrl(req);
  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)
    ?.split(',')[0]
    ?.trim();
  const effectiveHost = forwardedHost || req.get('host') || '';
  const secFetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  const secFetchMode = String(req.headers['sec-fetch-mode'] || '').toLowerCase();
  const origin = String(req.headers.origin || '').toLowerCase();
  const devHeader = String(req.headers['x-device-model'] || '').trim();

  // Native Pixel 10 Pro Android App WebView or Sync Manager
  if (origin.includes('appassets.androidplatform.net') || devHeader.length > 0) {
    return true;
  }

  // Same-origin Web App browser access (Preview, Published Cloud Run Web App, or localhost)
  if (
    secFetchSite === 'same-origin' ||
    secFetchSite === 'same-site' ||
    secFetchSite === 'none' ||
    (req.method === 'GET' && secFetchMode === 'navigate') ||
    isPreviewEnvironment ||
    isLocalHostname(effectiveHost)
  ) {
    return true;
  }
  return false;
}

function requireMcpAuth(req: Request, res: Response, next: NextFunction): void {
  applyNoLeakSecurityHeaders(res);
  const token = extractTokenFromRequest(req);
  const verified = verifyAnyAuthorizedToken(token, { allowDeviceToken: true });
  if (!verified) {
    const { baseUrl } = resolvePublicHttpsBaseUrl(req);
    res.setHeader(
      'WWW-Authenticate',
      `Bearer realm="hafner-gruenraum-mcp", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
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

function requireInternalSyncAuth(req: Request, res: Response, next: NextFunction): void {
  applyNoLeakSecurityHeaders(res);
  const token = extractTokenFromRequest(req);
  const verified = verifyAnyAuthorizedToken(token, { allowDeviceToken: true });
  if (verified) {
    (req as Request & { authKind?: string }).authKind = verified;
    next();
    return;
  }
  if (isTrustedOwnerBrowserContext(req)) {
    setOwnerSessionCookie(req, res);
    (req as Request & { authKind?: string }).authKind = 'web_owner_session';
    next();
    return;
  }
  res.status(401).json({
    error: 'Unauthorized: Gültiger Geräteschlüssel oder MCP-Zugangsschlüssel erforderlich.'
  });
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
      if (!sTime || (cTime && cTime >= sTime)) {
        byId.set(c.id, c);
      }
    }
  }
  return Array.from(byId.values());
}

function mergeConcurrentOfflineSnapshot(
  serverSnap: AppDataSnapshot,
  clientSnap: AppDataSnapshot
): AppDataSnapshot {
  return {
    customers: mergeArrayById(serverSnap.customers, clientSnap.customers),
    properties: mergeArrayById(serverSnap.properties, clientSnap.properties),
    appointments: mergeArrayById(serverSnap.appointments, clientSnap.appointments),
    workRecords: mergeArrayById(serverSnap.workRecords, clientSnap.workRecords),
    invoices: mergeArrayById(serverSnap.invoices, clientSnap.invoices),
    inquiries: mergeArrayById(serverSnap.inquiries, clientSnap.inquiries),
    offers: mergeArrayById(serverSnap.offers, clientSnap.offers),
    orders: mergeArrayById(serverSnap.orders, clientSnap.orders),
    equipments: mergeArrayById(serverSnap.equipments, clientSnap.equipments),
    materials: mergeArrayById(serverSnap.materials, clientSnap.materials),
    expenses: mergeArrayById(serverSnap.expenses, clientSnap.expenses),
    taxSettings: clientSnap.taxSettings || serverSnap.taxSettings
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
    byId.set(a.id, a);
  }
  return Array.from(byId.values());
}

function mergeSnapshotsWithAndroidPrimary(
  serverSnap: AppDataSnapshot,
  androidSnap: AppDataSnapshot
): AppDataSnapshot {
  return {
    customers: mergeArrayWithAndroidPrimary(serverSnap.customers, androidSnap.customers),
    properties: mergeArrayWithAndroidPrimary(serverSnap.properties, androidSnap.properties),
    appointments: mergeArrayWithAndroidPrimary(serverSnap.appointments, androidSnap.appointments),
    workRecords: mergeArrayWithAndroidPrimary(serverSnap.workRecords, androidSnap.workRecords),
    invoices: mergeArrayWithAndroidPrimary(serverSnap.invoices, androidSnap.invoices),
    inquiries: mergeArrayWithAndroidPrimary(serverSnap.inquiries, androidSnap.inquiries),
    offers: mergeArrayWithAndroidPrimary(serverSnap.offers, androidSnap.offers),
    orders: mergeArrayWithAndroidPrimary(serverSnap.orders, androidSnap.orders),
    equipments: mergeArrayWithAndroidPrimary(serverSnap.equipments, androidSnap.equipments),
    materials: mergeArrayWithAndroidPrimary(serverSnap.materials, androidSnap.materials),
    expenses: mergeArrayWithAndroidPrimary(serverSnap.expenses, androidSnap.expenses),
    taxSettings: androidSnap.taxSettings || serverSnap.taxSettings
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
            name: 'hafner-gruenraum-mcp',
            version: '1.2.0'
          },
          instructions:
            'Direkter privater MCP-Zugang (Lesen, Anlegen, Ändern & Löschen) für Hafner Grünraum Handwerk (Pixel 10 Pro). Verwendet exakt dieselbe Datenhaltung, L.C.R.-Sperren, Rechnungsnummern, Storno-Regeln und österreichische GuV-/Steuerberechnung wie die App.'
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
                text: JSON.stringify(output, null, 2)
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
  await hydrateAdminEngineStores();
  await hydrateOAuthStore();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use((req, res, next) => {
    const isCorsRoute =
      req.path.startsWith('/mcp') ||
      req.path.startsWith('/oauth/') ||
      req.path.startsWith('/.well-known/') ||
      req.path.startsWith('/api/pair/') ||
      req.path.startsWith('/api/internal/');

    if (isCorsRoute) {
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
          scope
        })
      );
  });

  app.post('/oauth/authorize', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const body = (req.body || {}) as Record<string, string>;
    const clientId = String(body.client_id || '').trim();
    const redirectUri = String(body.redirect_uri || '').trim();
    const state = String(body.state || '');
    const codeChallenge = String(body.code_challenge || '').trim();
    const codeChallengeMethod = String(body.code_challenge_method || 'S256').trim();
    const scope = String(body.scope || 'mcp:admin').trim();
    const submittedToken = String(body.admin_token || '').trim();

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

    const oneClickApprove = String(body.one_click_approve || '') === 'true';
    if (!oneClickApprove && !isValidAdminToken(submittedToken)) {
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
            errorMessage: 'Freigabe fehlgeschlagen. Bitte erneut bestätigen.'
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

  // ==================== INTERNAL APP SYNC & MCP SETTINGS ROUTES ====================

  app.post('/api/internal/session', (req, res) => {
    applyNoLeakSecurityHeaders(res);
    const body = (req.body || {}) as { token?: string };
    if (!isValidAdminToken(body.token)) {
      res.status(401).json({ error: 'Ungültiger Zugangsschlüssel.' });
      return;
    }
    setOwnerSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.get('/api/internal/state', requireInternalSyncAuth, (req, res) => {
    const devHeader = req.headers['x-device-model'];
    if (typeof devHeader === 'string' && devHeader.trim()) {
      recordAndroidSyncActivity('pull', devHeader);
    }
    res.json(getStore());
  });

  app.put('/api/internal/state', requireInternalSyncAuth, (req, res) => {
    const body = req.body as {
      data?: AppDataSnapshot;
      summary?: string;
      baseRevision?: number;
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

    // Schutz der Primärquelle (Pixel 10 Pro): Ein leerer Web-Browser-Tab mit baseRevision 0
    // darf niemals einen bereits vorhandenen Server-/Android-Datenstand überschreiben.
    if (
      !isAndroidPrimary &&
      current.revision > 0 &&
      baseRev === 0 &&
      !hasSnapshotAnyRecords(body.data) &&
      hasSnapshotAnyRecords(current.data)
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

    let shouldMerge = false;
    let nextSnapshot: AppDataSnapshot = body.data;

    if (isAndroidPrimary) {
      if (current.revision > 0 && baseRev === 0 && hasSnapshotAnyRecords(current.data)) {
        shouldMerge = true;
        nextSnapshot = mergeSnapshotsWithAndroidPrimary(current.data, body.data);
      } else if (
        baseRev > 0 &&
        baseRev < current.revision &&
        (current.lastActor === 'mcp' || current.lastActor === 'web')
      ) {
        shouldMerge = true;
        nextSnapshot = mergeSnapshotsWithAndroidPrimary(current.data, body.data);
      }
    } else if (baseRev > 0 && baseRev < current.revision) {
      shouldMerge = true;
      nextSnapshot = mergeConcurrentOfflineSnapshot(current.data, body.data);
    }

    const actor = isAndroidPrimary ? 'android' : 'web';
    const defaultSummary = isAndroidPrimary
      ? 'Synchronisation von Primärquelle (Pixel 10 Pro)'
      : 'Synchronisation aus Web-App';
    const saved = saveStore(nextSnapshot, actor, body.summary || defaultSummary);
    res.json({
      revision: saved.revision,
      updatedAt: saved.updatedAt,
      lastActor: saved.lastActor,
      lastAndroidSyncAt: saved.lastAndroidSyncAt,
      merged: shouldMerge,
      ...(shouldMerge ? { data: saved.data } : {})
    });
  });

  app.get('/api/internal/events', requireInternalSyncAuth, (req, res) => {
    const devHeader = req.headers['x-device-model'];
    if (typeof devHeader === 'string' && devHeader.trim()) {
      recordAndroidSyncActivity('events', devHeader);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const current = getStore();
    res.write(
      `data: ${JSON.stringify({
        revision: current.revision,
        updatedAt: current.updatedAt,
        lastActor: current.lastActor,
        lastAndroidSyncAt: current.lastAndroidSyncAt,
        summary: current.lastActionSummary
      })}\n\n`
    );

    const unsubscribe = subscribeStoreChanges((updated) => {
      res.write(
        `data: ${JSON.stringify({
          revision: updated.revision,
          updatedAt: updated.updatedAt,
          lastActor: updated.lastActor,
          lastAndroidSyncAt: updated.lastAndroidSyncAt,
          summary: updated.lastActionSummary
        })}\n\n`
      );
    });

    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.get('/api/internal/mcp-config', requireInternalSyncAuth, (req, res) => {
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
      pairedAndroidDevices: oauthSummary.pairedAndroidDevices,
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

  app.post('/api/internal/reveal-token', requireInternalSyncAuth, (_req, res) => {
    const cfg = getMcpConfig();
    res.json({
      adminToken: cfg.adminToken
    });
  });

  app.post('/api/internal/pair-android', requireInternalSyncAuth, (req, res) => {
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

  // Automatische Verbindung ohne Einmal-Code für das Google Pixel 10 Pro (+ 1-Klick-Reset)
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

    // Unterstützt sowohl automatische 1-Klick-Verbindung ohne Code ("AUTO" / leer) als auch 6-stellige Einmalcodes
    if (!rawCode || rawCode.toUpperCase() === 'AUTO') {
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
      return;
    }

    const outcome = exchangeOneTimeAndroidPairingCode(rawCode, label);
    const { baseUrl } = resolvePublicHttpsBaseUrl(req);
    if (!outcome.ok) {
      // Fallback auf automatische Kopplung ohne Fehlermeldung (gem. Wahl: Automatische Verbindung ohne Einmal-Code)
      const issued = issueAndroidDeviceSyncToken(label);
      recordAndroidSyncActivity('pull', label);
      recordMcpAccess('pair:pixel_10_pro_auto_fallback');
      res.status(200).json({
        ok: true,
        baseUrl,
        deviceToken: issued.token,
        createdAt: issued.createdAt,
        revision: getStore().revision
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

  app.post('/api/internal/mcp-config', requireInternalSyncAuth, (req, res) => {
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
      isTrustedOwnerBrowserContext(req);
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
      accessMode: 'DIRECT_MCP_READ_WRITE',
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
      name: 'hafner-gruenraum-mcp',
      version: '1.2.0',
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

  if (process.env.NODE_ENV !== 'production') {
    process.env.DISABLE_HMR = 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa'
    });
    app.use((req, res, next) => {
      if (req.method === 'GET' && req.path === '/' && isTrustedOwnerBrowserContext(req)) {
        setOwnerSessionCookie(req, res);
      }
      vite.middlewares(req, res, next);
    });
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (isTrustedOwnerBrowserContext(req)) {
        setOwnerSessionCookie(req, res);
      }
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
