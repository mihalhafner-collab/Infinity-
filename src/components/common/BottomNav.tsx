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
    <nav className="min-h-[62px] pb-[env(safe-area-inset-bottom)] bg-white border-t border-slate-200/90 grid grid-cols-4 items-center shrink-0 z-20 px-1.5 select-none">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive =
          currentScreen === item.id ||
          (item.id === 'M01_HEUTE' && currentScreen === 'M19_ZEITERFASSUNG') ||
          (item.id === 'M03_KUNDEN' && currentScreen === 'M17_OBJEKTE');

        return (
          <button
            key={item.id}
            onClick={() => handleNav(item.id)}
            className={`h-full min-h-[56px] flex flex-col items-center justify-center py-1 transition-all active:scale-95 ${
              isActive ? 'text-[#3138A0]' : 'text-slate-600 hover:text-slate-900'
            }`}
            aria-label={item.label}
          >
            <span
              className={`px-3.5 py-0.5 rounded-full flex items-center justify-center transition-colors ${
                isActive ? 'bg-indigo-100/90 text-[#3138A0]' : 'bg-transparent'
              }`}
            >
              <Icon size={23} className={isActive ? 'stroke-[2.5]' : 'stroke-[2]'} />
            </span>
            <span
              className={`text-xs mt-0.5 tracking-tight whitespace-nowrap ${
                isActive ? 'font-bold text-[#3138A0]' : 'font-semibold text-slate-600'
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
