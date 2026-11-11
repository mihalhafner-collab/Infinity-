import React, { useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import {
  HardDrive,
  FileArchive,
  CheckCircle,
  RefreshCw,
  FolderOpen,
  ArrowRight,
  ShieldCheck,
  AlertTriangle
} from 'lucide-react';

import {
  getNativeBackupMeta,
  isNativeAndroidApp
} from '../../services/nativeBridge.ts';

export const SicherungView: React.FC = () => {
  const { lastBackupDate, performBackup, restoreBackup } = useApp();
  const isNative = isNativeAndroidApp();

  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupSuccess, setBackupSuccess] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState(false);
  const [targetLabel, setTargetLabel] = useState<string>(() => {
    return getNativeBackupMeta()?.targetLabel || 'hausgarten-backup.zip';
  });

  const handleBackup = async (forcePickTarget = false) => {
    setIsBackingUp(true);
    setBackupSuccess(false);
    const ok = await performBackup(forcePickTarget);
    const updatedMeta = getNativeBackupMeta();
    if (updatedMeta?.targetLabel) {
      setTargetLabel(updatedMeta.targetLabel);
    }
    setIsBackingUp(false);
    if (ok) {
      setBackupSuccess(true);
      setTimeout(() => setBackupSuccess(false), 4000);
    }
  };

  const handleRestore = async (pickExternalFile = false) => {
    const ok = await restoreBackup(pickExternalFile);
    setRestoreModalOpen(false);
    if (ok) {
      setRestoreSuccess(true);
      setTimeout(() => setRestoreSuccess(false), 3000);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#F8F9FA] overflow-hidden relative">
      <Header title="Sicherung" subtitle="App" showBack />

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-xs text-slate-700 overscroll-contain">
        {/* Main Target File Card (ILL-014, WF-025) */}
        <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-[#3138A0] shrink-0 font-bold">
              <FileArchive size={22} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 leading-tight truncate">
                {targetLabel}
              </h3>
              <p className="text-[11px] text-slate-500">
                Zieldatei einmal gewählt · fortlaufend ergänzt
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Letzter geprüfter Stand:</span>
              <span className="font-semibold text-slate-800">
                {lastBackupDate ? new Date(lastBackupDate).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Noch keine Sicherung'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Integritätsstatus:</span>
              <span className={`font-bold flex items-center gap-1 ${lastBackupDate ? 'text-[#2C7738]' : 'text-slate-400'}`}>
                <CheckCircle size={13} />
                <span>{lastBackupDate ? 'Rücklesen bestätigt' : 'Ausstehend'}</span>
              </span>
            </div>
          </div>

          {/* Flow visual (Page 44) */}
          <div className="p-2.5 bg-slate-50 rounded-xl flex items-center justify-between text-[11px] text-slate-600 font-medium">
            <span>Neue Daten</span>
            <ArrowRight size={13} className="text-slate-400" />
            <span className="font-bold text-[#3138A0]">gleiche Datei ergänzen</span>
            <ArrowRight size={13} className="text-slate-400" />
            <span>erneut prüfen</span>
          </div>

          {backupSuccess && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-[#2C7738] text-xs font-semibold flex items-center gap-2 animate-fade-in">
              <CheckCircle size={15} />
              <span>Sicherung erfolgreich in hausgarten-backup.zip ergänzt & geprüft!</span>
            </div>
          )}

          {restoreSuccess && (
            <div className="p-2.5 bg-indigo-50 border border-indigo-200 rounded-xl text-[#3138A0] text-xs font-semibold flex items-center gap-2 animate-fade-in">
              <CheckCircle size={15} />
              <span>Daten erfolgreich wiederhergestellt!</span>
            </div>
          )}

          {/* Main Action: Sicherung ergänzen */}
          <button
            onClick={() => void handleBackup(false)}
            disabled={isBackingUp}
            className="w-full h-12 bg-[#3138A0] hover:bg-[#272d82] active:scale-98 disabled:opacity-50 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 shadow-xs transition-all"
          >
            <RefreshCw size={15} className={isBackingUp ? 'animate-spin' : ''} />
            <span>{isBackingUp ? 'Prüfe und sichere...' : 'Sicherung ergänzen'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setRestoreModalOpen(true)}
              className="flex-1 h-10 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all"
            >
              <span>Wiederherstellen</span>
            </button>

            {isNative && (
              <button
                onClick={() => void handleBackup(true)}
                disabled={isBackingUp}
                className="h-10 px-3 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shrink-0"
              >
                <FolderOpen size={14} className="text-[#3138A0]" />
                <span>Zielort wählen</span>
              </button>
            )}
          </div>
        </div>

        {/* Info Rules Card (REQ-020, REQ-021) */}
        <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-slate-800 font-bold">
            <ShieldCheck size={16} className="text-[#3138A0]" />
            <span>Sicherungskonzept (REQ-020 bis REQ-022)</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Es entsteht nicht pro Lauf eine neue sichtbare Datei. Eine gewählte Datei wird sicher fortgeschrieben und durch Rücklesen validiert. Wiederherstellung erfolgt nur nach ausdrücklicher Bestätigung.
          </p>
        </div>
      </div>

      {/* Restore Confirmation Modal */}
      {restoreModalOpen && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-4 shadow-2xl border border-slate-200 space-y-3">
            <div className="flex items-center gap-2 text-[#B42318]">
              <AlertTriangle size={20} />
              <h3 className="text-base font-bold text-slate-900">Diese Sicherung übernehmen?</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Die App-Daten werden durch die ausgewählte, geprüfte Sicherung aus <span className="font-mono font-bold">hausgarten-backup.zip</span> ersetzt.
            </p>

            <div className="pt-2 flex items-center gap-2">
              <button
                onClick={() => setRestoreModalOpen(false)}
                className="flex-1 h-11 bg-slate-100 text-slate-700 font-semibold rounded-xl text-xs"
              >
                Abbrechen
              </button>
              <button
                onClick={() => void handleRestore(false)}
                className="flex-1 h-11 bg-[#3138A0] text-white font-semibold rounded-xl text-xs"
              >
                Wiederherstellen
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="shrink-0 w-full mt-auto bg-white border-t border-slate-200/80 z-20 shadow-md">
        <BottomActionBar />
        <BottomNav />
      </div>
    </div>
  );
};
