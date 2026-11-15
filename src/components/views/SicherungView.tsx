import React, { useRef, useState } from 'react';
import { useApp, usePixelBackLayer } from '../../context/AppContext.tsx';
import { Header } from '../common/Header.tsx';
import { BottomActionBar } from '../common/BottomActionBar.tsx';
import { BottomNav } from '../common/BottomNav.tsx';
import { UndoToast } from '../common/UndoToast.tsx';
import {
  FileArchive,
  CheckCircle,
  RefreshCw,
  FolderOpen,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  Download,
  Upload
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [targetLabel, setTargetLabel] = useState<string>(() => {
    return getNativeBackupMeta()?.targetLabel || 'hausgarten-backup.zip';
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  usePixelBackLayer(restoreModalOpen, () => setRestoreModalOpen(false));

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 5000);
  };

  const handleBackup = async (forcePickTarget = false) => {
    setIsBackingUp(true);
    setBackupSuccess(false);
    setErrorMsg(null);
    const ok = await performBackup(forcePickTarget);
    const updatedMeta = getNativeBackupMeta();
    if (updatedMeta?.targetLabel) {
      setTargetLabel(updatedMeta.targetLabel);
    }
    setIsBackingUp(false);
    if (ok) {
      setBackupSuccess(true);
      setTimeout(() => setBackupSuccess(false), 4000);
    } else {
      showError('Sicherung abgebrochen oder Zieldatei konnte nicht beschrieben werden.');
    }
  };

  const handleRestore = async (pickExternalFile = false) => {
    setErrorMsg(null);
    const ok = await restoreBackup(pickExternalFile);
    setRestoreModalOpen(false);
    if (ok) {
      setRestoreSuccess(true);
      setTimeout(() => setRestoreSuccess(false), 3500);
    } else {
      showError('Wiederherstellung fehlgeschlagen oder keine gültige Sicherungsdatei gefunden.');
    }
  };

  const handleBrowserDownloadJson = async () => {
    await handleBackup(false);
    const raw = localStorage.getItem('hausgarten_backup_file');
    if (!raw) return;
    const blob = new Blob([raw], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hausgarten-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBrowserUploadJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = String(reader.result || '');
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object') {
          showError('Ungültiges Dateiformat.');
          return;
        }
        localStorage.setItem('hausgarten_backup_file', text);
        await handleRestore(false);
      } catch {
        showError('Datei konnte nicht gelesen werden.');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
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
                Zieldatei einmal gewählt · fortlaufend ergänzt (inkl. Lösch-Index)
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Letzter geprüfter Stand:</span>
              <span className="font-semibold text-slate-800">
                {lastBackupDate
                  ? new Date(lastBackupDate).toLocaleString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                  : 'Noch keine Sicherung'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Integritätsstatus:</span>
              <span
                className={`font-bold flex items-center gap-1 ${
                  lastBackupDate ? 'text-[#2C7738]' : 'text-slate-400'
                }`}
              >
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

          {errorMsg && (
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-[#B42318] text-xs font-semibold flex items-center gap-2 animate-fade-in">
              <AlertTriangle size={15} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {backupSuccess && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-[#2C7738] text-xs font-semibold flex items-center gap-2 animate-fade-in">
              <CheckCircle size={15} className="shrink-0" />
              <span>Sicherung erfolgreich in {targetLabel} ergänzt & geprüft!</span>
            </div>
          )}

          {restoreSuccess && (
            <div className="p-2.5 bg-indigo-50 border border-indigo-200 rounded-xl text-[#3138A0] text-xs font-semibold flex items-center gap-2 animate-fade-in">
              <CheckCircle size={15} className="shrink-0" />
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

            {isNative ? (
              <button
                onClick={() => void handleBackup(true)}
                disabled={isBackingUp}
                className="h-10 px-3 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shrink-0"
              >
                <FolderOpen size={14} className="text-[#3138A0]" />
                <span>Zielort wählen</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleBrowserDownloadJson()}
                className="h-10 px-3 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shrink-0"
              >
                <Download size={14} className="text-[#3138A0]" />
                <span>Datei laden</span>
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleBrowserUploadJson}
            className="hidden"
          />
        </div>

        {/* Info Rules Card (REQ-020, REQ-021) */}
        <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs space-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-slate-800 font-bold">
            <ShieldCheck size={16} className="text-[#3138A0]" />
            <span>Sicherungskonzept (REQ-020 bis REQ-022)</span>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed">
            Es entsteht nicht pro Lauf eine neue sichtbare Datei. Eine gewählte Datei wird sicher fortgeschrieben und durch Rücklesen validiert. Wiederherstellung erfolgt mit Rückgängig-Schutz.
          </p>
        </div>
      </div>

      <UndoToast />

      {/* Restore Confirmation Modal */}
      {restoreModalOpen && (
        <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-4 shadow-2xl border border-slate-200 space-y-3">
            <div className="flex items-center gap-2 text-[#B42318]">
              <AlertTriangle size={20} />
              <h3 className="text-base font-bold text-slate-900">Diese Sicherung übernehmen?</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Die App-Daten werden durch die geprüfte Sicherung aus{' '}
              <span className="font-mono font-bold">{targetLabel}</span> ersetzt (Sie können den Vorgang direkt danach über „Rückgängig“ widerrufen).
            </p>

            <div className="pt-1 space-y-2">
              <div className="flex items-center gap-2">
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

              {isNative ? (
                <button
                  type="button"
                  onClick={() => void handleRestore(true)}
                  className="w-full h-10 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5"
                >
                  <FolderOpen size={14} className="text-[#3138A0]" />
                  <span>Andere Sicherungsdatei auswählen…</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-10 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5"
                >
                  <Upload size={14} className="text-[#3138A0]" />
                  <span>Sicherungsdatei (.json) vom Gerät wählen…</span>
                </button>
              )}
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
