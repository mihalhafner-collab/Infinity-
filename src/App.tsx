import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext.tsx';
import { PixelFrame } from './components/common/PixelFrame.tsx';
import { GoogleSignInButton } from './components/common/GoogleSignInButton.tsx';
import { isNativeAndroidApp } from './services/nativeBridge.ts';
import {
  OWNER_EMAIL,
  OwnerSessionState,
  getOwnerSessionState,
  ownerSignIn,
  subscribeOwnerSession
} from './services/gmailService.ts';
import { HeuteView } from './components/views/HeuteView.tsx';
import { PlanungView } from './components/views/PlanungView.tsx';
import { KundenView } from './components/views/KundenView.tsx';
import { AbrechnungView } from './components/views/AbrechnungView.tsx';
import { ArbeitenView } from './components/views/ArbeitenView.tsx';
import { LcrView } from './components/views/LcrView.tsx';
import { GeraeteView } from './components/views/GeraeteView.tsx';
import { MaterialView } from './components/views/MaterialView.tsx';
import { VorgaengeView } from './components/views/VorgaengeView.tsx';
import { SicherungView } from './components/views/SicherungView.tsx';
import { EinstellungenView } from './components/views/EinstellungenView.tsx';

// Modals
import { PlusMenuModal } from './components/common/PlusMenuModal.tsx';
import { ThreeDotsMenuModal } from './components/common/ThreeDotsMenuModal.tsx';
import { SucheModal } from './components/modals/SucheModal.tsx';
import { TerminModal } from './components/modals/TerminModal.tsx';
import { KundeModal } from './components/modals/KundeModal.tsx';
import { ObjektModal } from './components/modals/ObjektModal.tsx';
import { ArbeitModal } from './components/modals/ArbeitModal.tsx';
import { RechnungModal } from './components/modals/RechnungModal.tsx';
import { RechnungVersendenModal } from './components/modals/RechnungVersendenModal.tsx';
import { WartungModal } from './components/modals/WartungModal.tsx';
import { GeraetModal } from './components/modals/GeraetModal.tsx';
import { MaterialModal } from './components/modals/MaterialModal.tsx';

const MainRouter: React.FC = () => {
  const { currentScreen } = useApp();

  const renderCurrentScreen = () => {
    switch (currentScreen) {
      case 'M01_HEUTE':
        return <HeuteView />;
      case 'M02_PLANUNG':
        return <PlanungView />;
      case 'M03_KUNDEN':
        return <KundenView />;
      case 'M04_ABRECHNUNG':
        return <AbrechnungView />;
      case 'M05_ANFRAGEN':
      case 'M06_ANGEBOTE':
      case 'M07_AUFTRAEGE':
        return <VorgaengeView />;
      case 'M08_ARBEITEN':
        return <ArbeitenView />;
      case 'M09_LCR':
        return <LcrView />;
      case 'M10_GERAETE':
        return <GeraeteView />;
      case 'M11_MATERIAL':
        return <MaterialView />;
      case 'M12_SICHERUNG':
        return <SicherungView />;
      case 'M13_EINSTELLUNGEN':
      case 'M15_SPEICHER_APP':
        return <EinstellungenView />;
      default:
        return <HeuteView />;
    }
  };

  return (
    <PixelFrame>
      {renderCurrentScreen()}

      {/* Global Overlays & Modals */}
      <PlusMenuModal />
      <ThreeDotsMenuModal />
      <SucheModal />
      <TerminModal />
      <KundeModal />
      <ObjektModal />
      <ArbeitModal />
      <RechnungModal />
      <RechnungVersendenModal />
      <WartungModal />
      <GeraetModal />
      <MaterialModal />
    </PixelFrame>
  );
};

export default function App() {
  const isNative = isNativeAndroidApp();
  const [ownerSession, setOwnerSession] = useState<OwnerSessionState>(() => getOwnerSessionState());
  const [signingIn, setSigningIn] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (isNative) return;
    return subscribeOwnerSession((state) => {
      setOwnerSession(state);
    });
  }, [isNative]);

  if (!isNative && ownerSession.checking) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-6 text-center shadow-xs space-y-3">
          <div className="w-9 h-9 mx-auto border-2 border-[#3138A0] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-bold text-slate-900">Infinity</p>
          <p className="text-xs text-slate-500">Anmeldung wird geprüft…</p>
        </div>
      </div>
    );
  }

  if (!isNative && !ownerSession.authenticated) {
    const displayedError = localError || ownerSession.error;
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-5">
        <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="space-y-1">
            <span className="inline-block px-2.5 py-0.5 rounded-md bg-indigo-50 text-[#3138A0] text-[11px] font-bold">
              Infinity Web
            </span>
            <h1 className="text-xl font-bold text-slate-900">Mit Google anmelden</h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              Bitte mit dem Google-Konto <span className="font-semibold text-slate-800">{OWNER_EMAIL}</span> anmelden, um auf Ihre Geschäftsdaten zuzugreifen.
            </p>
          </div>

          {displayedError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-[#B42318]">
              {displayedError}
            </div>
          )}

          <GoogleSignInButton
            disabled={signingIn}
            label={signingIn ? 'Anmeldung läuft…' : 'Mit Google anmelden'}
            onClick={async () => {
              setSigningIn(true);
              setLocalError(null);
              try {
                await ownerSignIn();
              } catch (err: unknown) {
                setLocalError(
                  err instanceof Error ? err.message : 'Google-Anmeldung fehlgeschlagen.'
                );
              } finally {
                setSigningIn(false);
              }
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <AppProvider ownerAuthenticated={true}>
      <MainRouter />
    </AppProvider>
  );
}
