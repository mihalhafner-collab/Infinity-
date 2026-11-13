import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { CollapsibleCard } from '../common/CollapsibleCard.tsx';
import {
  Sun,
  Moon,
  CloudSun,
  Cloud,
  CloudFog,
  CloudRain,
  CloudSnow,
  CloudLightning,
  RefreshCw,
  MapPin,
  ChevronRight,
  Clock,
  AlertTriangle,
  Wrench,
  MessageSquare,
  MoreVertical
} from 'lucide-react';
import {
  WeatherIconKind,
  useSmartphoneWeather
} from '../../services/weatherService.ts';

function renderWeatherIcon(kind: WeatherIconKind, size = 18): React.ReactNode {
  switch (kind) {
    case 'sun':
      return <Sun size={size} className="text-amber-500 shrink-0" />;
    case 'moon':
      return <Moon size={size} className="text-indigo-500 shrink-0" />;
    case 'cloud-sun':
      return <CloudSun size={size} className="text-amber-500 shrink-0" />;
    case 'cloud':
      return <Cloud size={size} className="text-slate-500 shrink-0" />;
    case 'fog':
      return <CloudFog size={size} className="text-slate-400 shrink-0" />;
    case 'rain':
      return <CloudRain size={size} className="text-sky-600 shrink-0" />;
    case 'snow':
      return <CloudSnow size={size} className="text-sky-400 shrink-0" />;
    case 'storm':
      return <CloudLightning size={size} className="text-purple-600 shrink-0" />;
  }
}

export const HeuteView: React.FC = () => {
  const {
    appointments,
    workRecords,
    equipments,
    inquiries,
    customers,
    navigate,
    setSelectedCustomerId,
    setIsThreeDotsMenuOpen
  } = useApp();

  const { weather, refreshWeather } = useSmartphoneWeather();
  const [weatherDetailsOpen, setWeatherDetailsOpen] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<'stunden' | 'faellig' | null>(null);

  const nowDate = new Date();
  const todayIso = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(nowDate.getDate()).padStart(2, '0')}`;
  const todayLabel = nowDate.toLocaleDateString('de-AT', {
    weekday: 'long',
    day: 'numeric',
    month: 'short'
  });

  // Heutige Termine
  const todayApps = useMemo(
    () =>
      appointments
        .filter((a) => a.date === todayIso)
        .sort((a, b) => (a.start_time || '99:99').localeCompare(b.start_time || '99:99')),
    [appointments, todayIso]
  );

  // Offene Arbeitsstunden (ohne L.C.R.)
  const openWork = useMemo(
    () => workRecords.filter((w) => !w.settlement_id && !w.is_lcr),
    [workRecords]
  );
  const openHoursSum = useMemo(
    () => openWork.reduce((sum, w) => sum + (w.hours || 0), 0),
    [openWork]
  );
  const openAmountSum = useMemo(
    () => openWork.reduce((sum, w) => sum + (w.accounting_amount || 0), 0),
    [openWork]
  );

  // Fällige Geräte & neue Anfragen
  const dueEquipments = useMemo(
    () => equipments.filter((e) => e.status === 'faellig'),
    [equipments]
  );
  const newInquiries = useMemo(
    () => inquiries.filter((i) => i.status === 'neu'),
    [inquiries]
  );

  const totalActionItems = openWork.length + dueEquipments.length + newInquiries.length;

  const handleOpenTour = () => {
    navigate('M02_PLANUNG');
  };

  const handleOpenCustomer = (custId: string | null) => {
    if (!custId) return;
    setSelectedCustomerId(custId);
    navigate('M03_KUNDEN');
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
      {/* Main Scroll Area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3.5 pb-4 space-y-4 overscroll-contain">
        {/* Datum & Live-Wetter Kopfzeile + Drei-Punkte-Menü */}
        <div className="flex items-start justify-between gap-2.5">
          <div>
            <h1 className="text-2xl font-bold text-slate-950 tracking-tight leading-tight">
              {todayLabel}
            </h1>
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mt-0.5 tabular-nums">
              <span>
                {todayApps.length} {todayApps.length === 1 ? 'Termin' : 'Termine'}
              </span>
              <span>·</span>
              <span>
                {todayApps
                  .reduce((sum, a) => sum + (a.duration_minutes || 60) / 60, 0)
                  .toFixed(0)}{' '}
                Std. geplant
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (weather.data) {
                  setWeatherDetailsOpen((prev) => !prev);
                } else {
                  void refreshWeather(true);
                }
              }}
              title="Live-Wetter am Smartphone-Standort (Open-Meteo)"
              className="min-h-[40px] flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200/90 rounded-2xl shadow-2xs text-sm font-bold text-slate-900 tabular-nums shrink-0 active:bg-slate-50 transition-colors"
            >
              {weather.data ? (
                <>
                  {renderWeatherIcon(weather.data.iconKind, 18)}
                  <span>{weather.data.temperatureC}°</span>
                </>
              ) : weather.status === 'loading' ? (
                <>
                  <RefreshCw size={15} className="text-slate-400 animate-spin shrink-0" />
                  <span className="text-xs text-slate-500">Wetter…</span>
                </>
              ) : (
                <>
                  <MapPin size={15} className="text-[#3138A0] shrink-0" />
                  <span className="text-xs text-[#3138A0]">Wetter</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsThreeDotsMenuOpen(true)}
              className="w-10 h-10 bg-white border border-slate-200/90 rounded-2xl shadow-2xs flex items-center justify-center text-slate-700 hover:bg-slate-50 active:scale-95 transition-all shrink-0"
              aria-label="Menü öffnen"
              title="Weitere Bereiche & Einstellungen"
            >
              <MoreVertical size={19} />
            </button>
          </div>
        </div>

        {/* Kompakte Live-Tagesvorhersage bei Tipp auf das Wetter-Badge */}
        {weatherDetailsOpen && weather.data && (
          <div className="px-3.5 py-2 bg-white border border-slate-200/90 rounded-2xl shadow-2xs flex items-center justify-between gap-2 text-xs text-slate-700">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="font-bold text-slate-900">{weather.data.conditionLabel}</span>
              {weather.data.tempMaxC !== null && weather.data.tempMinC !== null && (
                <span className="text-slate-600 tabular-nums">
                  · H: {weather.data.tempMaxC}° / T: {weather.data.tempMinC}°
                </span>
              )}
              {weather.data.precipProbabilityMax !== null && (
                <span className="text-sky-700 font-semibold tabular-nums">
                  · Regen {weather.data.precipProbabilityMax}%
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void refreshWeather(true)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-[#3138A0] active:bg-slate-100 shrink-0"
              title="Wetter aktualisieren"
            >
              <RefreshCw size={14} className={weather.status === 'loading' ? 'animate-spin' : ''} />
            </button>
          </div>
        )}

        {!weather.data && weather.status === 'permission_needed' && (
          <div className="px-3.5 py-2 bg-amber-50/80 border border-amber-200 rounded-xl flex items-center justify-between gap-2 text-xs text-amber-900">
            <span>Standortfreigabe für Live-Wetter erforderlich.</span>
            <button
              type="button"
              onClick={() => void refreshWeather(true)}
              className="font-bold text-[#3138A0] shrink-0 underline"
            >
              Freigeben
            </button>
          </div>
        )}

        {/* 1. DEIN TAG / HEUTIGE TERMINE */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-bold px-0.5">
            <span className="text-slate-600 uppercase tracking-wider text-[10px]">Dein Tag</span>
            <button
              type="button"
              onClick={handleOpenTour}
              className="py-1 px-2 -mr-2 text-[#3138A0] font-bold hover:underline flex items-center gap-0.5 rounded-xl active:bg-indigo-50/70 text-xs"
            >
              <span>Tagestour</span>
              <ChevronRight size={15} />
            </button>
          </div>

          {todayApps.length === 0 ? (
            <div className="px-4 py-3.5 bg-white border border-slate-200 rounded-2xl flex items-center justify-between text-xs text-slate-500 shadow-2xs">
              <span>Keine Termine für heute eingetragen.</span>
              <button
                type="button"
                onClick={() => navigate('M02_PLANUNG')}
                className="font-bold text-[#3138A0] hover:underline shrink-0"
              >
                Kalender →
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {todayApps.map((app, idx) => {
                const cust = customers.find((c) => c.id === app.customer_id);
                const isNext = idx === 0;

                return (
                  <div
                    key={app.id}
                    onClick={() => handleOpenCustomer(app.customer_id)}
                    className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs hover:border-[#3138A0] active:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="flex flex-col text-xs font-bold text-slate-800 font-mono tabular-nums shrink-0 pt-0.5">
                          <span>{app.start_time || 'Tag'}</span>
                          {app.end_time && (
                            <span className="text-[11px] text-slate-400 font-normal">
                              {app.end_time}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-slate-950 leading-snug">
                            {app.title || 'Termin'}
                          </h3>
                          <p className="text-xs text-slate-600 mt-0.5 truncate">
                            {cust ? cust.name : 'Ohne Kunde'}
                            {app.duration_minutes ? ` · ${app.duration_minutes} Min.` : ''}
                          </p>
                          {app.address && (
                            <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                              {app.address}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0">
                        {isNext ? (
                          <span className="text-[11px] font-bold text-[#3138A0]">
                            Als Nächstes
                          </span>
                        ) : (
                          <span className="text-[11px] font-semibold text-slate-400">
                            Geplant
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 2. ZU ERLEDIGEN (Einheitliches Ausklapp-Design) */}
        <div className="space-y-2.5 pt-0.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
              Zu erledigen
            </span>
            <span className="text-xs font-semibold text-slate-500 tabular-nums">
              {totalActionItems} {totalActionItems === 1 ? 'Hinweis' : 'Hinweise'}
            </span>
          </div>

          {/* Ausklappbare Karte 1: Offene Stunden */}
          <CollapsibleCard
            title="Offene Stunden"
            subtitle={`${openHoursSum.toFixed(2)} Std. · ${openWork.length} Einträge`}
            icon={<Clock size={17} />}
            iconBgClassName="bg-orange-50 text-[#B4470B] border-orange-100"
            headerRight={
              <span className="text-sm font-bold text-[#B4470B] tabular-nums">
                {openAmountSum.toFixed(0)} €
              </span>
            }
            open={expandedGroup === 'stunden'}
            onToggle={() =>
              setExpandedGroup((prev) => (prev === 'stunden' ? null : 'stunden'))
            }
            bodyClassName="divide-y divide-slate-100 bg-slate-50/70 border-t border-slate-100"
          >
            {openWork.length === 0 ? (
              <p className="p-3.5 text-xs text-slate-500">
                Keine offenen Arbeitsstunden vorhanden.
              </p>
            ) : (
              <>
                {openWork.slice(0, 6).map((w) => {
                  const c = customers.find((cust) => cust.id === w.customer_id);
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => navigate('M04_ABRECHNUNG')}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-slate-100/70 transition-colors"
                    >
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-slate-900 block truncate">
                          {w.title}
                        </span>
                        <span className="text-[11px] text-slate-500 tabular-nums block truncate">
                          {c?.name || 'Ohne Kunde'} · {w.work_date} · {w.hours} Std.
                        </span>
                      </div>
                      <span className="text-xs font-bold text-[#B4470B] tabular-nums shrink-0">
                        {(w.accounting_amount || 0).toFixed(2)} €
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => navigate('M04_ABRECHNUNG')}
                  className="w-full px-3.5 py-2.5 text-xs font-bold text-[#3138A0] hover:bg-indigo-50/50 text-center transition-colors"
                >
                  Zur Abrechnung ({openWork.length} offene Einträge) →
                </button>
              </>
            )}
          </CollapsibleCard>

          {/* Ausklappbare Karte 2: Fällig & neu */}
          <CollapsibleCard
            title="Fällig & neu"
            subtitle={`${dueEquipments.length} Wartung · ${newInquiries.length} neue Anfrage`}
            icon={<AlertTriangle size={17} />}
            iconBgClassName="bg-fuchsia-50 text-[#9A1B8D] border-fuchsia-100"
            headerRight={
              <span className="text-sm font-bold text-[#9A1B8D] tabular-nums">
                {dueEquipments.length + newInquiries.length}
              </span>
            }
            open={expandedGroup === 'faellig'}
            onToggle={() =>
              setExpandedGroup((prev) => (prev === 'faellig' ? null : 'faellig'))
            }
            bodyClassName="divide-y divide-slate-100 bg-slate-50/70 border-t border-slate-100"
          >
            {dueEquipments.length === 0 && newInquiries.length === 0 ? (
              <p className="p-3.5 text-xs text-slate-500">
                Keine fälligen Wartungen oder neuen Anfragen.
              </p>
            ) : (
              <>
                {dueEquipments.map((eq) => (
                  <button
                    key={eq.id}
                    type="button"
                    onClick={() => navigate('M10_GERAETE')}
                    className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-slate-100/70 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Wrench size={15} className="text-[#9A1B8D] shrink-0" />
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-slate-900 block truncate">
                          {eq.name}
                        </span>
                        <span className="text-[11px] text-slate-500 block truncate">
                          Wartung fällig: {eq.maintenance_plan}
                        </span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-fuchsia-50 text-[#9A1B8D] text-[10px] font-bold shrink-0">
                      Fällig
                    </span>
                  </button>
                ))}
                {newInquiries.map((inq) => {
                  const c = customers.find((cust) => cust.id === inq.customer_id);
                  return (
                    <button
                      key={inq.id}
                      type="button"
                      onClick={() => navigate('M05_ANFRAGEN')}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-slate-100/70 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <MessageSquare size={15} className="text-[#3138A0] shrink-0" />
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-slate-900 block truncate">
                            {inq.title}
                          </span>
                          <span className="text-[11px] text-slate-500 block truncate">
                            {c?.name || 'Kunde'} · Wunsch: {inq.desired_date || 'offen'}
                          </span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-indigo-50 text-[#3138A0] text-[10px] font-bold shrink-0">
                        Neu
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </CollapsibleCard>
        </div>
      </div>

      {/* Untere Leiste fixiert (Pixel 10 Pro Daumenzone) */}
      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-md">
        <BottomActionBar />
        <BottomNav />
      </div>
    </div>
  );
};
