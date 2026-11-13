import React, { useRef, useState } from 'react';
import { Trash2, ArrowLeft } from 'lucide-react';

interface SwipeToDeleteRowProps {
  children: React.ReactNode;
  onDelete: () => void;
  deleteLabel?: string;
  className?: string;
}

/**
 * Pixel 10 Pro optimierte Wisch-Zeile mit nach links versetztem Referenzpunkt (75 %),
 * um versehentliche Löschungen (insbesondere der Kundenakte beim Scrollen oder Tippen)
 * zuverlässig zu verhindern.
 *
 * WICHTIG:
 * - Kein `snap-end` auf dem roten Hintergrund, damit ein kurzes Anstreifen niemals
 *   automatisch in die Löschposition schnappt.
 * - Erst wenn die Zeile über den linken Referenzpunkt (mind. 75 % der Zeilenbreite nach links)
 *   gezogen und dort losgelassen wird, wird die Löschung ausgelöst.
 */
const LEFT_DELETE_REFERENCE_RATIO = 0.75;

export const SwipeToDeleteRow: React.FC<SwipeToDeleteRowProps> = ({
  children,
  onDelete,
  deleteLabel = 'Eintrag löschen',
  className = ''
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isTouchingRef = useRef(false);
  const isMouseDownRef = useRef(false);
  const triggeredRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartScrollRef = useRef(0);
  const [isMouseDragging, setIsMouseDragging] = useState(false);
  const [pastReferencePoint, setPastReferencePoint] = useState(false);

  const updateReferenceState = () => {
    const el = scrollRef.current;
    if (!el) return;
    const width = el.clientWidth || 1;
    const ratio = el.scrollLeft / width;
    const reached = ratio >= LEFT_DELETE_REFERENCE_RATIO;
    setPastReferencePoint((prev) => (prev !== reached ? reached : prev));
  };

  const finalizeSwipePosition = () => {
    const el = scrollRef.current;
    if (!el || triggeredRef.current) return;
    const width = el.clientWidth || 1;
    const ratio = el.scrollLeft / width;

    // Nur löschen, wenn bis über den linken Referenzpunkt (75 %) gezogen wurde
    if (ratio >= LEFT_DELETE_REFERENCE_RATIO) {
      triggeredRef.current = true;
      el.scrollTo({ left: width, behavior: 'smooth' });
      setTimeout(() => {
        onDelete();
      }, 150);
    } else if (el.scrollLeft > 0) {
      setPastReferencePoint(false);
      el.scrollTo({ left: 0, behavior: 'smooth' });
    }
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || triggeredRef.current) return;
    updateReferenceState();

    // Kein automatisches Auslösen während des Scrollens unterhalb von 92 %
    if (isTouchingRef.current || isMouseDownRef.current) return;
    const width = el.clientWidth || 1;
    const ratio = el.scrollLeft / width;
    if (ratio < LEFT_DELETE_REFERENCE_RATIO && el.scrollLeft > 0) {
      el.scrollTo({ left: 0, behavior: 'smooth' });
    }
  };

  const handleTouchStart = () => {
    isTouchingRef.current = true;
  };

  const handleTouchEnd = () => {
    isTouchingRef.current = false;
    finalizeSwipePosition();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea')) return;

    const el = scrollRef.current;
    if (!el) return;
    isMouseDownRef.current = true;
    setIsMouseDragging(true);
    dragStartXRef.current = e.clientX;
    dragStartScrollRef.current = el.scrollLeft;
    el.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMouseDownRef.current || e.pointerType !== 'mouse') return;
    const el = scrollRef.current;
    if (!el) return;
    const dx = e.clientX - dragStartXRef.current;
    el.scrollLeft = Math.max(0, dragStartScrollRef.current - dx);
    updateReferenceState();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMouseDownRef.current || e.pointerType !== 'mouse') return;
    const el = scrollRef.current;
    isMouseDownRef.current = false;
    setIsMouseDragging(false);
    if (el && el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    finalizeSwipePosition();
  };

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`w-full overflow-x-auto no-scrollbar flex items-stretch select-none rounded-2xl touch-pan-y ${
        isMouseDragging ? 'cursor-grabbing' : ''
      } ${className}`}
    >
      {/* Vordergrund-Inhalt (rastet immer links am Startpunkt ein) */}
      <div className="w-full shrink-0">{children}</div>

      {/* Lösch-Hintergrund mit nach links gesetztem Referenzpunkt (ab 75 % Wischweg) */}
      <div
        className={`w-full shrink-0 flex items-center justify-between px-4 transition-colors duration-150 ${
          pastReferencePoint
            ? 'bg-[#B42318] text-white'
            : 'bg-slate-200/90 text-slate-700'
        }`}
      >
        {/* Linker Sicherheitsbereich bis zum Referenzpunkt */}
        <div className="flex items-center gap-1.5 text-[11px] font-semibold">
          {pastReferencePoint ? (
            <>
              <Trash2 size={15} className="shrink-0" />
              <span className="font-bold">{deleteLabel}</span>
            </>
          ) : (
            <>
              <ArrowLeft size={14} className="text-slate-500 shrink-0" />
              <span>Weiter nach links ziehen…</span>
            </>
          )}
        </div>

        {/* Visueller Referenzpunkt auf der linken Wischziel-Seite (75 %-Schwelle) */}
        <div className="flex items-center gap-2 pl-3 border-l-2 border-dashed border-current/40 shrink-0">
          <Trash2 size={15} className="shrink-0" />
          <span className="text-[10px] font-bold">
            {pastReferencePoint ? 'Loslassen zum Löschen' : 'Referenzpunkt links'}
          </span>
        </div>
      </div>
    </div>
  );
};
