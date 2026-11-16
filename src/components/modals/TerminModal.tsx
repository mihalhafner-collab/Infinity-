import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { X, Calendar, Clock, MapPin, User, AlertTriangle } from 'lucide-react';
import {
  parseAppointmentTime,
  minutesToAppointmentTime,
  getAppointmentRange,
  suggestNextFreeAppointmentSlot
} from '../../utils/appointmentConflict.ts';
import { CustomerSelectField } from '../common/CustomerSelectField.tsx';

export const TerminModal: React.FC = () => {
  const {
    activeModal,
    setActiveModal,
    addAppointment,
    appointments,
    customers,
    selectedCustomerId
  } = useApp();

  const getTodayLocalIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  };

  const [title, setTitle] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(getTodayLocalIso);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (activeModal === 'TERMIN_ANLEGEN') {
      const initCustId = selectedCustomerId || '';
      const cust = customers.find((c) => c.id === initCustId);
      const initAddr =
        cust && (cust.street || cust.city)
          ? [cust.street, cust.city].filter(Boolean).join(', ')
          : '';

      setTitle('');
      setCustomerId(initCustId);
      setDate(getTodayLocalIso());
      setStartTime('');
      setEndTime('');
      setAddress(initAddr);
      setNotes('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModal]);

  if (activeModal !== 'TERMIN_ANLEGEN') return null;

  const targetDate = date || getTodayLocalIso();
  const formattedDate = targetDate.includes('-')
    ? targetDate.split('-').reverse().join('.')
    : targetDate;

  const startMin = parseAppointmentTime(startTime);
  const endMin = parseAppointmentTime(endTime);
  const hasInvalidEndTime = startMin !== null && endMin !== null && endMin <= startMin;

  // Termine am gewählten Tag (mit Uhrzeit zuerst, danach ohne Uhrzeit)
  const sameDayAppointments = appointments
    .filter((a) => a.date === targetDate)
    .sort((a, b) => {
      if (!a.start_time && !b.start_time) return 0;
      if (!a.start_time) return 1;
      if (!b.start_time) return -1;
      return a.start_time.localeCompare(b.start_time);
    });

  // Zeitliche Konfliktprüfung (inkl. Termine mit „Ende offen“ als möglicher Konflikt)
  const draftRange = !hasInvalidEndTime ? getAppointmentRange(startTime, endTime) : null;

  const conflictingAppointments = draftRange
    ? sameDayAppointments.filter((a) => {
        const aRange = getAppointmentRange(a.start_time, a.end_time, a.duration_minutes);
        if (!aRange) return false;
        return draftRange.start < aRange.end && draftRange.end > aRange.start;
      })
    : [];

  const hasTimeConflict = conflictingAppointments.length > 0;
  const conflictingIds = new Set(conflictingAppointments.map((a) => a.id));

  // Prüfen, ob ein exakter oder offener ("möglicher") Zeitkonflikt vorliegt
  const isExactOverlap =
    hasTimeConflict &&
    !draftRange?.isOpenEnd &&
    conflictingAppointments.some((a) => {
      const r = getAppointmentRange(a.start_time, a.end_time, a.duration_minutes);
      return r !== null && !r.isOpenEnd;
    });

  // Möglicher Doppeltermin am selben Tag für denselben Kunden (auch ohne Uhrzeit)
  const hasSameCustomerOnDay =
    Boolean(customerId) && sameDayAppointments.some((a) => a.customer_id === customerId);

  const desiredSpanMin =
    startMin !== null && endMin !== null && endMin > startMin ? endMin - startMin : 60;

  const suggestedSlot = hasTimeConflict
    ? suggestNextFreeAppointmentSlot(sameDayAppointments, desiredSpanMin, Boolean(endTime))
    : null;

  const handleStartTimeChange = (nextStart: string) => {
    const prevStartMin = parseAppointmentTime(startTime);
    const prevEndMin = parseAppointmentTime(endTime);
    setStartTime(nextStart);

    if (nextStart && prevEndMin !== null) {
      const nextStartMin = parseAppointmentTime(nextStart);
      const keepSpan =
        prevStartMin !== null && prevEndMin > prevStartMin ? prevEndMin - prevStartMin : 60;
      if (nextStartMin !== null && nextStartMin >= prevEndMin) {
        setEndTime(minutesToAppointmentTime(nextStartMin + keepSpan));
      }
    }
  };

  const handleSave = () => {
    if (hasInvalidEndTime) return;
    const durationMinutes =
      startMin !== null && endMin !== null && endMin > startMin ? endMin - startMin : null;

    // REQ-011: Alle Angaben optional!
    // REQ-013: Fehlender Titel erhält den Anzeigetext "Termin"
    addAppointment({
      title: title.trim() || undefined,
      customer_id: customerId || null,
      date: targetDate,
      start_time: startTime || null,
      end_time: endTime || null,
      duration_minutes: durationMinutes,
      address: address.trim() || null,
      notes: notes.trim()
    });
    setActiveModal(null);
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
      <div className="flex-1" onClick={() => setActiveModal(null)} />

      <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[90%] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900 leading-tight">Termin planen</h2>
            <p className="text-[11px] text-[#3138A0] font-medium">Alle Angaben freiwillig</p>
          </div>
          <button
            onClick={() => setActiveModal(null)}
            className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-full hover:bg-slate-100 transition-colors"
            aria-label="Schließen"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form body */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3.5 text-xs text-slate-700">
          {/* Titel (optional) */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Titel <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="z.B. Hecke schneiden (Standard: Termin)"
              className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm text-slate-900"
            />
          </div>

          {/* Kunde (optional) */}
          <div>
            <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
              <User size={13} className="text-[#3138A0]" />
              <span>
                Kunde <span className="text-slate-400 font-normal">(optional)</span>
              </span>
            </label>
            <CustomerSelectField
              customers={customers}
              value={customerId}
              allowEmpty={true}
              emptyLabel="Nicht zugeordnet (kein Kunde)"
              onChange={(nextId) => {
                setCustomerId(nextId);
                const cust = customers.find((c) => c.id === nextId);
                if (cust && !address && (cust.street || cust.city)) {
                  setAddress([cust.street, cust.city].filter(Boolean).join(', '));
                }
              }}
            />
          </div>

          {/* Datum & Uhrzeit (optional) */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Calendar size={13} className="text-slate-500" />
                <span>Tag</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Clock
                  size={13}
                  className={hasTimeConflict ? 'text-[#B42318]' : 'text-slate-500'}
                />
                <span>
                  Uhrzeit <span className="text-slate-400 font-normal">(opt.)</span>
                </span>
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => handleStartTimeChange(e.target.value)}
                placeholder="--:--"
                className={`w-full h-11 px-2.5 bg-slate-50 border rounded-xl focus:bg-white outline-hidden text-xs text-slate-900 ${
                  hasTimeConflict
                    ? 'border-red-300 bg-red-50/40 focus:border-[#B42318]'
                    : 'border-slate-200 focus:border-[#3138A0]'
                }`}
              />
            </div>
          </div>

          {/* Dauer / Ende offen & Ort */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Endzeit <span className="text-slate-400 font-normal">(opt.)</span>
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                placeholder="Ende offen"
                className={`w-full h-11 px-2.5 bg-slate-50 border rounded-xl focus:bg-white outline-hidden text-xs text-slate-900 ${
                  hasTimeConflict || hasInvalidEndTime
                    ? 'border-red-300 bg-red-50/40 focus:border-[#B42318]'
                    : 'border-slate-200 focus:border-[#3138A0]'
                }`}
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <MapPin size={13} className="text-slate-500" />
                <span>Ort / Adresse</span>
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Optional für Navigation"
                className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
              />
            </div>
          </div>

          {hasInvalidEndTime && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-[11px] font-semibold text-[#B42318] flex items-center gap-1.5">
              <AlertTriangle size={14} className="shrink-0 text-[#B42318]" />
              <span>Endzeit muss nach der Startzeit liegen.</span>
            </div>
          )}

          {/* Kurzer Hinweis bei Terminkonflikt oder bereits geplanten Terminen am selben Tag */}
          {!hasInvalidEndTime && sameDayAppointments.length > 0 && (
            <div
              className={`p-2.5 rounded-xl border text-xs space-y-1.5 ${
                hasTimeConflict
                  ? 'bg-red-50 border-red-200 text-[#B42318]'
                  : 'bg-amber-50/90 border-amber-200 text-amber-900'
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold leading-tight">
                <AlertTriangle
                  size={14}
                  className={`shrink-0 ${hasTimeConflict ? 'text-[#B42318]' : 'text-amber-600'}`}
                />
                <span>
                  {hasTimeConflict
                    ? isExactOverlap
                      ? `Terminkonflikt am ${formattedDate}`
                      : `Möglicher Terminkonflikt am ${formattedDate}`
                    : hasSameCustomerOnDay
                      ? `Möglicher Doppeltermin am ${formattedDate} (selber Kunde)`
                      : `Bereits ${
                          sameDayAppointments.length === 1
                            ? '1 Termin'
                            : `${sameDayAppointments.length} Termine`
                        } am ${formattedDate}`}
                </span>
              </div>

              <div className="space-y-1 pl-5">
                {sameDayAppointments.map((app) => {
                  const appCust = customers.find((c) => c.id === app.customer_id);
                  const isColliding = conflictingIds.has(app.id);
                  const isSameCust =
                    !hasTimeConflict && Boolean(customerId) && app.customer_id === customerId;
                  const timeLabel = app.start_time
                    ? `${app.start_time}${app.end_time ? `–${app.end_time}` : ' (offen)'}`
                    : 'Ohne Zeit';

                  return (
                    <div
                      key={app.id}
                      className={`text-[11px] flex items-center gap-1.5 leading-snug ${
                        isColliding
                          ? 'font-bold text-[#B42318]'
                          : isSameCust
                            ? 'font-bold text-amber-950'
                            : hasTimeConflict
                              ? 'text-slate-600'
                              : 'text-amber-800'
                      }`}
                    >
                      <span className="font-mono font-bold shrink-0">{timeLabel}</span>
                      <span className="truncate">
                        · {appCust ? `${appCust.name}: ` : ''}
                        {app.title || 'Termin'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {hasTimeConflict && suggestedSlot && (
                <div className="pl-5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setStartTime(suggestedSlot.start);
                      if (suggestedSlot.end) {
                        setEndTime(suggestedSlot.end);
                      }
                    }}
                    className="min-h-[32px] px-2.5 py-1 bg-white hover:bg-red-100/60 border border-red-200 text-[#B42318] font-bold rounded-lg text-[11px] transition-colors shadow-2xs"
                  >
                    Freie Zeit{' '}
                    {suggestedSlot.end
                      ? `${suggestedSlot.start}–${suggestedSlot.end}`
                      : `ab ${suggestedSlot.start}`}{' '}
                    übernehmen
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Notiz */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Notiz / Bemerkung <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="z.B. Geräte bereitstellen..."
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 resize-none"
            />
          </div>

          <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-[11px] text-slate-500 flex items-start gap-2">
            <span className="text-[#3138A0] font-bold">ⓘ</span>
            <span>
              Ohne Uhrzeit erscheint der Termin unter „Ohne Uhrzeit“. Ohne Adresse bleibt er in der Tour sichtbar, ohne Navigationsstopp.
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
          <button
            onClick={() => setActiveModal(null)}
            className="flex-1 h-12 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-semibold rounded-xl text-sm transition-all"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={hasInvalidEndTime}
            className={`flex-1 h-12 active:scale-98 text-white font-semibold rounded-xl text-sm transition-all shadow-xs disabled:opacity-40 ${
              hasTimeConflict
                ? 'bg-[#B4470B] hover:bg-[#963b09]'
                : 'bg-[#3138A0] hover:bg-[#272d82]'
            }`}
          >
            {hasTimeConflict ? 'Trotzdem speichern' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
};
