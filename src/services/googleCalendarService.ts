import { getAccessToken, invalidateAccessToken } from './gmailService.ts';
import {
  deleteNativeDeviceCalendarEvent,
  isNativeAndroidApp,
  readNativeDeviceCalendar,
  upsertNativeDeviceCalendarEvent
} from './nativeBridge.ts';
import type { Appointment } from '../types/index.ts';

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

export function extractGoogleEventId(notes?: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/\[gcal:([^\]]+)\]/);
  return match?.[1]?.trim() || null;
}

export function cleanGoogleEventNotes(notes?: string | null): string {
  if (!notes) return '';
  return notes.replace(/\[gcal:[^\]]+\]/g, '').trim();
}

export function attachGoogleEventIdToNotes(
  notes: string | undefined | null,
  googleEventId: string
): string {
  const cleaned = cleanGoogleEventNotes(notes);
  return cleaned ? `${cleaned}\n[gcal:${googleEventId}]` : `[gcal:${googleEventId}]`;
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

export async function syncAppointmentToGoogleCalendar(
  appointment: Appointment,
  customerName?: string | null
): Promise<string | null> {
  const existingGoogleId = extractGoogleEventId(appointment.notes);
  const cleanNotes = cleanGoogleEventNotes(appointment.notes);
  const baseTitle = appointment.title || 'Termin';
  const fullTitle =
    customerName && !baseTitle.toLowerCase().includes(customerName.toLowerCase())
      ? `${baseTitle} (${customerName})`
      : baseTitle;

  if (isNativeAndroidApp()) {
    try {
      const eventId = await upsertNativeDeviceCalendarEvent({
        googleEventId: existingGoogleId,
        title: fullTitle,
        date: appointment.date,
        start_time: appointment.start_time,
        end_time: appointment.end_time,
        duration_minutes: appointment.duration_minutes || 60,
        address: appointment.address || '',
        notes: cleanNotes
      });
      if (eventId) {
        clearGoogleCalendarCache();
      }
      return eventId;
    } catch {
      return null;
    }
  }

  const token = await getAccessToken();
  if (!token) return null;

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Vienna';
  const [y, m, d] = appointment.date.split('-').map(Number);
  const body: Record<string, unknown> = {
    summary: fullTitle,
    location: appointment.address || undefined,
    description: cleanNotes || undefined
  };

  if (appointment.start_time) {
    const [sh, sm] = appointment.start_time.split(':').map(Number);
    const startDt = new Date(y || 2026, (m || 1) - 1, d || 1, sh || 8, sm || 0, 0, 0);
    const endDt = new Date(y || 2026, (m || 1) - 1, d || 1, sh || 8, sm || 0, 0, 0);

    if (appointment.end_time) {
      const [eh, em] = appointment.end_time.split(':').map(Number);
      endDt.setHours(eh || (sh || 8) + 1, em || 0, 0, 0);
      if (endDt.getTime() <= startDt.getTime()) {
        endDt.setTime(startDt.getTime() + (appointment.duration_minutes || 60) * 60000);
      }
    } else {
      endDt.setTime(startDt.getTime() + (appointment.duration_minutes || 60) * 60000);
    }

    body.start = { dateTime: startDt.toISOString(), timeZone };
    body.end = { dateTime: endDt.toISOString(), timeZone };
  } else {
    body.start = { date: appointment.date };
    body.end = { date: addDaysIsoLocal(appointment.date, 1) };
  }

  try {
    if (existingGoogleId) {
      const patchRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(existingGoogleId)}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }
      );
      if (patchRes.ok) {
        clearGoogleCalendarCache();
        return existingGoogleId;
      }
    }

    const postRes = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );
    if (!postRes.ok) return null;
    const created = (await postRes.json()) as { id?: string };
    if (created.id) {
      clearGoogleCalendarCache();
      return created.id;
    }
    return null;
  } catch {
    return null;
  }
}

export async function deleteAppointmentFromGoogleCalendar(googleEventId: string): Promise<boolean> {
  if (!googleEventId) return false;
  if (isNativeAndroidApp()) {
    try {
      const ok = await deleteNativeDeviceCalendarEvent(googleEventId);
      if (ok) clearGoogleCalendarCache();
      return ok;
    } catch {
      return false;
    }
  }

  const token = await getAccessToken();
  if (!token) return false;

  try {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
    if (res.ok || res.status === 404 || res.status === 410) {
      clearGoogleCalendarCache();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
