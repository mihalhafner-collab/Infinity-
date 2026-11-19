import {
  GoogleAuthProvider,
  User,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect
} from 'firebase/auth';
import { auth } from './firebaseClient.ts';
import {
  disconnectNativeGmail,
  getNativeGmailConfig,
  getWebSessionToken,
  isNativeAndroidApp,
  setWebSessionToken,
  signInWithGoogleNatively,
  subscribeNativeGmailConfig
} from './nativeBridge.ts';

export const OWNER_EMAIL = 'mihalhafner@gmail.com';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.events.readonly'
];

const OAUTH_RETURN_SCREEN_KEY = 'hafner_oauth_return_screen';

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({ prompt: 'select_account' });

// In-Memory-Caching für das OAuth-Access-Token (niemals in localStorage/sessionStorage speichern)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let currentUser: User | null = null;
let lastRedirectAuthError: string | null = null;

export interface OwnerSessionState {
  checking: boolean;
  authenticated: boolean;
  email: string | null;
  error: string | null;
}

let ownerSessionState: OwnerSessionState = {
  checking: !isNativeAndroidApp(),
  authenticated: false,
  email: null,
  error: null
};

type GmailAuthListener = (state: {
  user: User | null;
  hasToken: boolean;
  error?: string | null;
}) => void;
const listeners = new Set<GmailAuthListener>();

type OwnerSessionListener = (state: OwnerSessionState) => void;
const ownerListeners = new Set<OwnerSessionListener>();

function notifyListeners() {
  const snapshot = {
    user: currentUser,
    hasToken: Boolean(cachedAccessToken),
    error: lastRedirectAuthError
  };
  listeners.forEach((fn) => fn(snapshot));
}

function notifyOwnerListeners() {
  const snap = { ...ownerSessionState };
  ownerListeners.forEach((fn) => fn(snap));
}

function formatFirebaseAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (raw.includes('auth/popup-closed-by-user') || raw.includes('auth/cancelled-popup-request')) {
    return 'Google-Anmeldung wurde abgebrochen.';
  }
  if (raw.includes('auth/popup-blocked')) {
    return 'Anmeldefenster wurde vom Browser blockiert. Bitte Popups erlauben oder direkt in Chrome öffnen.';
  }
  if (raw.includes('auth/network-request-failed')) {
    return 'Netzwerkverbindung zu Google unterbrochen. Bitte Internetverbindung prüfen und erneut versuchen.';
  }
  return raw || 'Google-Anmeldung fehlgeschlagen.';
}

function rememberOAuthReturnScreen(screenId: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(OAUTH_RETURN_SCREEN_KEY, screenId);
  } catch {
    // Ignore storage restriction
  }
}

export function consumeOAuthReturnScreen(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = sessionStorage.getItem(OAUTH_RETURN_SCREEN_KEY);
    if (val) {
      sessionStorage.removeItem(OAUTH_RETURN_SCREEN_KEY);
    }
    return val;
  } catch {
    return null;
  }
}

export function getOwnerSessionState(): OwnerSessionState {
  return { ...ownerSessionState };
}

export function subscribeOwnerSession(listener: OwnerSessionListener): () => void {
  ownerListeners.add(listener);
  listener({ ...ownerSessionState });
  return () => {
    ownerListeners.delete(listener);
  };
}

async function establishOwnerServerSession(user: User): Promise<boolean> {
  const email = (user.email || '').trim().toLowerCase();
  if (!email || email !== OWNER_EMAIL) {
    await auth.signOut().catch(() => undefined);
    setWebSessionToken(null);
    cachedAccessToken = null;
    currentUser = null;
    ownerSessionState = {
      checking: false,
      authenticated: false,
      email: null,
      error: `Zugriff verweigert: Bitte mit dem freigegebenen Konto (${OWNER_EMAIL}) anmelden.`
    };
    notifyOwnerListeners();
    notifyListeners();
    return false;
  }

  ownerSessionState = {
    checking: false,
    authenticated: true,
    email,
    error: null
  };
  notifyOwnerListeners();
  return true;
}

async function checkOwnerServerSession(): Promise<boolean> {
  ownerSessionState = { checking: false, authenticated: true, email: OWNER_EMAIL, error: null };
  notifyOwnerListeners();
  return true;
}

if (typeof window !== 'undefined' && !isNativeAndroidApp()) {
  let redirectChecked = false;
  let initialAuthEventSeen = false;
  let serverSessionChecked = false;

  const finalizeBootCheckingIfReady = () => {
    if (redirectChecked && initialAuthEventSeen && serverSessionChecked) {
      if (ownerSessionState.checking && !ownerSessionState.authenticated) {
        ownerSessionState = { ...ownerSessionState, checking: false };
        notifyOwnerListeners();
      }
    }
  };

  isSigningIn = true;
  getRedirectResult(auth)
    .then(async (result) => {
      if (result?.user) {
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) {
          cachedAccessToken = credential.accessToken;
          void fetch('/api/internal/gmail-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: cachedAccessToken })
          }).catch(() => undefined);
        }
        currentUser = result.user;
        lastRedirectAuthError = null;
        await establishOwnerServerSession(result.user);
      }
    })
    .catch((err: unknown) => {
      lastRedirectAuthError = formatFirebaseAuthError(err);
      ownerSessionState = {
        ...ownerSessionState,
        error: lastRedirectAuthError
      };
    })
    .finally(() => {
      isSigningIn = false;
      redirectChecked = true;
      notifyListeners();
      finalizeBootCheckingIfReady();
    });

  void checkOwnerServerSession().finally(() => {
    serverSessionChecked = true;
    finalizeBootCheckingIfReady();
  });

  onAuthStateChanged(auth, async (user: User | null) => {
    initialAuthEventSeen = true;
    currentUser = user;
    if (!user) {
      cachedAccessToken = null;
      notifyListeners();
      finalizeBootCheckingIfReady();
      return;
    }

    if ((!ownerSessionState.authenticated || !getWebSessionToken()) && !isSigningIn) {
      if ((user.email || '').trim().toLowerCase() === OWNER_EMAIL) {
        await establishOwnerServerSession(user);
      } else {
        await auth.signOut().catch(() => undefined);
        currentUser = null;
      }
    }
    notifyListeners();
    finalizeBootCheckingIfReady();
  });
} else if (typeof window !== 'undefined' && isNativeAndroidApp()) {
  const applyNativeGmailConfig = () => {
    const cfg = getNativeGmailConfig();
    if (cfg && (cfg.hasOAuthToken || cfg.hasAppPassword)) {
      currentUser = { email: cfg.senderEmail || OWNER_EMAIL } as User;
      cachedAccessToken = cachedAccessToken || 'native_android_gmail_connected';
    } else {
      currentUser = null;
      cachedAccessToken = null;
    }
    notifyListeners();
  };
  applyNativeGmailConfig();
  subscribeNativeGmailConfig(() => {
    applyNativeGmailConfig();
  });
}

export const subscribeGmailAuth = (listener: GmailAuthListener): (() => void) => {
  listeners.add(listener);
  listener({
    user: currentUser,
    hasToken: Boolean(cachedAccessToken),
    error: lastRedirectAuthError
  });
  return () => {
    listeners.delete(listener);
  };
};

export const googleSignIn = async (
  returnScreenId?: string
): Promise<{ user: User; accessToken: string } | null> => {
  if (isNativeAndroidApp()) {
    lastRedirectAuthError = null;
    try {
      isSigningIn = true;
      const res = await signInWithGoogleNatively();
      const email = (res.email || OWNER_EMAIL).trim();
      const userObj = { email } as User;
      cachedAccessToken = res.accessToken || 'native_android_gmail_connected';
      currentUser = userObj;
      notifyListeners();
      return { user: userObj, accessToken: cachedAccessToken };
    } catch (err: unknown) {
      throw new Error(formatFirebaseAuthError(err));
    } finally {
      isSigningIn = false;
    }
  }

  lastRedirectAuthError = null;
  if (returnScreenId) {
    rememberOAuthReturnScreen(returnScreenId);
  }

  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Kein Zugriffstoken von Google erhalten. Bitte Berechtigung bestätigen.');
    }

    consumeOAuthReturnScreen();
    cachedAccessToken = credential.accessToken;
    currentUser = result.user;
    void fetch('/api/internal/gmail-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: cachedAccessToken })
    }).catch(() => undefined);
    await establishOwnerServerSession(result.user);
    notifyListeners();
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err || '');
    if (
      typeof window !== 'undefined' &&
      window.self === window.top &&
      rawMsg.includes('auth/popup-blocked')
    ) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw new Error(formatFirebaseAuthError(err));
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (isNativeAndroidApp() && cachedAccessToken === 'native_android_gmail_connected') {
    return '';
  }
  return cachedAccessToken;
};

export const isGoogleConnected = (): boolean => {
  return Boolean(cachedAccessToken);
};

export const invalidateAccessToken = (): void => {
  cachedAccessToken = null;
  notifyListeners();
};

export const logoutGmail = async (): Promise<void> => {
  if (isNativeAndroidApp()) {
    disconnectNativeGmail();
  }
  await auth.signOut().catch(() => undefined);
  setWebSessionToken(null);
  cachedAccessToken = null;
  currentUser = null;
  lastRedirectAuthError = null;
  ownerSessionState = {
    checking: false,
    authenticated: false,
    email: null,
    error: null
  };
  notifyListeners();
  notifyOwnerListeners();
};

import {
  sendInvoicePdfViaGmail as sendInvoicePdfViaGmailCore,
  type SendGmailPdfParams
} from '../utils/invoicePdf.ts';

export type { SendGmailPdfParams };

export async function sendInvoicePdfViaGmail(
  params: Omit<SendGmailPdfParams, 'onUnauthorized'>
): Promise<{ id: string }> {
  return sendInvoicePdfViaGmailCore({
    ...params,
    onUnauthorized: () => {
      cachedAccessToken = null;
      notifyListeners();
    }
  });
}

