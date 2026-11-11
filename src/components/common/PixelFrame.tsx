import React, { useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { isNativeAndroidApp } from '../../services/nativeBridge.ts';
import { ChevronLeft, Monitor, Smartphone } from 'lucide-react';

interface PixelFrameProps {
  children: React.ReactNode;
}

const EDGE_START_ZONE_PX = 20;
const SWIPE_TRIGGER_PX = 48;
const MAX_VERTICAL_DRIFT_PX = 46;

export const PixelFrame: React.FC<PixelFrameProps> = ({ children }) => {
  const {
    pixelFrameEnabled,
    setPixelFrameEnabled,
    canSystemGoBack,
    triggerSystemBack,
    switchMainTab,
    setActiveModal,
    setSendingInvoiceId,
    setIsSearchOpen,
    setIsPlusMenuOpen,
    setIsThreeDotsMenuOpen
  } = useApp();

  const canvasRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{
    active: boolean;
    side: 'left' | 'right';
    startX: number;
    startY: number;
  } | null>(null);

  const [edgePreview, setEdgePreview] = useState<{
    side: 'left' | 'right';
    ready: boolean;
  } | null>(null);

  // In der eigenständigen Native-Kotlin-App auf dem Pixel 10 Pro übernimmt Android 16
  // Statusleiste, Predictive-Back-Pfeil und Gestenbalken nativ über OnBackPressedDispatcher.
  if (isNativeAndroidApp()) {
    return (
      <div className="pixel-app-shell w-full h-[100dvh] bg-[#F8F9FA] text-[#1E2238] flex flex-col overflow-hidden relative">
        {children}
      </div>
    );
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canSystemGoBack) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const offsetLeft = e.clientX - rect.left;
    const offsetRight = rect.right - e.clientX;

    if (offsetLeft >= 0 && offsetLeft <= EDGE_START_ZONE_PX) {
      gestureRef.current = {
        active: true,
        side: 'left',
        startX: e.clientX,
        startY: e.clientY
      };
    } else if (offsetRight >= 0 && offsetRight <= EDGE_START_ZONE_PX) {
      gestureRef.current = {
        active: true,
        side: 'right',
        startX: e.clientX,
        startY: e.clientY
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || !g.active) return;

    const dy = Math.abs(e.clientY - g.startY);
    if (dy > MAX_VERTICAL_DRIFT_PX) {
      gestureRef.current = null;
      setEdgePreview(null);
      return;
    }

    const inwardDx = g.side === 'left' ? e.clientX - g.startX : g.startX - e.clientX;
    if (inwardDx > 12) {
      setEdgePreview({
        side: g.side,
        ready: inwardDx >= SWIPE_TRIGGER_PX
      });
    } else {
      setEdgePreview(null);
    }
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    setEdgePreview(null);
    if (!g || !g.active) return;

    const dy = Math.abs(e.clientY - g.startY);
    const inwardDx = g.side === 'left' ? e.clientX - g.startX : g.startX - e.clientX;
    if (dy <= MAX_VERTICAL_DRIFT_PX && inwardDx >= SWIPE_TRIGGER_PX) {
      triggerSystemBack();
    }
  };

  const handlePointerCancel = () => {
    gestureRef.current = null;
    setEdgePreview(null);
  };

  const handleHomeGesturePill = () => {
    setSendingInvoiceId(null);
    setActiveModal(null);
    setIsSearchOpen(false);
    setIsPlusMenuOpen(false);
    setIsThreeDotsMenuOpen(false);
    switchMainTab('M01_HEUTE');
  };

  return (
    <div className="pixel-app-shell w-full h-full h-[100dvh] bg-[#F8F9FA] sm:bg-[#E2E5E9] flex flex-col items-center justify-center sm:py-2 sm:px-4 text-[#1E2238] overflow-hidden">
      {/* Desktop Helper Bar to toggle Device Frame */}
      <div className="hidden sm:flex items-center justify-between w-full max-w-[432px] mb-2 px-3.5 py-1.5 text-xs text-slate-700 bg-white/90 backdrop-blur-sm rounded-xl border border-slate-200 shadow-xs shrink-0">
        <div className="flex items-center gap-2 font-semibold">
          <Smartphone size={15} className="text-[#3138A0]" />
          <span>Google Pixel 10 Pro (6.3&quot; · 20:9)</span>
        </div>
        <button
          onClick={() => setPixelFrameEnabled(!pixelFrameEnabled)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:bg-slate-200/80 text-xs font-semibold text-slate-800 transition-colors"
          title="Rahmen umschalten"
        >
          {pixelFrameEnabled ? (
            <>
              <Monitor size={13} />
              <span>Vollbild</span>
            </>
          ) : (
            <>
              <Smartphone size={13} />
              <span>Pixel Rahmen</span>
            </>
          )}
        </button>
      </div>

      {/* Main Container:
          - Auf dem echten Pixel 10 Pro (< 640px): 100% Vollfläche ohne doppelte Status-/Home-Leiste.
          - Auf Desktop (>= 640px): Exakte Pixel 10 Pro 20:9 Bildschirmgeometrie (428×936). */}
      <div
        className={`w-full bg-[#F8F9FA] relative flex flex-col overflow-hidden transition-all duration-200 h-[100dvh] max-h-[100dvh] ${
          pixelFrameEnabled
            ? 'sm:w-[428px] sm:max-w-[428px] sm:h-[min(936px,calc(100dvh-3rem))] sm:max-h-[min(936px,calc(100dvh-3rem))] sm:rounded-[50px] sm:shadow-2xl sm:ring-[12px] sm:ring-slate-900 sm:border-[3px] sm:border-slate-700/80'
            : 'sm:w-[468px] sm:max-w-[468px] sm:h-[min(960px,calc(100dvh-3rem))] sm:rounded-3xl sm:shadow-xl sm:border sm:border-slate-300'
        }`}
      >
        {/* Pixel 10 Pro Centered Camera Punch-Hole (nur im Desktop-Geräterahmen) */}
        {pixelFrameEnabled && (
          <div className="hidden sm:flex absolute top-2.5 left-1/2 -translate-x-1/2 w-4 h-4 bg-black rounded-full z-50 pointer-events-none ring-1 ring-slate-800 shadow-inner items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-900 ring-1 ring-indigo-950/40" />
          </div>
        )}

        {/* Simulierte Android 16 Statusleiste (nur auf Desktop sichtbar – auf dem echten Pixel übernimmt das System) */}
        <div className="hidden sm:flex w-full h-8 px-6 items-center justify-between text-xs font-semibold text-slate-800 bg-white shrink-0 select-none z-30 pt-0.5 border-b border-slate-100/60">
          <span className="font-mono text-xs tabular-nums">09:41</span>
          <div className="flex items-center gap-1.5 text-xs text-slate-700">
            <span className="font-mono text-[11px] tracking-tight font-bold">5G</span>
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 20h.01" />
              <path d="M2 8.82a15 15 0 0 1 20 0" />
              <path d="M5 12.859a10 10 0 0 1 14 0" />
              <path d="M8.5 16.429a5 5 0 0 1 7 0" />
            </svg>
            <div className="w-4 h-2.5 border border-slate-700 rounded-xs flex items-center p-0.5">
              <div className="w-full h-full bg-slate-800 rounded-2xs" />
            </div>
            <span className="text-[11px] font-mono tabular-nums">100%</span>
          </div>
        </div>

        {/* App Content Canvas + Pixel 10 Pro Edge-Swipe Back Detection */}
        <div
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerCancel}
          className="flex-1 min-h-0 flex flex-col overflow-hidden relative bg-[#F8F9FA]"
        >
          {children}

          {/* Android 16 Predictive Back Edge Pill Indicator */}
          {edgePreview && (
            <div
              className={`pointer-events-none absolute top-1/2 -translate-y-1/2 z-50 flex items-center justify-center rounded-full shadow-lg transition-all duration-150 ${
                edgePreview.side === 'left' ? 'left-3' : 'right-3'
              } ${
                edgePreview.ready
                  ? 'w-11 h-11 bg-[#3138A0] text-white scale-100 opacity-100'
                  : 'w-9 h-9 bg-slate-900/80 text-white scale-90 opacity-85'
              }`}
              aria-hidden="true"
            >
              <ChevronLeft size={22} strokeWidth={2.6} />
            </div>
          )}
        </div>

        {/* Simulierte Android 16 Systemleiste (nur auf Desktop – auf dem echten Pixel nutzt Android die echte Gestenleiste) */}
        <div className="hidden sm:grid w-full h-8 px-5 bg-white grid-cols-3 items-center shrink-0 border-t border-slate-100/70 z-30 select-none">
          <div className="flex items-center justify-start">
            {canSystemGoBack && (
              <button
                type="button"
                onClick={() => triggerSystemBack()}
                className="flex items-center gap-0.5 px-2.5 py-1 -ml-1.5 rounded-full text-slate-700 hover:text-slate-950 hover:bg-slate-100 active:scale-95 transition-all"
                aria-label="Pixel Zurück"
                title="Zurück (Pixel-Geste / Esc)"
              >
                <ChevronLeft size={18} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={handleHomeGesturePill}
              className="py-1.5 px-3 rounded-full hover:bg-slate-100/80 active:scale-95 transition-transform"
              aria-label="Startansicht Heute"
              title="Heute (Pixel Home-Leiste)"
            >
              <span className="block w-34 h-1 bg-slate-900/80 rounded-full" />
            </button>
          </div>
          <div />
        </div>
      </div>
    </div>
  );
};
