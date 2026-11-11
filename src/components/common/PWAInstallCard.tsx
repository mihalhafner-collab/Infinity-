import React, { useState } from 'react';
import { Download, CheckCircle, Smartphone, ChevronRight } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall.ts';
import { isNativeAndroidApp } from '../../services/nativeBridge.ts';

interface PWAInstallCardProps {
  compact?: boolean;
}

export const PWAInstallCard: React.FC<PWAInstallCardProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const isNative = isNativeAndroidApp();

  if (compact) {
    if (isNative || isInstalled) return null;

    return (
      <>
        <button
          type="button"
          onClick={() => {
            if (isInstallable) {
              void install();
            } else {
              setShowGuide((prev) => !prev);
            }
          }}
          className="w-full min-h-[48px] px-3 py-2 flex items-center justify-between hover:bg-indigo-50/50 active:bg-indigo-100/50 transition-colors text-left"
        >
          <div className="flex items-center gap-2.5">
            <img
              src="/pwa-maskable-192x192.png"
              alt="Hafner Bildschirm-Icon"
              className="w-7 h-7 rounded-full object-cover border border-slate-300 shrink-0"
            />
            <div>
              <span className="text-sm font-semibold text-slate-900 block leading-tight">
                Auf Startbildschirm
              </span>
              <span className="text-[11px] text-slate-500">
                {isInstallable ? 'Direkt auf Pixel 10 Pro installieren' : 'App-Icon zum Startbildschirm'}
              </span>
            </div>
          </div>
          {isInstallable ? (
            <Download size={16} className="text-[#3138A0] shrink-0" />
          ) : (
            <ChevronRight size={16} className="text-slate-400 shrink-0" />
          )}
        </button>

        {showGuide && !isInstallable && (
          <div className="px-3 py-2.5 bg-indigo-50/70 text-[11px] text-slate-700 leading-relaxed space-y-1">
            {isIOS ? (
              <p>
                Tippe in Safari auf <strong>Teilen</strong> und wähle{' '}
                <strong>Zum Home-Bildschirm</strong>.
              </p>
            ) : (
              <p>
                Öffne die veröffentlichte App-Adresse in <strong>Chrome auf dem Pixel 10 Pro</strong>,
                tippe oben rechts auf <strong>⋮</strong> und wähle{' '}
                <strong>Zum Startbildschirm hinzufügen → Installieren</strong>.
              </p>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5">
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center shrink-0">
          <div className="w-14 h-14 rounded-full overflow-hidden shadow-sm ring-2 ring-slate-200 bg-[#02061A]">
            <img
              src="/pwa-maskable-192x192.png"
              alt="Hafner Bildschirm-Icon Vorschau"
              className="w-full h-full object-cover"
            />
          </div>
          <span className="text-[10px] font-semibold text-slate-700 mt-1 leading-none">
            Hafner
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <span className="text-xs font-bold text-slate-900 block leading-tight">
            Bildschirm-Icon (Pixel 10 Pro)
          </span>
          <span className="text-[11px] text-slate-500 block mt-0.5 leading-snug">
            Rundes Adaptive/Maskable-Icon für den Pixel-Startbildschirm im Vollbildmodus.
          </span>
        </div>
      </div>

      {isNative ? (
        <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-[#2C7738] font-semibold flex items-center gap-1.5">
          <CheckCircle size={14} className="shrink-0" />
          <span>Eigenständige Native Kotlin-App (Pixel 10 Pro) aktiv</span>
        </div>
      ) : isInstalled ? (
        <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-[#2C7738] font-semibold flex items-center gap-1.5">
          <CheckCircle size={14} className="shrink-0" />
          <span>Auf Startbildschirm installiert (Vollbildmodus aktiv)</span>
        </div>
      ) : isInstallable ? (
        <button
          type="button"
          onClick={() => void install()}
          className="w-full h-10 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-all"
        >
          <Download size={14} />
          <span>Auf Startbildschirm installieren</span>
        </button>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowGuide((prev) => !prev)}
            className="w-full h-10 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-800 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all"
          >
            <Smartphone size={14} className="text-[#3138A0]" />
            <span>Anleitung für Pixel 10 Pro Startbildschirm</span>
          </button>

          {showGuide && (
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-700 leading-relaxed">
              {isIOS ? (
                <p>
                  1. Tippe in Safari auf <strong>Teilen</strong>.<br />
                  2. Wähle <strong>Zum Home-Bildschirm</strong>.
                </p>
              ) : (
                <p>
                  1. Öffne die App in <strong>Chrome auf deinem Pixel 10 Pro</strong>.<br />
                  2. Tippe oben rechts auf <strong>⋮</strong> →{' '}
                  <strong>Zum Startbildschirm hinzufügen</strong> → <strong>Installieren</strong>.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
