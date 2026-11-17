import React, { useLayoutEffect, useRef, useState } from 'react';
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
  const probeRef = useRef<HTMLDivElement>(null);
  const maxViewportHeightRef = useRef<number>(0);
  const lastPortraitRef = useRef<boolean | null>(null);

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

  // Automatische Ausrichtung auf dem Google Pixel 10 Pro (Statusleiste + Kamera-Cutout oben, Gestenbalken & Tastatur unten)
  useLayoutEffect(() => {
    const updateSafeInsets = () => {
      const root = document.documentElement;
      const nativeApp = isNativeAndroidApp();

      // Auf Desktop (>= 640px) übernimmt der simulierte Pixel-Rahmen Status- und Gestenleiste separat
      if (window.innerWidth >= 640 && !nativeApp) {
        root.style.setProperty('--pixel-safe-top', '0px');
        root.style.setProperty('--pixel-safe-bottom', '0px');
        return;
      }

      // Echte vom System/Browser gemeldete CSS env(safe-area-inset-*) Werte auslesen
      let envTop = 0;
      let envBottom = 0;
      if (probeRef.current) {
        const cs = window.getComputedStyle(probeRef.current);
        envTop = parseFloat(cs.paddingTop) || 0;
        envBottom = parseFloat(cs.paddingBottom) || 0;
      }

      const rawScreenW = window.screen?.width || window.innerWidth;
      const rawScreenH = window.screen?.height || window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      const screenCssH =
        rawScreenW > window.innerWidth * 1.5 && dpr > 1 ? rawScreenH / dpr : rawScreenH;

      const vvH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      const layoutH = Math.max(window.innerHeight, Math.round(vvH));
      const isPortrait = window.innerHeight >= window.innerWidth;

      if (lastPortraitRef.current !== isPortrait) {
        lastPortraitRef.current = isPortrait;
        maxViewportHeightRef.current = layoutH;
      } else if (layoutH > maxViewportHeightRef.current) {
        maxViewportHeightRef.current = layoutH;
      }

      const baseH = Math.max(maxViewportHeightRef.current, layoutH);
      const isKeyboardOpen = vvH < baseH * 0.78;

      // Differenz zwischen physischer Pixel-10-Pro-Displayhöhe (952dp / 915dp) und App-Fensterhöhe:
      // - < 36px: Echtes Edge-to-Edge (weder Statusleiste ~52dp noch Gestenleiste ~24dp durch OS abgezogen)
      // - 36..67px: Obere Statusleiste durch OS abgezogen, untere Gestenleiste liegt noch im Viewport
      // - >= 68px: Beide Systemleisten (z. B. Native FrameLayout oder Browser-Adressleiste) bereits berücksichtigt
      const missingVertical = Math.max(0, screenCssH - baseH);
      const isStandalone =
        Boolean(window.matchMedia?.('(display-mode: standalone)').matches) ||
        Boolean(window.matchMedia?.('(display-mode: fullscreen)').matches);

      let safeTop = envTop;
      let safeBottom = envBottom;

      if (isPortrait) {
        if (missingVertical < 36) {
          safeTop = Math.max(envTop, 52);
          safeBottom = Math.max(envBottom, 28);
        } else if (missingVertical < 68) {
          safeTop = envTop;
          safeBottom = Math.max(envBottom, 28);
        } else {
          safeTop = envTop;
          safeBottom = nativeApp ? envBottom : Math.max(envBottom, isStandalone ? 20 : 10);
        }
      } else if (missingVertical < 28) {
        safeTop = Math.max(envTop, 28);
        safeBottom = Math.max(envBottom, 20);
      }

      // Bei geöffneter Bildschirmtastatur liegt der untere Bedienbereich bündig über der Tastatur
      if (isKeyboardOpen) {
        safeBottom = 0;
      }

      root.style.setProperty('--pixel-safe-top', `${Math.round(safeTop)}px`);
      root.style.setProperty('--pixel-safe-bottom', `${Math.round(safeBottom)}px`);
    };

    updateSafeInsets();

    const vv = window.visualViewport;
    const standaloneMedia = window.matchMedia?.('(display-mode: standalone)');

    window.addEventListener('resize', updateSafeInsets);
    window.addEventListener('orientationchange', updateSafeInsets);
    vv?.addEventListener('resize', updateSafeInsets);
    standaloneMedia?.addEventListener?.('change', updateSafeInsets);

    return () => {
      window.removeEventListener('resize', updateSafeInsets);
      window.removeEventListener('orientationchange', updateSafeInsets);
      vv?.removeEventListener('resize', updateSafeInsets);
      standaloneMedia?.removeEventListener?.('change', updateSafeInsets);
    };
  }, []);

  const triggerSystemBackRef = useRef(triggerSystemBack);
  triggerSystemBackRef.current = triggerSystemBack;

  // Universelles Nach-unten-Wischen zum Schließen für alle Bottom-Sheets, Menüs & Reiter (.rounded-t-3xl)
  useLayoutEffect(() => {
    let activeSheet: HTMLElement | null = null;
    let scrollEl: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    let currentY = 0;
    let isDraggingSheet = false;

    const findScrollableWithin = (
      target: EventTarget | null,
      boundary: HTMLElement
    ): HTMLElement | null => {
      let el = target instanceof HTMLElement ? target : null;
      while (el && el !== boundary) {
        if (el.scrollHeight > el.clientHeight + 4) {
          const cs = window.getComputedStyle(el);
          if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
            return el;
          }
        }
        el = el.parentElement;
      }
      return null;
    };

    const closeSheetElement = (sheet: HTMLElement) => {
      if (sheet.dataset.swipeCloseSearch === 'true') {
        setIsSearchOpen(false);
        return;
      }
      const prev = sheet.previousElementSibling;
      if (prev instanceof HTMLElement && prev.classList.contains('flex-1')) {
        prev.click();
        return;
      }
      triggerSystemBackRef.current();
    };

    const resetActiveSheet = () => {
      if (activeSheet) {
        activeSheet.style.transition = 'transform 180ms ease-out';
        activeSheet.style.transform = '';
      }
      activeSheet = null;
      scrollEl = null;
      isDraggingSheet = false;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!target) return;
      const sheet = target.closest('.rounded-t-3xl') as HTMLElement | null;
      if (!sheet || sheet.dataset.customSwipe === 'true') return;

      const scroller = findScrollableWithin(target, sheet);
      if (scroller && scroller.scrollTop > 4) {
        return;
      }

      activeSheet = sheet;
      scrollEl = scroller;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      currentY = startY;
      isDraggingSheet = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!activeSheet || e.touches.length !== 1) return;
      if (scrollEl && scrollEl.scrollTop > 4) {
        resetActiveSheet();
        return;
      }

      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const dx = x - startX;
      const dy = y - startY;
      currentY = y;

      if (!isDraggingSheet) {
        if (dy < -6 || Math.abs(dx) > Math.abs(dy) * 1.1) {
          resetActiveSheet();
          return;
        }
        if (dy > 10 && dy > Math.abs(dx) * 1.15) {
          isDraggingSheet = true;
          activeSheet.style.transition = 'none';
        }
      }

      if (isDraggingSheet) {
        const offset = Math.max(0, dy);
        activeSheet.style.transform = `translateY(${offset}px)`;
      }
    };

    const onTouchEnd = () => {
      if (!activeSheet) return;
      const sheet = activeSheet;
      const dy = currentY - startY;
      const wasDragging = isDraggingSheet;
      resetActiveSheet();

      if (wasDragging && dy > 48) {
        closeSheetElement(sheet);
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', resetActiveSheet, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', resetActiveSheet);
    };
  }, [setIsSearchOpen]);

  // In der eigenständigen Native-Kotlin-App auf dem Pixel 10 Pro übernimmt Android 16
  // Statusleiste, Predictive-Back-Pfeil und Gestenbalken nativ über OnBackPressedDispatcher.
  if (isNativeAndroidApp()) {
    return (
      <div className="pixel-app-shell w-full h-[100dvh] bg-white text-[#1E2238] flex flex-col overflow-hidden relative">
        <div ref={probeRef} className="pixel-env-probe" aria-hidden="true" />
        <div className="pixel-safe-top-spacer w-full bg-white shrink-0" aria-hidden="true" />
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative bg-[#F8F9FA]">
          {children}
        </div>
        <div className="pixel-safe-bottom-spacer w-full bg-white shrink-0" aria-hidden="true" />
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
    <div className="pixel-app-shell w-full h-full h-[100dvh] bg-white sm:bg-[#E2E5E9] flex flex-col items-center justify-center sm:py-2 sm:px-4 text-[#1E2238] overflow-hidden">
      <div ref={probeRef} className="pixel-env-probe" aria-hidden="true" />

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
          - Auf dem echten Pixel 10 Pro (< 640px): Automatische Systemleisten-Ausrichtung oben & unten.
          - Auf Desktop (>= 640px): Exakte Pixel 10 Pro 20:9 Bildschirmgeometrie (428×936). */}
      <div
        className={`w-full bg-white relative flex flex-col overflow-hidden transition-all duration-200 h-[100dvh] max-h-[100dvh] ${
          pixelFrameEnabled
            ? 'sm:w-[428px] sm:max-w-[428px] sm:h-[min(936px,calc(100dvh-3rem))] sm:max-h-[min(936px,calc(100dvh-3rem))] sm:rounded-[50px] sm:shadow-2xl sm:ring-[12px] sm:ring-slate-900 sm:border-[3px] sm:border-slate-700/80'
            : 'sm:w-[468px] sm:max-w-[468px] sm:h-[min(960px,calc(100dvh-3rem))] sm:rounded-3xl sm:shadow-xl sm:border sm:border-slate-300'
        }`}
      >
        {/* Automatischer oberer Systemleisten-/Kamera-Abstand auf dem echten Pixel 10 Pro */}
        <div className="sm:hidden pixel-safe-top-spacer w-full bg-white shrink-0" aria-hidden="true" />

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

        {/* Automatischer unterer Gestenbalken-Abstand auf dem echten Pixel 10 Pro */}
        <div className="sm:hidden pixel-safe-bottom-spacer w-full bg-white shrink-0" aria-hidden="true" />

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
