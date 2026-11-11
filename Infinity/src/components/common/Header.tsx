import React from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { ChevronLeft, MoreVertical } from 'lucide-react';
import { ScreenId } from '../../types/index.ts';

interface HeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  showBack = false,
  onBack
}) => {
  const { currentScreen, canGoBack, goBack, setIsThreeDotsMenuOpen } = useApp();

  const isMainTab = ['M01_HEUTE', 'M02_PLANUNG', 'M03_KUNDEN', 'M04_ABRECHNUNG'].includes(currentScreen);
  const shouldShowBack = showBack || canGoBack || !isMainTab;

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      goBack();
    }
  };

  return (
    <header className="h-14 px-4 bg-white border-b border-slate-200/80 flex items-center justify-between shrink-0 sticky top-0 z-20">
      <div className="flex items-center gap-2 min-w-0">
        {shouldShowBack && (
          <button
            onClick={handleBack}
            className="min-w-[48px] min-h-[48px] -ml-2 flex items-center justify-center text-slate-700 hover:text-slate-900 active:bg-slate-100 rounded-full transition-colors"
            aria-label="Zurück"
          >
            <ChevronLeft size={24} />
          </button>
        )}
        <div className="flex flex-col min-w-0">
          {subtitle && (
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider truncate">
              {subtitle}
            </span>
          )}
          <h1 className="text-lg font-bold text-slate-900 tracking-tight truncate leading-tight">
            {title}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => setIsThreeDotsMenuOpen(true)}
          className="min-w-[48px] min-h-[48px] -mr-2 flex items-center justify-center text-slate-700 hover:text-slate-900 active:bg-slate-100 rounded-full transition-colors"
          aria-label="Menü öffnen"
        >
          <MoreVertical size={22} />
        </button>
      </div>
    </header>
  );
};
