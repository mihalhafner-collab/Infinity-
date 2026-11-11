import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events.readonly'
];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

// In-Memory-Caching für das OAuth-Access-Token (niemals in localStorage/sessionStorage speichern)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let currentUser: User | null = null;

type GmailAuthListener = (state: { user: User | null; hasToken: boolean }) => void;
const listeners = new Set<GmailAuthListener>();

function notifyListeners() {
  const snapshot = { user: currentUser, hasToken: Boolean(cachedAccessToken) };
  listeners.forEach((fn) => fn(snapshot));
}

onAuthStateChanged(auth, (user: User | null) => {
  currentUser = user;
  if (!user) {
    cachedAccessToken = null;
  } else if (!cachedAccessToken && !isSigningIn) {
    cachedAccessToken = null;
  }
  notifyListeners();
});

export const subscribeGmailAuth = (listener: GmailAuthListener): (() => void) => {
  listeners.add(listener);
  listener({ user: currentUser, hasToken: Boolean(cachedAccessToken) });
  return () => {
    listeners.delete(listener);
  };
};

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Kein Zugriffstoken von Google erhalten. Bitte Berechtigung bestätigen.');
    }

    cachedAccessToken = credential.accessToken;
    currentUser = result.user;
    notifyListeners();
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const invalidateAccessToken = (): void => {
  cachedAccessToken = null;
  notifyListeners();
};

export const logoutGmail = async (): Promise<void> => {
  await auth.signOut();
  cachedAccessToken = null;
  currentUser = null;
  notifyListeners();
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return bytesToBase64(bytes);
}

function wrapBase64Lines(b64: string, lineLength = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += lineLength) {
    lines.push(b64.slice(i, i + lineLength));
  }
  return lines.join('\r\n');
}

function asciiToBase64Url(ascii: string): string {
  return btoa(ascii).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sanitizeAttachmentFilename(filename: string): string {
  const safe = filename
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe.endsWith('.pdf') ? safe : `${safe}.pdf`;
}

export interface SendGmailPdfParams {
  accessToken: string;
  to: string;
  subject: string;
  bodyText: string;
  pdfBlob: Blob;
  filename: string;
}

export async function sendInvoicePdfViaGmail({
  accessToken,
  to,
  subject,
  bodyText,
  pdfBlob,
  filename
}: SendGmailPdfParams): Promise<{ id: string }> {
  const cleanTo = to.trim();
  if (!cleanTo || !cleanTo.includes('@')) {
    throw new Error('Bitte eine gültige Empfänger-E-Mail-Adresse eingeben.');
  }

  const pdfBuffer = await pdfBlob.arrayBuffer();
  const pdfBase64 = wrapBase64Lines(bytesToBase64(new Uint8Array(pdfBuffer)));
  const bodyBase64 = wrapBase64Lines(utf8ToBase64(bodyText));
  const encodedSubject = `=?UTF-8?B?${utf8ToBase64(subject)}?=`;
  const safeFilename = sanitizeAttachmentFilename(filename);
  const boundary = `hafner_invoice_${Date.now().toString(36)}`;

  const mimeLines = [
    `To: ${cleanTo}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    bodyBase64,
    '',
    `--${boundary}`,
    `Content-Type: application/pdf; name="${safeFilename}"`,
    `Content-Disposition: attachment; filename="${safeFilename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    pdfBase64,
    `--${boundary}--`,
    ''
  ];

  const rawMime = mimeLines.join('\r\n');
  const rawBase64Url = asciiToBase64Url(rawMime);

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: rawBase64Url })
  });

  if (response.status === 401 || response.status === 403) {
    cachedAccessToken = null;
    notifyListeners();
    throw new Error('Gmail-Sitzung abgelaufen oder Berechtigung fehlt. Bitte erneut mit Google anmelden.');
  }

  if (!response.ok) {
    const errPayload = await response.json().catch(() => null);
    const detail = errPayload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Gmail-Versand fehlgeschlagen: ${detail}`);
  }

  return (await response.json()) as { id: string };
}
