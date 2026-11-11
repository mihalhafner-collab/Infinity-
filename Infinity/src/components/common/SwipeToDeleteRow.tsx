import React, { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

interface SwipeToDeleteRowProps {
  children: React.ReactNode;
  onDelete: () => void;
  deleteLabel?: string;
  className?: string;
}

/**
 * Pixel 10 Pro optimierte Wisch-Zeile:
 * Verschieben nach links legt den roten Löschbereich frei und löscht den Eintrag.
 */
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

  const finalizeSwipePosition = () => {
    const el = scrollRef.current;
    if (!el || triggeredRef.current) return;
    const width = el.clientWidth || 1;
    const ratio = el.scrollLeft / width;

    if (ratio >= 0.4) {
      triggeredRef.current = true;
      el.scrollTo({ left: width, behavior: 'smooth' });
      setTimeout(() => {
        onDelete();
      }, 140);
    } else if (el.scrollLeft > 0) {
      el.scrollTo({ left: 0, behavior: 'smooth' });
    }
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || triggeredRef.current) return;
    if (isTouchingRef.current || isMouseDownRef.current) return;
    const width = el.clientWidth || 1;
    if (el.scrollLeft / width >= 0.7) {
      triggeredRef.current = true;
      onDelete();
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
    // Ignoriere Klicks direkt auf interaktive Buttons oder Links innerhalb der Zeile
    const target = e.target as HTMLElement;
    if (target.closest('button, a')) return;

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
      className={`w-full overflow-x-auto no-scrollbar flex items-stretch select-none rounded-xl ${
        isMouseDragging ? 'snap-none cursor-grabbing' : 'snap-x snap-mandatory'
      } ${className}`}
    >
      {/* Vordergrund-Inhalt */}
      <div className="w-full shrink-0 snap-start">{children}</div>

      {/* Roter Lösch-Hintergrund beim Nach-links-Verschieben */}
      <div
        onClick={() => {
          if (!triggeredRef.current) {
            triggeredRef.current = true;
            onDelete();
          }
        }}
        className="w-full shrink-0 snap-end bg-[#B42318] text-white flex items-center justify-between px-4 cursor-pointer"
      >
        <div className="flex items-center gap-2 font-bold text-xs">
          <Trash2 size={16} />
          <span>{deleteLabel}</span>
        </div>
        <span className="text-[10px] font-semibold opacity-80">Loslassen zum Löschen</span>
      </div>
    </div>
  );
};
