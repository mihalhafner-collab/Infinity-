import React, { useState } from 'react';
import { useApp, usePixelBackLayer } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { UndoToast } from '../common/UndoToast.tsx';
import {
  MessageSquare,
  FileText,
  CheckSquare,
  Check,
  Plus,
  Clock,
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  Trash2,
  X
} from 'lucide-react';
import { Order } from '../../types/index.ts';
import { getTodayLocalIso } from '../../utils/invoicePdf.ts';

const QUICK_ORDER_ACTIVITIES = [
  'Rasenpflege / Mähen',
  'Heckenschnitt & Formschnitt',
  'Baumpflege / Rückschnitt',
  'Unkrautentfernung & Beetpflege',
  'Grünschnitt-Entsorgung',
  'Hochdruckreinigung',
  'Laubentfernung',
  'Winterdienst'
];

export const VorgaengeView: React.FC = () => {
  const {
    currentScreen,
    setCurrentScreen,
    inquiries,
    offers,
    orders,
    customers,
    addOrder,
    updateOrdersStatusBatch,
    deleteOrdersBatch,
    addAppointment,
    setSelectedCustomerId,
    setPrefilledWorkTitle,
    setActiveModal,
    navigate
  } = useApp();

  const [orderSelectionMode, setOrderSelectionMode] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);

  // Kompakter "+ Auftrag"-Dialog (damit auch mehrere Tätigkeiten direkt als Auftrag erfasst werden können)
  const [showNewOrderForm, setShowNewOrderForm] = useState(false);
  const [newOrderCustomerId, setNewOrderCustomerId] = useState('');
  const [newOrderPickedActivities, setNewOrderPickedActivities] = useState<string[]>([]);
  const [newOrderCustomTitle, setNewOrderCustomTitle] = useState('');
  const [newOrderStatus, setNewOrderStatus] = useState<Order['status']>('in_arbeit');
  const [newOrderNotes, setNewOrderNotes] = useState('');

  usePixelBackLayer(orderSelectionMode, () => {
    setOrderSelectionMode(false);
    setSelectedOrderIds([]);
  });
  usePixelBackLayer(showNewOrderForm, () => setShowNewOrderForm(false));

  // Determine subview based on currentScreen
  let activeTab: 'anfragen' | 'angebote' | 'auftraege' = 'anfragen';
  if (currentScreen === 'M06_ANGEBOTE') activeTab = 'angebote';
  if (currentScreen === 'M07_AUFTRAEGE') activeTab = 'auftraege';

  const setTab = (tab: 'anfragen' | 'angebote' | 'auftraege') => {
    setOrderSelectionMode(false);
    setSelectedOrderIds([]);
    if (tab === 'anfragen') setCurrentScreen('M05_ANFRAGEN');
    if (tab === 'angebote') setCurrentScreen('M06_ANGEBOTE');
    if (tab === 'auftraege') setCurrentScreen('M07_AUFTRAEGE');
  };

  const openNewOrderSheet = () => {
    setNewOrderCustomerId(customers[0]?.id || '');
    setNewOrderPickedActivities([]);
    setNewOrderCustomTitle('');
    setNewOrderStatus('in_arbeit');
    setNewOrderNotes('');
    setShowNewOrderForm(true);
  };

  const toggleNewOrderActivity = (act: string) => {
    setNewOrderPickedActivities((prev) =>
      prev.includes(act) ? prev.filter((a) => a !== act) : [...prev, act]
    );
  };

  const resolvedNewOrderTitle = [
    ...newOrderPickedActivities,
    newOrderCustomTitle.trim()
  ]
    .filter(Boolean)
    .join(', ');

  const handleCreateOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrderCustomerId || !resolvedNewOrderTitle) return;
    addOrder({
      customer_id: newOrderCustomerId,
      title: resolvedNewOrderTitle,
      status: newOrderStatus,
      notes: newOrderNotes.trim()
    });
    setShowNewOrderForm(false);
  };

  const toggleOrderSelection = (id: string) => {
    setSelectedOrderIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllOrders = () => {
    if (selectedOrderIds.length === orders.length) {
      setSelectedOrderIds([]);
    } else {
      setSelectedOrderIds(orders.map((o) => o.id));
    }
  };

  const selectedOrders = orders.filter((o) => selectedOrderIds.includes(o.id));

  const handleBatchStatus = (status: Order['status']) => {
    if (selectedOrderIds.length === 0) return;
    updateOrdersStatusBatch(selectedOrderIds, status);
    setOrderSelectionMode(false);
    setSelectedOrderIds([]);
  };

  const handleBatchSchedule = () => {
    if (selectedOrders.length === 0) return;
    selectedOrders.forEach((ord) => {
      addAppointment({
        customer_id: ord.customer_id,
        property_id: ord.property_id || null,
        title: ord.title,
        date: ord.scheduled_date || getTodayLocalIso(),
        start_time: null,
        end_time: null,
        duration_minutes: null,
        notes: ord.notes || ''
      });
    });
    setOrderSelectionMode(false);
    setSelectedOrderIds([]);
    navigate('M02_PLANUNG');
  };

  const handleBatchRecordWork = () => {
    if (selectedOrders.length === 0) return;
    const firstOrder = selectedOrders[0];
    const combinedTitles = Array.from(
      new Set(selectedOrders.map((o) => o.title.trim()).filter(Boolean))
    ).join(', ');
    setSelectedCustomerId(firstOrder.customer_id);
    setPrefilledWorkTitle(combinedTitles);
    setOrderSelectionMode(false);
    setSelectedOrderIds([]);
    setActiveModal('ARBEIT_NACHTRAGEN');
  };

  const handleBatchDeleteOrders = () => {
    if (selectedOrderIds.length === 0) return;
    deleteOrdersBatch(selectedOrderIds);
    setOrderSelectionMode(false);
    setSelectedOrderIds([]);
  };

  const getOrderStatusBadge = (status: Order['status']) => {
    if (status === 'geplant') {
      return {
        label: 'Geplant',
        cls: 'bg-amber-50 text-[#B4470B]'
      };
    }
    if (status === 'in_arbeit') {
      return {
        label: 'In Arbeit',
        cls: 'bg-indigo-50 text-[#3138A0]'
      };
    }
    return {
      label: 'Erledigt',
      cls: 'bg-emerald-50 text-[#2C7738]'
    };
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
      <Header
        title={
          activeTab === 'anfragen'
            ? 'Anfragen'
            : activeTab === 'angebote'
              ? 'Angebote'
              : 'Aufträge'
        }
        subtitle="Vorgänge"
        showBack
      />

      {/* Oben reine Ansicht, Bedienelemente im unteren Bereich */}

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3.5 overscroll-contain">
        {/* Info Banner: REQ-025 Nachvollziehbare Vorgangskette */}
        <div className="p-2.5 bg-indigo-50/60 border border-indigo-100 rounded-xl text-[11px] text-[#3138A0]">
          Anfrage → Angebot → Auftrag sind getrennte bewusste Schritte (REQ-025). Aufträge lassen sich einzeln oder per Mehrfachauswahl bündeln.
        </div>

        {/* ANFRAGEN LISTE (M05, WF-010, ILL-012) */}
        {activeTab === 'anfragen' && (
          <div className="space-y-2.5">
            {inquiries.length === 0 ? (
              <div className="p-8 bg-white border border-slate-200 rounded-2xl text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
                  <MessageSquare size={22} />
                </div>
                <h4 className="font-bold text-slate-900 text-sm">Keine Anfragen</h4>
                <p className="text-xs text-slate-500 max-w-[240px] mx-auto">
                  Erfassen Sie neue Kundenanfragen über das Plus-Menü.
                </p>
              </div>
            ) : (
              inquiries.map((inq) => {
                const cust = customers.find((c) => c.id === inq.customer_id);
                return (
                  <div
                    key={inq.id}
                    className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 leading-tight">
                          {inq.title}
                        </h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {cust?.name} · Wunsch: {inq.desired_date}
                        </p>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          inq.status === 'neu'
                            ? 'bg-fuchsia-50 text-[#9A1B8D]'
                            : 'bg-emerald-50 text-[#2C7738]'
                        }`}
                      >
                        {inq.status === 'neu' ? 'Neu' : 'Angenommen'}
                      </span>
                    </div>

                    {inq.notes && (
                      <p className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded-lg italic">
                        {inq.notes}
                      </p>
                    )}

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                      <button
                        onClick={() => setTab('angebote')}
                        className="px-3 py-1.5 bg-[#3138A0] text-white font-semibold text-xs rounded-xl shadow-2xs flex items-center gap-1.5 transition-colors"
                      >
                        <span>Angebot vorbereiten</span>
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ANGEBOTE LISTE (M06, WF-011, ILL-012) */}
        {activeTab === 'angebote' && (
          <div className="space-y-2.5">
            {offers.length === 0 ? (
              <div className="p-8 bg-white border border-slate-200 rounded-2xl text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
                  <FileText size={22} />
                </div>
                <h4 className="font-bold text-slate-900 text-sm">Keine Angebote</h4>
                <p className="text-xs text-slate-500 max-w-[240px] mx-auto">
                  Erstellen Sie Angebote aus Anfragen oder direkt im Kundenprofil.
                </p>
              </div>
            ) : (
              offers.map((off) => {
                const cust = customers.find((c) => c.id === off.customer_id);
                return (
                  <div
                    key={off.id}
                    className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2.5"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 leading-tight">
                          {off.title}
                        </h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {cust?.name} · {off.items.length} Positionen
                        </p>
                      </div>
                      <span className="text-sm font-bold text-[#B4470B]">
                        {off.total_amount.toFixed(2)} €
                      </span>
                    </div>

                    <div className="bg-slate-50 p-2.5 rounded-xl space-y-1 text-xs">
                      {off.items.map((it, idx) => (
                        <div key={idx} className="flex justify-between text-slate-700">
                          <span>{it.description}</span>
                          <span className="font-semibold">{it.total.toFixed(2)} €</span>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">
                        Freigegeben · Gültig bis Monatsende
                      </span>
                      <button
                        onClick={() => setTab('auftraege')}
                        className="px-3 py-1.5 bg-[#2C7738] text-white font-semibold text-xs rounded-xl shadow-2xs flex items-center gap-1.5 transition-colors"
                      >
                        <CheckCircle2 size={13} />
                        <span>Annahme dokumentieren</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* AUFTRÄGE LISTE (M07, WF-012, ILL-012 + Mehrfachauswahl) */}
        {activeTab === 'auftraege' && (
          <div className="space-y-2.5">
            {orders.length === 0 ? (
              <div className="p-8 bg-white border border-slate-200 rounded-2xl text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
                  <CheckSquare size={22} />
                </div>
                <h4 className="font-bold text-slate-900 text-sm">Keine Aufträge</h4>
                <p className="text-xs text-slate-500 max-w-[240px] mx-auto">
                  Legen Sie direkt einen Auftrag an oder übernehmen Sie ein angenommenes Angebot.
                </p>
                {customers.length > 0 && (
                  <button
                    type="button"
                    onClick={openNewOrderSheet}
                    className="mt-2 px-4 py-2 bg-[#3138A0] text-white text-xs font-semibold rounded-xl"
                  >
                    + Auftrag anlegen
                  </button>
                )}
              </div>
            ) : (
              orders.map((ord) => {
                const cust = customers.find((c) => c.id === ord.customer_id);
                const isSelected = selectedOrderIds.includes(ord.id);
                const badge = getOrderStatusBadge(ord.status);

                return (
                  <div
                    key={ord.id}
                    onClick={
                      orderSelectionMode ? () => toggleOrderSelection(ord.id) : undefined
                    }
                    className={`p-3.5 bg-white border rounded-2xl shadow-2xs space-y-2.5 transition-all ${
                      orderSelectionMode ? 'cursor-pointer active:scale-[0.99]' : ''
                    } ${
                      orderSelectionMode && isSelected
                        ? 'border-[#3138A0] bg-indigo-50/25 ring-1 ring-[#3138A0]/20'
                        : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        {orderSelectionMode && (
                          <div
                            className={`w-6 h-6 mt-0.5 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                              isSelected
                                ? 'bg-[#3138A0] border-[#3138A0] text-white'
                                : 'bg-white border-slate-300'
                            }`}
                          >
                            {isSelected && <Check size={14} strokeWidth={3} />}
                          </div>
                        )}
                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-slate-900 leading-tight">
                            {ord.title}
                          </h4>
                          <p className="text-xs text-slate-500 mt-0.5">{cust?.name || 'Kunde'}</p>
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </div>

                    {ord.notes && (
                      <p className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded-lg italic">
                        {ord.notes}
                      </p>
                    )}

                    {!orderSelectionMode && (
                      <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2">
                        <button
                          onClick={() => {
                            setSelectedCustomerId(ord.customer_id);
                            setActiveModal('TERMIN_ANLEGEN');
                          }}
                          className="h-10 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <CalendarPlus size={14} className="text-[#3138A0]" />
                          <span>Termin anlegen</span>
                        </button>

                        <button
                          onClick={() => {
                            setSelectedCustomerId(ord.customer_id);
                            setPrefilledWorkTitle(ord.title);
                            setActiveModal('ARBEIT_NACHTRAGEN');
                          }}
                          className="h-10 bg-[#3138A0] hover:bg-[#272d82] text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                        >
                          <Clock size={14} />
                          <span>Arbeit erfassen</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Undo-Banner für Mehrfach-Löschung */}
      <UndoToast />

      {/* Mehrfach-Aktionsleiste für ausgewählte Aufträge */}
      {activeTab === 'auftraege' && orderSelectionMode && selectedOrderIds.length > 0 && (
        <div className="shrink-0 bg-slate-900 text-white px-3.5 py-2.5 border-t border-slate-800 z-30 space-y-2 animate-slide-up">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold">
              {selectedOrderIds.length}{' '}
              {selectedOrderIds.length === 1 ? 'Auftrag' : 'Aufträge'} gewählt
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleBatchStatus('in_arbeit')}
                className="px-2 py-0.5 rounded bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-100 font-semibold transition-colors"
              >
                In Arbeit
              </button>
              <button
                type="button"
                onClick={() => handleBatchStatus('erledigt')}
                className="px-2 py-0.5 rounded bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-100 font-semibold transition-colors"
              >
                Erledigt
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={handleBatchRecordWork}
              className="h-10 bg-[#3138A0] hover:bg-[#272d82] text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Clock size={14} />
              <span>Arbeit ({selectedOrderIds.length})</span>
            </button>

            <button
              type="button"
              onClick={handleBatchSchedule}
              className="h-10 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <CalendarPlus size={14} />
              <span>Termine</span>
            </button>

            <button
              type="button"
              onClick={handleBatchDeleteOrders}
              className="h-10 bg-red-600/90 hover:bg-red-600 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Trash2 size={14} />
              <span>Löschen</span>
            </button>
          </div>
        </div>
      )}

      {/* Kompaktes Bottom-Sheet zum Anlegen eines Auftrags (mit Mehrfachauswahl der Tätigkeiten) */}
      {showNewOrderForm && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
          <div className="flex-1" onClick={() => setShowNewOrderForm(false)} />
          <form
            onSubmit={handleCreateOrder}
            className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[88%] flex flex-col animate-slide-up"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Auftrag anlegen</h3>
              <button
                type="button"
                onClick={() => setShowNewOrderForm(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-3 text-xs text-slate-700 overscroll-contain">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Kunde *</label>
                <select
                  value={newOrderCustomerId}
                  onChange={(e) => setNewOrderCustomerId(e.target.value)}
                  className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-hidden focus:border-[#3138A0]"
                  required
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-slate-700">
                    Arbeiten / Leistungen (Mehrfachauswahl)
                  </label>
                  {newOrderPickedActivities.length > 0 && (
                    <span className="text-[11px] font-semibold text-[#3138A0]">
                      {newOrderPickedActivities.length} gewählt
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_ORDER_ACTIVITIES.map((act) => {
                    const active = newOrderPickedActivities.includes(act);
                    return (
                      <button
                        key={act}
                        type="button"
                        onClick={() => toggleNewOrderActivity(act)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border flex items-center gap-1 transition-all ${
                          active
                            ? 'bg-[#3138A0] border-[#3138A0] text-white'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        {active && <Check size={11} strokeWidth={3} />}
                        <span>{act}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Zusatz / Freitext {!newOrderPickedActivities.length ? '*' : '(optional)'}
                </label>
                <input
                  type="text"
                  value={newOrderCustomTitle}
                  onChange={(e) => setNewOrderCustomTitle(e.target.value)}
                  placeholder="z.B. Hecke Nordseite + Abtransport"
                  className="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-hidden focus:border-[#3138A0]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Status</label>
                  <select
                    value={newOrderStatus}
                    onChange={(e) => setNewOrderStatus(e.target.value as Order['status'])}
                    className="w-full h-10 px-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 outline-hidden"
                  >
                    <option value="geplant">Geplant</option>
                    <option value="in_arbeit">In Arbeit</option>
                    <option value="erledigt">Erledigt</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Notiz</label>
                  <input
                    type="text"
                    value={newOrderNotes}
                    onChange={(e) => setNewOrderNotes(e.target.value)}
                    placeholder="Optionaler Hinweis"
                    className="w-full h-10 px-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-hidden"
                  />
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100">
              <button
                type="submit"
                disabled={!newOrderCustomerId || !resolvedNewOrderTitle}
                className="w-full h-12 bg-[#3138A0] hover:bg-[#272d82] disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors"
              >
                Auftrag speichern
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-md">
        {activeTab === 'auftraege' && (
          <div className="px-3.5 pt-2.5 pb-1.5 flex items-center justify-between gap-2 border-b border-slate-100">
            <button
              type="button"
              onClick={openNewOrderSheet}
              disabled={customers.length === 0}
              className="h-9 px-3 bg-[#3138A0] hover:bg-[#272d82] disabled:opacity-40 text-white rounded-xl text-xs font-semibold flex items-center gap-1 transition-colors"
            >
              <Plus size={14} />
              <span>Auftrag anlegen</span>
            </button>

            <div className="flex items-center gap-1.5">
              {orderSelectionMode && orders.length > 0 && (
                <button
                  type="button"
                  onClick={handleSelectAllOrders}
                  className="h-9 px-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors"
                >
                  {selectedOrderIds.length === orders.length ? 'Keine' : 'Alle'}
                </button>
              )}

              {orders.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (orderSelectionMode) {
                      setOrderSelectionMode(false);
                      setSelectedOrderIds([]);
                    } else {
                      setOrderSelectionMode(true);
                    }
                  }}
                  className={`h-9 px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    orderSelectionMode
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                  }`}
                >
                  <CheckSquare size={13} />
                  <span>
                    {orderSelectionMode
                      ? `Fertig (${selectedOrderIds.length})`
                      : 'Auswählen'}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        <BottomActionBar>
          <div className="w-full max-w-[260px] flex items-center p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setTab('anfragen')}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all truncate px-1 ${
                activeTab === 'anfragen'
                  ? 'bg-white text-[#3138A0] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Anfragen ({inquiries.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('angebote')}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all truncate px-1 ${
                activeTab === 'angebote'
                  ? 'bg-white text-[#3138A0] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Angebote ({offers.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('auftraege')}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all truncate px-1 ${
                activeTab === 'auftraege'
                  ? 'bg-white text-[#3138A0] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Aufträge ({orders.length})
            </button>
          </div>
        </BottomActionBar>
        <BottomNav />
      </div>
    </div>
  );
};
