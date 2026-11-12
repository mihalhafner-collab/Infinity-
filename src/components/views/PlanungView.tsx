import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { useApp } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { GoogleSignInButton } from '../common/GoogleSignInButton.tsx';
import { UndoToast } from '../common/UndoToast.tsx';
import {
  googleSignIn,
  subscribeGmailAuth
} from '../../services/gmailService.ts';
import {
  GoogleCalendarNormalizedItem,
  fetchGoogleCalendarEvents
} from '../../services/googleCalendarService.ts';
import { isNativeAndroidApp } from '../../services/nativeBridge.ts';
import {
  AlertTriangle,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Home,
  MapPin,
  Navigation,
  RefreshCw,
  Trash2,
  User
} from 'lucide-react';
import { Appointment } from '../../types/index.ts';
import { findDayConflictingAppointmentIds } from '../../utils/appointmentConflict.ts';

type SourceFilter = 'all' | 'app' | 'google';

interface UnifiedPlanItem {
  uid: string;
  source: 'app' | 'google';
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
  is_all_day: boolean;
  customer_id: string | null;
  property_id: string | null;
  address: string | null;
  notes: string;
  appRecord?: Appointment;
  googleRecord?: GoogleCalendarNormalizedItem;
}

const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTH_SHORT = [
  'Jan.',
  'Feb.',
  'Mär.',
  'Apr.',
  'Mai',
  'Jun.',
  'Jul.',
  'Aug.',
  'Sep.',
  'Okt.',
  'Nov.',
  'Dez.'
];

function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIsoLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1);
}

function shiftIsoDate(iso: string, deltaDays: number): string {
  const dt = parseIsoLocal(iso);
  dt.setDate(dt.getDate() + deltaDays);
  return toLocalIsoDate(dt);
}

function getMondayOfIsoWeek(iso: string): string {
  const dt = parseIsoLocal(iso);
  const day = dt.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diffToMonday);
  return toLocalIsoDate(dt);
}

function getIsoWeekNumber(iso: string): number {
  const dt = parseIsoLocal(iso);
  const target = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

function formatDayHeaderDE(iso: string): string {
  const dt = parseIsoLocal(iso);
  const wd = WEEKDAY_SHORT[dt.getDay()];
  return `${wd}, ${String(dt.getDate()).padStart(2, '0')}. ${MONTH_SHORT[dt.getMonth()]} ${dt.getFullYear()}`;
}

function formatShortDayDE(iso: string): string {
  const dt = parseIsoLocal(iso);
  const wd = WEEKDAY_SHORT[dt.getDay()];
  return `${wd}, ${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.`;
}

export const PlanungView: React.FC = () => {
  const {
    appointments,
    customers,
    properties,
    addAppointment,
    deleteAppointment,
    setSelectedCustomerId,
    setPrefilledWorkTitle,
    setActiveModal,
    navigate
  } = useApp();

  const todayIso = useMemo(() => toLocalIsoDate(new Date()), []);

  const [activeTab, setActiveTab] = useState<'tag' | 'woche' | 'tour'>('tag');
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  const isNativeAndroid = isNativeAndroidApp();

  // Google Calendar Auth & Events state
  const [googleUser, setGoogleUser] = useState<FirebaseUser | null>(null);
  const [hasGoogleToken, setHasGoogleToken] = useState(false);
  const [nativeCalendarConnected, setNativeCalendarConnected] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isLoadingCalendar, setIsLoadingCalendar] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarNormalizedItem[]>([]);

  useEffect(() => {
    if (isNativeAndroid) return;
    const unsub = subscribeGmailAuth(({ user, hasToken, error }) => {
      setGoogleUser(user);
      setHasGoogleToken(hasToken);
      if (error) {
        setCalendarError(error);
      }
      if (!hasToken) {
        setGoogleEvents([]);
      }
    });
    return unsub;
  }, [isNativeAndroid]);

  const weekMondayIso = useMemo(() => getMondayOfIsoWeek(selectedDate), [selectedDate]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, idx) => {
      const dateIso = shiftIsoDate(weekMondayIso, idx);
      const dt = parseIsoLocal(dateIso);
      return {
        label: WEEKDAY_SHORT[dt.getDay()],
        dayNum: dt.getDate(),
        date: dateIso
      };
    });
  }, [weekMondayIso]);

  const fetchStartIso = useMemo(() => shiftIsoDate(weekMondayIso, -14), [weekMondayIso]);
  const fetchEndIso = useMemo(() => shiftIsoDate(weekMondayIso, 35), [weekMondayIso]);

  const loadCalendarEvents = useCallback(
    async (forceRefresh = false) => {
      if (!isNativeAndroid && !hasGoogleToken) return;
      setIsLoadingCalendar(true);
      setCalendarError(null);
      try {
        const items = await fetchGoogleCalendarEvents(fetchStartIso, fetchEndIso, forceRefresh);
        setGoogleEvents(items);
        if (isNativeAndroid) {
          setNativeCalendarConnected(true);
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Kalendertermine konnten nicht abgerufen werden.';
        setCalendarError(msg);
        if (isNativeAndroid) {
          setNativeCalendarConnected(false);
        }
      } finally {
        setIsLoadingCalendar(false);
      }
    },
    [isNativeAndroid, hasGoogleToken, fetchStartIso, fetchEndIso]
  );

  useEffect(() => {
    if (isNativeAndroid || hasGoogleToken) {
      void loadCalendarEvents(false);
    }
  }, [isNativeAndroid, hasGoogleToken, loadCalendarEvents]);

  const handleConnectGoogle = async () => {
    if (isNativeAndroid) {
      await loadCalendarEvents(true);
      return;
    }
    setIsSigningIn(true);
    setCalendarError(null);
    try {
      await googleSignIn('M02_PLANUNG');
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Google-Anmeldung wurde abgebrochen.';
      setCalendarError(msg);
    } finally {
      setIsSigningIn(false);
    }
  };

  const isCalendarConnected = isNativeAndroid ? nativeCalendarConnected : hasGoogleToken;

  const importedGoogleKeys = useMemo(() => {
    const keys = new Set<string>();
    appointments.forEach((a) => {
      const match = a.notes?.match(/\[gcal:([^\]]+)\]/);
      if (match?.[1]) {
        keys.add(`${match[1]}_${a.date}`);
      }
    });
    return keys;
  }, [appointments]);

  const allUnifiedItems = useMemo<UnifiedPlanItem[]>(() => {
    const appItems: UnifiedPlanItem[] = appointments.map((a) => ({
      uid: `app-${a.id}`,
      source: 'app',
      title: a.title || 'Termin',
      date: a.date,
      start_time: a.start_time,
      end_time: a.end_time,
      duration_minutes: a.duration_minutes,
      is_all_day: !a.start_time,
      customer_id: a.customer_id,
      property_id: a.property_id,
      address: a.address,
      notes: a.notes || '',
      appRecord: a
    }));

    const gcalItems: UnifiedPlanItem[] = googleEvents.map((g) => ({
      uid: g.id,
      source: 'google',
      title: g.title,
      date: g.date,
      start_time: g.start_time,
      end_time: g.end_time,
      duration_minutes: g.duration_minutes,
      is_all_day: g.is_all_day,
      customer_id: null,
      property_id: null,
      address: g.address,
      notes: g.notes,
      googleRecord: g
    }));

    return [...appItems, ...gcalItems];
  }, [appointments, googleEvents]);

  const filteredUnifiedItems = useMemo(() => {
    if (sourceFilter === 'app') return allUnifiedItems.filter((i) => i.source === 'app');
    if (sourceFilter === 'google') return allUnifiedItems.filter((i) => i.source === 'google');
    return allUnifiedItems;
  }, [allUnifiedItems, sourceFilter]);

  const sortPlanItems = (items: UnifiedPlanItem[]) =>
    [...items].sort((a, b) => {
      if (!a.start_time && !b.start_time) return a.title.localeCompare(b.title);
      if (!a.start_time) return 1;
      if (!b.start_time) return -1;
      const cmp = a.start_time.localeCompare(b.start_time);
      if (cmp !== 0) return cmp;
      return a.source === 'app' ? -1 : 1;
    });

  const dayAllSources = useMemo(
    () => sortPlanItems(allUnifiedItems.filter((i) => i.date === selectedDate)),
    [allUnifiedItems, selectedDate]
  );

  const dayItems = useMemo(
    () => sortPlanItems(filteredUnifiedItems.filter((i) => i.date === selectedDate)),
    [filteredUnifiedItems, selectedDate]
  );

  const dayAppCount = useMemo(
    () => dayAllSources.filter((i) => i.source === 'app').length,
    [dayAllSources]
  );
  const dayGoogleCount = useMemo(
    () => dayAllSources.filter((i) => i.source === 'google').length,
    [dayAllSources]
  );

  const getConflictIdsForItems = useCallback(
    (itemsOnDay: UnifiedPlanItem[]): Set<string> => {
      const deduplicated = itemsOnDay.filter((item) => {
        if (
          item.source === 'google' &&
          item.googleRecord &&
          importedGoogleKeys.has(`${item.googleRecord.googleEventId}_${item.date}`)
        ) {
          return false;
        }
        return true;
      });

      const pseudoAppointments: Appointment[] = deduplicated.map((i, idx) => ({
        id: i.uid,
        title: i.title,
        date: i.date,
        start_time: i.start_time,
        end_time: i.end_time,
        duration_minutes: i.duration_minutes,
        customer_id: i.customer_id,
        property_id: i.property_id,
        address: i.address,
        notes: i.notes,
        tour_order: idx
      }));

      return findDayConflictingAppointmentIds(pseudoAppointments);
    },
    [importedGoogleKeys]
  );

  const dayConflictUids = useMemo(
    () => getConflictIdsForItems(dayAllSources),
    [dayAllSources, getConflictIdsForItems]
  );

  const timedDayItems = useMemo(() => dayItems.filter((i) => Boolean(i.start_time)), [dayItems]);
  const untimedDayItems = useMemo(() => dayItems.filter((i) => !i.start_time), [dayItems]);

  const weekDateSet = useMemo(() => new Set(weekDays.map((w) => w.date)), [weekDays]);
  const weekAllSources = useMemo(
    () => allUnifiedItems.filter((i) => weekDateSet.has(i.date)),
    [allUnifiedItems, weekDateSet]
  );
  const activeScopeAllCount = activeTab === 'woche' ? weekAllSources.length : dayAllSources.length;
  const activeScopeAppCount =
    activeTab === 'woche'
      ? weekAllSources.filter((i) => i.source === 'app').length
      : dayAppCount;
  const activeScopeGoogleCount =
    activeTab === 'woche'
      ? weekAllSources.filter((i) => i.source === 'google').length
      : dayGoogleCount;

  const handlePrev = () => {
    setSelectedDate((prev) => shiftIsoDate(prev, activeTab === 'woche' ? -7 : -1));
  };

  const handleNext = () => {
    setSelectedDate((prev) => shiftIsoDate(prev, activeTab === 'woche' ? 7 : 1));
  };

  const handleImportGoogleToApp = (item: UnifiedPlanItem) => {
    if (!item.googleRecord) return;
    const gKey = `${item.googleRecord.googleEventId}_${item.date}`;
    if (importedGoogleKeys.has(gKey)) return;

    const cleanNotes = item.notes
      ? `${item.notes}\n[gcal:${item.googleRecord.googleEventId}]`
      : `[gcal:${item.googleRecord.googleEventId}]`;

    addAppointment({
      title: item.title,
      date: item.date,
      start_time: item.start_time,
      end_time: item.end_time,
      duration_minutes: item.duration_minutes,
      customer_id: null,
      property_id: null,
      address: item.address,
      notes: cleanNotes
    });
  };

  const getMapsUrl = (address: string) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

  const resolveDisplayAddress = (item: UnifiedPlanItem): string | null => {
    if (item.address) return item.address;
    if (item.customer_id) {
      const cust = customers.find((c) => c.id === item.customer_id);
      if (cust && (cust.street || cust.city)) {
        return [cust.street, cust.city].filter(Boolean).join(', ');
      }
    }
    return null;
  };

  const cleanDisplayNotes = (notes: string): string =>
    notes.replace(/\[gcal:[^\]]+\]/g, '').trim();

  const weekNumber = useMemo(() => getIsoWeekNumber(selectedDate), [selectedDate]);
  const weekSundayIso = weekDays[6]?.date || selectedDate;

  const headerSubtitle =
    activeTab === 'woche'
      ? `KW ${weekNumber} · ${formatShortDayDE(weekMondayIso)} – ${formatShortDayDE(weekSundayIso)}`
      : formatDayHeaderDE(selectedDate);

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
      {/* ==================== OBEN: REINE ANSICHT ==================== */}
      <Header title="Planung" subtitle={headerSubtitle} />

      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3 overscroll-contain">
        {/* Schlanke Statuszeile (nur Info, keine Bedienung oben) */}
        <div className="flex items-center justify-between text-[11px] px-0.5 text-slate-500">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 font-semibold text-[#3138A0]">
              <span className="w-2 h-2 rounded-full bg-[#3138A0]" />
              App: {activeScopeAppCount}
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-[#0B8043]">
              <span className="w-2 h-2 rounded-full bg-[#0B8043]" />
              Google: {isCalendarConnected ? activeScopeGoogleCount : 'nicht verbunden'}
            </span>
          </div>

          {isCalendarConnected && (
            <button
              type="button"
              onClick={() => void loadCalendarEvents(true)}
              disabled={isLoadingCalendar}
              className="inline-flex items-center gap-1 text-[10px] text-[#0B8043] font-semibold truncate max-w-[165px] hover:underline disabled:opacity-60"
            >
              <RefreshCw
                size={11}
                className={`shrink-0 ${isLoadingCalendar ? 'animate-spin' : ''}`}
              />
              <span className="truncate">
                {isLoadingCalendar
                  ? 'Synchronisiere…'
                  : isNativeAndroid
                    ? 'Pixel Kalender'
                    : googleUser?.email || 'Verbunden'}
              </span>
            </button>
          )}
        </div>

        {/* Fehlermeldung falls Google Kalender erneuert werden muss */}
        {calendarError && (
          <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-[11px] text-[#B42318]">
            {calendarError}
          </div>
        )}

        {/* Konflikt-Hinweis am gewählten Tag (App + Google gemeinsam geprüft) */}
        {activeTab !== 'woche' && dayConflictUids.size > 0 && (
          <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-[#B42318]">
            <AlertTriangle size={15} className="shrink-0 text-[#B42318]" />
            <span className="font-bold text-[11px]">
              Zeitüberschneidung: {dayConflictUids.size} Termine (App / Google) überlappen sich.
            </span>
          </div>
        )}

        {/* 1. TAG-ANSICHT */}
        {activeTab === 'tag' && (
          <div className="space-y-3">
            {untimedDayItems.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-0.5 block">
                  Ganztägig & Ohne Uhrzeit ({untimedDayItems.length})
                </span>

                <div className="space-y-2">
                  {untimedDayItems.map((item) => {
                    const cust = item.customer_id
                      ? customers.find((c) => c.id === item.customer_id)
                      : null;
                    const prop = item.property_id
                      ? properties.find((p) => p.id === item.property_id)
                      : null;
                    const addr = resolveDisplayAddress(item);
                    const isAlreadyInApp =
                      item.source === 'google' &&
                      item.googleRecord &&
                      importedGoogleKeys.has(
                        `${item.googleRecord.googleEventId}_${item.date}`
                      );

                    return (
                      <div
                        key={item.uid}
                        className={`p-3 bg-white border border-slate-200 rounded-xl shadow-2xs border-l-4 ${
                          item.source === 'app' ? 'border-l-[#3138A0]' : 'border-l-[#0B8043]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  item.source === 'app'
                                    ? 'bg-indigo-50 text-[#3138A0]'
                                    : 'bg-emerald-50 text-[#0B8043]'
                                }`}
                              >
                                {item.source === 'app' ? 'App' : 'Google'}
                              </span>
                              <span className="text-[10px] font-semibold text-slate-400">
                                {item.source === 'google' ? 'Ganztägig' : 'Flexibel'}
                              </span>
                            </div>

                            <h4 className="text-xs font-bold text-slate-900 mt-1 leading-snug">
                              {item.title}
                            </h4>

                            {(cust || prop || addr) && (
                              <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                                {cust ? cust.name : ''}
                                {cust && prop ? ` · ${prop.name}` : prop ? prop.name : ''}
                                {(cust || prop) && addr ? ` · ${addr}` : addr || ''}
                              </p>
                            )}
                          </div>

                          {item.source === 'google' ? (
                            <button
                              type="button"
                              disabled={Boolean(isAlreadyInApp)}
                              onClick={() => handleImportGoogleToApp(item)}
                              className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 shrink-0 transition-colors ${
                                isAlreadyInApp
                                  ? 'bg-slate-100 text-slate-400'
                                  : 'bg-emerald-50 hover:bg-emerald-100 text-[#0B8043]'
                              }`}
                            >
                              {isAlreadyInApp ? (
                                <>
                                  <Check size={11} />
                                  <span>In App</span>
                                </>
                              ) : (
                                <>
                                  <Download size={11} />
                                  <span>Übernehmen</span>
                                </>
                              )}
                            </button>
                          ) : (
                            item.appRecord && (
                              <button
                                type="button"
                                onClick={() => deleteAppointment(item.appRecord!.id)}
                                className="w-7 h-7 rounded-lg text-slate-400 hover:text-[#B42318] hover:bg-red-50 flex items-center justify-center shrink-0 transition-colors"
                                title="Termin löschen"
                              >
                                <Trash2 size={13} />
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {timedDayItems.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-0.5 block">
                  Zeitplan ({timedDayItems.length})
                </span>

                <div className="space-y-2.5">
                  {timedDayItems.map((item) => {
                    const cust = item.customer_id
                      ? customers.find((c) => c.id === item.customer_id)
                      : null;
                    const prop = item.property_id
                      ? properties.find((p) => p.id === item.property_id)
                      : null;
                    const addr = resolveDisplayAddress(item);
                    const notesClean = cleanDisplayNotes(item.notes);
                    const isConflict = dayConflictUids.has(item.uid);
                    const isAlreadyInApp =
                      item.source === 'google' &&
                      item.googleRecord &&
                      importedGoogleKeys.has(
                        `${item.googleRecord.googleEventId}_${item.date}`
                      );

                    return (
                      <div
                        key={item.uid}
                        className={`p-3 bg-white border rounded-2xl shadow-2xs border-l-4 transition-all space-y-2 ${
                          isConflict
                            ? 'border-red-300 border-l-[#B42318] bg-red-50/15'
                            : item.source === 'app'
                              ? 'border-slate-200 border-l-[#3138A0]'
                              : 'border-slate-200 border-l-[#0B8043]'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-13 shrink-0 pt-0.5 font-mono">
                            <span
                              className={`text-xs font-bold block leading-tight ${
                                isConflict ? 'text-[#B42318]' : 'text-slate-900'
                              }`}
                            >
                              {item.start_time}
                            </span>
                            <span className="text-[11px] text-slate-400 block leading-tight">
                              {item.end_time || 'offen'}
                            </span>
                            {item.duration_minutes ? (
                              <span className="text-[10px] text-slate-400 block mt-0.5">
                                {item.duration_minutes}m
                              </span>
                            ) : null}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    item.source === 'app'
                                      ? 'bg-indigo-50 text-[#3138A0]'
                                      : 'bg-emerald-50 text-[#0B8043]'
                                  }`}
                                >
                                  {item.source === 'app' ? 'App-Termin' : 'Google Kalender'}
                                </span>

                                {isConflict && (
                                  <span className="px-1.5 py-0.5 rounded bg-red-100 text-[#B42318] text-[10px] font-bold">
                                    Konflikt
                                  </span>
                                )}
                              </div>

                              {item.source === 'app' && item.appRecord && (
                                <button
                                  type="button"
                                  onClick={() => deleteAppointment(item.appRecord!.id)}
                                  className="w-6 h-6 rounded-md text-slate-400 hover:text-[#B42318] hover:bg-red-50 flex items-center justify-center shrink-0"
                                  title="Termin löschen"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>

                            <h4 className="text-sm font-bold text-slate-900 leading-snug mt-1">
                              {item.title}
                            </h4>

                            {(cust || prop) && (
                              <p className="text-xs text-slate-600 mt-0.5 flex items-center gap-1.5 flex-wrap">
                                {cust && (
                                  <span className="inline-flex items-center gap-1 font-medium">
                                    <User size={11} className="text-[#3138A0]" />
                                    {cust.name}
                                  </span>
                                )}
                                {prop && (
                                  <span className="inline-flex items-center gap-1 text-[#3138A0] font-semibold text-[11px]">
                                    <Home size={11} />
                                    {prop.name}
                                  </span>
                                )}
                              </p>
                            )}

                            {addr && (
                              <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1 truncate">
                                <MapPin size={11} className="shrink-0 text-slate-400" />
                                <span className="truncate">{addr}</span>
                              </p>
                            )}

                            {notesClean && (
                              <p className="text-[11px] text-slate-500 bg-slate-50 px-2 py-1 rounded-lg mt-1.5 line-clamp-2">
                                {notesClean}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                          {item.source === 'app' ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {item.customer_id && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedCustomerId(item.customer_id);
                                    navigate('M03_KUNDEN');
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold transition-colors"
                                >
                                  Kundenakte
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  if (item.customer_id) {
                                    setSelectedCustomerId(item.customer_id);
                                  }
                                  setPrefilledWorkTitle(item.title);
                                  setActiveModal('ARBEIT_NACHTRAGEN');
                                }}
                                className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] text-[11px] font-semibold flex items-center gap-1 transition-colors"
                              >
                                <Clock size={11} />
                                <span>Arbeit erfassen</span>
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={Boolean(isAlreadyInApp)}
                              onClick={() => handleImportGoogleToApp(item)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                                isAlreadyInApp
                                  ? 'bg-slate-100 text-slate-400'
                                  : 'bg-emerald-50 hover:bg-emerald-100 text-[#0B8043]'
                              }`}
                            >
                              {isAlreadyInApp ? (
                                <>
                                  <Check size={12} />
                                  <span>In App übernommen</span>
                                </>
                              ) : (
                                <>
                                  <Download size={12} />
                                  <span>In App übernehmen</span>
                                </>
                              )}
                            </button>
                          )}

                          {addr && (
                            <a
                              href={getMapsUrl(addr)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold flex items-center gap-1 shrink-0 transition-colors"
                            >
                              <Navigation size={11} className="text-[#3138A0]" />
                              <span>Route</span>
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {dayItems.length === 0 && (
              <div className="p-8 bg-white border border-slate-200 rounded-2xl text-center space-y-1.5">
                <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                  <Calendar size={18} />
                </div>
                <p className="text-xs font-bold text-slate-800">
                  Freier Tag ({formatDayHeaderDE(selectedDate)})
                </p>
                <p className="text-[11px] text-slate-500">
                  Keine Termine im gewählten Filter eingetragen.
                </p>
              </div>
            )}
          </div>
        )}

        {/* 2. WOCHEN-ANSICHT */}
        {activeTab === 'woche' && (
          <div className="space-y-2.5">
            {weekDays.map((wd) => {
              const itemsForDay = sortPlanItems(
                filteredUnifiedItems.filter((i) => i.date === wd.date)
              );
              const allSourcesForDay = allUnifiedItems.filter((i) => i.date === wd.date);
              const conflictsOnDay = getConflictIdsForItems(allSourcesForDay);
              const isToday = wd.date === todayIso;
              const isSelected = wd.date === selectedDate;

              if (itemsForDay.length === 0) {
                return (
                  <div
                    key={wd.date}
                    onClick={() => {
                      setSelectedDate(wd.date);
                      setActiveTab('tag');
                    }}
                    className={`px-3 py-2 bg-white border rounded-xl flex items-center justify-between cursor-pointer transition-colors ${
                      isToday
                        ? 'border-indigo-200 bg-indigo-50/30'
                        : 'border-slate-200/80 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-bold ${
                          isToday ? 'text-[#3138A0]' : 'text-slate-700'
                        }`}
                      >
                        {formatShortDayDE(wd.date)}
                      </span>
                      {isToday && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-[#3138A0] text-[9px] font-bold">
                          Heute
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400">Frei</span>
                  </div>
                );
              }

              return (
                <div
                  key={wd.date}
                  className={`bg-white border rounded-2xl overflow-hidden shadow-2xs ${
                    isSelected
                      ? 'border-[#3138A0]/50'
                      : isToday
                        ? 'border-indigo-200'
                        : 'border-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDate(wd.date);
                      setActiveTab('tag');
                    }}
                    className="w-full px-3 py-2 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between text-left hover:bg-slate-100/70 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">
                        {formatShortDayDE(wd.date)}
                      </span>
                      {isToday && (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-[#3138A0] text-[9px] font-bold">
                          Heute
                        </span>
                      )}
                      {conflictsOnDay.size > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-red-100 text-[#B42318] text-[9px] font-bold">
                          Konflikt
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-semibold text-slate-500">
                      {itemsForDay.length} {itemsForDay.length === 1 ? 'Termin' : 'Termine'} →
                    </span>
                  </button>

                  <div className="divide-y divide-slate-100">
                    {itemsForDay.map((item) => {
                      const cust = item.customer_id
                        ? customers.find((c) => c.id === item.customer_id)
                        : null;
                      const isConflict = conflictsOnDay.has(item.uid);

                      return (
                        <div
                          key={item.uid}
                          onClick={() => {
                            setSelectedDate(wd.date);
                            setActiveTab('tag');
                          }}
                          className="px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-50 transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`w-1.5 h-6 rounded-full shrink-0 ${
                                isConflict
                                  ? 'bg-[#B42318]'
                                  : item.source === 'app'
                                    ? 'bg-[#3138A0]'
                                    : 'bg-[#0B8043]'
                              }`}
                            />
                            <span className="font-mono text-[11px] font-bold text-slate-700 w-12 shrink-0">
                              {item.start_time || 'Tag'}
                            </span>
                            <div className="min-w-0">
                              <span className="text-xs font-bold text-slate-900 block truncate">
                                {item.title}
                              </span>
                              {(cust || item.address) && (
                                <span className="text-[10px] text-slate-500 block truncate">
                                  {cust ? cust.name : item.address}
                                </span>
                              )}
                            </div>
                          </div>

                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${
                              item.source === 'app'
                                ? 'bg-indigo-50 text-[#3138A0]'
                                : 'bg-emerald-50 text-[#0B8043]'
                            }`}
                          >
                            {item.source === 'app' ? 'App' : 'Google'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 3. TOUR-ANSICHT */}
        {activeTab === 'tour' && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs font-semibold px-0.5">
              <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">
                Tagestour · {formatShortDayDE(selectedDate)}
              </span>
              <span className="text-[11px] text-slate-500">
                {dayItems.filter((i) => Boolean(resolveDisplayAddress(i))).length} mit Adresse
              </span>
            </div>

            {dayItems.length === 0 ? (
              <div className="p-8 bg-white border border-slate-200 rounded-2xl text-center text-slate-400 text-xs">
                Keine Stopps für die Tagestour an diesem Tag vorhanden.
              </div>
            ) : (
              dayItems.map((item, idx) => {
                const cust = item.customer_id
                  ? customers.find((c) => c.id === item.customer_id)
                  : null;
                const address = resolveDisplayAddress(item);

                return (
                  <div
                    key={item.uid}
                    className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-7 h-7 rounded-full text-white font-bold text-xs flex items-center justify-center shrink-0 ${
                            item.source === 'app' ? 'bg-[#3138A0]' : 'bg-[#0B8043]'
                          }`}
                        >
                          {idx + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-sm font-bold text-slate-900 leading-tight truncate">
                              {item.title}
                            </h4>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${
                                item.source === 'app'
                                  ? 'bg-indigo-50 text-[#3138A0]'
                                  : 'bg-emerald-50 text-[#0B8043]'
                              }`}
                            >
                              {item.source === 'app' ? 'App' : 'Google'}
                            </span>
                          </div>
                          <span className="text-xs text-slate-500 block truncate">
                            {item.start_time || 'Ganztägig / Flexibel'}
                            {item.end_time ? ` – ${item.end_time}` : ''}
                            {cust ? ` · ${cust.name}` : ''}
                          </span>
                        </div>
                      </div>
                    </div>

                    {address ? (
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-1.5 text-slate-600 min-w-0">
                          <MapPin size={13} className="text-[#3138A0] shrink-0" />
                          <span className="truncate">{address}</span>
                        </div>
                        <a
                          href={getMapsUrl(address)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] font-semibold text-[11px] rounded-lg flex items-center gap-1 shrink-0 transition-colors"
                        >
                          <Navigation size={12} />
                          <span>Route</span>
                        </a>
                      </div>
                    ) : (
                      <div className="pt-1 text-[11px] text-slate-400 italic">
                        Keine Adresse hinterlegt
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <UndoToast />

      {/* ==================== UNTEN: KOMPLETTE BEDIENUNG (PIXEL 10 PRO DAUMENZONE) ==================== */}
      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200 z-20 shadow-[0_-4px_16px_rgba(15,23,42,0.06)]">
        <div className="px-3 pt-2.5 pb-2 space-y-2 border-b border-slate-100">
          {/* Google- / Pixel-Kalender-Anmeldung direkt in der Daumenzone, solange noch nicht verbunden */}
          {!isCalendarConnected && sourceFilter !== 'app' && (
            <div className="p-2 bg-emerald-50/60 border border-emerald-200/80 rounded-xl flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-[#0B8043] leading-tight">
                {isNativeAndroid ? 'Pixel System-Kalender:' : 'Google Kalender verbinden:'}
              </span>
              <div className="shrink-0">
                {isNativeAndroid ? (
                  <button
                    type="button"
                    onClick={handleConnectGoogle}
                    disabled={isLoadingCalendar}
                    className="h-9 px-3.5 rounded-full bg-[#0B8043] text-white text-xs font-bold flex items-center gap-1.5 shadow-2xs active:opacity-90 disabled:opacity-60"
                  >
                    <Calendar size={14} />
                    <span>{isLoadingCalendar ? 'Lade…' : 'Kalender freigeben'}</span>
                  </button>
                ) : (
                  <GoogleSignInButton
                    onClick={handleConnectGoogle}
                    disabled={isSigningIn}
                    label={isSigningIn ? 'Verbinde…' : 'Sign in with Google'}
                  />
                )}
              </div>
            </div>
          )}

          {/* 7-Tage-Schnellwahl (Mo–So) mit App- & Google-Indikatorpunkten */}
          <div className="grid grid-cols-7 gap-1.5">
            {weekDays.map((wd) => {
              const isSelected = selectedDate === wd.date;
              const isToday = wd.date === todayIso;
              const hasApp = appointments.some((a) => a.date === wd.date);
              const hasGoogle = googleEvents.some((g) => g.date === wd.date);

              return (
                <button
                  key={wd.date}
                  type="button"
                  onClick={() => {
                    setSelectedDate(wd.date);
                    if (activeTab === 'woche') {
                      setActiveTab('tag');
                    }
                  }}
                  className={`py-2 px-1 flex flex-col items-center rounded-xl transition-all border ${
                    isSelected
                      ? 'bg-[#3138A0] border-[#3138A0] text-white shadow-2xs'
                      : isToday
                        ? 'bg-indigo-50/80 border-indigo-200 text-[#3138A0]'
                        : 'bg-slate-50 border-transparent text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase leading-none">
                    {wd.label}
                  </span>
                  <span className="text-sm font-bold leading-tight mt-0.5 tabular-nums">{wd.dayNum}</span>
                  <div className="flex items-center gap-0.5 h-1.5 mt-0.5">
                    {hasApp && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isSelected ? 'bg-white' : 'bg-[#3138A0]'
                        }`}
                      />
                    )}
                    {hasGoogle && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isSelected ? 'bg-emerald-300' : 'bg-[#0B8043]'
                        }`}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Datumsnavigation + Quellenfilter */}
          <div className="flex items-center justify-between gap-1.5">
            {/* Datum Vor / Kalender / Heute / Zurück */}
            <div className="flex items-center gap-0.5 bg-slate-100 rounded-xl p-0.5 shrink-0">
              <button
                type="button"
                onClick={handlePrev}
                className="w-9 h-9 flex items-center justify-center text-slate-800 hover:bg-white rounded-lg transition-colors"
                aria-label="Zurück"
              >
                <ChevronLeft size={19} />
              </button>

              <label className="relative cursor-pointer h-9 px-2.5 flex items-center gap-1.5 text-xs font-bold text-slate-900 hover:bg-white rounded-lg transition-colors">
                <Calendar size={14} className="text-[#3138A0]" />
                <span>{formatShortDayDE(selectedDate)}</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    if (e.target.value) setSelectedDate(e.target.value);
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
              </label>

              {selectedDate !== todayIso && (
                <button
                  type="button"
                  onClick={() => setSelectedDate(todayIso)}
                  className="h-9 px-2.5 text-xs font-bold text-[#3138A0] bg-white rounded-lg shadow-2xs"
                >
                  Heute
                </button>
              )}

              <button
                type="button"
                onClick={handleNext}
                className="w-9 h-9 flex items-center justify-center text-slate-800 hover:bg-white rounded-lg transition-colors"
                aria-label="Weiter"
              >
                <ChevronRight size={19} />
              </button>
            </div>

            {/* Quellenfilter (Alle / App / Google) + Sync */}
            <div className="flex items-center gap-1 min-w-0">
              <div className="flex items-center bg-slate-100 p-0.5 rounded-xl">
                <button
                  type="button"
                  onClick={() => setSourceFilter('all')}
                  className={`h-9 px-2.5 rounded-lg text-xs font-bold transition-all ${
                    sourceFilter === 'all'
                      ? 'bg-white text-slate-950 shadow-2xs'
                      : 'text-slate-600'
                  }`}
                >
                  Alle
                </button>
                <button
                  type="button"
                  onClick={() => setSourceFilter('app')}
                  className={`h-9 px-2.5 rounded-lg text-xs font-bold transition-all ${
                    sourceFilter === 'app'
                      ? 'bg-[#3138A0] text-white shadow-2xs'
                      : 'text-[#3138A0]'
                  }`}
                >
                  App
                </button>
                <button
                  type="button"
                  onClick={() => setSourceFilter('google')}
                  className={`h-9 px-2.5 rounded-lg text-xs font-bold transition-all ${
                    sourceFilter === 'google'
                      ? 'bg-[#0B8043] text-white shadow-2xs'
                      : 'text-[#0B8043]'
                  }`}
                >
                  Google
                </button>
              </div>

              {hasGoogleToken && (
                <button
                  type="button"
                  onClick={() => void loadCalendarEvents(true)}
                  disabled={isLoadingCalendar}
                  title="Google Kalender aktualisieren"
                  className="w-10 h-10 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-[#0B8043] flex items-center justify-center shrink-0 transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={16} className={isLoadingCalendar ? 'animate-spin' : ''} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Ansicht-Umschalter [Tag | Woche | Tour] direkt in der unteren Aktionsleiste zwischen Suche & Plus */}
        <BottomActionBar>
          <div className="w-full max-w-[248px] flex items-center p-1 bg-slate-100 rounded-2xl">
            <button
              type="button"
              onClick={() => setActiveTab('tag')}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                activeTab === 'tag'
                  ? 'bg-white text-[#3138A0] shadow-xs'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              Tag
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('woche')}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                activeTab === 'woche'
                  ? 'bg-white text-[#3138A0] shadow-xs'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              Woche
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('tour')}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all ${
                activeTab === 'tour'
                  ? 'bg-white text-[#3138A0] shadow-xs'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              Tour
            </button>
          </div>
        </BottomActionBar>

        <BottomNav />
      </div>
    </div>
  );
};
