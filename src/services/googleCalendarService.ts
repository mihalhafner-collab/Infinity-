import { getAccessToken, invalidateAccessToken } from './gmailService.ts';
import { isNativeAndroidApp, readNativeDeviceCalendar } from './nativeBridge.ts';

export interface GoogleCalendarNormalizedItem {
  id: string;
  googleEventId: string;
  title: string;
  date: string; // YYYY-MM-DD (local)
  start_time: string | null; // HH:mm or null for all-day
  end_time: string | null; // HH:mm or null for all-day
  duration_minutes: number | null;
  is_all_day: boolean;
  address: string | null;
  notes: string;
  htmlLink: string | null;
}

interface GoogleCalendarApiEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: {
    dateTime?: string;
    date?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
  };
}

function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toLocalTimeHHMM(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function addDaysIsoLocal(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + days);
  return toLocalIsoDate(dt);
}

// Simple in-memory range cache so switching tabs/days is instant
let cachedRangeKey: string | null = null;
let cachedItems: GoogleCalendarNormalizedItem[] = [];

export function clearGoogleCalendarCache(): void {
  cachedRangeKey = null;
  cachedItems = [];
}

export async function fetchGoogleCalendarEvents(
  startDateIso: string,
  endDateIso: string,
  forceRefresh = false
): Promise<GoogleCalendarNormalizedItem[]> {
  const rangeKey = `${startDateIso}_${endDateIso}`;
  if (!forceRefresh && cachedRangeKey === rangeKey) {
    return cachedItems;
  }

  if (isNativeAndroidApp()) {
    const nativeItems = await readNativeDeviceCalendar(startDateIso, endDateIso);
    cachedRangeKey = rangeKey;
    cachedItems = nativeItems;
    return nativeItems;
  }

  const token = await getAccessToken();
  if (!token) {
    return [];
  }

  const [sy, sm, sd] = startDateIso.split('-').map(Number);
  const [ey, em, ed] = endDateIso.split('-').map(Number);
  const timeMin = new Date(sy, (sm || 1) - 1, sd || 1, 0, 0, 0).toISOString();
  const timeMax = new Date(ey, (em || 1) - 1, ed || 1, 23, 59, 59).toISOString();

  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin,
    timeMax,
    maxResults: '250'
  });

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (response.status === 401 || response.status === 403) {
    invalidateAccessToken();
    clearGoogleCalendarCache();
    throw new Error(
      'Bitte einmal neu mit Google anmelden, um den Kalenderzugriff freizugeben.'
    );
  }

  if (!response.ok) {
    const errJson = await response.json().catch(() => null);
    const msg = errJson?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Google Kalender konnte nicht geladen werden (${msg}).`);
  }

  const payload = (await response.json()) as { items?: GoogleCalendarApiEvent[] };
  const rawItems = payload.items || [];
  const normalized: GoogleCalendarNormalizedItem[] = [];

  for (const ev of rawItems) {
    if (ev.status === 'cancelled') continue;

    const title = ev.summary?.trim() || 'Google Kalendertermin';
    const address = ev.location?.trim() || null;
    const notes = ev.description?.trim() || '';
    const htmlLink = ev.htmlLink || null;

    if (ev.start?.dateTime) {
      const startDt = new Date(ev.start.dateTime);
      if (Number.isNaN(startDt.getTime())) continue;

      const endDt = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
      const dateStr = toLocalIsoDate(startDt);
      const startHHMM = toLocalTimeHHMM(startDt);
      let endHHMM: string | null = null;
      let durationMin: number | null = null;

      if (endDt && !Number.isNaN(endDt.getTime()) && endDt > startDt) {
        const diffMin = Math.round((endDt.getTime() - startDt.getTime()) / 60000);
        durationMin = diffMin > 0 ? diffMin : null;
        // Clamp end time if event crosses midnight
        if (toLocalIsoDate(endDt) === dateStr) {
          endHHMM = toLocalTimeHHMM(endDt);
        } else {
          endHHMM = '23:59';
        }
      }

      normalized.push({
        id: `gcal-${ev.id}-${dateStr}`,
        googleEventId: ev.id,
        title,
        date: dateStr,
        start_time: startHHMM,
        end_time: endHHMM,
        duration_minutes: durationMin,
        is_all_day: false,
        address,
        notes,
        htmlLink
      });
    } else if (ev.start?.date) {
      // All-day event (Google end.date is exclusive)
      const startDay = ev.start.date;
      const exclusiveEnd = ev.end?.date || addDaysIsoLocal(startDay, 1);
      let cursor = startDay;
      let guard = 0;
      while (cursor < exclusiveEnd && guard < 31) {
        if (cursor >= startDateIso && cursor <= endDateIso) {
          normalized.push({
            id: `gcal-${ev.id}-${cursor}`,
            googleEventId: ev.id,
            title,
            date: cursor,
            start_time: null,
            end_time: null,
            duration_minutes: null,
            is_all_day: true,
            address,
            notes,
            htmlLink
          });
        }
        cursor = addDaysIsoLocal(cursor, 1);
        guard++;
      }
    }
  }

  cachedRangeKey = rangeKey;
  cachedItems = normalized;
  return normalized;
}
