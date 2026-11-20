import React from 'react';
import { AppProvider, useApp } from './context/AppContext.tsx';
import { PixelFrame } from './components/common/PixelFrame.tsx';
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
import { UndoToast } from './components/common/UndoToast.tsx';

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
      case 'M14_KLEINTEILE':
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
      <UndoToast />
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
  return (
    <AppProvider ownerAuthenticated={true}>
      <MainRouter />
    </AppProvider>
  );
}

