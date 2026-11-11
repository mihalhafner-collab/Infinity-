import React from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { ChevronLeft, MoreVertical } from 'lucide-react';

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
    <header className="h-[56px] px-4 bg-white border-b border-slate-200/90 flex items-center justify-between shrink-0 sticky top-0 z-20">
      <div className="flex items-center gap-2 min-w-0">
        {shouldShowBack && (
          <button
            onClick={handleBack}
            className="w-12 h-12 -ml-2 flex items-center justify-center text-slate-800 hover:text-slate-950 active:bg-slate-100 rounded-full transition-colors shrink-0"
            aria-label="Zurück"
          >
            <ChevronLeft size={26} strokeWidth={2.5} />
          </button>
        )}
        <div className="flex flex-col min-w-0">
          {subtitle && (
            <span className="text-xs font-semibold text-slate-600 tracking-wide truncate leading-tight">
              {subtitle}
            </span>
          )}
          <h1 className="text-xl font-bold text-slate-950 tracking-tight truncate leading-tight">
            {title}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => setIsThreeDotsMenuOpen(true)}
          className="w-12 h-12 -mr-2 flex items-center justify-center text-slate-800 hover:text-slate-950 active:bg-slate-100 rounded-full transition-colors"
          aria-label="Menü öffnen"
        >
          <MoreVertical size={24} strokeWidth={2.2} />
        </button>
      </div>
    </header>
  );
};
