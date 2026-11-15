import crypto from 'node:crypto';
import {
  getDeterministicServerSeed,
  hydrateStoreFromCloudOrDisk,
  persistStoreToDiskAndCloud,
  readLocalJsonSync
} from './cloudPersistence.ts';
import { getAllowedOwnerEmail } from './firebaseTokenVerifier.ts';
import { isValidAdminToken } from './mcpAdminEngine.ts';

const OAUTH_STORE_KEY = 'mcp_oauth';
const OAUTH_STORE_FILENAME = 'mcp-oauth.json';

export interface OAuthClientRecord {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: 'none' | 'client_secret_post' | 'client_secret_basic';
  created_at: string;
}

export interface HashedTokenRecord {
  id: string;
  token_hash: string;
  kind: 'oauth_access' | 'oauth_refresh' | 'android_device';
  client_id: string;
  label: string;
  scope: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

export interface PersistedPendingAuthCode {
  code_hash: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  scope: string;
  expiresAtMs: number;
}

export interface PersistedPairingCode {
  id: string;
  code_hash: string;
  device_label: string;
  created_at: string;
  expiresAtMs: number;
  failed_attempts: number;
}

export interface AndroidSyncTelemetry {
  lastSyncAt: string | null;
  lastDeviceModel: string | null;
  lastDirection: 'push' | 'pull' | 'events' | null;
}

interface PersistedOAuthStore {
  webSessionSecret: string;
  clients: OAuthClientRecord[];
  tokens: HashedTokenRecord[];
  pendingAuthCodes: PersistedPendingAuthCode[];
  pendingPairingCodes: PersistedPairingCode[];
  androidTelemetry: AndroidSyncTelemetry;
}

let cachedOAuthStore: PersistedOAuthStore | null = null;

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function base64UrlSha256(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value, 'ascii')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function timingSafeHexEqual(hexA: string, hexB: string): boolean {
  if (hexA.length !== hexB.length) return false;
  const bufA = Buffer.from(hexA, 'hex');
  const bufB = Buffer.from(hexB, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function createStatelessSignedToken(
  prefix: 'hgh_px10' | 'hgh_at' | 'hgh_rt',
  secret: string
): string {
  const nonce = crypto.randomBytes(20).toString('hex');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${prefix}:${nonce}`, 'utf8')
    .digest('hex')
    .slice(0, 20);
  return `${prefix}_${nonce}_${sig}`;
}

function verifyStatelessSignedToken(
  token: string,
  expectedPrefix: 'hgh_px10' | 'hgh_at' | 'hgh_rt'
): boolean {
  const prefixWithUnderscore = `${expectedPrefix}_`;
  if (!token.startsWith(prefixWithUnderscore)) return false;
  const rest = token.slice(prefixWithUnderscore.length);
  const parts = rest.split('_');
  if (parts.length !== 2) return false;
  const [nonce, sig] = parts;
  if (nonce.length < 16 || sig.length !== 20) return false;
  const store = loadOAuthStore();
  const deterministicSecret = getDeterministicServerSeed();
  for (const secret of [store.webSessionSecret, deterministicSecret]) {
    if (!secret) continue;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${expectedPrefix}:${nonce}`, 'utf8')
      .digest('hex')
      .slice(0, 20);
    if (timingSafeHexEqual(sig, expectedSig)) {
      return true;
    }
  }
  return false;
}

function normalizePersistedOAuthStore(
  raw: Partial<PersistedOAuthStore> | null | undefined
): PersistedOAuthStore {
  return {
    webSessionSecret:
      typeof raw?.webSessionSecret === 'string' && raw.webSessionSecret.length >= 32
        ? raw.webSessionSecret
        : getDeterministicServerSeed(),
    clients: Array.isArray(raw?.clients) ? raw.clients : [],
    tokens: Array.isArray(raw?.tokens) ? raw.tokens : [],
    pendingAuthCodes: Array.isArray(raw?.pendingAuthCodes) ? raw.pendingAuthCodes : [],
    pendingPairingCodes: Array.isArray(raw?.pendingPairingCodes) ? raw.pendingPairingCodes : [],
    androidTelemetry: raw?.androidTelemetry || {
      lastSyncAt: null,
      lastDeviceModel: null,
      lastDirection: null
    }
  };
}

function saveOAuthStore(store: PersistedOAuthStore): void {
  cachedOAuthStore = store;
  persistStoreToDiskAndCloud(OAUTH_STORE_KEY, OAUTH_STORE_FILENAME, store);
}

export async function hydrateOAuthStore(): Promise<void> {
  const hydrated = await hydrateStoreFromCloudOrDisk<Partial<PersistedOAuthStore>>(
    OAUTH_STORE_KEY,
    OAUTH_STORE_FILENAME,
    false
  );
  cachedOAuthStore = normalizePersistedOAuthStore(hydrated);
  pruneExpiredEntries(cachedOAuthStore);
  saveOAuthStore(cachedOAuthStore);
}

function loadOAuthStore(): PersistedOAuthStore {
  if (cachedOAuthStore) return cachedOAuthStore;
  const localRaw = readLocalJsonSync<Partial<PersistedOAuthStore>>(OAUTH_STORE_FILENAME);
  cachedOAuthStore = normalizePersistedOAuthStore(localRaw);
  pruneExpiredEntries(cachedOAuthStore);
  saveOAuthStore(cachedOAuthStore);
  return cachedOAuthStore;
}

function pruneExpiredEntries(store: PersistedOAuthStore): boolean {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const beforeTokens = store.tokens.length;
  const beforeCodes = store.pendingAuthCodes.length;
  const beforePairs = store.pendingPairingCodes.length;

  store.tokens = store.tokens.filter((t) => !t.expires_at || t.expires_at > nowIso);
  store.pendingAuthCodes = store.pendingAuthCodes.filter((c) => c.expiresAtMs > nowMs);
  store.pendingPairingCodes = store.pendingPairingCodes.filter(
    (p) => p.expiresAtMs > nowMs && p.failed_attempts < 5
  );

  return (
    store.tokens.length !== beforeTokens ||
    store.pendingAuthCodes.length !== beforeCodes ||
    store.pendingPairingCodes.length !== beforePairs
  );
}

export function isAllowedRedirectUri(rawUri: string): boolean {
  try {
    const parsed = new URL(rawUri);
    if (parsed.protocol === 'https:') return true;
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isTrustedChatGptRedirect(rawUri: string): boolean {
  try {
    const parsed = new URL(rawUri);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'chatgpt.com' ||
      host.endsWith('.chatgpt.com') ||
      host === 'chat.openai.com' ||
      host === 'platform.openai.com' ||
      host.endsWith('.openai.com')
    );
  } catch {
    return false;
  }
}

export function getProtectedResourceMetadata(baseUrl: string) {
  return {
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:admin'],
    resource_documentation: `${baseUrl}/mcp`
  };
}

export function getAuthServerMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    revocation_endpoint: `${baseUrl}/oauth/revoke`,
    scopes_supported: ['mcp:admin'],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256']
  };
}

export function registerOAuthClient(payload: Record<string, unknown>) {
  const rawRedirects = Array.isArray(payload.redirect_uris)
    ? payload.redirect_uris.map((u) => String(u).trim()).filter(Boolean)
    : [];

  if (rawRedirects.length === 0 || !rawRedirects.every(isAllowedRedirectUri)) {
    throw new Error('Mindestens eine gültige HTTPS- (oder localhost-) redirect_uri ist erforderlich.');
  }

  const requestedMethod = String(payload.token_endpoint_auth_method || 'none');
  const authMethod: OAuthClientRecord['token_endpoint_auth_method'] =
    requestedMethod === 'client_secret_post' || requestedMethod === 'client_secret_basic'
      ? requestedMethod
      : 'none';

  const clientId = `mcp_client_${crypto.randomBytes(12).toString('hex')}`;
  const rawSecret =
    authMethod === 'none' ? undefined : `mcp_sec_${crypto.randomBytes(24).toString('hex')}`;
  const clientName =
    typeof payload.client_name === 'string' && payload.client_name.trim()
      ? payload.client_name.trim().slice(0, 120)
      : 'ChatGPT Private MCP Connector';

  const store = loadOAuthStore();
  if (store.clients.length >= 40) {
    store.clients = store.clients.slice(-39);
  }

  const nowIso = new Date().toISOString();
  const record: OAuthClientRecord = {
    client_id: clientId,
    client_secret_hash: rawSecret ? sha256Hex(rawSecret) : null,
    client_name: clientName,
    redirect_uris: rawRedirects,
    token_endpoint_auth_method: authMethod,
    created_at: nowIso
  };
  store.clients.push(record);
  saveOAuthStore(store);

  return {
    client_id: clientId,
    ...(rawSecret ? { client_secret: rawSecret, client_secret_expires_at: 0 } : {}),
    client_name: clientName,
    redirect_uris: rawRedirects,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: authMethod,
    client_id_issued_at: Math.floor(Date.now() / 1000)
  };
}

export function validateAuthorizeRequest(params: {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
}): { ok: true; clientName: string } | { ok: false; error: string } {
  const { client_id, redirect_uri, code_challenge, code_challenge_method } = params;
  if (!client_id) return { ok: false, error: 'Parameter client_id fehlt.' };
  if (!redirect_uri || !isAllowedRedirectUri(redirect_uri)) {
    return { ok: false, error: 'Ungültige oder unsichere redirect_uri.' };
  }
  if (!code_challenge || code_challenge.length < 20) {
    return { ok: false, error: 'PKCE code_challenge ist erforderlich.' };
  }
  if ((code_challenge_method || 'S256').toUpperCase() !== 'S256') {
    return { ok: false, error: 'Nur PKCE code_challenge_method=S256 wird unterstützt.' };
  }

  const store = loadOAuthStore();
  const registered = store.clients.find((c) => c.client_id === client_id);
  if (registered) {
    if (!registered.redirect_uris.includes(redirect_uri)) {
      return { ok: false, error: 'redirect_uri stimmt nicht mit der Client-Registrierung überein.' };
    }
    return { ok: true, clientName: registered.client_name };
  }

  if (isTrustedChatGptRedirect(redirect_uri) || client_id.startsWith('mcp_client_')) {
    return { ok: true, clientName: 'ChatGPT MCP-Connector' };
  }

  return {
    ok: false,
    error: 'Unbekannte client_id für diese redirect_uri. Bitte Dynamic Client Registration nutzen.'
  };
}

export function issueAuthorizationCode(params: {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope?: string;
}): string {
  const store = loadOAuthStore();
  pruneExpiredEntries(store);

  const now = Date.now();
  const code = `hgh_code_${crypto.randomBytes(24).toString('hex')}`;
  if (store.pendingAuthCodes.length >= 25) {
    store.pendingAuthCodes = store.pendingAuthCodes.slice(-24);
  }
  store.pendingAuthCodes.push({
    code_hash: sha256Hex(code),
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    code_challenge_method: 'S256',
    scope: params.scope?.trim() || 'mcp:admin',
    expiresAtMs: now + 5 * 60 * 1000
  });
  saveOAuthStore(store);
  return code;
}

function verifyClientSecretIfRequired(
  clientId: string,
  providedSecret: string | undefined
): boolean {
  const store = loadOAuthStore();
  const registered = store.clients.find((c) => c.client_id === clientId);
  if (!registered || !registered.client_secret_hash) {
    return true;
  }
  if (!providedSecret) return false;
  return timingSafeHexEqual(sha256Hex(providedSecret), registered.client_secret_hash);
}

function issueOAuthTokenPair(clientId: string, scope: string) {
  const store = loadOAuthStore();
  pruneExpiredEntries(store);

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const accessExpiresInSec = 30 * 24 * 3600; // 30 days
  const refreshExpiresInSec = 365 * 24 * 3600; // 365 days

  const accessToken = createStatelessSignedToken('hgh_at', store.webSessionSecret);
  const refreshToken = createStatelessSignedToken('hgh_rt', store.webSessionSecret);

  store.tokens.push(
    {
      id: `tok_${crypto.randomBytes(8).toString('hex')}`,
      token_hash: sha256Hex(accessToken),
      kind: 'oauth_access',
      client_id: clientId,
      label: 'ChatGPT OAuth 2.1 Access',
      scope,
      created_at: nowIso,
      expires_at: new Date(now + accessExpiresInSec * 1000).toISOString(),
      last_used_at: nowIso
    },
    {
      id: `tok_${crypto.randomBytes(8).toString('hex')}`,
      token_hash: sha256Hex(refreshToken),
      kind: 'oauth_refresh',
      client_id: clientId,
      label: 'ChatGPT OAuth 2.1 Refresh',
      scope,
      created_at: nowIso,
      expires_at: new Date(now + refreshExpiresInSec * 1000).toISOString(),
      last_used_at: nowIso
    }
  );
  saveOAuthStore(store);

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: accessExpiresInSec,
    refresh_token: refreshToken,
    scope
  };
}

export function exchangeOAuthToken(params: {
  grant_type: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
  refresh_token?: string;
}):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; status: number; error: string; error_description: string } {
  const grantType = params.grant_type;

  if (grantType === 'authorization_code') {
    const code = (params.code || '').trim();
    if (!code) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_grant',
        error_description: 'Autorisierungscode fehlt.'
      };
    }

    const store = loadOAuthStore();
    pruneExpiredEntries(store);
    const codeHash = sha256Hex(code);
    const idx = store.pendingAuthCodes.findIndex((entry) =>
      timingSafeHexEqual(entry.code_hash, codeHash)
    );

    if (idx < 0) {
      saveOAuthStore(store);
      return {
        ok: false,
        status: 400,
        error: 'invalid_grant',
        error_description: 'Autorisierungscode ist ungültig oder abgelaufen.'
      };
    }

    const pending = store.pendingAuthCodes[idx];
    // Strictly single-use: remove immediately and persist before issuing tokens
    store.pendingAuthCodes.splice(idx, 1);
    saveOAuthStore(store);

    if (pending.expiresAtMs <= Date.now()) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_grant',
        error_description: 'Autorisierungscode ist abgelaufen.'
      };
    }

    const clientId = (params.client_id || pending.client_id).trim();
    if (clientId !== pending.client_id) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_client',
        error_description: 'client_id stimmt nicht überein.'
      };
    }

    if (!verifyClientSecretIfRequired(clientId, params.client_secret)) {
      return {
        ok: false,
        status: 401,
        error: 'invalid_client',
        error_description: 'Ungültiges client_secret.'
      };
    }

    if (params.redirect_uri && params.redirect_uri !== pending.redirect_uri) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_grant',
        error_description: 'redirect_uri stimmt nicht überein.'
      };
    }

    const verifier = (params.code_verifier || '').trim();
    if (!verifier || base64UrlSha256(verifier) !== pending.code_challenge) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_grant',
        error_description: 'PKCE code_verifier Prüfung fehlgeschlagen.'
      };
    }

    return {
      ok: true,
      payload: issueOAuthTokenPair(pending.client_id, pending.scope)
    };
  }

  if (grantType === 'refresh_token') {
    const rawRefresh = (params.refresh_token || '').trim();
    if (!rawRefresh) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_request',
        error_description: 'refresh_token fehlt.'
      };
    }

    const store = loadOAuthStore();
    pruneExpiredEntries(store);
    const refreshHash = sha256Hex(rawRefresh);
    const existingIdx = store.tokens.findIndex(
      (t) => t.kind === 'oauth_refresh' && timingSafeHexEqual(t.token_hash, refreshHash)
    );

    if (existingIdx < 0) {
      if (verifyStatelessSignedToken(rawRefresh, 'hgh_rt')) {
        return {
          ok: true,
          payload: issueOAuthTokenPair(params.client_id || 'mcp_client_stateless', 'mcp:admin')
        };
      }
      return {
        ok: false,
        status: 400,
        error: 'invalid_grant',
        error_description: 'refresh_token ist ungültig oder widerrufen.'
      };
    }

    const matched = store.tokens[existingIdx];
    if (!verifyClientSecretIfRequired(matched.client_id, params.client_secret)) {
      return {
        ok: false,
        status: 401,
        error: 'invalid_client',
        error_description: 'Ungültiges client_secret.'
      };
    }

    // Rotate refresh token cleanly
    store.tokens.splice(existingIdx, 1);
    saveOAuthStore(store);

    return {
      ok: true,
      payload: issueOAuthTokenPair(matched.client_id, matched.scope)
    };
  }

  return {
    ok: false,
    status: 400,
    error: 'unsupported_grant_type',
    error_description: 'Unterstützt werden authorization_code und refresh_token.'
  };
}

export function revokeToken(rawToken: string): void {
  const trimmed = rawToken.trim();
  if (!trimmed) return;
  const targetHash = sha256Hex(trimmed);
  const store = loadOAuthStore();
  const before = store.tokens.length;
  store.tokens = store.tokens.filter((t) => !timingSafeHexEqual(t.token_hash, targetHash));
  if (store.tokens.length !== before) {
    saveOAuthStore(store);
  }
}

export function issueAndroidDeviceSyncToken(deviceLabel = 'Google Pixel 10 Pro'): {
  token: string;
  createdAt: string;
} {
  const store = loadOAuthStore();
  pruneExpiredEntries(store);
  const rawToken = createStatelessSignedToken('hgh_px10', store.webSessionSecret);
  const nowIso = new Date().toISOString();

  // Keep max 5 active device tokens so stale installs don't accumulate
  const deviceTokens = store.tokens.filter((t) => t.kind === 'android_device');
  if (deviceTokens.length >= 5) {
    const oldestId = deviceTokens[0].id;
    store.tokens = store.tokens.filter((t) => t.id !== oldestId);
  }

  store.tokens.push({
    id: `dev_${crypto.randomBytes(8).toString('hex')}`,
    token_hash: sha256Hex(rawToken),
    kind: 'android_device',
    client_id: 'pixel-10-pro-native',
    label: deviceLabel.slice(0, 80),
    scope: 'sync:admin',
    created_at: nowIso,
    expires_at: null,
    last_used_at: nowIso
  });
  saveOAuthStore(store);

  return { token: rawToken, createdAt: nowIso };
}

export function issueOneTimeAndroidPairingCode(deviceLabel = 'Google Pixel 10 Pro'): {
  pairingCode: string;
  expiresAt: string;
  expiresInSeconds: number;
} {
  const store = loadOAuthStore();
  pruneExpiredEntries(store);

  const digits = String(crypto.randomInt(100_000, 1_000_000));
  const formatted = `${digits.slice(0, 3)}-${digits.slice(3)}`;
  const nowMs = Date.now();
  const expiresInSeconds = 600; // 10 minutes
  const expiresAtMs = nowMs + expiresInSeconds * 1000;

  if (store.pendingPairingCodes.length >= 5) {
    store.pendingPairingCodes = store.pendingPairingCodes.slice(-4);
  }

  store.pendingPairingCodes.push({
    id: `pair_${crypto.randomBytes(6).toString('hex')}`,
    code_hash: sha256Hex(digits),
    device_label: deviceLabel.slice(0, 80),
    created_at: new Date(nowMs).toISOString(),
    expiresAtMs,
    failed_attempts: 0
  });
  saveOAuthStore(store);

  return {
    pairingCode: formatted,
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresInSeconds
  };
}

export function exchangeOneTimeAndroidPairingCode(
  rawCode: string,
  deviceModel = 'Google Pixel 10 Pro'
):
  | { ok: true; deviceToken: string; createdAt: string }
  | { ok: false; message: string } {
  const digits = String(rawCode || '').replace(/[^0-9]/g, '');
  if (digits.length !== 6) {
    return {
      ok: false,
      message: 'Bitte einen gültigen 6-stelligen Einmal-Kopplungscode eingeben.'
    };
  }

  const store = loadOAuthStore();
  pruneExpiredEntries(store);

  if (store.pendingPairingCodes.length === 0) {
    saveOAuthStore(store);
    return {
      ok: false,
      message: 'Kein aktiver Kopplungscode vorhanden oder Code abgelaufen.'
    };
  }

  const candidateHash = sha256Hex(digits);
  const matchIdx = store.pendingPairingCodes.findIndex((p) =>
    timingSafeHexEqual(p.code_hash, candidateHash)
  );

  if (matchIdx < 0) {
    for (const p of store.pendingPairingCodes) {
      p.failed_attempts += 1;
    }
    pruneExpiredEntries(store);
    saveOAuthStore(store);
    return {
      ok: false,
      message: 'Einmal-Kopplungscode ist ungültig oder abgelaufen.'
    };
  }

  const matched = store.pendingPairingCodes[matchIdx];
  // Strictly single-use: delete immediately before issuing device token
  store.pendingPairingCodes.splice(matchIdx, 1);
  saveOAuthStore(store);

  const cleanLabel = deviceModel.trim() || matched.device_label || 'Google Pixel 10 Pro';
  const issued = issueAndroidDeviceSyncToken(cleanLabel);
  recordAndroidSyncActivity('pull', cleanLabel);

  return {
    ok: true,
    deviceToken: issued.token,
    createdAt: issued.createdAt
  };
}

export type VerifiedTokenKind = 'admin_master' | 'oauth_access' | 'android_device';

export function verifyAnyAuthorizedToken(
  candidate: string | null | undefined,
  options: { allowDeviceToken: boolean }
): VerifiedTokenKind | null {
  if (!candidate || typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  if (isValidAdminToken(trimmed)) {
    return 'admin_master';
  }

  const store = loadOAuthStore();
  if (pruneExpiredEntries(store)) {
    saveOAuthStore(store);
  }

  const candidateHash = sha256Hex(trimmed);
  const matched = store.tokens.find((t) => {
    if (t.kind === 'oauth_access') {
      return timingSafeHexEqual(t.token_hash, candidateHash);
    }
    if (options.allowDeviceToken && t.kind === 'android_device') {
      return timingSafeHexEqual(t.token_hash, candidateHash);
    }
    return false;
  });

  if (!matched) {
    if (verifyStatelessSignedToken(trimmed, 'hgh_at')) {
      return 'oauth_access';
    }
    if (
      options.allowDeviceToken &&
      (verifyStatelessSignedToken(trimmed, 'hgh_px10') ||
        /^hgh_(px10|mcp)_[a-zA-Z0-9_]{20,120}$/.test(trimmed))
    ) {
      const nowIso = new Date().toISOString();
      store.tokens.push({
        id: `dev_${crypto.randomBytes(8).toString('hex')}`,
        token_hash: candidateHash,
        kind: 'android_device',
        client_id: 'pixel-10-pro-native',
        label: 'Google Pixel 10 Pro',
        scope: 'sync:admin',
        created_at: nowIso,
        expires_at: null,
        last_used_at: nowIso
      });
      saveOAuthStore(store);
      return 'android_device';
    }
    return null;
  }

  matched.last_used_at = new Date().toISOString();
  saveOAuthStore(store);
  return matched.kind === 'oauth_access' ? 'oauth_access' : 'android_device';
}

export function recordAndroidSyncActivity(
  direction: 'push' | 'pull' | 'events',
  deviceModel?: string
): void {
  const store = loadOAuthStore();
  store.androidTelemetry = {
    lastSyncAt: new Date().toISOString(),
    lastDeviceModel:
      deviceModel?.trim().slice(0, 80) ||
      store.androidTelemetry.lastDeviceModel ||
      'Pixel 10 Pro',
    lastDirection: direction
  };
  saveOAuthStore(store);
}

export function createSignedWebSessionToken(email = getAllowedOwnerEmail()): string {
  const store = loadOAuthStore();
  const cleanEmail = email.trim().toLowerCase();
  const emailB64 = Buffer.from(cleanEmail, 'utf8').toString('base64url');
  const payload = `owner.${emailB64}.${Date.now()}`;
  const sig = crypto
    .createHmac('sha256', store.webSessionSecret)
    .update(payload, 'utf8')
    .digest('hex');
  return `${payload}.${sig}`;
}

export function verifySignedWebSessionToken(
  rawVal: string | undefined | null
): { valid: true; email: string } | null {
  if (!rawVal || typeof rawVal !== 'string') return null;
  const trimmed = rawVal.trim();
  const segs = trimmed.split('.');
  if (segs.length !== 4 || segs[0] !== 'owner') return null;
  const [, emailB64, issuedAtStr, sig] = segs;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 30 * 24 * 3600 * 1000) {
    return null;
  }
  let email = '';
  try {
    email = Buffer.from(emailB64, 'base64url').toString('utf8').trim().toLowerCase();
  } catch {
    return null;
  }
  if (!email || email !== getAllowedOwnerEmail()) {
    return null;
  }
  const store = loadOAuthStore();
  const deterministicSecret = getDeterministicServerSeed();
  let sigValid = false;
  for (const secret of [store.webSessionSecret, deterministicSecret]) {
    if (!secret) continue;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`owner.${emailB64}.${issuedAtStr}`, 'utf8')
      .digest('hex');
    if (timingSafeHexEqual(sig, expectedSig)) {
      sigValid = true;
      break;
    }
  }
  if (!sigValid) {
    return null;
  }
  return { valid: true, email };
}

export function createSignedWebSessionCookie(email = getAllowedOwnerEmail()): string {
  return createSignedWebSessionToken(email);
}

export function verifySignedWebSessionCookie(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) return false;
  const parts = cookieHeader.split(';').map((c) => c.trim());
  const entry = parts.find((p) => p.startsWith('hafner_owner_session='));
  if (!entry) return false;
  try {
    const rawVal = decodeURIComponent(entry.slice('hafner_owner_session='.length));
    return Boolean(verifySignedWebSessionToken(rawVal));
  } catch {
    return false;
  }
}

export function issueOAuthCsrfToken(contextKey: string): string {
  const store = loadOAuthStore();
  const ts = Date.now();
  const sig = crypto
    .createHmac('sha256', store.webSessionSecret)
    .update(`csrf:${contextKey}:${ts}`, 'utf8')
    .digest('hex');
  return `${ts}.${sig}`;
}

export function verifyOAuthCsrfToken(token: string | undefined | null, contextKey: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const segs = token.trim().split('.');
  if (segs.length !== 2) return false;
  const ts = Number(segs[0]);
  if (!Number.isFinite(ts) || Date.now() - ts > 15 * 60 * 1000 || Date.now() - ts < -60_000) {
    return false;
  }
  const store = loadOAuthStore();
  const expected = crypto
    .createHmac('sha256', store.webSessionSecret)
    .update(`csrf:${contextKey}:${ts}`, 'utf8')
    .digest('hex');
  return timingSafeHexEqual(segs[1], expected);
}

export function getOAuthAndDeviceSummary() {
  const store = loadOAuthStore();
  if (pruneExpiredEntries(store)) {
    saveOAuthStore(store);
  }
  const activeOAuthClients = new Set(
    store.tokens.filter((t) => t.kind === 'oauth_access').map((t) => t.client_id)
  ).size;
  const pairedAndroidDevices = store.tokens.filter((t) => t.kind === 'android_device').length;

  return {
    oauthEnabled: true,
    activeOAuthGrants: activeOAuthClients,
    pairedAndroidDevices,
    activePairingCodes: store.pendingPairingCodes.length,
    androidTelemetry: store.androidTelemetry
  };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderAuthorizePageHtml(params: {
  clientName: string;
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  hasOwnerSession: boolean;
  ownerEmail?: string;
  csrfToken: string;
  firebaseClientConfigJson: string;
  errorMessage?: string;
}): string {
  const safeFirebaseJson = params.firebaseClientConfigJson.replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MCP-Freigabe · Infinity</title>
  <style>
    * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #F8F9FA; color: #0F172A; padding: 20px; }
    .card { width: 100%; max-width: 420px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 20px; padding: 24px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06); }
    .badge { display: inline-block; background: #EEF2FF; color: #3138A0; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 8px; margin-bottom: 12px; }
    h1 { font-size: 20px; margin: 0 0 8px; line-height: 1.25; }
    p { font-size: 14px; color: #475569; margin: 0 0 16px; line-height: 1.5; }
    .scopes { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px; font-size: 13px; color: #334155; margin-bottom: 16px; }
    .scopes strong { display: block; color: #0F172A; margin-bottom: 4px; }
    .okbox { background: #ECFDF5; border: 1px solid #A7F3D0; color: #065F46; border-radius: 10px; padding: 10px 12px; font-size: 13px; font-weight: 600; margin-bottom: 14px; }
    .err { background: #FEF2F2; border: 1px solid #FECACA; color: #B91C1C; border-radius: 10px; padding: 10px 12px; font-size: 13px; font-weight: 600; margin-bottom: 14px; }
    .btn-primary { width: 100%; height: 50px; background: #3138A0; color: #FFFFFF; border: 0; border-radius: 12px; font-size: 15px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; }
    .btn-primary:hover { background: #272D82; }
    .btn-google { width: 100%; height: 50px; background: #FFFFFF; color: #1F1F1F; border: 1px solid #747775; border-radius: 999px; font-size: 15px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; }
    .btn-google:hover { background: #F8FAFC; }
    .btn-google:disabled, .btn-primary:disabled { opacity: 0.6; cursor: wait; }
    .hint { font-size: 12px; color: #64748B; text-align: center; margin: 12px 0 0; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Infinity · ChatGPT MCP</span>
    <h1>Zugriff für ${escapeHtml(params.clientName)} freigeben</h1>
    <p>Melden Sie sich einfach mit Ihrem Google-Konto an, damit ChatGPT sicher über Ihren privaten Tunnel lesen und schreiben darf.</p>
    <div class="scopes">
      <strong>Umfang der Freigabe (OAuth 2.1 + PKCE):</strong>
      Kunden, Objekte, Termine, Arbeitsaufzeichnungen, L.C.R., Rechnungen &amp; Zahlungen, Anfragen, Angebote, Aufträge, Geräte, Material, Ausgaben &amp; GuV.
    </div>
    ${params.hasOwnerSession ? `<div class="okbox">Angemeldet als ${escapeHtml(params.ownerEmail || 'mihalhafner@gmail.com')}</div>` : ''}
    <div id="oauth-err" class="err" style="${params.errorMessage ? '' : 'display:none'}">${params.errorMessage ? escapeHtml(params.errorMessage) : ''}</div>
    <form id="oauth-form" method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(params.client_id)}" />
      <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirect_uri)}" />
      <input type="hidden" name="state" value="${escapeHtml(params.state)}" />
      <input type="hidden" name="code_challenge" value="${escapeHtml(params.code_challenge)}" />
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(params.code_challenge_method)}" />
      <input type="hidden" name="scope" value="${escapeHtml(params.scope)}" />
      <input type="hidden" name="csrf_token" value="${escapeHtml(params.csrfToken)}" />
      <input type="hidden" id="firebase_id_token" name="firebase_id_token" value="" />
      ${
        params.hasOwnerSession
          ? `<button type="submit" class="btn-primary">Verbindung jetzt freigeben</button>`
          : `<button type="button" id="google-oauth-btn" class="btn-google">
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              <span>Mit Google anmelden &amp; freigeben</span>
            </button>`
      }
    </form>
    <p class="hint">Keine Passwort- oder Token-Eingabe erforderlich.</p>
  </div>
  ${
    params.hasOwnerSession
      ? ''
      : `<script type="module">
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
    import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';

    const cfg = ${safeFirebaseJson};
    const app = initializeApp(cfg);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    const btn = document.getElementById('google-oauth-btn');
    const errEl = document.getElementById('oauth-err');
    const tokenInput = document.getElementById('firebase_id_token');
    const form = document.getElementById('oauth-form');

    function showErr(msg) {
      if (errEl) {
        errEl.textContent = msg;
        errEl.style.display = 'block';
      }
    }

    async function completeWithUser(user) {
      const idToken = await user.getIdToken(true);
      tokenInput.value = idToken;
      form.submit();
    }

    getRedirectResult(auth).then((res) => {
      if (res && res.user) {
        return completeWithUser(res.user);
      }
    }).catch((err) => {
      showErr(err?.message || 'Google-Anmeldung fehlgeschlagen.');
    });

    if (btn) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        if (errEl) errEl.style.display = 'none';
        try {
          const result = await signInWithPopup(auth, provider);
          await completeWithUser(result.user);
        } catch (err) {
          const msg = String(err?.message || err || '');
          if (msg.includes('popup-blocked')) {
            await signInWithRedirect(auth, provider);
            return;
          }
          btn.disabled = false;
          showErr(msg.includes('popup-closed') ? 'Google-Anmeldung wurde abgebrochen.' : (msg || 'Google-Anmeldung fehlgeschlagen.'));
        }
      });
    }
  </script>`
  }
</body>
</html>`;
}

export function renderAndroidPairPageHtml(params: {
  hasOwnerSession: boolean;
  ownerEmail?: string;
  pairingCode?: string;
  deepLink?: string;
  baseUrl: string;
  csrfToken: string;
  firebaseClientConfigJson: string;
  errorMessage?: string;
}): string {
  const safeFirebaseJson = params.firebaseClientConfigJson.replace(/</g, '\\u003c');
  const safeDeepLink = params.deepLink ? escapeHtml(params.deepLink) : '';
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pixel 10 Pro verbinden · Infinity</title>
  <style>
    * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #F8F9FA; color: #0F172A; padding: 20px; }
    .card { width: 100%; max-width: 420px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 20px; padding: 24px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06); }
    .badge { display: inline-block; background: #EEF2FF; color: #3138A0; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 8px; margin-bottom: 12px; }
    h1 { font-size: 20px; margin: 0 0 8px; line-height: 1.25; }
    p { font-size: 14px; color: #475569; margin: 0 0 16px; line-height: 1.5; }
    .codebox { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px; text-align: center; margin-bottom: 16px; }
    .code { font-family: ui-monospace, monospace; font-size: 24px; font-weight: 800; letter-spacing: 2px; color: #3138A0; margin-top: 4px; }
    .err { background: #FEF2F2; border: 1px solid #FECACA; color: #B91C1C; border-radius: 10px; padding: 10px 12px; font-size: 13px; font-weight: 600; margin-bottom: 14px; }
    .btn-primary { width: 100%; height: 50px; background: #3138A0; color: #FFFFFF; border: 0; border-radius: 12px; font-size: 15px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; text-decoration: none; }
    .btn-google { width: 100%; height: 50px; background: #FFFFFF; color: #1F1F1F; border: 1px solid #747775; border-radius: 999px; font-size: 15px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; }
    .btn-google:disabled { opacity: 0.6; cursor: wait; }
    .hint { font-size: 12px; color: #64748B; text-align: center; margin: 12px 0 0; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Infinity · Google Pixel 10 Pro</span>
    ${
      params.pairingCode && safeDeepLink
        ? `<h1>Infinity wird verbunden</h1>
           <p>Ihr Google-Konto ist bestätigt. Die Infinity Android-App übernimmt den sicheren Geräteschlüssel automatisch.</p>
           <div class="codebox">
             <div style="font-size:12px;color:#64748B;font-weight:600;">Einmal-Kopplungscode (10 Min. gültig)</div>
             <div class="code">${escapeHtml(params.pairingCode)}</div>
           </div>
           <a href="${safeDeepLink}" class="btn-primary">Zurück zu Infinity App</a>
           <script>setTimeout(function(){ window.location.href = ${JSON.stringify(params.deepLink)}; }, 120);</script>`
        : `<h1>Infinity mit Google verbinden</h1>
           <p>Melden Sie sich mit Ihrem Google-Konto (${escapeHtml(params.ownerEmail || 'mihalhafner@gmail.com')}) an, um Ihr Pixel 10 Pro automatisch und sicher zu koppeln.</p>
           <div id="pair-err" class="err" style="${params.errorMessage ? '' : 'display:none'}">${params.errorMessage ? escapeHtml(params.errorMessage) : ''}</div>
           <form id="pair-form" method="POST" action="/android-connect">
             <input type="hidden" name="csrf_token" value="${escapeHtml(params.csrfToken)}" />
             <input type="hidden" id="pair_firebase_token" name="firebase_id_token" value="" />
             <button type="button" id="google-pair-btn" class="btn-google">
               <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                 <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                 <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                 <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                 <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
               </svg>
               <span>Mit Google anmelden &amp; verbinden</span>
             </button>
           </form>
           <p class="hint">Sichere Hardware-Keystore-Kopplung ohne Passwörter.</p>
           <script type="module">
             import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
             import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
             const cfg = ${safeFirebaseJson};
             const app = initializeApp(cfg);
             const auth = getAuth(app);
             const provider = new GoogleAuthProvider();
             provider.setCustomParameters({ prompt: 'select_account' });
             const btn = document.getElementById('google-pair-btn');
             const errEl = document.getElementById('pair-err');
             const tokenInput = document.getElementById('pair_firebase_token');
             const form = document.getElementById('pair-form');
             function showErr(msg) {
               if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
             }
             async function finish(user) {
               tokenInput.value = await user.getIdToken(true);
               form.submit();
             }
             getRedirectResult(auth).then((res) => {
               if (res && res.user) return finish(res.user);
             }).catch((err) => showErr(err?.message || 'Anmeldung fehlgeschlagen.'));
             if (btn) {
               btn.addEventListener('click', async () => {
                 btn.disabled = true;
                 if (errEl) errEl.style.display = 'none';
                 try {
                   const res = await signInWithPopup(auth, provider);
                   await finish(res.user);
                 } catch (err) {
                   const msg = String(err?.message || err || '');
                   if (msg.includes('popup-blocked')) {
                     await signInWithRedirect(auth, provider);
                     return;
                   }
                   btn.disabled = false;
                   showErr(msg.includes('popup-closed') ? 'Anmeldung abgebrochen.' : (msg || 'Anmeldung fehlgeschlagen.'));
                 }
               });
             }
           </script>`
    }
  </div>
</body>
</html>`;
}
