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
    <div className="px-5 py-2 bg-white/95 backdrop-blur-xs border-t border-slate-200/80 flex items-center justify-between shrink-0 z-10">
      {/* Lupe (Suche) - min 48dp hitbox */}
      <button
        onClick={() => setIsSearchOpen(true)}
        className="w-12 h-12 flex items-center justify-center text-slate-700 hover:text-slate-900 active:bg-slate-100 rounded-full transition-colors shrink-0"
        aria-label="Suche öffnen"
        title="Suche"
      >
        <Search size={22} />
      </button>

      {children && (
        <div className="flex-1 flex items-center justify-center px-2">
          {children}
        </div>
      )}

      {/* Plus (Schnellmenü) - min 48dp hitbox */}
      <button
        onClick={() => setIsPlusMenuOpen(true)}
        className="w-12 h-12 flex items-center justify-center text-slate-700 hover:text-slate-900 active:bg-slate-100 rounded-full transition-colors shrink-0"
        aria-label="Schnellmenü öffnen"
        title="Schnellmenü"
      >
        <Plus size={24} />
      </button>
    </div>
  );
};

