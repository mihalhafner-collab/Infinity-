import React from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { Home, Calendar, Users, Receipt } from 'lucide-react';
import { ScreenId } from '../../types/index.ts';

interface NavItem {
  id: ScreenId;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const navItems: NavItem[] = [
  { id: 'M01_HEUTE', label: 'Heute', icon: Home },
  { id: 'M02_PLANUNG', label: 'Planung', icon: Calendar },
  { id: 'M03_KUNDEN', label: 'Kunden', icon: Users },
  { id: 'M04_ABRECHNUNG', label: 'Abrechnung', icon: Receipt },
];

export const BottomNav: React.FC = () => {
  const { currentScreen, switchMainTab } = useApp();

  const handleNav = (screenId: ScreenId) => {
    switchMainTab(screenId);
  };

  return (
    <nav className="h-[56px] bg-white border-t border-slate-200/90 grid grid-cols-4 items-center shrink-0 z-20 px-1 select-none">
      {navItems.map((item) => {
        const Icon = item.icon;
        // Also highlight parent tab if we are in a sub-view
        const isActive =
          currentScreen === item.id ||
          (item.id === 'M01_HEUTE' && currentScreen === 'M19_ZEITERFASSUNG') ||
          (item.id === 'M03_KUNDEN' && currentScreen === 'M17_OBJEKTE');

        return (
          <button
            key={item.id}
            onClick={() => handleNav(item.id)}
            className={`h-full min-h-[48px] flex flex-col items-center justify-center py-1 transition-colors active:scale-95 ${
              isActive ? 'text-[#3138A0]' : 'text-[#5D6178] hover:text-slate-800'
            }`}
            aria-label={item.label}
          >
            <Icon size={21} className={isActive ? 'stroke-[2.5]' : 'stroke-[1.8]'} />
            <span
              className={`text-[11px] mt-0.5 tracking-tight ${
                isActive ? 'font-bold text-[#3138A0]' : 'font-medium text-[#5D6178]'
              }`}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
