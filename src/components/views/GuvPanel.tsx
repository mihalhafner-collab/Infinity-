import React, { useState } from 'react';
import { useApp, usePixelBackLayer } from '../../context/AppContext.tsx';
import { SwipeToDeleteRow } from '../common/SwipeToDeleteRow.tsx';
import {
  BusinessExpense,
  ExpenseCategory,
  TaxCalculationMethod
} from '../../types/index.ts';
import {
  calculateGuvSummary,
  evaluateExpenseForYear,
  EXPENSE_CATEGORY_LABELS,
  generateGuvPdfAsync,
  GWG_LIMIT_EUR,
  KU_REVENUE_LIMIT,
  KU_TOLERANCE_LIMIT
} from '../../utils/guvCalculator.ts';
import { formatDateDE } from '../../utils/invoicePdf.ts';
import { downloadOrSaveBlob } from '../../services/nativeBridge.ts';
import {
  Sparkles,
  Plus,
  Download,
  Scale,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Pencil,
  Wrench,
  X,
  Info
} from 'lucide-react';

function parseEuroInput(val: string): number {
  const cleaned = val.replace(',', '.').replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isNaN(parsed) ? 0 : Math.max(0, Math.round(parsed * 100) / 100);
}

function fmtMoney(val: number): string {
  return `${val.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} €`;
}

export const GuvPanel: React.FC = () => {
  const {
    invoices,
    equipments,
    expenses,
    taxSettings,
    addExpense,
    updateExpense,
    deleteExpense,
    updateTaxSettings
  } = useApp();

  const [legalOpen, setLegalOpen] = useState(false);
  const [deductionsOpen, setDeductionsOpen] = useState(true);
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<BusinessExpense | null>(null);
  usePixelBackLayer(expenseModalOpen, () => setExpenseModalOpen(false));

  // Modal Form States
  const [expTitle, setExpTitle] = useState('');
  const [expDate, setExpDate] = useState('2026-11-10');
  const [expAmountStr, setExpAmountStr] = useState('');
  const [expCategory, setExpCategory] = useState<ExpenseCategory>('werkzeug_anlage');
  const [expLifeYears, setExpLifeYears] = useState<number>(5);
  const [expNotes, setExpNotes] = useState('');

  // Lokale Text-Inputs für flüssige Komma-Eingabe bei Zusatzabzügen
  const [svsInput, setSvsInput] = useState(() =>
    taxSettings.svs_paid > 0 ? String(taxSettings.svs_paid).replace('.', ',') : ''
  );
  const [transitInput, setTransitInput] = useState(() =>
    taxSettings.transit_ticket_full > 0
      ? String(taxSettings.transit_ticket_full).replace('.', ',')
      : ''
  );
  const [extraIncomeInput, setExtraIncomeInput] = useState(() =>
    taxSettings.manual_extra_income > 0
      ? String(taxSettings.manual_extra_income).replace('.', ',')
      : ''
  );

  const summary = calculateGuvSummary(invoices, expenses, taxSettings);
  const activeRes = summary.activeResult;
  const year = summary.year;

  const openNewExpenseModal = (presetCategory: ExpenseCategory = 'werkzeug_anlage') => {
    setEditingExpense(null);
    setExpTitle('');
    setExpDate(`${year}-06-15`);
    setExpAmountStr('');
    setExpCategory(presetCategory);
    setExpLifeYears(5);
    setExpNotes('');
    setExpenseModalOpen(true);
  };

  const openEditExpenseModal = (exp: BusinessExpense) => {
    setEditingExpense(exp);
    setExpTitle(exp.title);
    setExpDate(exp.date);
    setExpAmountStr(String(exp.amount).replace('.', ','));
    setExpCategory(exp.category);
    setExpLifeYears(exp.useful_life_years || 5);
    setExpNotes(exp.notes || '');
    setExpenseModalOpen(true);
  };

  const handleSaveExpense = () => {
    const amt = parseEuroInput(expAmountStr);
    if (!expTitle.trim() || amt <= 0) return;

    const payload = {
      title: expTitle.trim(),
      date: expDate || `${year}-06-15`,
      amount: amt,
      category: expCategory,
      useful_life_years:
        expCategory === 'werkzeug_anlage' && amt > GWG_LIMIT_EUR ? expLifeYears : null,
      notes: expNotes.trim()
    };

    if (editingExpense) {
      updateExpense(editingExpense.id, payload);
    } else {
      addExpense(payload);
    }
    setExpenseModalOpen(false);
  };

  const handleDownloadPdf = async () => {
    const { blob, filename } = await generateGuvPdfAsync(summary);
    await downloadOrSaveBlob(blob, filename, 'application/pdf');
  };

  // Live-Vorschau im Ausgabe-Modal (GWG vs. AfA inkl. Halbjahres-AfA)
  const previewAmount = parseEuroInput(expAmountStr);
  const previewEvaluation =
    previewAmount > 0
      ? evaluateExpenseForYear(
          {
            id: 'preview',
            title: expTitle || 'Anschaffung',
            date: expDate || `${year}-06-15`,
            amount: previewAmount,
            category: expCategory,
            useful_life_years: expLifeYears
          },
          year
        )
      : null;

  const methodOrder: Array<Exclude<TaxCalculationMethod, 'auto_best'>> = [
    'ku_pauschal_45',
    'ku_pauschal_20',
    'basis_pauschal_15',
    'ear_echt'
  ];

  // SVG-Fortschrittsbalken für Kleinunternehmergrenze (55.000 €) ohne Inline-Style
  const barRatio = Math.min(100, Math.max(0, Math.round((summary.totalCashIncome / KU_REVENUE_LIMIT) * 100)));

  return (
    <div className="flex-1 flex flex-col gap-3 text-xs text-slate-700 pb-2">
      {/* OBEN: Reine Ergebnis- & Statusübersicht */}
      <div className="space-y-3">
        {/* 1. Detaillierte Gewinn- & Verlustrechnung (Ergebnis-Aufstellung) */}
        <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div>
              <span className="text-[10px] font-bold text-[#3138A0] uppercase tracking-wider block">
                Ergebnisrechnung {year}
              </span>
              <h3 className="text-sm font-bold text-slate-900 leading-tight">
                {activeRes.shortTitle}
              </h3>
            </div>
            <span className="px-2 py-0.5 bg-emerald-50 text-[#2C7738] text-[10px] font-bold rounded-md">
              {taxSettings.preferred_method === 'auto_best' ? 'Auto-Optimal' : 'Manuell gewählt'}
            </span>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Bezahlte Rechnungen {year} (§ 19 Zufluss)</span>
              <span className="font-mono font-semibold text-slate-900">
                {fmtMoney(summary.paidInvoiceIncomeInYear)}
              </span>
            </div>

            {summary.manualExtraIncome > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Sonstige Betriebseinnahmen</span>
                <span className="font-mono font-semibold text-slate-900">
                  {fmtMoney(summary.manualExtraIncome)}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between font-bold text-slate-900 pt-1 border-t border-slate-100">
              <span>Summe Betriebseinnahmen</span>
              <span className="font-mono text-[#2C7738]">{fmtMoney(activeRes.totalIncome)}</span>
            </div>

            {/* Abzüge je nach gewählter Methode */}
            {activeRes.flatRateDeduction > 0 && (
              <div className="flex items-center justify-between text-slate-700">
                <span>− Pauschalierte Ausgaben ({activeRes.flatRatePercent} %)</span>
                <span className="font-mono font-semibold text-[#B4470B]">
                  − {fmtMoney(activeRes.flatRateDeduction)}
                </span>
              </div>
            )}

            {activeRes.actualRunningAndGoods > 0 && (
              <div className="flex items-center justify-between text-slate-700">
                <span>
                  {activeRes.key === 'basis_pauschal_15'
                    ? '− Wareneinsatz / Material (zusätzlich)'
                    : '− Laufende Ausgaben & Wareneinsatz'}
                </span>
                <span className="font-mono font-semibold text-[#B4470B]">
                  − {fmtMoney(activeRes.actualRunningAndGoods)}
                </span>
              </div>
            )}

            {activeRes.key === 'ear_echt' && (
              <div className="flex items-center justify-between text-slate-700">
                <span>− Abschreibung (GWG ≤ 1.000 € & AfA)</span>
                <span className="font-mono font-semibold text-[#B4470B]">
                  − {fmtMoney(activeRes.depreciationGwgAfa)}
                </span>
              </div>
            )}

            {activeRes.additionalDeductions > 0 && (
              <div className="flex items-center justify-between text-slate-700">
                <span>− SVS, Arbeitsplatzpauschale & Öffi</span>
                <span className="font-mono font-semibold text-[#B4470B]">
                  − {fmtMoney(activeRes.additionalDeductions)}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between font-semibold text-slate-800 pt-1.5 border-t border-slate-100">
              <span>= Vorläufiges Betriebsergebnis</span>
              <span className="font-mono">{fmtMoney(activeRes.preliminaryProfit)}</span>
            </div>

            <div className="flex items-center justify-between text-emerald-800">
              <span>− 15 % Grundfreibetrag (§ 10 EStG)</span>
              <span className="font-mono font-semibold">− {fmtMoney(activeRes.grundfreibetrag)}</span>
            </div>

            <div className="p-3 bg-indigo-50/70 border border-indigo-200/80 rounded-xl flex items-center justify-between mt-2">
              <div>
                <span className="font-bold text-slate-900 block text-xs">
                  Steuerpflichtiger {activeRes.taxableProfit < 0 ? 'Verlust' : 'Gewinn'}
                </span>
                <span className="text-[10px] text-slate-500">
                  ESt-Bemessungsgrundlage {year}
                </span>
              </div>
              <span
                className={`text-base font-bold font-mono ${
                  activeRes.taxableProfit < 0 ? 'text-[#B42318]' : 'text-[#3138A0]'
                }`}
              >
                {fmtMoney(activeRes.taxableProfit)}
              </span>
            </div>

            {/* Einkommensteuer-Orientierung nach Tarif 2026 */}
            <div className="px-2.5 py-2 bg-slate-50 border border-slate-200/70 rounded-xl flex items-center justify-between text-[11px]">
              <span className="text-slate-600">
                Geschätzte Einkommensteuer (§ 33 Tarif):
              </span>
              <span className="font-bold font-mono text-slate-900">
                {activeRes.estimatedIncomeTax === 0
                  ? '0,00 € (bis 13.539 € steuerfrei)'
                  : fmtMoney(activeRes.estimatedIncomeTax)}
              </span>
            </div>
          </div>
        </div>

        {/* 2. Kleinunternehmergrenze 55.000 € Fortschritt */}
        <div className="p-3 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-700">
              Kleinunternehmergrenze (§ 6 Abs. 1 Z 27 UStG)
            </span>
            <span
              className={`font-mono font-bold ${
                summary.kuStatus === 'exceeded'
                  ? 'text-[#B42318]'
                  : summary.kuStatus === 'tolerance'
                    ? 'text-[#B4470B]'
                    : 'text-[#2C7738]'
              }`}
            >
              {summary.totalCashIncome.toLocaleString('de-DE', { maximumFractionDigits: 0 })} /{' '}
              {KU_REVENUE_LIMIT.toLocaleString('de-DE')} €
            </span>
          </div>

          <svg className="w-full h-2 rounded-full overflow-hidden bg-slate-200" viewBox="0 0 100 4" preserveAspectRatio="none">
            <rect
              x="0"
              y="0"
              width={barRatio}
              height="4"
              className={
                summary.kuStatus === 'exceeded'
                  ? 'fill-[#B42318]'
                  : summary.kuStatus === 'tolerance'
                    ? 'fill-[#B4470B]'
                    : 'fill-[#2C7738]'
              }
            />
          </svg>

          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <span>
              {summary.kuStatus === 'ok'
                ? 'USt-befreit & KU-Pauschalierung zulässig'
                : summary.kuStatus === 'tolerance'
                  ? `Innerhalb +10 % Toleranz (bis ${KU_TOLERANCE_LIMIT.toLocaleString('de-DE')} €)`
                  : 'Über 60.500 €: USt-Pflicht & keine KU-Pauschalierung!'}
            </span>
            {summary.openReceivablesTotal > 0 && (
              <span className="font-semibold text-[#B4470B]">
                +{summary.openReceivablesTotal.toFixed(0)} € offen
              </span>
            )}
          </div>
        </div>

        {/* 3. Geprüfte rechtliche Vorgaben (Österreich BMF / WKO Stand 2026) */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs overflow-hidden">
          <button
            type="button"
            onClick={() => setLegalOpen((p) => !p)}
            className="w-full p-3 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Scale size={16} className="text-[#3138A0] shrink-0" />
              <div>
                <span className="text-xs font-bold text-slate-900 block leading-tight">
                  Rechtliche Vorgaben & Pauschalierung (AT 2026)
                </span>
                <span className="text-[10px] text-slate-500">
                  § 17 EStG, § 13 GWG, § 7 Halbjahres-AfA, § 10 Grundfreibetrag
                </span>
              </div>
            </div>
            {legalOpen ? (
              <ChevronUp size={16} className="text-slate-400 shrink-0" />
            ) : (
              <ChevronDown size={16} className="text-slate-400 shrink-0" />
            )}
          </button>

          {legalOpen && (
            <div className="p-3.5 pt-2 border-t border-slate-100 bg-slate-50/60 space-y-2.5 text-[11px] text-slate-600 leading-relaxed">
              <div>
                <strong className="text-slate-900 block">
                  1. Einnahmen-Ausgaben-Rechnung statt doppelter Bilanz-GuV:
                </strong>
                Einzelunternehmer unter 700.000 € Jahresumsatz unterliegen keiner Buchführungspflicht nach UGB. Maßgeblich ist das <strong>Zufluss-Abfluss-Prinzip (§ 19 EStG)</strong>: Versteuert werden im Kalenderjahr tatsächlich eingegangene Kundenzahlungen.
              </div>
              <div>
                <strong className="text-slate-900 block">
                  2. Kleinunternehmerpauschalierung (§ 17 Abs. 3a EStG):
                </strong>
                Bis <strong>55.000 € Bruttoumsatz</strong> (Toleranz +10 % bis 60.500 €) können Betriebsausgaben ohne Einzelbelege pauschal mit <strong>45 %</strong> (Handwerk/Regelbetrieb, max. 24.750 €) bzw. <strong>20 %</strong> (Dienstleistungsbetriebe lt. DLB-V, max. 11.000 €) angesetzt werden. <strong>Zusätzlich abziehbar:</strong> SVS-Pflichtbeiträge, Arbeitsplatzpauschale (300 €/1.200 € – letztmalig 2026!), 50 % Öffi-Ticket sowie der 15 % Grundfreibetrag.
              </div>
              <div>
                <strong className="text-slate-900 block">
                  3. GWG (§ 13 EStG) & Abschreibung / AfA (§ 7 EStG):
                </strong>
                Bei USt-Kleinunternehmern zählt der <strong>Bruttokaufpreis</strong>: Selbstständig nutzbare Geräte bis <strong>1.000 €</strong> sind sofort zu 100 % als GWG absetzbar. Geräte über 1.000 € werden über die Nutzungsdauer verteilt (Inbetriebnahme 1. Halbjahr = 100 % Jahres-AfA; ab 1. Juli = <strong>50 % Halbjahres-AfA</strong>). Bei Wahl einer Pauschalierung sind GWG & reguläre AfA bereits im Pauschalsatz abgegolten.
              </div>
              <div>
                <strong className="text-slate-900 block">
                  4. Grundfreibetrag (§ 10 EStG) & Steuertarif 2026 (§ 33 EStG):
                </strong>
                Vom ermittelten Gewinn werden automatisch <strong>15 % Grundfreibetrag</strong> (bis 33.000 € Gewinn = max. 4.950 €) abgezogen – auch bei Pauschalierung! Bis <strong>13.539 €</strong> steuerpflichtigem Jahreseinkommen fällt 2026 <strong>0 % Einkommensteuer</strong> an.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* UNTERER BEREICH: Alle Eingabe-, Auswahl- & Exportoptionen in Daumenreichweite */}
      <div className="mt-auto pt-1 space-y-3">
        {/* 4. Ausgaben, GWG (≤ 1.000 €) & Anlagen-AfA (> 1.000 €) */}
        <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900 leading-tight">
                Ausgaben, GWG & Geräte-AfA ({expenses.length})
              </h3>
              <span className="text-[11px] text-slate-500">
                Ansatz {year}: {fmtMoney(summary.totalActualExpensesAndAfa)} (für Vergleich & E/A)
              </span>
            </div>

            <button
              type="button"
              onClick={() => openNewExpenseModal('werkzeug_anlage')}
              className="h-9 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-xs flex items-center gap-1 shadow-2xs transition-colors shrink-0"
            >
              <Plus size={14} />
              <span>Beleg / Gerät</span>
            </button>
          </div>

          {activeRes.key !== 'ear_echt' && expenses.length > 0 && (
            <div className="p-2 bg-indigo-50/60 border border-indigo-100 rounded-xl text-[10px] text-[#3138A0] flex items-start gap-1.5">
              <Info size={13} className="shrink-0 mt-0.5" />
              <span>
                Bei <strong>{activeRes.shortTitle}</strong> sind GWG, AfA & laufende Belege bereits mit der Pauschale abgegolten
                {activeRes.key === 'basis_pauschal_15'
                  ? ' (Wareneinsatz wird zusätzlich abgezogen).'
                  : ' – sie werden aber laufend gegen die echte E/A-Rechnung geprüft.'}
              </span>
            </div>
          )}

          {expenses.length === 0 ? (
            <div className="p-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center space-y-1">
              <p className="text-xs text-slate-500">
                Noch keine Ausgaben oder Geräte-Anschaffungen erfasst.
              </p>
              <p className="text-[10px] text-slate-400">
                Größere Käufe erfassen, um automatisch zu prüfen, ob die echte E/A-Rechnung günstiger ist.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {summary.evaluatedExpenses.map(({ expense, deductibleInYear, kind, ruleLabel }) => (
                <SwipeToDeleteRow
                  key={expense.id}
                  onDelete={() => deleteExpense(expense.id)}
                  deleteLabel="Beleg löschen"
                >
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900 text-xs truncate">
                          {expense.title}
                        </span>
                        {kind === 'gwg' && (
                          <span className="px-1.5 py-0.5 bg-emerald-100 text-[#2C7738] text-[9px] font-bold rounded shrink-0">
                            GWG 100%
                          </span>
                        )}
                        {kind === 'afa' && (
                          <span className="px-1.5 py-0.5 bg-indigo-100 text-[#3138A0] text-[9px] font-bold rounded shrink-0">
                            AfA
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 block truncate">
                        {formatDateDE(expense.date)} · Kaufpreis {fmtMoney(expense.amount)} · {ruleLabel}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="text-right">
                        <span
                          className={`font-bold font-mono block text-xs ${
                            deductibleInYear > 0 ? 'text-[#B4470B]' : 'text-slate-400'
                          }`}
                        >
                          {fmtMoney(deductibleInYear)}
                        </span>
                        <span className="text-[9px] text-slate-400 block">in {year}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openEditExpenseModal(expense)}
                        className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-[#3138A0] hover:bg-slate-100"
                        aria-label="Ausgabe bearbeiten"
                      >
                        <Pencil size={12} />
                      </button>
                    </div>
                  </div>
                </SwipeToDeleteRow>
              ))}
            </div>
          )}
        </div>

        {/* 5. Zusatzabzüge (SVS, Arbeitsplatzpauschale, Öffi, Korrektureinnahmen) */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs overflow-hidden">
          <button
            type="button"
            onClick={() => setDeductionsOpen((p) => !p)}
            className="w-full p-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
          >
            <div>
              <span className="text-xs font-bold text-slate-900 block leading-tight">
                Zusatzabzüge (auch bei Pauschalierung abziehbar!)
              </span>
              <span className="text-[11px] text-slate-500">
                SVS-Beiträge, Arbeitsplatzpauschale & sonstige Einnahmen
              </span>
            </div>
            {deductionsOpen ? (
              <ChevronUp size={16} className="text-slate-400 shrink-0" />
            ) : (
              <ChevronDown size={16} className="text-slate-400 shrink-0" />
            )}
          </button>

          {deductionsOpen && (
            <div className="p-3.5 pt-2 border-t border-slate-100 space-y-3 bg-slate-50/40">
              {/* SVS Pflichtbeiträge */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700 text-[11px]">
                    Bezahlte SVS-Pflichtbeiträge {year} (€)
                  </label>
                  {summary.totalCashIncome > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const approxSvs = Math.round(summary.totalCashIncome * 0.55 * 0.268);
                        setSvsInput(String(approxSvs));
                        updateTaxSettings({ svs_paid: approxSvs });
                      }}
                      className="text-[10px] font-bold text-[#3138A0] hover:underline"
                    >
                      Richtwert (~{Math.round(summary.totalCashIncome * 0.55 * 0.268)} €) einsetzen
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={svsInput}
                  onChange={(e) => {
                    setSvsInput(e.target.value);
                    updateTaxSettings({ svs_paid: parseEuroInput(e.target.value) });
                  }}
                  placeholder="z.B. 1800,00"
                  className="w-full h-10 px-3 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-semibold text-slate-900"
                />
              </div>

              {/* Arbeitsplatzpauschale (§ 4 Abs. 4 Z 8 EStG) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700 text-[11px]">
                    Arbeitsplatzpauschale (§ 4 Abs. 4 Z 8 EStG)
                  </label>
                  <span className="text-[10px] text-amber-700 font-semibold">
                    {year <= 2026 ? 'Bis inkl. 2026 gültig' : 'Ab 2027 gesetzlich entfallen'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { val: 0, label: 'Keines', sub: '0 €' },
                      { val: 300, label: 'Klein', sub: '300 € / J.' },
                      { val: 1200, label: 'Groß', sub: '1.200 € / J.' }
                    ] as const
                  ).map((opt) => {
                    const active =
                      year <= 2026
                        ? taxSettings.workplace_allowance === opt.val
                        : opt.val === 0;
                    return (
                      <button
                        key={opt.val}
                        type="button"
                        disabled={year >= 2027 && opt.val > 0}
                        onClick={() => updateTaxSettings({ workplace_allowance: opt.val })}
                        className={`py-2 px-2 rounded-xl border text-center transition-all disabled:opacity-40 ${
                          active
                            ? 'bg-white border-[#3138A0] text-[#3138A0] font-bold shadow-2xs'
                            : 'bg-white/70 border-slate-200 text-slate-600'
                        }`}
                      >
                        <span className="block text-[11px] leading-tight">{opt.label}</span>
                        <span className="block text-[10px] opacity-80">{opt.sub}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Öffi-Ticket & Sonstige Betriebseinnahmen */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-slate-700 text-[11px] block mb-1">
                    Öffi-Ticket gesamt (50 % Abzug)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={transitInput}
                    onChange={(e) => {
                      setTransitInput(e.target.value);
                      updateTaxSettings({ transit_ticket_full: parseEuroInput(e.target.value) });
                    }}
                    placeholder="0,00 €"
                    className="w-full h-10 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-medium text-slate-900"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 text-[11px] block mb-1">
                    Sonst. Einnahmen {year} (€)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={extraIncomeInput}
                    onChange={(e) => {
                      setExtraIncomeInput(e.target.value);
                      updateTaxSettings({ manual_extra_income: parseEuroInput(e.target.value) });
                    }}
                    placeholder="Optional (z.B. Barbeleg)"
                    className="w-full h-10 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs font-medium text-slate-900"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 6. Steuerjahr, Methoden-Auswahl & PDF-Export */}
        <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-3">
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Veranlagungsjahr
              </span>
              <span className="text-xs font-bold text-slate-900">
                Steuerjahr wählen
              </span>
            </div>

            <div className="flex items-center p-0.5 bg-slate-100 rounded-xl border border-slate-200/70">
              {[2025, 2026, 2027].map((yr) => (
                <button
                  key={yr}
                  type="button"
                  onClick={() => updateTaxSettings({ selected_year: yr })}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    year === yr
                      ? 'bg-white text-[#3138A0] shadow-2xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {yr}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-[#2C7738] shrink-0">
                <Sparkles size={16} />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-900 block leading-tight">
                  Berechnungsmethode wählen
                </span>
                <span className="text-[11px] text-slate-500">
                  Pauschalierung vs. echte Beleg-Abschreibung
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => updateTaxSettings({ preferred_method: 'auto_best' })}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors shrink-0 ${
                taxSettings.preferred_method === 'auto_best'
                  ? 'bg-[#2C7738] text-white border-[#2C7738]'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Auto-Optimal
            </button>
          </div>

          {/* Empfehlungs-Hinweis */}
          <div className="p-2.5 bg-emerald-50/70 border border-emerald-200/80 rounded-xl text-[11px] text-emerald-950 flex items-start gap-2">
            <CheckCircle2 size={15} className="text-[#2C7738] shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block text-[#2C7738]">
                Beste Wahl: {summary.methods[summary.bestMethodKey].shortTitle}
              </span>
              <span className="leading-snug">{summary.recommendationText}</span>
            </div>
          </div>

          {/* 4 Methoden im 2x2 Grid zum direkten Antippen */}
          <div className="grid grid-cols-2 gap-2">
            {methodOrder.map((key) => {
              const m = summary.methods[key];
              const isSelected = summary.activeMethodKey === key;
              const isBest = summary.bestMethodKey === key;

              return (
                <button
                  key={key}
                  type="button"
                  disabled={!m.eligible}
                  onClick={() => updateTaxSettings({ preferred_method: key })}
                  className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between min-h-[82px] disabled:opacity-45 ${
                    isSelected
                      ? 'bg-indigo-50/70 border-[#3138A0] ring-1 ring-[#3138A0]/30'
                      : 'bg-slate-50/80 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span
                      className={`text-[11px] font-bold leading-tight ${
                        isSelected ? 'text-[#3138A0]' : 'text-slate-800'
                      }`}
                    >
                      {m.shortTitle}
                    </span>
                    {isBest && m.eligible && (
                      <span className="px-1.5 py-0.5 bg-emerald-100 text-[#2C7738] text-[9px] font-bold rounded shrink-0">
                        Best
                      </span>
                    )}
                  </div>

                  <div className="mt-2">
                    {m.eligible ? (
                      <>
                        <span className="text-[10px] text-slate-500 block">Stpfl. Gewinn:</span>
                        <span
                          className={`text-xs font-bold font-mono ${
                            m.taxableProfit < 0 ? 'text-[#B42318]' : 'text-slate-900'
                          }`}
                        >
                          {fmtMoney(m.taxableProfit)}
                        </span>
                      </>
                    ) : (
                      <span className="text-[10px] text-[#B42318] font-semibold">
                        Über Umsatzgrenze
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <p className="text-[10px] text-slate-500 leading-snug px-0.5">
            <strong className="text-slate-700">Hinweis zur Branche (45 % vs. 20 %):</strong> Handwerkliche Grünraum- & Gartengestaltung fällt i. d. R. unter <strong>45 %</strong>; reine Hausbetreuungs-/Pflegedienstleistungen lt. DLB-V unter <strong>20 %</strong>.
          </p>

          <button
            type="button"
            onClick={handleDownloadPdf}
            className="w-full h-10 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-all"
          >
            <Download size={14} />
            <span>G&V PDF herunterladen ({year})</span>
          </button>
        </div>
      </div>

      {/* MODAL: Ausgabe / Geräte-Anschaffung (GWG / AfA) hinzufügen oder bearbeiten */}
      {expenseModalOpen && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
          <div className="flex-1" onClick={() => setExpenseModalOpen(false)} />
          <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[90%] flex flex-col animate-slide-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 leading-tight">
                  {editingExpense ? 'Ausgabe / Anlage bearbeiten' : 'Ausgabe / Gerät erfassen'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Automatische GWG- (≤ 1.000 €) & Halbjahres-AfA-Prüfung
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExpenseModalOpen(false)}
                className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-3 text-xs text-slate-700">
              {/* Kategorie */}
              <div>
                <label className="font-semibold block mb-1">Kategorie</label>
                <select
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value as ExpenseCategory)}
                  className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs font-semibold text-slate-900"
                >
                  {(Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]).map((cat) => (
                    <option key={cat} value={cat}>
                      {EXPENSE_CATEGORY_LABELS[cat]}
                    </option>
                  ))}
                </select>
              </div>

              {/* 1-Tipp Übernahme aus vorhandenen Geräten (M10_GERAETE), wenn Werkzeug/Anlage gewählt */}
              {expCategory === 'werkzeug_anlage' && equipments.length > 0 && !editingExpense && (
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Aus Gerätebestand übernehmen (1 Tipp)
                  </span>
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                    {equipments.slice(0, 8).map((eq) => (
                      <button
                        key={eq.id}
                        type="button"
                        onClick={() =>
                          setExpTitle([eq.name, eq.model].filter(Boolean).join(' – '))
                        }
                        className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-[#3138A0] border border-indigo-200/70 rounded-lg text-[11px] font-semibold whitespace-nowrap flex items-center gap-1 shrink-0"
                      >
                        <Wrench size={11} />
                        <span>{eq.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Bezeichnung */}
              <div>
                <label className="font-semibold block mb-1">Bezeichnung *</label>
                <input
                  type="text"
                  value={expTitle}
                  onChange={(e) => setExpTitle(e.target.value)}
                  placeholder={
                    expCategory === 'werkzeug_anlage'
                      ? 'z.B. Motorsäge Stihl MS 261 / Rasenmäher'
                      : 'z.B. Sonderkraftstoff, Rindenmulch, Versicherung'
                  }
                  className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm text-slate-900"
                />
              </div>

              {/* Betrag & Zahlungs-/Inbetriebnahmedatum */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="font-semibold block mb-1">Bruttobetrag (€) *</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={expAmountStr}
                    onChange={(e) => setExpAmountStr(e.target.value)}
                    placeholder="z.B. 890,00"
                    className="w-full h-11 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-sm font-bold text-slate-900"
                  />
                </div>

                <div>
                  <label className="font-semibold block mb-1">Kauf- / Bezahldatum</label>
                  <input
                    type="date"
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                    className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900"
                  />
                </div>
              </div>

              {/* Nutzungsdauer (nur relevant wenn Gerät/Anlage > 1.000 €) */}
              {expCategory === 'werkzeug_anlage' && previewAmount > GWG_LIMIT_EUR && (
                <div>
                  <label className="font-semibold block mb-1">
                    Betriebsgewöhnliche Nutzungsdauer (AfA § 7 EStG)
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[3, 5, 7, 10].map((yrs) => (
                      <button
                        key={yrs}
                        type="button"
                        onClick={() => setExpLifeYears(yrs)}
                        className={`h-10 rounded-xl border text-xs font-bold transition-all ${
                          expLifeYears === yrs
                            ? 'bg-[#3138A0] text-white border-[#3138A0]'
                            : 'bg-slate-50 text-slate-700 border-slate-200'
                        }`}
                      >
                        {yrs} Jahre
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Live-Steuervorschau für diesen Beleg */}
              {previewEvaluation && (
                <div className="p-2.5 bg-emerald-50/80 border border-emerald-200 rounded-xl text-[11px] text-emerald-950 space-y-0.5">
                  <div className="flex items-center justify-between font-bold">
                    <span>Steuerlicher Ansatz {year}:</span>
                    <span className="font-mono text-[#2C7738]">
                      {fmtMoney(previewEvaluation.deductibleInYear)}
                    </span>
                  </div>
                  <span className="block text-[10px] text-emerald-800">
                    {previewEvaluation.ruleLabel}
                  </span>
                </div>
              )}

              {previewAmount > 0 && expCategory === 'werkzeug_anlage' && previewAmount > GWG_LIMIT_EUR && (
                <div className="p-2 bg-amber-50 border border-amber-200 rounded-xl text-[10px] text-amber-900 flex items-start gap-1.5">
                  <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    Über 1.000 € GWG-Grenze: Kauf Jan–Jun = 100 % Jahres-AfA, Kauf Jul–Dez = 50 % Halbjahres-AfA im ersten Jahr.
                  </span>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setExpenseModalOpen(false)}
                className="flex-1 h-12 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm"
              >
                Abbrechen
              </button>
              <button
                type="button"
                disabled={!expTitle.trim() || previewAmount <= 0}
                onClick={handleSaveExpense}
                className="flex-1 h-12 bg-[#3138A0] hover:bg-[#272d82] disabled:opacity-40 text-white font-semibold rounded-xl text-sm shadow-xs"
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
