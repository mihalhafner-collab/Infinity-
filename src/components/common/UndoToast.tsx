import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { CheckCircle2, RotateCcw } from 'lucide-react';

export const UndoToast: React.FC = () => {
  const { undoToast, setUndoToast } = useApp();
  const [secondsLeft, setSecondsLeft] = useState(5);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);

  const hasUndoAction = Boolean(undoToast?.onUndo);

  useEffect(() => {
    setDragX(0);
    setIsDragging(false);
    startXRef.current = null;
    startYRef.current = null;

    if (!undoToast) {
      setSecondsLeft(5);
      return;
    }

    // Alle Benachrichtigungsanzeigen dauern einheitlich 5 Sekunden
    const durationMs = 5000;
    setSecondsLeft(5);
    const interval = setInterval(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    const dismissTimer = setTimeout(() => {
      setUndoToast(null);
    }, durationMs);

    return () => {
      clearInterval(interval);
      clearTimeout(dismissTimer);
    };
  }, [undoToast, setUndoToast]);

  if (!undoToast) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current === null || startYRef.current === null) return;
    const dx = e.touches[0].clientX - startXRef.current;
    const dy = e.touches[0].clientY - startYRef.current;
    if (Math.abs(dx) > Math.abs(dy)) {
      setDragX(dx);
    }
  };

  const handleTouchEnd = () => {
    if (startXRef.current === null) return;
    if (Math.abs(dragX) > 40) {
      setUndoToast(null);
      return;
    }
    setDragX(0);
    setIsDragging(false);
    startXRef.current = null;
    startYRef.current = null;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || startXRef.current === null) return;
    const dx = e.clientX - startXRef.current;
    setDragX(dx);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || startXRef.current === null) return;
    if (Math.abs(dragX) > 40) {
      setUndoToast(null);
      return;
    }
    setDragX(0);
    setIsDragging(false);
    startXRef.current = null;
    startYRef.current = null;
  };

  const swipeStyle: React.CSSProperties = {
    transform: dragX !== 0 ? `translateX(${dragX}px)` : undefined,
    opacity: dragX !== 0 ? Math.max(0.15, 1 - Math.abs(dragX) / 160) : 1,
    transition: isDragging ? 'none' : 'transform 160ms ease-out, opacity 160ms ease-out'
  };

  if (!hasUndoAction) {
    return (
      <div
        style={swipeStyle}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="absolute bottom-20 left-4 right-4 z-50 bg-[#1E2238] text-white px-4 py-3 rounded-xl shadow-xl flex items-center justify-between gap-2.5 animate-slide-up border border-emerald-500/40 select-none touch-pan-y cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold truncate">{undoToast.message}</span>
            <span className="text-[10px] text-slate-300">
              {secondsLeft}s · Nach links/rechts wischen zum Ausblenden
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={swipeStyle}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="absolute bottom-20 left-4 right-4 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl flex items-center justify-between gap-3 animate-slide-up border border-slate-800 select-none touch-pan-y cursor-grab active:cursor-grabbing"
    >
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-medium truncate">{undoToast.message}</span>
        <span className="text-[10px] text-slate-300">
          Noch {secondsLeft}s · Links/rechts wischen zum Ausblenden
        </span>
      </div>
      <button
        type="button"
        onClick={() => {
          undoToast.onUndo?.();
          setUndoToast(null);
        }}
        className="px-3 py-1.5 bg-white/20 hover:bg-white/30 active:scale-95 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all shrink-0 min-h-[36px]"
      >
        <RotateCcw size={13} />
        <span>{undoToast.actionLabel || 'Rückgängig'}</span>
      </button>
    </div>
  );
};
