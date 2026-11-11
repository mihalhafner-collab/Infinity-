import type { Appointment } from '../types/index.ts';

const DEFAULT_OPEN_END_MINUTES = 60;

export function parseAppointmentTime(timeStr: string | null | undefined): number | null {
  if (!timeStr || !timeStr.includes(':')) return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function minutesToAppointmentTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface EffectiveTimeRange {
  start: number;
  end: number;
  isOpenEnd: boolean;
}

export function getAppointmentRange(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  durationMinutes?: number | null
): EffectiveTimeRange | null {
  const start = parseAppointmentTime(startTime);
  if (start === null) return null;

  const end = parseAppointmentTime(endTime);
  if (end !== null && end > start) {
    return { start, end, isOpenEnd: false };
  }

  const fallbackSpan =
    durationMinutes && durationMinutes > 0 ? durationMinutes : DEFAULT_OPEN_END_MINUTES;
  return {
    start,
    end: Math.min(24 * 60, start + fallbackSpan),
    isOpenEnd: true
  };
}

export function findDayConflictingAppointmentIds(dayAppointments: Appointment[]): Set<string> {
  const timed = dayAppointments
    .map((app) => ({
      app,
      range: getAppointmentRange(app.start_time, app.end_time, app.duration_minutes)
    }))
    .filter((item): item is { app: Appointment; range: EffectiveTimeRange } => item.range !== null);

  const conflictIds = new Set<string>();
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (a.range.start < b.range.end && a.range.end > b.range.start) {
        conflictIds.add(a.app.id);
        conflictIds.add(b.app.id);
      }
    }
  }
  return conflictIds;
}

export function suggestNextFreeAppointmentSlot(
  dayAppointments: Appointment[],
  desiredDurationMin: number,
  keepEndTime: boolean
): { start: string; end: string | '' } | null {
  const span = desiredDurationMin > 0 ? desiredDurationMin : DEFAULT_OPEN_END_MINUTES;
  const ranges = dayAppointments
    .map((a) => getAppointmentRange(a.start_time, a.end_time, a.duration_minutes))
    .filter((r): r is EffectiveTimeRange => r !== null)
    .sort((a, b) => a.start - b.start);

  const candidates = ranges
    .map((r) => r.end)
    .filter((m) => m >= 6 * 60 && m + span <= 23 * 60 + 55)
    .sort((a, b) => a - b);

  for (const candStart of candidates) {
    const candEnd = candStart + span;
    const overlaps = ranges.some((r) => candStart < r.end && candEnd > r.start);
    if (!overlaps) {
      return {
        start: minutesToAppointmentTime(candStart),
        end: keepEndTime ? minutesToAppointmentTime(candEnd) : ''
      };
    }
  }
  return null;
}
