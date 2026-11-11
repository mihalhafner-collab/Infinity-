import React from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { Smartphone, Monitor } from 'lucide-react';

interface PixelFrameProps {
  children: React.ReactNode;
}

export const PixelFrame: React.FC<PixelFrameProps> = ({ children }) => {
  const { pixelFrameEnabled, setPixelFrameEnabled } = useApp();

  return (
    <div className="w-full h-full h-[100dvh] bg-[#E2E5E9] flex flex-col items-center justify-center sm:py-2 sm:px-4 text-[#1E2238] overflow-hidden">
      {/* Desktop Helper Bar to toggle Device Frame */}
      <div className="hidden sm:flex items-center justify-between w-full max-w-[412px] mb-2 px-3 py-1.5 text-xs text-slate-600 bg-white/80 backdrop-blur-sm rounded-xl border border-slate-200 shadow-xs shrink-0">
        <div className="flex items-center gap-1.5 font-medium">
          <Smartphone size={14} className="text-[#3138A0]" />
          <span>Google Pixel 10 Pro (20:9)</span>
        </div>
        <button
          onClick={() => setPixelFrameEnabled(!pixelFrameEnabled)}
          className="flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-slate-200 text-[11px] font-semibold text-slate-700 transition-colors"
          title="Rahmen umschalten"
        >
          {pixelFrameEnabled ? (
            <>
              <Monitor size={12} />
              <span>Vollbild</span>
            </>
          ) : (
            <>
              <Smartphone size={12} />
              <span>Pixel Rahmen</span>
            </>
          )}
        </button>
      </div>

      {/* Main Container - Exact Pixel 10 Pro viewport on mobile or inside device frame */}
      <div
        className={`w-full bg-[#F8F9FA] relative flex flex-col overflow-hidden transition-all duration-200 h-[100dvh] max-h-[100dvh] ${
          pixelFrameEnabled
            ? 'sm:w-[412px] sm:max-w-[412px] sm:h-[892px] sm:max-h-[892px] sm:rounded-[52px] sm:shadow-2xl sm:ring-[14px] sm:ring-slate-900 sm:border-[3px] sm:border-slate-700/80'
            : 'max-w-[440px] sm:rounded-3xl sm:shadow-xl sm:border sm:border-slate-300'
        }`}
      >
        {/* Pixel 10 Pro Centered Camera Punch-Hole */}
        {pixelFrameEnabled && (
          <div className="hidden sm:flex absolute top-2.5 left-1/2 -translate-x-1/2 w-4 h-4 bg-black rounded-full z-50 pointer-events-none ring-1 ring-slate-800 shadow-inner items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-900 ring-1 ring-indigo-950/40" />
          </div>
        )}

        {/* Android 16 Status Bar (32px, Pixel 10 Pro Ergonomie) */}
        <div className="w-full h-8 px-6 flex items-center justify-between text-xs font-semibold text-slate-800 bg-white shrink-0 select-none z-30 pt-0.5 border-b border-slate-100/50">
          <span className="font-mono text-[11px]">09:41</span>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-700">
            <span className="font-mono text-[10px] tracking-tight font-bold">5G</span>
            {/* Wi-Fi Icon */}
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h.01"/>
              <path d="M2 8.82a15 15 0 0 1 20 0"/>
              <path d="M5 12.859a10 10 0 0 1 14 0"/>
              <path d="M8.5 16.429a5 5 0 0 1 7 0"/>
            </svg>
            {/* Battery Indicator */}
            <div className="w-4 h-2.5 border border-slate-700 rounded-xs flex items-center p-0.5">
              <div className="w-full h-full bg-slate-800 rounded-2xs" />
            </div>
            <span className="text-[10px] font-mono">100%</span>
          </div>
        </div>

        {/* App Content Canvas (flex-1 min-h-0 guarantees scroll containment) */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative bg-[#F8F9FA]">
          {children}
        </div>

        {/* Android Home Navigation Gesture Pill (safe area zone) */}
        <div className="w-full py-2 bg-white flex justify-center items-center shrink-0 border-t border-slate-100/60 z-30">
          <div className="w-36 h-1 bg-slate-900/70 rounded-full" />
        </div>
      </div>
    </div>
  );
};
