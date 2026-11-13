import React from 'react';
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
}

/**
 * Einheitliches Anzeigedesign für alle ausklappbaren Optionen (Accordions)
 * in der Infinity App (optimiert für Google Pixel 10 Pro).
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
  bodyClassName = 'p-3.5 bg-slate-50/70 border-t border-slate-100 space-y-2.5'
}) => {
  return (
    <div
      className={`bg-white border border-slate-200/95 rounded-2xl overflow-hidden shadow-2xs transition-colors ${className}`}
    >
      <button
        type="button"
        onClick={onToggle}
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
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-200 ${
              open
                ? 'bg-indigo-50 text-[#3138A0] rotate-180'
                : 'bg-slate-100 text-slate-500'
            }`}
          >
            <ChevronDown size={16} />
          </div>
        </div>
      </button>

      {open && <div className={bodyClassName}>{children}</div>}
    </div>
  );
};
