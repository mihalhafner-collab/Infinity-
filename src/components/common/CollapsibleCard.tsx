import React, { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface CollapsibleCardProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  iconBgClassName?: string;
  badge?: React.ReactNode;
  headerRight?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  expandDirection?: 'down' | 'up';
}

function findScrollableAncestorWithin(
  target: EventTarget | null,
  boundary: HTMLElement | null
): HTMLElement | null {
  let el = target instanceof HTMLElement ? target : null;
  while (el && el !== boundary) {
    if (el.scrollHeight > el.clientHeight + 4) {
      const style = window.getComputedStyle(el);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        return el;
      }
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Einheitliches Anzeigedesign für alle ausklappbaren Optionen & Reiter (Accordions)
 * in der Infinity App (optimiert für Google Pixel 10 Pro).
 * Unterstützt bei geöffnetem Zustand das Schließen per Nach-unten-Wischen (wie beim Plus-Menü).
 */
export const CollapsibleCard: React.FC<CollapsibleCardProps> = ({
  title,
  subtitle,
  icon,
  iconBgClassName = 'bg-indigo-50 text-[#3138A0] border-indigo-100',
  badge,
  headerRight,
  open,
  onToggle,
  children,
  className = '',
  headerClassName = '',
  bodyClassName,
  expandDirection = 'down'
}) => {
  const isUp = expandDirection === 'up';
  const defaultBodyClass = isUp
    ? 'p-3.5 bg-slate-50/70 border-b border-slate-100 space-y-2.5'
    : 'p-3.5 bg-slate-50/70 border-t border-slate-100 space-y-2.5';
  const resolvedBodyClass = bodyClassName ?? defaultBodyClass;

  const cardRef = useRef<HTMLDivElement | null>(null);
  const startYRef = useRef<number | null>(null);
  const startXRef = useRef<number | null>(null);
  const scrollElRef = useRef<HTMLElement | null>(null);
  const suppressNextClickRef = useRef(false);

  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Bei expandDirection="up" zeigt der Pfeil im geschlossenen Zustand nach oben (rotate-180)
  // und im geöffneten Zustand nach unten (rotate-0).
  const arrowRotationClass = isUp
    ? open
      ? 'bg-indigo-50 text-[#3138A0] rotate-0'
      : 'bg-slate-100 text-slate-500 rotate-180'
    : open
      ? 'bg-indigo-50 text-[#3138A0] rotate-180'
      : 'bg-slate-100 text-slate-500 rotate-0';

  const resetDrag = () => {
    setDragOffsetY(0);
    setIsDragging(false);
    startYRef.current = null;
    startXRef.current = null;
    scrollElRef.current = null;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!open) return;
    const scrollEl = findScrollableAncestorWithin(e.target, cardRef.current);
    if (scrollEl && scrollEl.scrollTop > 4) {
      startYRef.current = null;
      return;
    }
    scrollElRef.current = scrollEl;
    startYRef.current = e.touches[0].clientY;
    startXRef.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!open || startYRef.current === null || startXRef.current === null) return;
    if (scrollElRef.current && scrollElRef.current.scrollTop > 4) {
      resetDrag();
      return;
    }
    const dy = e.touches[0].clientY - startYRef.current;
    const dx = e.touches[0].clientX - startXRef.current;
    if (dy > 8 && dy > Math.abs(dx) * 1.15) {
      setIsDragging(true);
      setDragOffsetY(Math.min(dy, 90));
    } else if (dy < -8) {
      resetDrag();
    }
  };

  const handleTouchEnd = () => {
    if (!open || startYRef.current === null) return;
    if (dragOffsetY > 38) {
      suppressNextClickRef.current = true;
      resetDrag();
      onToggle();
      return;
    }
    resetDrag();
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!open || e.pointerType === 'touch') return;
    const scrollEl = findScrollableAncestorWithin(e.target, cardRef.current);
    if (scrollEl && scrollEl.scrollTop > 4) return;
    scrollElRef.current = scrollEl;
    startYRef.current = e.clientY;
    startXRef.current = e.clientX;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!open || e.pointerType === 'touch' || startYRef.current === null || startXRef.current === null) {
      return;
    }
    const dy = e.clientY - startYRef.current;
    const dx = e.clientX - startXRef.current;
    if (dy > 8 && dy > Math.abs(dx) * 1.15) {
      setIsDragging(true);
      setDragOffsetY(Math.min(dy, 90));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!open || e.pointerType === 'touch' || startYRef.current === null) return;
    if (dragOffsetY > 38) {
      suppressNextClickRef.current = true;
      resetDrag();
      onToggle();
      return;
    }
    resetDrag();
  };

  const bodyDragStyle: React.CSSProperties | undefined =
    open && dragOffsetY > 0
      ? {
          transform: `translateY(${Math.round(dragOffsetY * 0.55)}px)`,
          opacity: Math.max(0.45, 1 - dragOffsetY / 150),
          transition: isDragging ? 'none' : 'transform 160ms ease-out, opacity 160ms ease-out'
        }
      : undefined;

  return (
    <div
      ref={cardRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={resetDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={`bg-white border border-slate-200/95 rounded-2xl overflow-hidden shadow-2xs transition-colors ${className}`}
    >
      {isUp && open && (
        <div style={bodyDragStyle} className={resolvedBodyClass}>
          <div className="pt-1.5 pb-0.5 flex justify-center shrink-0">
            <div className="w-9 h-1 bg-slate-300 rounded-full" />
          </div>
          {children}
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            return;
          }
          onToggle();
        }}
        aria-expanded={open}
        className={`w-full min-h-[52px] px-3.5 py-2.5 flex items-center justify-between gap-2.5 text-left hover:bg-slate-50/80 active:bg-slate-100/70 transition-colors ${headerClassName}`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {icon && (
            <div
              className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${iconBgClassName}`}
            >
              {icon}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-bold text-slate-950 leading-snug truncate">
                {title}
              </span>
              {badge}
            </div>
            {subtitle && (
              <div className="text-[11px] text-slate-500 leading-tight mt-0.5 truncate">
                {subtitle}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {headerRight}
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-200 ${arrowRotationClass}`}
          >
            <ChevronDown size={16} />
          </div>
        </div>
      </button>

      {!isUp && open && (
        <div style={bodyDragStyle} className={resolvedBodyClass}>
          {children}
        </div>
      )}
    </div>
  );
};
