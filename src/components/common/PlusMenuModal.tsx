import React, { useRef, useState } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import {
  X,
  Briefcase,
  Bookmark,
  Wrench,
  Clock,
  CalendarPlus,
  MessageSquarePlus,
  UserPlus,
  Camera,
  PackagePlus,
  Receipt,
  CreditCard,
  RefreshCw,
  Sparkles,
  Home,
  Pencil,
  Scale
} from 'lucide-react';
import { ScreenId } from '../../types/index.ts';

export const PlusMenuModal: React.FC = () => {
  const {
    isPlusMenuOpen,
    setIsPlusMenuOpen,
    navigate,
    setActiveModal,
    currentScreen,
    selectedCustomerId,
    setSelectedPropertyId,
    setSelectedEquipmentId,
    setSelectedMaterialId,
    customers,
    properties,
    performBackup
  } = useApp();

  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartYRef = useRef<number | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  if (!isPlusMenuOpen) return null;

  const currentCust = customers.find((c) => c.id === selectedCustomerId);
  const currentCustProps = currentCust
    ? properties.filter((p) => p.customer_id === currentCust.id)
    : [];

  const closeSheet = () => {
    setDragOffsetY(0);
    setIsDragging(false);
    dragStartYRef.current = null;
    setIsPlusMenuOpen(false);
  };

  const handleTouchStart = (e: React.TouchEvent, fromScrollableList = false) => {
    if (fromScrollableList && listScrollRef.current && listScrollRef.current.scrollTop > 2) {
      dragStartYRef.current = null;
      return;
    }
    dragStartYRef.current = e.touches[0].clientY;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (dragStartYRef.current === null) return;
    const deltaY = e.touches[0].clientY - dragStartYRef.current;
    if (deltaY > 0) {
      setDragOffsetY(deltaY);
    } else {
      setDragOffsetY(0);
    }
  };

  const handleTouchEnd = () => {
    if (dragStartYRef.current === null) return;
    if (dragOffsetY > 45) {
      closeSheet();
      return;
    }
    setDragOffsetY(0);
    setIsDragging(false);
    dragStartYRef.current = null;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return;
    dragStartYRef.current = e.clientY;
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || dragStartYRef.current === null) return;
    const deltaY = e.clientY - dragStartYRef.current;
    if (deltaY > 0) {
      setDragOffsetY(deltaY);
    } else {
      setDragOffsetY(0);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || dragStartYRef.current === null) return;
    if (dragOffsetY > 45) {
      closeSheet();
      return;
    }
    setDragOffsetY(0);
    setIsDragging(false);
    dragStartYRef.current = null;
  };

  const handleTileClick = (screen: ScreenId) => {
    closeSheet();
    navigate(screen);
  };

  const handleAction = (actionKey: string) => {
    closeSheet();
    switch (actionKey) {
      case 'geraet_anlegen':
        setSelectedEquipmentId(null);
        setActiveModal('GERAET_ANLEGEN');
        break;
      case 'zubehoer_anlegen':
        setSelectedEquipmentId(null);
        setActiveModal('ZUBEHOER_ANLEGEN');
        break;
      case 'wartung_erfassen':
        setActiveModal('WARTUNG_DOKUMENTIEREN');
        break;
      case 'material_anlegen':
        setSelectedMaterialId(null);
        setActiveModal('MATERIAL_ANLEGEN');
        break;
      case 'arbeit_nachtragen':
        setActiveModal('ARBEIT_NACHTRAGEN');
        break;
      case 'termin_anlegen':
        setActiveModal('TERMIN_ANLEGEN');
        break;
      case 'anfrage_anlegen':
        setActiveModal('ANFRAGE_ANLEGEN');
        break;
      case 'kunde_anlegen':
        setActiveModal('KUNDE_ANLEGEN');
        break;
      case 'kunde_bearbeiten':
        setActiveModal('KUNDE_BEARBEITEN');
        break;
      case 'objekt_anlegen':
        setSelectedPropertyId(null);
        setActiveModal('OBJEKT_ANLEGEN');
        break;
      case 'foto_hinzufuegen':
        if (currentCustProps.length > 0) {
          setSelectedPropertyId(currentCustProps[0].id);
          setActiveModal('OBJEKT_BEARBEITEN');
        } else {
          setSelectedPropertyId(null);
          setActiveModal('OBJEKT_ANLEGEN');
        }
        break;
      case 'abrechnung_vorbereiten':
        setActiveModal('RECHNUNG_VORBEREITEN');
        break;
      case 'guv_oeffnen':
        setActiveModal('OPEN_GUV_TAB');
        break;
      case 'zahlung_erfassen':
        setActiveModal('ZAHLUNG_ERFASSEN');
        break;
      case 'sicherung_ausfuehren':
        performBackup();
        break;
    }
  };

  // Get screen-specific context title and subtitle
  const getContextInfo = () => {
    switch (currentScreen) {
      case 'M10_GERAETE':
        return { title: 'Geräteverwaltung', subtitle: 'Aktionen für Maschinen & Werkzeuge' };
      case 'M11_MATERIAL':
        return { title: 'Material', subtitle: 'Aktionen für Material & Preise' };
      case 'M08_ARBEITEN':
        return { title: 'Arbeiten', subtitle: 'Aktionen für Arbeitsaufzeichnungen' };
      case 'M09_LCR':
        return { title: 'L.C.R. Kennzeichnung', subtitle: 'Aktionen für L.C.R.-Arbeiten' };
      case 'M05_ANFRAGEN':
        return { title: 'Anfragen', subtitle: 'Aktionen für Kundenanfragen' };
      case 'M06_ANGEBOTE':
        return { title: 'Angebote', subtitle: 'Aktionen für Angebote' };
      case 'M07_AUFTRAEGE':
        return { title: 'Aufträge', subtitle: 'Aktionen für Aufträge' };
      case 'M03_KUNDEN':
        return currentCust
          ? { title: 'Kundenakte', subtitle: currentCust.name }
          : { title: 'Kunden', subtitle: 'Kundenverwaltung & Stammdaten' };
      case 'M04_ABRECHNUNG':
        return { title: 'Abrechnung & G&V', subtitle: 'Rechnungen, Zahlungen & Pauschalierung' };
      case 'M02_PLANUNG':
        return { title: 'Planung', subtitle: 'Termine & Einsätze' };
      case 'M12_SICHERUNG':
        return { title: 'Sicherung', subtitle: 'Datenbestand & Backup' };
      default:
        return { title: 'Schnellzugriff', subtitle: 'Direktkacheln & Aktionen' };
    }
  };

  // Screen-specific contextual actions (Timer & Arbeit starten removed)
  const getActions = () => {
    if (currentScreen === 'M10_GERAETE') {
      return [
        { key: 'geraet_anlegen', label: 'Neues Gerät hinzufügen', icon: Wrench, isPrimary: true },
        { key: 'zubehoer_anlegen', label: 'Neues Zubehör hinzufügen', icon: PackagePlus },
        { key: 'wartung_erfassen', label: 'Wartung dokumentieren', icon: Clock },
        { key: 'material_anlegen', label: 'Material anlegen', icon: PackagePlus },
      ];
    }

    if (currentScreen === 'M11_MATERIAL') {
      return [
        { key: 'material_anlegen', label: 'Neues Material anlegen', icon: PackagePlus, isPrimary: true },
        { key: 'arbeit_nachtragen', label: 'Arbeit nachtragen', icon: Clock },
        { key: 'geraet_anlegen', label: 'Gerät anlegen', icon: Wrench },
      ];
    }

    if (currentScreen === 'M08_ARBEITEN') {
      return [
        { key: 'arbeit_nachtragen', label: 'Arbeit nachtragen', icon: Clock, isPrimary: true },
        { key: 'termin_anlegen', label: 'Termin anlegen', icon: CalendarPlus },
        { key: 'material_anlegen', label: 'Material anlegen', icon: PackagePlus },
      ];
    }

    if (currentScreen === 'M09_LCR') {
      return [
        { key: 'arbeit_nachtragen', label: 'L.C.R.-Arbeit nachtragen', icon: Bookmark, isPrimary: true },
        { key: 'termin_anlegen', label: 'Termin anlegen', icon: CalendarPlus },
      ];
    }

    if (currentScreen === 'M05_ANFRAGEN') {
      return [
        { key: 'anfrage_anlegen', label: 'Neue Anfrage erfassen', icon: MessageSquarePlus, isPrimary: true },
        { key: 'kunde_anlegen', label: 'Neuen Kunden anlegen', icon: UserPlus },
        { key: 'termin_anlegen', label: 'Termin anlegen', icon: CalendarPlus },
      ];
    }

    if (currentScreen === 'M06_ANGEBOTE') {
      return [
        { key: 'anfrage_anlegen', label: 'Neue Anfrage anlegen', icon: MessageSquarePlus, isPrimary: true },
        { key: 'kunde_anlegen', label: 'Kunde anlegen', icon: UserPlus },
        { key: 'termin_anlegen', label: 'Termin anlegen', icon: CalendarPlus },
      ];
    }

    if (currentScreen === 'M07_AUFTRAEGE') {
      return [
        { key: 'arbeit_nachtragen', label: 'Arbeit für Auftrag erfassen', icon: Clock, isPrimary: true },
        { key: 'termin_anlegen', label: 'Termin für Auftrag planen', icon: CalendarPlus },
      ];
    }

    if (currentScreen === 'M03_KUNDEN') {
      if (currentCust) {
        const noPropsYet = currentCustProps.length === 0;
        return [
          {
            key: 'objekt_anlegen',
            label: `Neues Objekt zu ${currentCust.name} hinzufügen`,
            icon: Home,
            isPrimary: noPropsYet
          },
          {
            key: 'arbeit_nachtragen',
            label: `Arbeit für ${currentCust.name} erfassen`,
            icon: Clock,
            isPrimary: !noPropsYet
          },
          {
            key: 'foto_hinzufuegen',
            label:
              currentCustProps.length > 0
                ? `Objektinfos / Fotos ergänzen`
                : `Objekt mit Fotos & Infos anlegen`,
            icon: Camera
          },
          {
            key: 'termin_anlegen',
            label: `Termin für ${currentCust.name} anlegen`,
            icon: CalendarPlus
          },
          {
            key: 'kunde_bearbeiten',
            label: `Stammdaten von ${currentCust.name} bearbeiten`,
            icon: Pencil
          },
          { key: 'kunde_anlegen', label: 'Neuen Kunden anlegen', icon: UserPlus }
        ];
      }
      return [
        { key: 'kunde_anlegen', label: 'Neuen Kunden anlegen', icon: UserPlus, isPrimary: true },
        { key: 'anfrage_anlegen', label: 'Anfrage anlegen', icon: MessageSquarePlus },
        { key: 'termin_anlegen', label: 'Termin anlegen', icon: CalendarPlus },
        { key: 'arbeit_nachtragen', label: 'Arbeit nachtragen', icon: Clock },
      ];
    }

    if (currentScreen === 'M04_ABRECHNUNG') {
      return [
        { key: 'abrechnung_vorbereiten', label: 'Abrechnung vorbereiten', icon: Receipt, isPrimary: true },
        { key: 'guv_oeffnen', label: 'Gewinn & Verlust / Pauschalierung', icon: Scale },
        { key: 'zahlung_erfassen', label: 'Zahlung erfassen', icon: CreditCard },
        { key: 'arbeit_nachtragen', label: 'Arbeit nachtragen', icon: Clock },
        { key: 'termin_anlegen', label: 'Termin anlegen', icon: CalendarPlus },
      ];
    }

    if (currentScreen === 'M02_PLANUNG') {
      return [
        { key: 'termin_anlegen', label: 'Termin planen', icon: CalendarPlus, isPrimary: true },
        { key: 'arbeit_nachtragen', label: 'Arbeit nachtragen', icon: Clock },
        { key: 'anfrage_anlegen', label: 'Anfrage anlegen', icon: MessageSquarePlus },
        { key: 'kunde_anlegen', label: 'Kunde anlegen', icon: UserPlus },
      ];
    }

    if (currentScreen === 'M12_SICHERUNG') {
      return [
        { key: 'sicherung_ausfuehren', label: 'Sicherung jetzt ergänzen', icon: RefreshCw, isPrimary: true },
        { key: 'material_anlegen', label: 'Material anlegen', icon: PackagePlus },
        { key: 'geraet_anlegen', label: 'Gerät anlegen', icon: Wrench },
      ];
    }

    // Default (M01_HEUTE etc.)
    return [
      { key: 'arbeit_nachtragen', label: 'Arbeit nachtragen', icon: Clock, isPrimary: true },
      { key: 'termin_anlegen', label: 'Termin anlegen', icon: CalendarPlus },
      { key: 'kunde_anlegen', label: 'Kunde anlegen', icon: UserPlus },
      { key: 'anfrage_anlegen', label: 'Anfrage anlegen', icon: MessageSquarePlus },
      { key: 'material_anlegen', label: 'Material anlegen', icon: PackagePlus },
      { key: 'geraet_anlegen', label: 'Gerät anlegen', icon: Wrench },
    ];
  };

  const contextInfo = getContextInfo();
  const actions = getActions();

  return (
    <div className="absolute inset-0 z-50 bg-black/45 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
      {/* Background touch dismiss */}
      <div className="flex-1" onClick={closeSheet} />

      {/* Sheet Content (~25% niedrigere Höhe + Nach-unten-ziehen zum Schließen) */}
      <div
        data-custom-swipe="true"
        style={{
          transform: dragOffsetY > 0 ? `translateY(${dragOffsetY}px)` : undefined,
          transition: isDragging ? 'none' : 'transform 180ms ease-out'
        }}
        className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl px-4 pt-2 pb-3.5 max-h-[64%] flex flex-col animate-slide-up"
      >
        {/* Zieh-Bereich oben (Handle + Header + Direktkacheln) */}
        <div
          onTouchStart={(e) => handleTouchStart(e, false)}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="shrink-0 touch-pan-x select-none cursor-grab active:cursor-grabbing"
        >
          <div className="py-1 flex justify-center">
            <div className="w-11 h-1.5 bg-slate-300 rounded-full" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-950 leading-tight">
                {contextInfo.title}
              </h2>
              <p className="text-[11px] text-slate-600">{contextInfo.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={closeSheet}
              className="w-9 h-9 flex items-center justify-center text-slate-600 hover:text-slate-900 rounded-full hover:bg-slate-100 active:scale-95 transition-all"
              aria-label="Schließen"
            >
              <X size={20} />
            </button>
          </div>

          {/* 3 Direktkacheln (kompakt) */}
          <div className="pt-2 pb-2.5 border-b border-slate-100">
            <span className="text-[11px] font-semibold text-slate-500 tracking-wide block mb-1.5">
              Direkt öffnen
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleTileClick('M08_ARBEITEN')}
                className={`p-2 rounded-2xl flex flex-col items-center text-center transition-all active:scale-97 group border ${
                  currentScreen === 'M08_ARBEITEN'
                    ? 'bg-indigo-50/90 border-[#3138A0]/50'
                    : 'bg-slate-50 hover:bg-indigo-50/50 border-slate-200'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-white shadow-2xs border border-slate-200 flex items-center justify-center text-[#3138A0] mb-1">
                  <Briefcase size={16} />
                </div>
                <span className="text-xs font-bold text-slate-900 leading-tight">Arbeiten</span>
                <span className="text-[10px] text-slate-500">Aufzeichnung</span>
              </button>

              <button
                type="button"
                onClick={() => handleTileClick('M09_LCR')}
                className={`p-2 rounded-2xl flex flex-col items-center text-center transition-all active:scale-97 group border ${
                  currentScreen === 'M09_LCR'
                    ? 'bg-indigo-50/90 border-[#3138A0]/50'
                    : 'bg-slate-50 hover:bg-indigo-50/50 border-slate-200'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-white shadow-2xs border border-slate-200 flex items-center justify-center text-[#3138A0] mb-1">
                  <Bookmark size={16} />
                </div>
                <span className="text-xs font-bold text-slate-900 leading-tight">L.C.R.</span>
                <span className="text-[10px] text-slate-500">Kennzeichnung</span>
              </button>

              <button
                type="button"
                onClick={() => handleTileClick('M10_GERAETE')}
                className={`p-2 rounded-2xl flex flex-col items-center text-center transition-all active:scale-97 group border ${
                  currentScreen === 'M10_GERAETE'
                    ? 'bg-indigo-50/90 border-[#3138A0]/50'
                    : 'bg-slate-50 hover:bg-indigo-50/50 border-slate-200'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-white shadow-2xs border border-slate-200 flex items-center justify-center text-[#3138A0] mb-1">
                  <Wrench size={16} />
                </div>
                <span className="text-xs font-bold text-slate-900 leading-tight">Geräte</span>
                <span className="text-[10px] text-slate-500">Wartung</span>
              </button>
            </div>
          </div>
        </div>

        {/* Schnellaktionen Liste - Contextual */}
        <div
          ref={listScrollRef}
          onTouchStart={(e) => handleTouchStart(e, true)}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="flex-1 min-h-0 overflow-y-auto pt-2 pb-1.5 overscroll-contain"
        >
          <div className="flex items-center justify-between mb-1.5 px-1">
            <span className="text-[11px] font-semibold text-slate-500 tracking-wide block">
              Passende Aktionen
            </span>
            <span className="text-[11px] text-[#3138A0] font-semibold flex items-center gap-1">
              <Sparkles size={12} />
              <span>Kontextbezogen</span>
            </span>
          </div>

          <div className="space-y-1.5">
            {actions.map((act) => {
              const Icon = act.icon;
              return (
                <button
                  key={act.key}
                  type="button"
                  onClick={() => handleAction(act.key)}
                  className={`w-full min-h-[42px] py-1.5 px-3 flex items-center justify-between text-left rounded-2xl transition-all active:scale-99 ${
                    act.isPrimary
                      ? 'bg-indigo-50/80 border border-indigo-200 text-slate-950 shadow-2xs hover:bg-indigo-100/70'
                      : 'hover:bg-slate-50 active:bg-slate-100 border border-slate-100 text-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        act.isPrimary
                          ? 'bg-[#3138A0] text-white shadow-2xs'
                          : 'bg-slate-100 text-[#3138A0]'
                      }`}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0">
                      <span
                        className={`text-xs block leading-snug ${
                          act.isPrimary ? 'font-bold text-[#3138A0]' : 'font-semibold text-slate-900'
                        }`}
                      >
                        {act.label}
                      </span>
                    </div>
                  </div>

                  {act.isPrimary && (
                    <span className="text-[11px] font-bold text-[#3138A0] bg-white px-2 py-0.5 rounded-full border border-indigo-100 shrink-0">
                      Empfohlen
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer info note */}
        <div className="pt-1.5 border-t border-slate-100 text-center shrink-0">
          <p className="text-[11px] text-slate-400">
            Nach unten ziehen zum Schließen · Öffnen allein speichert nichts
          </p>
        </div>
      </div>
    </div>
  );
};
