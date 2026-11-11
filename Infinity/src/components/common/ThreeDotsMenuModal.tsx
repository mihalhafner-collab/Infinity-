import React from 'react';
import { useApp } from '../../context/AppContext.tsx';
import {
  X,
  MessageSquare,
  FileText,
  CheckSquare,
  Briefcase,
  Bookmark,
  Wrench,
  Package,
  HardDrive,
  Settings,
  ChevronRight
} from 'lucide-react';
import { ScreenId } from '../../types/index.ts';
import { PWAInstallCard } from './PWAInstallCard.tsx';

export const ThreeDotsMenuModal: React.FC = () => {
  const { isThreeDotsMenuOpen, setIsThreeDotsMenuOpen, navigate } = useApp();

  if (!isThreeDotsMenuOpen) return null;

  const handleSelect = (screen: ScreenId) => {
    setIsThreeDotsMenuOpen(false);
    navigate(screen);
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
      <div className="flex-1" onClick={() => setIsThreeDotsMenuOpen(false)} />

      <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[88%] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900 leading-tight">Menü</h2>
            <p className="text-[11px] text-slate-500">Alle Bereiche und Abläufe</p>
          </div>
          <button
            onClick={() => setIsThreeDotsMenuOpen(false)}
            className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-full hover:bg-slate-100 transition-colors"
            aria-label="Schließen"
          >
            <X size={20} />
          </button>
        </div>

        {/* 3 Gruppen mit den 9 Zielen (Page 32, ILL-011) */}
        <div className="flex-1 overflow-y-auto py-2 space-y-4">
          {/* Gruppe 1: Vorgänge */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#3138A0] uppercase tracking-wider mb-1 px-1">
              <span>Vorgänge</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl divide-y divide-slate-100 overflow-hidden">
              <button
                onClick={() => handleSelect('M05_ANFRAGEN')}
                className="w-full min-h-[48px] px-3 py-2 flex items-center justify-between hover:bg-indigo-50/50 active:bg-indigo-100/50 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5">
                  <MessageSquare size={17} className="text-[#3138A0]" />
                  <div>
                    <span className="text-sm font-semibold text-slate-900 block leading-tight">Anfragen</span>
                    <span className="text-[11px] text-slate-500">Anliegen prüfen & weiterleiten</span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </button>

              <button
                onClick={() => handleSelect('M06_ANGEBOTE')}
                className="w-full min-h-[48px] px-3 py-2 flex items-center justify-between hover:bg-indigo-50/50 active:bg-indigo-100/50 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5">
                  <FileText size={17} className="text-[#3138A0]" />
                  <div>
                    <span className="text-sm font-semibold text-slate-900 block leading-tight">Angebote</span>
                    <span className="text-[11px] text-slate-500">Positionen, Preise & Freigaben</span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </button>

              <button
                onClick={() => handleSelect('M07_AUFTRAEGE')}
                className="w-full min-h-[48px] px-3 py-2 flex items-center justify-between hover:bg-indigo-50/50 active:bg-indigo-100/50 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5">
                  <CheckSquare size={17} className="text-[#3138A0]" />
                  <div>
                    <span className="text-sm font-semibold text-slate-900 block leading-tight">Aufträge</span>
                    <span className="text-[11px] text-slate-500">Einsätze & Touren planen</span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </button>

              <button
                onClick={() => handleSelect('M08_ARBEITEN')}
                className="w-full min-h-[48px] px-3 py-2 flex items-center justify-between hover:bg-indigo-50/50 active:bg-indigo-100/50 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5">
                  <Briefcase size={17} className="text-[#3138A0]" />
                  <div>
                    <span className="text-sm font-semibold text-slate-900 block leading-tight">Arbeiten</span>
                    <span className="text-[11px] text-slate-500">Originalaufzeichnungen & Zeiten</span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </button>

              <button
                onClick={() => handleSelect('M09_LCR')}
                className="w-full min-h-[48px] px-3 py-2 flex items-center justify-between hover:bg-indigo-50/50 active:bg-indigo-100/50 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5">
                  <Bookmark size={17} className="text-[#3138A0]" />
                  <div>
                    <span className="text-sm font-semibold text-slate-900 block leading-tight">L.C.R.</span>
                    <span className="text-[11px] text-slate-500">Gekennzeichnete Originale ansehen</span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </button>
            </div>
          </div>

          {/* Gruppe 2: Betrieb */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#2C7738] uppercase tracking-wider mb-1 px-1">
              <span>Betrieb</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl divide-y divide-slate-100 overflow-hidden">
              <button
                onClick={() => handleSelect('M10_GERAETE')}
                className="w-full min-h-[48px] px-3 py-2 flex items-center justify-between hover:bg-emerald-50/50 active:bg-emerald-100/50 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5">
                  <Wrench size={17} className="text-[#2C7738]" />
                  <div>
                    <span className="text-sm font-semibold text-slate-900 block leading-tight">Geräte</span>
                    <span className="text-[11px] text-slate-500">Stammdaten & Wartungsintervalle</span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </button>

              <button
                onClick={() => handleSelect('M11_MATERIAL')}
                className="w-full min-h-[48px] px-3 py-2 flex items-center justify-between hover:bg-emerald-50/50 active:bg-emerald-100/50 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5">
                  <Package size={17} className="text-[#2C7738]" />
                  <div>
                    <span className="text-sm font-semibold text-slate-900 block leading-tight">Material</span>
                    <span className="text-[11px] text-slate-500">Produkte, Preise & Verbrauch</span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </button>
            </div>
          </div>

          {/* Gruppe 3: App */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#5D6178] uppercase tracking-wider mb-1 px-1">
              <span>App</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl divide-y divide-slate-100 overflow-hidden">
              <button
                onClick={() => handleSelect('M12_SICHERUNG')}
                className="w-full min-h-[48px] px-3 py-2 flex items-center justify-between hover:bg-slate-100/70 active:bg-slate-200/50 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5">
                  <HardDrive size={17} className="text-[#5D6178]" />
                  <div>
                    <span className="text-sm font-semibold text-slate-900 block leading-tight">Sicherung</span>
                    <span className="text-[11px] text-slate-500">Eine Zieldatei fortlaufend ergänzen</span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </button>

              <button
                onClick={() => handleSelect('M13_EINSTELLUNGEN')}
                className="w-full min-h-[48px] px-3 py-2 flex items-center justify-between hover:bg-slate-100/70 active:bg-slate-200/50 transition-colors text-left"
              >
                <div className="flex items-center gap-2.5">
                  <Settings size={17} className="text-[#5D6178]" />
                  <div>
                    <span className="text-sm font-semibold text-slate-900 block leading-tight">Einstellungen</span>
                    <span className="text-[11px] text-slate-500">Vorgaben, Rechnungsdaten & MCP</span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-slate-400" />
              </button>

              <PWAInstallCard compact />
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 text-center">
          <p className="text-[11px] text-slate-400">
            Ein Menüaufruf startet weder Zeiterfassung noch Sicherung, Rechnung oder Datenänderung.
          </p>
        </div>
      </div>
    </div>
  );
};
