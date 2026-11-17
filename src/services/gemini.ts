import { GoogleGenAI } from '@google/genai';

export const FIXED_API_KEY_STORAGE_KEY = 'infinity_fixed_api_key';

let cachedClient: GoogleGenAI | null = null;
let cachedClientKey = '';

/**
 * Liefert den einzigen, dauerhaft festen API-Key:
 * 1. Bevorzugt aus dem lokalen Gerätespeicher (in den App-Einstellungen auf dem Pixel 10 Pro hinterlegt).
 * 2. Fallback auf die eine Build-Umgebungsvariable VITE_GEMINI_API_KEY (aus GitHub Actions Secrets).
 */
export function getFixedApiKey(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(FIXED_API_KEY_STORAGE_KEY)?.trim();
      if (stored) {
        return stored;
      }
    }
  } catch {
    // Ignore storage access errors
  }

  const envKey = (import.meta.env?.VITE_GEMINI_API_KEY as string | undefined)?.trim();
  if (envKey && envKey !== 'MY_GEMINI_API_KEY') {
    return envKey;
  }

  return '';
}

export function getStoredDeviceApiKey(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(FIXED_API_KEY_STORAGE_KEY)?.trim() || '';
    }
  } catch {
    // Ignore
  }
  return '';
}

export function setFixedApiKey(apiKey: string): void {
  const clean = apiKey.trim();
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (clean) {
        window.localStorage.setItem(FIXED_API_KEY_STORAGE_KEY, clean);
      } else {
        window.localStorage.removeItem(FIXED_API_KEY_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore
  }
  cachedClient = null;
  cachedClientKey = '';
}

export function hasFixedApiKey(): boolean {
  return getFixedApiKey().length > 0;
}

/**
 * Einzige zentrale Stelle zur Initialisierung des GoogleGenAI-Clients im gesamten Projekt.
 */
export function getGeminiClient(): GoogleGenAI {
  const apiKey = getFixedApiKey();
  if (!apiKey) {
    throw new Error(
      'Kein API-Key hinterlegt. Bitte den festen API-Key einmalig in den Einstellungen speichern.'
    );
  }
  if (!cachedClient || cachedClientKey !== apiKey) {
    cachedClient = new GoogleGenAI({ apiKey });
    cachedClientKey = apiKey;
  }
  return cachedClient;
}
