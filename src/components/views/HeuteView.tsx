import React, { useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
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
  ChevronDown,
  Clock,
  AlertTriangle,
  Wrench,
  MessageSquare
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
    setSelectedCustomerId
  } = useApp();

  const { weather, refreshWeather } = useSmartphoneWeather();
  const [weatherDetailsOpen, setWeatherDetailsOpen] = useState(false);
  const [openHoursExpanded, setOpenHoursExpanded] = useState(false);
  const [tasksExpanded, setTasksExpanded] = useState(false);

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

  // Filter today's appointments
  const todayApps = appointments
    .filter((a) => a.date === todayIso)
    .sort((a, b) => (a.start_time || '99:99').localeCompare(b.start_time || '99:99'));

  // Calculate open unbilled hours (excluding LCR!)
  const openWork = workRecords.filter((w) => !w.settlement_id && !w.is_lcr);
  const openHoursSum = openWork.reduce((sum, w) => sum + (w.hours || 0), 0);
  const openAmountSum = openWork.reduce((sum, w) => sum + (w.accounting_amount || 0), 0);

  // Due maintenance
  const dueEquipments = equipments.filter((e) => e.status === 'faellig');
  const newInquiries = inquiries.filter((i) => i.status === 'neu');

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
      <Header title="Heute" />

      {/* Main Scroll Area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 overscroll-contain">
        {/* Date & Weather Row (ILL-001) */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-950 tracking-tight leading-tight">
              {todayLabel}
            </h2>
            <div className="flex items-center gap-1.5 text-sm text-slate-600 mt-1 tabular-nums">
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

          {/* Live Open-Meteo Smartphone Weather Widget */}
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
            className="min-h-[42px] flex items-center gap-2 px-3 py-2 bg-white border border-slate-200/90 rounded-2xl shadow-2xs text-sm font-bold text-slate-900 tabular-nums shrink-0 active:bg-slate-50 transition-colors"
          >
            {weather.data ? (
              <>
                {renderWeatherIcon(weather.data.iconKind, 18)}
                <span>{weather.data.temperatureC}°</span>
              </>
            ) : weather.status === 'loading' ? (
              <>
                <RefreshCw size={16} className="text-slate-400 animate-spin shrink-0" />
                <span className="text-xs text-slate-500">Wetter…</span>
              </>
            ) : (
              <>
                <MapPin size={16} className="text-[#3138A0] shrink-0" />
                <span className="text-xs text-[#3138A0]">Wetter</span>
              </>
            )}
          </button>
        </div>

        {/* Kompakte Live-Tagesvorhersage bei Tipp auf das Wetter-Badge */}
        {weatherDetailsOpen && weather.data && (
          <div className="px-3.5 py-2.5 bg-white border border-slate-200/90 rounded-2xl shadow-2xs flex items-center justify-between gap-2 text-xs text-slate-700">
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

        {/* Dein Tag / Tagestour Teaser */}
        <div className="flex items-center justify-between text-sm font-semibold px-0.5">
          <span className="text-slate-600 tracking-wide text-xs font-bold">Dein Tag</span>
          <button
            onClick={handleOpenTour}
            className="min-h-[44px] -my-2 px-2 text-[#3138A0] font-bold hover:underline flex items-center gap-0.5 rounded-xl active:bg-indigo-50/70"
          >
            <span>Tagestour</span>
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Termine heute Liste */}
        <div className="space-y-3">
          {todayApps.length === 0 ? (
            <div className="p-5 bg-white border border-slate-200 rounded-2xl text-center text-sm text-slate-600">
              Keine Termine für heute eingetragen.
            </div>
          ) : (
            todayApps.map((app, idx) => {
              const cust = customers.find((c) => c.id === app.customer_id);
              const isNext = idx === 0;

              return (
                <div
                  key={app.id}
                  onClick={() => handleOpenCustomer(app.customer_id)}
                  className="p-4 bg-white border border-slate-200 rounded-2xl shadow-2xs hover:border-[#3138A0] active:bg-slate-50 transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className="flex flex-col text-sm font-bold text-slate-800 font-mono tabular-nums shrink-0 pt-0.5">
                        <span>{app.start_time || 'Ohne Zeit'}</span>
                        {app.end_time && (
                          <span className="text-xs text-slate-500 font-normal">{app.end_time}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-bold text-slate-950 leading-snug">
                          {app.title || 'Termin'}
                        </h3>
                        <p className="text-sm text-slate-600 mt-0.5">
                          {cust ? cust.name : 'Ohne Kunde'}
                          {app.duration_minutes ? ` · ${app.duration_minutes} Min.` : ''}
                        </p>
                        {app.address && (
                          <p className="text-xs text-slate-500 mt-0.5 truncate">
                            {app.address}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {isNext ? (
                        <span className="text-xs font-bold text-[#3138A0]">
                          Als Nächstes
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-slate-500">
                          Geplant
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Section: Zu erledigen (Aufklappbare Gruppen gem. REQ-004) */}
        <div className="pt-1">
          <div className="flex items-center justify-between text-xs font-bold px-0.5 mb-2.5">
            <span className="text-slate-600 tracking-wide">Zu erledigen</span>
            <span className="text-slate-500 font-semibold tabular-nums">
              {openWork.length + dueEquipments.length + newInquiries.length}{' '}
              {openWork.length + dueEquipments.length + newInquiries.length === 1
                ? 'Hinweis'
                : 'Hinweise'}
            </span>
          </div>

          <div className="space-y-2.5">
            {/* Offene Stunden Gruppe */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
              <button
                onClick={() => setOpenHoursExpanded(!openHoursExpanded)}
                className="w-full min-h-[58px] p-3.5 flex items-center justify-between hover:bg-slate-50 active:bg-slate-100/70 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center text-[#B4470B] shrink-0">
                    <Clock size={19} />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-slate-950 block leading-tight">
                      Offene Stunden
                    </span>
                    <span className="text-xs text-slate-600 tabular-nums">
                      {openHoursSum} Std. · {openAmountSum.toFixed(0)} €
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-bold text-[#B4470B] tabular-nums">
                    {openAmountSum.toFixed(0)} €
                  </span>
                  {openHoursExpanded ? (
                    <ChevronDown size={18} className="text-slate-500" />
                  ) : (
                    <ChevronRight size={18} className="text-slate-500" />
                  )}
                </div>
              </button>

              {openHoursExpanded && (
                <div className="p-3.5 bg-slate-50/70 border-t border-slate-100 text-sm">
                  {openWork.length === 0 ? (
                    <p className="py-2 text-center text-slate-500 italic">
                      Keine offenen Arbeitsstunden vorhanden.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-200/70">
                      {openWork.map((w) => {
                        const c = customers.find((cust) => cust.id === w.customer_id);
                        return (
                          <div key={w.id} className="py-2.5 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <span className="font-bold text-slate-900 block truncate">
                                {w.title}
                              </span>
                              <span className="text-xs text-slate-600 tabular-nums">
                                {c?.name} · {w.hours} Std.
                              </span>
                            </div>
                            <span className="font-bold text-[#B4470B] tabular-nums shrink-0">
                              {(w.accounting_amount || 0).toFixed(2)} €
                            </span>
                          </div>
                        );
                      })}
                      <button
                        onClick={() => navigate('M04_ABRECHNUNG')}
                        className="w-full min-h-[44px] mt-2 pt-2 text-center text-sm font-bold text-[#3138A0] hover:underline"
                      >
                        Zur Abrechnung wechseln →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Fällig & neu Gruppe */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
              <button
                onClick={() => setTasksExpanded(!tasksExpanded)}
                className="w-full min-h-[58px] p-3.5 flex items-center justify-between hover:bg-slate-50 active:bg-slate-100/70 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-fuchsia-50 flex items-center justify-center text-[#9A1B8D] shrink-0">
                    <AlertTriangle size={19} />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-slate-950 block leading-tight">
                      Fällig & neu
                    </span>
                    <span className="text-xs text-slate-600 tabular-nums">
                      {dueEquipments.length} Wartung · {newInquiries.length} neue Anfrage
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-bold text-[#9A1B8D] tabular-nums">
                    {dueEquipments.length + newInquiries.length}
                  </span>
                  {tasksExpanded ? (
                    <ChevronDown size={18} className="text-slate-500" />
                  ) : (
                    <ChevronRight size={18} className="text-slate-500" />
                  )}
                </div>
              </button>

              {tasksExpanded && (
                <div className="p-3.5 bg-slate-50/70 border-t border-slate-100 text-sm">
                  {dueEquipments.length === 0 && newInquiries.length === 0 ? (
                    <p className="py-2 text-center text-slate-500 italic">
                      Keine fälligen Aufgaben oder Anfragen.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {dueEquipments.map((eq) => (
                        <div
                          key={eq.id}
                          onClick={() => navigate('M10_GERAETE')}
                          className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between gap-2 cursor-pointer hover:border-[#9A1B8D]"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Wrench size={17} className="text-[#9A1B8D] shrink-0" />
                            <div className="min-w-0">
                              <span className="font-bold text-slate-900 block truncate">
                                {eq.name}
                              </span>
                              <span className="text-xs text-slate-600">
                                Wartung fällig: {eq.maintenance_plan}
                              </span>
                            </div>
                          </div>
                          <span className="text-xs font-bold text-[#9A1B8D] shrink-0">Fällig</span>
                        </div>
                      ))}

                      {newInquiries.map((inq) => {
                        const c = customers.find((cust) => cust.id === inq.customer_id);
                        return (
                          <div
                            key={inq.id}
                            onClick={() => navigate('M05_ANFRAGEN')}
                            className="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between gap-2 cursor-pointer hover:border-[#3138A0]"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <MessageSquare size={17} className="text-[#3138A0] shrink-0" />
                              <div className="min-w-0">
                                <span className="font-bold text-slate-900 block truncate">
                                  {inq.title}
                                </span>
                                <span className="text-xs text-slate-600">{c?.name}</span>
                              </div>
                            </div>
                            <span className="text-xs font-bold text-[#9A1B8D] shrink-0">Neu</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
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
