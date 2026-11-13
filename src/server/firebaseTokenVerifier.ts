import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SECURE_TOKEN_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedCerts: {
  certs: Record<string, string>;
  expiresAtMs: number;
} | null = null;

function readFirebaseProjectId(): string {
  const envId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (envId) return envId;
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as { projectId?: string };
      if (parsed.projectId?.trim()) return parsed.projectId.trim();
    }
  } catch {
    // Fallback below
  }
  return 'gen-lang-client-0369636054';
}

export function getAllowedOwnerEmail(): string {
  return (process.env.OWNER_EMAIL?.trim() || 'mihalhafner@gmail.com').toLowerCase();
}

function decodeBase64UrlToBuffer(segment: string): Buffer {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

function parseMaxAgeSeconds(cacheControl: string | null): number {
  if (!cacheControl) return 3600;
  const match = cacheControl.match(/max-age=(\d+)/i);
  if (!match) return 3600;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 60 ? parsed : 3600;
}

async function getGoogleSecureTokenCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && cachedCerts && cachedCerts.expiresAtMs > now + 30_000) {
    return cachedCerts.certs;
  }

  const res = await fetch(SECURE_TOKEN_CERTS_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) {
    if (cachedCerts) return cachedCerts.certs;
    throw new Error(`Google-Zertifikate konnten nicht geladen werden (HTTP ${res.status}).`);
  }
  const certs = (await res.json()) as Record<string, string>;
  const maxAgeSec = parseMaxAgeSeconds(res.headers.get('cache-control'));
  cachedCerts = {
    certs,
    expiresAtMs: now + maxAgeSec * 1000
  };
  return certs;
}

interface FirebaseJwtHeader {
  alg?: string;
  kid?: string;
}

interface FirebaseJwtPayload {
  aud?: string;
  iss?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
}

export async function verifyFirebaseGoogleIdToken(
  rawIdToken: string | undefined | null
): Promise<{ ok: true; uid: string; email: string } | { ok: false; error: string }> {
  const token = typeof rawIdToken === 'string' ? rawIdToken.trim() : '';
  if (!token) {
    return { ok: false, error: 'Google-Anmeldetoken fehlt.' };
  }

  const segments = token.split('.');
  if (segments.length !== 3) {
    return { ok: false, error: 'Ungültiges Google-Tokenformat.' };
  }

  const [headerB64, payloadB64, sigB64] = segments;

  let header: FirebaseJwtHeader;
  let payload: FirebaseJwtPayload;
  try {
    header = JSON.parse(decodeBase64UrlToBuffer(headerB64).toString('utf8')) as FirebaseJwtHeader;
    payload = JSON.parse(decodeBase64UrlToBuffer(payloadB64).toString('utf8')) as FirebaseJwtPayload;
  } catch {
    return { ok: false, error: 'Google-Token konnte nicht dekodiert werden.' };
  }

  if (header.alg !== 'RS256' || !header.kid) {
    return { ok: false, error: 'Ungültiger Signatur-Algorithmus oder Key-ID.' };
  }

  let certs: Record<string, string>;
  try {
    certs = await getGoogleSecureTokenCerts(false);
    if (!certs[header.kid]) {
      certs = await getGoogleSecureTokenCerts(true);
    }
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Google-Signaturschlüssel nicht erreichbar.'
    };
  }

  const pem = certs[header.kid];
  if (!pem) {
    return { ok: false, error: 'Unbekannter Google-Signaturschlüssel.' };
  }

  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    const signatureValid = verifier.verify(pem, decodeBase64UrlToBuffer(sigB64));
    if (!signatureValid) {
      return { ok: false, error: 'Google-Tokensignatur ist ungültig.' };
    }
  } catch {
    return { ok: false, error: 'Fehler bei der Token-Signaturprüfung.' };
  }

  const projectId = readFirebaseProjectId();
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  const nowSec = Math.floor(Date.now() / 1000);

  if (payload.aud !== projectId) {
    return { ok: false, error: 'Token gehört nicht zu diesem Projekt.' };
  }
  if (payload.iss !== expectedIssuer) {
    return { ok: false, error: 'Ungültiger Token-Aussteller.' };
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    return { ok: false, error: 'Fehlende Benutzer-ID im Google-Token.' };
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec - 60) {
    return { ok: false, error: 'Google-Anmeldesitzung ist abgelaufen. Bitte erneut anmelden.' };
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    return { ok: false, error: 'Ungültiger Ausstellungszeitpunkt des Google-Tokens.' };
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const allowedEmail = getAllowedOwnerEmail();
  if (!email || payload.email_verified !== true || email !== allowedEmail) {
    return {
      ok: false,
      error: `Zugriff verweigert: Bitte mit dem freigegebenen Konto (${allowedEmail}) anmelden.`
    };
  }

  return { ok: true, uid: payload.sub.trim(), email };
}
