import React, { useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import {
  Sun,
  ChevronRight,
  ChevronDown,
  Clock,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Wrench,
  MessageSquare
} from 'lucide-react';

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
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight leading-tight">
              {todayLabel}
            </h2>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
              <span>{todayApps.length} {todayApps.length === 1 ? 'Termin' : 'Termine'}</span>
              <span>·</span>
              <span>{todayApps.reduce((sum, a) => sum + ((a.duration_minutes || 60) / 60), 0).toFixed(0)} Std. geplant</span>
            </div>
          </div>

          {/* Weather Widget */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-200/80 rounded-xl shadow-2xs text-xs font-semibold text-slate-800">
            <Sun size={16} className="text-amber-500" />
            <span>12°</span>
          </div>
        </div>

        {/* Dein Tag / Tagestour Teaser */}
        <div className="flex items-center justify-between text-xs font-semibold px-0.5">
          <span className="text-slate-500 uppercase tracking-wider text-[11px]">Dein Tag</span>
          <button
            onClick={handleOpenTour}
            className="text-[#3138A0] hover:underline flex items-center gap-0.5"
          >
            <span>Tagestour</span>
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Termine heute Liste */}
        <div className="space-y-2.5">
          {todayApps.length === 0 ? (
            <div className="p-4 bg-white border border-slate-200 rounded-2xl text-center text-xs text-slate-500">
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
                  className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs hover:border-[#3138A0] transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col text-xs font-bold text-slate-700 font-mono shrink-0 pt-0.5">
                        <span>{app.start_time || 'Ohne Zeit'}</span>
                        {app.end_time && (
                          <span className="text-slate-400 font-normal">{app.end_time}</span>
                        )}
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 leading-tight">
                          {app.title || 'Termin'}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {cust ? cust.name : 'Ohne Kunde'}
                          {app.duration_minutes ? ` · ${app.duration_minutes} Min.` : ''}
                        </p>
                        {app.address && (
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                            {app.address}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {isNext ? (
                        <span className="px-2 py-0.5 bg-indigo-50 border border-indigo-100 text-[#3138A0] text-[10px] font-bold rounded-md">
                          Als Nächstes
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-semibold rounded-md">
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
        <div className="pt-2">
          <div className="flex items-center justify-between text-xs font-semibold px-0.5 mb-2">
            <span className="text-slate-500 uppercase tracking-wider text-[11px]">Zu erledigen</span>
            <span className="text-[11px] text-slate-400">
              {openWork.length + dueEquipments.length + newInquiries.length}{' '}
              {openWork.length + dueEquipments.length + newInquiries.length === 1 ? 'Hinweis' : 'Hinweise'}
            </span>
          </div>

          <div className="space-y-2">
            {/* Offene Stunden Gruppe */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
              <button
                onClick={() => setOpenHoursExpanded(!openHoursExpanded)}
                className="w-full min-h-[48px] p-3 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center text-[#B4470B]">
                    <Clock size={16} />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-900 block leading-tight">
                      Offene Stunden
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {openHoursSum} Std. · {openAmountSum.toFixed(0)} €
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[#B4470B] px-1.5 py-0.5 bg-orange-50 rounded-md">
                    {openAmountSum.toFixed(0)} €
                  </span>
                  {openHoursExpanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                </div>
              </button>

              {openHoursExpanded && (
                <div className="p-3 bg-slate-50/70 border-t border-slate-100 text-xs">
                  {openWork.length === 0 ? (
                    <p className="py-2 text-center text-slate-400 italic">Keine offenen Arbeitsstunden vorhanden.</p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {openWork.map((w) => {
                        const c = customers.find((cust) => cust.id === w.customer_id);
                        return (
                          <div key={w.id} className="py-2 flex items-center justify-between">
                            <div>
                              <span className="font-semibold text-slate-800 block">{w.title}</span>
                              <span className="text-[11px] text-slate-500">
                                {c?.name} · {w.hours} Std.
                              </span>
                            </div>
                            <span className="font-bold text-[#B4470B]">
                              {(w.accounting_amount || 0).toFixed(2)} €
                            </span>
                          </div>
                        );
                      })}
                      <button
                        onClick={() => navigate('M04_ABRECHNUNG')}
                        className="w-full mt-2 pt-2 text-center text-xs font-bold text-[#3138A0] hover:underline"
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
                className="w-full min-h-[48px] p-3 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-fuchsia-50 flex items-center justify-center text-[#9A1B8D]">
                    <AlertTriangle size={16} />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-900 block leading-tight">
                      Fällig & neu
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {dueEquipments.length} Wartung · {newInquiries.length} neue Anfrage
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[#9A1B8D] px-1.5 py-0.5 bg-fuchsia-50 rounded-md">
                    {dueEquipments.length + newInquiries.length}
                  </span>
                  {tasksExpanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                </div>
              </button>

              {tasksExpanded && (
                <div className="p-3 bg-slate-50/70 border-t border-slate-100 text-xs">
                  {dueEquipments.length === 0 && newInquiries.length === 0 ? (
                    <p className="py-2 text-center text-slate-400 italic">Keine fälligen Aufgaben oder Anfragen.</p>
                  ) : (
                    <div className="space-y-2">
                      {dueEquipments.map((eq) => (
                        <div
                          key={eq.id}
                          onClick={() => navigate('M10_GERAETE')}
                          className="p-2 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer hover:border-[#9A1B8D]"
                        >
                          <div className="flex items-center gap-2">
                            <Wrench size={14} className="text-[#9A1B8D]" />
                            <div>
                              <span className="font-semibold text-slate-800 block">{eq.name}</span>
                              <span className="text-[10px] text-slate-500">Wartung fällig: {eq.maintenance_plan}</span>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-[#9A1B8D] uppercase">Fällig</span>
                        </div>
                      ))}

                      {newInquiries.map((inq) => {
                        const c = customers.find((cust) => cust.id === inq.customer_id);
                        return (
                          <div
                            key={inq.id}
                            onClick={() => navigate('M05_ANFRAGEN')}
                            className="p-2 bg-white rounded-xl border border-slate-200 flex items-center justify-between cursor-pointer hover:border-[#3138A0]"
                          >
                            <div className="flex items-center gap-2">
                              <MessageSquare size={14} className="text-[#3138A0]" />
                              <div>
                                <span className="font-semibold text-slate-800 block">{inq.title}</span>
                                <span className="text-[10px] text-slate-500">{c?.name}</span>
                              </div>
                            </div>
                            <span className="text-[10px] font-bold text-[#9A1B8D] uppercase">Neu</span>
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
