import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { RotateCcw } from 'lucide-react';

export const UndoToast: React.FC = () => {
  const { undoToast, setUndoToast } = useApp();
  const [secondsLeft, setSecondsLeft] = useState(5);

  useEffect(() => {
    if (!undoToast) {
      setSecondsLeft(5);
      return;
    }

    setSecondsLeft(5);
    const interval = setInterval(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    const dismissTimer = setTimeout(() => {
      setUndoToast(null);
    }, 5000);

    return () => {
      clearInterval(interval);
      clearTimeout(dismissTimer);
    };
  }, [undoToast, setUndoToast]);

  if (!undoToast) return null;

  return (
    <div className="absolute bottom-20 left-4 right-4 z-40 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl flex items-center justify-between gap-3 animate-slide-up border border-slate-800">
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-medium truncate">{undoToast.message}</span>
        <span className="text-[10px] text-slate-300">Noch {secondsLeft}s zum Rückgängigmachen</span>
      </div>
      <button
        onClick={() => {
          undoToast.onUndo();
          setUndoToast(null);
        }}
        className="px-3 py-1.5 bg-white/20 hover:bg-white/30 active:scale-95 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all shrink-0 min-h-[36px]"
      >
        <RotateCcw size={13} />
        <span>Rückgängig</span>
      </button>
    </div>
  );
};
