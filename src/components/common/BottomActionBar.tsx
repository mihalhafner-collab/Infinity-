import React from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { Search, Plus } from 'lucide-react';

interface BottomActionBarProps {
  children?: React.ReactNode;
}

export const BottomActionBar: React.FC<BottomActionBarProps> = ({ children }) => {
  const {
    setIsSearchOpen,
    setIsPlusMenuOpen
  } = useApp();

  return (
    <div className="px-4 py-2 bg-white/95 backdrop-blur-xs border-t border-slate-200/80 flex items-center justify-between gap-2 shrink-0 z-10">
      {/* Lupe (Suche) - klare 48dp+ Daumenfläche */}
      <button
        onClick={() => setIsSearchOpen(true)}
        className="w-12 h-12 flex items-center justify-center bg-slate-100/90 hover:bg-slate-200 active:scale-95 text-slate-800 rounded-2xl transition-all shrink-0"
        aria-label="Suche öffnen"
        title="Suche"
      >
        <Search size={23} strokeWidth={2.2} />
      </button>

      {children && (
        <div className="flex-1 flex items-center justify-center min-w-0 px-1">
          {children}
        </div>
      )}

      {/* Plus (Schnellmenü) - klare primäre 48dp+ Daumenfläche */}
      <button
        onClick={() => setIsPlusMenuOpen(true)}
        className="w-12 h-12 flex items-center justify-center bg-indigo-50 hover:bg-indigo-100 active:scale-95 text-[#3138A0] border border-indigo-200/80 rounded-2xl transition-all shrink-0"
        aria-label="Schnellmenü öffnen"
        title="Schnellmenü"
      >
        <Plus size={25} strokeWidth={2.5} />
      </button>
    </div>
  );
};
