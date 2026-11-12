import { useEffect, useState } from 'react';
import { isNativeAndroidApp, readNativeDeviceLocation } from './nativeBridge.ts';

export type WeatherIconKind =
  | 'sun'
  | 'moon'
  | 'cloud-sun'
  | 'cloud'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'storm';

export type WeatherConnectionStatus =
  | 'loading'
  | 'live'
  | 'cached'
  | 'permission_needed'
  | 'error';

export interface SmartphoneWeatherSnapshot {
  temperatureC: number;
  tempMinC: number | null;
  tempMaxC: number | null;
  precipProbabilityMax: number | null;
  windSpeedKmh: number | null;
  weatherCode: number;
  isDay: boolean;
  conditionLabel: string;
  iconKind: WeatherIconKind;
  latitude: number;
  longitude: number;
  fetchedAtIso: string;
}

export interface SmartphoneWeatherState {
  status: WeatherConnectionStatus;
  data: SmartphoneWeatherSnapshot | null;
  errorMessage: string | null;
}

const WEATHER_CACHE_KEY = 'hafner_open_meteo_cache_v1';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 Minuten

function mapWmoWeatherCode(
  code: number,
  isDay: boolean
): { label: string; iconKind: WeatherIconKind } {
  if (code === 0) {
    return { label: isDay ? 'Sonnig' : 'Klar', iconKind: isDay ? 'sun' : 'moon' };
  }
  if (code === 1) {
    return { label: isDay ? 'Heiter' : 'Überwiegend klar', iconKind: isDay ? 'sun' : 'moon' };
  }
  if (code === 2) {
    return { label: 'Leicht bewölkt', iconKind: isDay ? 'cloud-sun' : 'cloud' };
  }
  if (code === 3) {
    return { label: 'Bedeckt', iconKind: 'cloud' };
  }
  if (code === 45 || code === 48) {
    return { label: 'Nebel', iconKind: 'fog' };
  }
  if (code >= 51 && code <= 57) {
    return { label: 'Nieselregen', iconKind: 'rain' };
  }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return { label: code >= 80 ? 'Regenschauer' : 'Regen', iconKind: 'rain' };
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return { label: 'Schneefall', iconKind: 'snow' };
  }
  if (code >= 95) {
    return { label: 'Gewitter', iconKind: 'storm' };
  }
  return { label: 'Wechselhaft', iconKind: 'cloud-sun' };
}

function loadCachedWeather(): SmartphoneWeatherSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SmartphoneWeatherSnapshot;
    if (
      typeof parsed?.temperatureC !== 'number' ||
      typeof parsed?.latitude !== 'number' ||
      typeof parsed?.longitude !== 'number' ||
      !parsed?.fetchedAtIso
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveCachedWeather(snapshot: SmartphoneWeatherSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage quota errors
  }
}

function isCacheFresh(snapshot: SmartphoneWeatherSnapshot | null): boolean {
  if (!snapshot?.fetchedAtIso) return false;
  const ageMs = Date.now() - new Date(snapshot.fetchedAtIso).getTime();
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < CACHE_TTL_MS;
}

async function resolveSmartphoneCoordinates(): Promise<{
  latitude: number;
  longitude: number;
}> {
  if (isNativeAndroidApp()) {
    const nativeCoords = await readNativeDeviceLocation();
    if (nativeCoords) {
      return nativeCoords;
    }
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw new Error('PERMISSION_OR_UNAVAILABLE: Standortdienst auf diesem Gerät nicht verfügbar.');
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        });
      },
      (err) => {
        if (err.code === 1) {
          reject(
            new Error(
              'PERMISSION_DENIED: Bitte Standortzugriff am Smartphone erlauben, um Live-Wetter zu laden.'
            )
          );
        } else {
          reject(new Error('Standort des Smartphones konnte momentan nicht ermittelt werden.'));
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 15 * 60 * 1000
      }
    );
  });
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
    is_day?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
}

async function fetchOpenMeteoForCoords(
  latitude: number,
  longitude: number
): Promise<SmartphoneWeatherSnapshot> {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: 'temperature_2m,weather_code,is_day,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    models: 'best_match',
    timezone: 'auto',
    forecast_days: '1'
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Open-Meteo HTTP ${res.status}`);
  }

  const json = (await res.json()) as OpenMeteoResponse;
  const temp = json.current?.temperature_2m;
  if (typeof temp !== 'number' || !Number.isFinite(temp)) {
    throw new Error('Ungültige Wetterantwort von Open-Meteo.');
  }

  const code = typeof json.current?.weather_code === 'number' ? json.current.weather_code : 0;
  const isDay = json.current?.is_day !== 0;
  const mapped = mapWmoWeatherCode(code, isDay);

  const maxArr = json.daily?.temperature_2m_max;
  const minArr = json.daily?.temperature_2m_min;
  const rainArr = json.daily?.precipitation_probability_max;

  return {
    temperatureC: Math.round(temp),
    tempMaxC: typeof maxArr?.[0] === 'number' ? Math.round(maxArr[0]) : null,
    tempMinC: typeof minArr?.[0] === 'number' ? Math.round(minArr[0]) : null,
    precipProbabilityMax: typeof rainArr?.[0] === 'number' ? Math.round(rainArr[0]) : null,
    windSpeedKmh:
      typeof json.current?.wind_speed_10m === 'number'
        ? Math.round(json.current.wind_speed_10m)
        : null,
    weatherCode: code,
    isDay,
    conditionLabel: mapped.label,
    iconKind: mapped.iconKind,
    latitude,
    longitude,
    fetchedAtIso: new Date().toISOString()
  };
}

// Zentraler In-Memory-Store für synchronen Zustand zwischen HeuteView und EinstellungenView
const initialCached = loadCachedWeather();
let currentState: SmartphoneWeatherState = initialCached
  ? {
      status: isCacheFresh(initialCached) ? 'live' : 'cached',
      data: initialCached,
      errorMessage: null
    }
  : {
      status: 'loading',
      data: null,
      errorMessage: null
    };

let refreshPromise: Promise<void> | null = null;
let autoStarted = false;
const weatherListeners = new Set<(state: SmartphoneWeatherState) => void>();

function emitWeatherState(next: SmartphoneWeatherState): void {
  currentState = next;
  weatherListeners.forEach((fn) => fn(currentState));
}

export async function refreshSmartphoneWeather(force = false): Promise<void> {
  if (!force && isCacheFresh(currentState.data)) {
    if (currentState.status !== 'live') {
      emitWeatherState({
        status: 'live',
        data: currentState.data,
        errorMessage: null
      });
    }
    return;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  if (!currentState.data) {
    emitWeatherState({
      status: 'loading',
      data: null,
      errorMessage: null
    });
  }

  refreshPromise = (async () => {
    try {
      const coords = await resolveSmartphoneCoordinates();
      const fresh = await fetchOpenMeteoForCoords(coords.latitude, coords.longitude);
      saveCachedWeather(fresh);
      emitWeatherState({
        status: 'live',
        data: fresh,
        errorMessage: null
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Wetterabruf fehlgeschlagen.';
      const isPerm =
        msg.startsWith('PERMISSION_DENIED:') ||
        msg.startsWith('PERMISSION_OR_UNAVAILABLE:') ||
        msg.toLowerCase().includes('standortberechtigung') ||
        msg.toLowerCase().includes('standortfreigabe');
      const cleanMsg = msg
        .replace(/^PERMISSION_DENIED:\s*/, '')
        .replace(/^PERMISSION_OR_UNAVAILABLE:\s*/, '');

      if (currentState.data) {
        // Falls Offline oder GPS kurzzeitig nicht erreichbar: letzten bekannten Standort erneut versuchen bzw. Cache behalten
        if (!isPerm) {
          try {
            const fallbackFresh = await fetchOpenMeteoForCoords(
              currentState.data.latitude,
              currentState.data.longitude
            );
            saveCachedWeather(fallbackFresh);
            emitWeatherState({
              status: 'live',
              data: fallbackFresh,
              errorMessage: null
            });
            return;
          } catch {
            // Behalte gecachten Wert für Offline-Gartenbetrieb
          }
        }
        emitWeatherState({
          status: 'cached',
          data: currentState.data,
          errorMessage: cleanMsg
        });
      } else {
        emitWeatherState({
          status: isPerm ? 'permission_needed' : 'error',
          data: null,
          errorMessage: cleanMsg
        });
      }
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export function useSmartphoneWeather(): {
  weather: SmartphoneWeatherState;
  refreshWeather: (force?: boolean) => Promise<void>;
} {
  const [weather, setWeather] = useState<SmartphoneWeatherState>(currentState);

  useEffect(() => {
    weatherListeners.add(setWeather);
    setWeather(currentState);

    if (!autoStarted) {
      autoStarted = true;
      void refreshSmartphoneWeather(false);
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !isCacheFresh(currentState.data)) {
        void refreshSmartphoneWeather(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      weatherListeners.delete(setWeather);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return {
    weather,
    refreshWeather: (force = true) => refreshSmartphoneWeather(force)
  };
}
