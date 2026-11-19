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
import { isNativeAndroidApp } from '../../services/nativeBridge.ts';

export const ThreeDotsMenuModal: React.FC = () => {
  const { isThreeDotsMenuOpen, setIsThreeDotsMenuOpen, navigate } = useApp();

  if (!isThreeDotsMenuOpen) return null;

  const handleSelect = (screen: ScreenId) => {
    setIsThreeDotsMenuOpen(false);
    navigate(screen);
  };

  return (
    <div className="absolute inset-0 z-50 bg-black/45 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
      <div className="flex-1" onClick={() => setIsThreeDotsMenuOpen(false)} />

      <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl px-4 pt-3 pb-5 max-h-[90%] flex flex-col animate-slide-up">
        <div className="w-11 h-1.5 bg-slate-300 rounded-full mx-auto mb-2.5 shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-950 leading-tight">Menü</h2>
            <p className="text-xs text-slate-600 mt-0.5">Alle Bereiche und Abläufe</p>
          </div>
          <button
            onClick={() => setIsThreeDotsMenuOpen(false)}
            className="w-11 h-11 flex items-center justify-center text-slate-600 hover:text-slate-900 rounded-full hover:bg-slate-100 active:scale-95 transition-all"
            aria-label="Schließen"
          >
            <X size={22} />
          </button>
        </div>

        {/* 3 Gruppen mit den 9 Zielen (Page 32, ILL-011) */}
        <div className="flex-1 overflow-y-auto py-3 space-y-4">
          {/* Gruppe 1: Vorgänge */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#3138A0] tracking-wide mb-1.5 px-1">
              <span>Vorgänge</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl divide-y divide-slate-200/70 overflow-hidden">
              <button
                onClick={() => handleSelect('M05_ANFRAGEN')}
                className="w-full min-h-[54px] px-3.5 py-2.5 flex items-center justify-between hover:bg-indigo-50/60 active:bg-indigo-100/60 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <MessageSquare size={20} className="text-[#3138A0] shrink-0" />
                  <div>
                    <span className="text-sm font-bold text-slate-950 block leading-tight">Anfragen</span>
                    <span className="text-xs text-slate-600">Anliegen prüfen & weiterleiten</span>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-400 shrink-0" />
              </button>

              <button
                onClick={() => handleSelect('M06_ANGEBOTE')}
                className="w-full min-h-[54px] px-3.5 py-2.5 flex items-center justify-between hover:bg-indigo-50/60 active:bg-indigo-100/60 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <FileText size={20} className="text-[#3138A0] shrink-0" />
                  <div>
                    <span className="text-sm font-bold text-slate-950 block leading-tight">Angebote</span>
                    <span className="text-xs text-slate-600">Positionen, Preise & Freigaben</span>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-400 shrink-0" />
              </button>

              <button
                onClick={() => handleSelect('M07_AUFTRAEGE')}
                className="w-full min-h-[54px] px-3.5 py-2.5 flex items-center justify-between hover:bg-indigo-50/60 active:bg-indigo-100/60 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <CheckSquare size={20} className="text-[#3138A0] shrink-0" />
                  <div>
                    <span className="text-sm font-bold text-slate-950 block leading-tight">Aufträge</span>
                    <span className="text-xs text-slate-600">Einsätze & Touren planen</span>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-400 shrink-0" />
              </button>

              <button
                onClick={() => handleSelect('M08_ARBEITEN')}
                className="w-full min-h-[54px] px-3.5 py-2.5 flex items-center justify-between hover:bg-indigo-50/60 active:bg-indigo-100/60 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <Briefcase size={20} className="text-[#3138A0] shrink-0" />
                  <div>
                    <span className="text-sm font-bold text-slate-950 block leading-tight">Arbeiten</span>
                    <span className="text-xs text-slate-600">Originalaufzeichnungen & Zeiten</span>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-400 shrink-0" />
              </button>

              <button
                onClick={() => handleSelect('M09_LCR')}
                className="w-full min-h-[54px] px-3.5 py-2.5 flex items-center justify-between hover:bg-indigo-50/60 active:bg-indigo-100/60 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <Bookmark size={20} className="text-[#3138A0] shrink-0" />
                  <div>
                    <span className="text-sm font-bold text-slate-950 block leading-tight">L.C.R.</span>
                    <span className="text-xs text-slate-600">Gekennzeichnete Originale ansehen</span>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-400 shrink-0" />
              </button>
            </div>
          </div>

          {/* Gruppe 2: Betrieb */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#2C7738] tracking-wide mb-1.5 px-1">
              <span>Betrieb</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl divide-y divide-slate-200/70 overflow-hidden">
              <button
                onClick={() => handleSelect('M10_GERAETE')}
                className="w-full min-h-[54px] px-3.5 py-2.5 flex items-center justify-between hover:bg-emerald-50/60 active:bg-emerald-100/60 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <Wrench size={20} className="text-[#2C7738] shrink-0" />
                  <div>
                    <span className="text-sm font-bold text-slate-950 block leading-tight">Geräte</span>
                    <span className="text-xs text-slate-600">Stammdaten & Wartungsintervalle</span>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-400 shrink-0" />
              </button>

              <button
                onClick={() => handleSelect('M11_MATERIAL')}
                className="w-full min-h-[54px] px-3.5 py-2.5 flex items-center justify-between hover:bg-emerald-50/60 active:bg-emerald-100/60 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <Package size={20} className="text-[#2C7738] shrink-0" />
                  <div>
                    <span className="text-sm font-bold text-slate-950 block leading-tight">Material</span>
                    <span className="text-xs text-slate-600">Produkte, Preise & Verbrauch</span>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-400 shrink-0" />
              </button>
            </div>
          </div>

          {/* Gruppe 3: App */}
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#5D6178] tracking-wide mb-1.5 px-1">
              <span>App</span>
            </div>
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl divide-y divide-slate-200/70 overflow-hidden">
              <button
                onClick={() => handleSelect('M12_SICHERUNG')}
                className="w-full min-h-[54px] px-3.5 py-2.5 flex items-center justify-between hover:bg-slate-100/80 active:bg-slate-200/60 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <HardDrive size={20} className="text-[#5D6178] shrink-0" />
                  <div>
                    <span className="text-sm font-bold text-slate-950 block leading-tight">Sicherung</span>
                    <span className="text-xs text-slate-600">Eine Zieldatei fortlaufend ergänzen</span>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-400 shrink-0" />
              </button>

              <button
                onClick={() => handleSelect('M13_EINSTELLUNGEN')}
                className="w-full min-h-[54px] px-3.5 py-2.5 flex items-center justify-between hover:bg-slate-100/80 active:bg-slate-200/60 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <Settings size={20} className="text-[#5D6178] shrink-0" />
                  <div>
                    <span className="text-sm font-bold text-slate-950 block leading-tight">Einstellungen</span>
                    <span className="text-xs text-slate-600">
                      {isNativeAndroidApp()
                        ? 'Vorgaben, Rechnungsdaten & MCP'
                        : 'Vorgaben, Rechnungsdaten & Speicher'}
                    </span>
                  </div>
                </div>
                <ChevronRight size={18} className="text-slate-400 shrink-0" />
              </button>
            </div>
          </div>
        </div>

        <div className="pt-2.5 border-t border-slate-100 text-center">
          <p className="text-xs text-slate-500">
            Ein Menüaufruf startet weder Zeiterfassung noch Sicherung, Rechnung oder Datenänderung.
          </p>
        </div>
      </div>
    </div>
  );
};
