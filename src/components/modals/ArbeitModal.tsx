import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext.tsx';
import {
  X,
  Clock,
  User,
  Briefcase,
  Bookmark,
  Trash2,
  Lock,
  AlertTriangle,
  Coffee,
  Calendar,
  Keyboard,
  ChevronDown,
  Euro,
  Package,
  Plus,
  Minus,
  Home,
  Check,
  CheckSquare
} from 'lucide-react';
import { UsedMaterial } from '../../types/index.ts';
import { getCustomerBillingRecipient } from '../../utils/invoicePdf.ts';

const ACTIVITY_GROUPS = [
  {
    group: 'Garten & Grünanlage',
    items: [
      'Rasenpflege / Mähen',
      'Heckenschnitt',
      'Strauch- & Baumschnitt',
      'Beetpflege & Unkraut',
      'Laubarbeiten',
      'Bepflanzung & Ansaat',
      'Bewässerung / Gartenarbeit',
      'Grünschnitt-Entsorgung'
    ]
  },
  {
    group: 'Haus & Außenbereich',
    items: [
      'Hausmeisterservice',
      'Hof- & Wegereinigung',
      'Treppenhausreinigung',
      'Dachrinnenreinigung',
      'Kleinreparatur / Montage',
      'Objektkontrolle',
      'Winterdienst (Räumen / Streuen)'
    ]
  }
];

const ALL_PRESET_ACTIVITIES = ACTIVITY_GROUPS.flatMap((g) => g.items);

const MATERIAL_UNITS = ['Sack', 'Stück', 'kg', 'l', 'm²', 'm³', 'm', 'Pauschale'];

const PRESET_MATERIAL_GROUPS = [
  {
    group: 'Garten & Pflege (Vorlagen)',
    items: [
      { id: 'tpl-mulch', name: 'Rindenmulch', unit: 'Sack' },
      { id: 'tpl-erde', name: 'Pflanzerde / Humus', unit: 'Sack' },
      { id: 'tpl-samen', name: 'Rasensamen', unit: 'kg' },
      { id: 'tpl-duenger', name: 'Rasendünger', unit: 'kg' },
      { id: 'tpl-naturduenger', name: 'Naturdünger / Hornspäne', unit: 'kg' },
      { id: 'tpl-vlies', name: 'Unkrautvlies', unit: 'm²' },
      { id: 'tpl-kies', name: 'Kies / Splitt', unit: 'Sack' },
      { id: 'tpl-gruenschnitt', name: 'Grünschnitt-Entsorgung', unit: 'm³' }
    ]
  },
  {
    group: 'Haus & Winterdienst (Vorlagen)',
    items: [
      { id: 'tpl-salz', name: 'Streusalz / Auftausalz', unit: 'Sack' },
      { id: 'tpl-streusplitt', name: 'Streusplitt', unit: 'Sack' },
      { id: 'tpl-reiniger', name: 'Reinigungsmittel', unit: 'l' },
      { id: 'tpl-leuchtmittel', name: 'Leuchtmittel', unit: 'Stück' },
      { id: 'tpl-kleinmat', name: 'Klein- & Befestigungsmaterial', unit: 'Pauschale' },
      { id: 'tpl-entsorgung', name: 'Entsorgungspauschale', unit: 'Pauschale' }
    ]
  }
];

interface DraftMaterialItem {
  uid: string;
  material_id: string;
  name: string;
  quantityStr: string;
  unit: string;
  priceStr: string; // leer = Preis offen (null)
}

interface WheelOption<T> {
  value: T;
  label: string;
  sublabel?: string;
}

// Pause: 0 bis 4 Std. (240 Min.) in 15-Minuten-Schritten
const PAUSE_WHEEL_OPTIONS: WheelOption<number>[] = Array.from({ length: 17 }, (_, i) => {
  const mins = i * 15;
  if (mins === 0) return { value: 0, label: 'Keine', sublabel: '0 Min' };
  if (mins < 60) return { value: mins, label: `${mins} Min` };
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return {
    value: mins,
    label: m === 0 ? `${h} Std` : `${h}:${String(m).padStart(2, '0')} h`,
    sublabel: `${mins} Min`
  };
});

// Stundensatz: Kein Standard! Startet bei null ("Kein Satz"), dann 0 € und 20 € bis 120 €
const PRESET_RATE_NUMBERS = [
  0, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120
];

const RATE_WHEEL_OPTIONS: WheelOption<number | null>[] = [
  { value: null, label: 'Offen', sublabel: 'Kein Satz' },
  ...PRESET_RATE_NUMBERS.map((rate) =>
    rate === 0
      ? { value: 0, label: '0 €', sublabel: 'Kulanz' }
      : { value: rate, label: `${rate} €`, sublabel: 'pro Std.' }
  )
];

const WHEEL_ITEM_WIDTH = 72;

interface HorizontalWheelPickerProps<T> {
  options: WheelOption<T>[];
  value: T;
  onChange: (val: T) => void;
  syncKey: string;
  ariaLabel: string;
}

function HorizontalWheelPicker<T>({
  options,
  value,
  onChange,
  syncKey,
  ariaLabel
}: HorizontalWheelPickerProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartScrollRef = useRef(0);
  const didDragRef = useRef(false);
  const [isMouseDragging, setIsMouseDragging] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = options.findIndex((o) => o.value === value);
    const targetIdx = idx >= 0 ? idx : 0;
    isSyncingRef.current = true;
    el.scrollLeft = targetIdx * WHEEL_ITEM_WIDTH;
    const raf = requestAnimationFrame(() => {
      isSyncingRef.current = false;
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || isSyncingRef.current) return;
    const idx = Math.max(
      0,
      Math.min(options.length - 1, Math.round(el.scrollLeft / WHEEL_ITEM_WIDTH))
    );
    const picked = options[idx];
    if (picked !== undefined && picked.value !== value) {
      onChange(picked.value);
    }
  };

  const scrollToIndex = (idx: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(options.length - 1, idx));
    el.scrollTo({ left: clamped * WHEEL_ITEM_WIDTH, behavior: 'smooth' });
    onChange(options[clamped].value);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const el = scrollRef.current;
    if (!el) return;
    setIsMouseDragging(true);
    didDragRef.current = false;
    dragStartXRef.current = e.clientX;
    dragStartScrollRef.current = el.scrollLeft;
    el.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMouseDragging || e.pointerType !== 'mouse') return;
    const el = scrollRef.current;
    if (!el) return;
    const dx = e.clientX - dragStartXRef.current;
    if (Math.abs(dx) > 4) didDragRef.current = true;
    el.scrollLeft = dragStartScrollRef.current - dx;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isMouseDragging || e.pointerType !== 'mouse') return;
    const el = scrollRef.current;
    setIsMouseDragging(false);
    if (!el) return;
    if (el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    const nearestIdx = Math.max(
      0,
      Math.min(options.length - 1, Math.round(el.scrollLeft / WHEEL_ITEM_WIDTH))
    );
    el.scrollTo({ left: nearestIdx * WHEEL_ITEM_WIDTH, behavior: 'smooth' });
    onChange(options[nearestIdx].value);
  };

  return (
    <div
      role="listbox"
      aria-label={ariaLabel}
      className="relative h-14 bg-white border border-slate-200 rounded-2xl overflow-hidden select-none flex items-center shadow-2xs"
    >
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-white via-white/85 to-transparent z-10" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white via-white/85 to-transparent z-10" />

      <div className="pointer-events-none absolute left-1/2 top-1 bottom-1 -translate-x-1/2 w-[72px] rounded-xl bg-indigo-50/60 border-2 border-[#3138A0] z-10 flex flex-col justify-between items-center py-0.5">
        <span className="w-2 h-0.5 rounded-full bg-[#3138A0]" />
        <span className="w-2 h-0.5 rounded-full bg-[#3138A0]" />
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`w-full h-full overflow-x-auto no-scrollbar flex items-center px-[calc(50%-36px)] touch-pan-x cursor-grab active:cursor-grabbing ${
          isMouseDragging ? 'snap-none' : 'snap-x snap-mandatory'
        }`}
      >
        {options.map((opt, idx) => {
          const isSelected = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => {
                if (!didDragRef.current) {
                  scrollToIndex(idx);
                }
              }}
              className={`w-[72px] shrink-0 h-full snap-center flex flex-col items-center justify-center transition-all duration-150 z-20 ${
                isSelected
                  ? 'text-[#3138A0] scale-105 font-bold'
                  : 'text-slate-400 scale-90 font-medium hover:text-slate-600'
              }`}
            >
              <span className="text-xs leading-tight whitespace-nowrap">{opt.label}</span>
              {opt.sublabel ? (
                <span
                  className={`text-[9px] leading-none mt-0.5 whitespace-nowrap ${
                    isSelected ? 'text-[#3138A0]/80 font-semibold' : 'text-slate-400/70'
                  }`}
                >
                  {opt.sublabel}
                </span>
              ) : (
                <span
                  className={`w-px h-1.5 mt-1 rounded-full ${
                    isSelected ? 'bg-transparent' : 'bg-slate-200'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr || !timeStr.includes(':')) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

function minutesToTimeString(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDurationText(netMinutes: number): string {
  if (netMinutes <= 0) return '0 Min.';
  const h = Math.floor(netMinutes / 60);
  const m = netMinutes % 60;
  if (h === 0) return `${m} Min.`;
  if (m === 0) return `${h} Std.`;
  return `${h} Std. ${m} Min.`;
}

function parseGermanDecimalOrNull(val: string): number | null {
  const trimmed = val.trim().replace(/\s+/g, '');
  if (!trimmed) return null;
  let normalized = '';
  if (trimmed.includes(',')) {
    normalized = trimmed.replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(trimmed) || (trimmed.match(/\./g) || []).length > 1) {
    normalized = trimmed.replace(/\./g, '').replace(/[^0-9]/g, '');
  } else {
    normalized = trimmed.replace(/[^0-9.]/g, '');
  }
  if (!normalized) return null;
  const parsed = parseFloat(normalized);
  return Number.isNaN(parsed) ? null : Math.max(0, parsed);
}

function parsePositiveQuantity(val: string): number {
  const parsed = parseGermanDecimalOrNull(val);
  return parsed !== null && parsed > 0 ? parsed : 0;
}

export const ArbeitModal: React.FC = () => {
  const {
    activeModal,
    setActiveModal,
    addWorkRecord,
    updateWorkRecord,
    deleteWorkRecord,
    workRecords,
    customers,
    properties,
    orders,
    materials,
    selectedCustomerId,
    selectedPropertyId,
    selectedWorkRecordId,
    prefilledWorkTitle,
    setPrefilledWorkTitle
  } = useApp();

  const isEditing = activeModal === 'ARBEIT_BEARBEITEN';
  const isAddingManual = activeModal === 'ARBEIT_NACHTRAGEN';

  const [title, setTitle] = useState('');
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [activityPickerOpen, setActivityPickerOpen] = useState(false);
  const [isCustomTitle, setIsCustomTitle] = useState(false);

  const getTodayLocalIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  };

  const [customerId, setCustomerId] = useState('');
  const [propertyId, setPropertyId] = useState<string>('');
  const [workDate, setWorkDate] = useState(getTodayLocalIso);
  const [startTime, setStartTime] = useState('07:00');
  const [endTime, setEndTime] = useState('17:00');
  const [breakMinutes, setBreakMinutes] = useState<number>(60);

  const [selectedRate, setSelectedRate] = useState<number | null>(50);
  const [isCustomRate, setIsCustomRate] = useState(false);
  const [customRateStr, setCustomRateStr] = useState('50');
  const [openSeq, setOpenSeq] = useState(0);

  const [isLcr, setIsLcr] = useState(false);
  const [hasMaterial, setHasMaterial] = useState(false);
  const [draftMaterials, setDraftMaterials] = useState<DraftMaterialItem[]>([]);
  const [notes, setNotes] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const rateInputRef = useRef<HTMLInputElement>(null);

  const existingRecord = isEditing
    ? workRecords.find((w) => w.id === selectedWorkRecordId)
    : null;

  const isBilled = !!existingRecord?.settlement_id;

  useEffect(() => {
    setConfirmDelete(false);
    setActivityPickerOpen(false);
    if (isEditing && existingRecord) {
      const recTitle = existingRecord.title || '';
      const parts = recTitle
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const allPartsMatchPresets =
        parts.length > 0 && parts.every((p) => ALL_PRESET_ACTIVITIES.includes(p));
      setTitle(recTitle);
      setSelectedActivities(
        allPartsMatchPresets
          ? parts
          : ALL_PRESET_ACTIVITIES.filter((act) => parts.includes(act))
      );
      setIsCustomTitle(!allPartsMatchPresets && recTitle !== '');

      setCustomerId(existingRecord.customer_id);
      setPropertyId(existingRecord.property_id || '');
      setWorkDate(existingRecord.work_date);

      const savedStart = existingRecord.start_time || '07:00';
      const savedEnd = existingRecord.end_time || '17:00';
      const rawBreak = existingRecord.break_minutes ?? 0;
      const snappedBreak = Math.min(240, Math.max(0, Math.round(rawBreak / 15) * 15));

      const diffHours =
        (parseTimeToMinutes(savedEnd) - parseTimeToMinutes(savedStart) - snappedBreak) / 60;

      setStartTime(savedStart);
      setBreakMinutes(snappedBreak);

      if (Math.abs(diffHours - existingRecord.hours) > 0.02 && existingRecord.hours > 0) {
        const derivedEnd =
          parseTimeToMinutes(savedStart) + Math.round(existingRecord.hours * 60) + snappedBreak;
        setEndTime(minutesToTimeString(derivedEnd));
      } else {
        setEndTime(savedEnd);
      }

      const recRate = existingRecord.hourly_rate ?? null;
      if (recRate === null || PRESET_RATE_NUMBERS.includes(recRate)) {
        setSelectedRate(recRate);
        setIsCustomRate(false);
        setCustomRateStr(recRate !== null ? String(recRate).replace('.', ',') : '');
      } else {
        setSelectedRate(null);
        setIsCustomRate(true);
        setCustomRateStr(String(recRate).replace('.', ','));
      }

      setIsLcr(existingRecord.is_lcr);
      setNotes(existingRecord.notes || '');

      const existingMats = existingRecord.materials || [];
      setHasMaterial(existingMats.length > 0);
      setDraftMaterials(
        existingMats.map((um, idx) => ({
          uid: `dm-${idx}-${Date.now()}`,
          material_id: um.material_id,
          name: um.name,
          quantityStr: String(um.quantity).replace('.', ','),
          unit: um.unit || 'Stück',
          priceStr: um.price_per_unit !== null ? String(um.price_per_unit).replace('.', ',') : ''
        }))
      );
      setOpenSeq((s) => s + 1);
    } else if (isAddingManual) {
      if (prefilledWorkTitle) {
        setTitle(prefilledWorkTitle);
        setSelectedActivities([]);
        setIsCustomTitle(true);
        setPrefilledWorkTitle(null);
      } else {
        setTitle(ALL_PRESET_ACTIVITIES[0]);
        setSelectedActivities([ALL_PRESET_ACTIVITIES[0]]);
        setIsCustomTitle(false);
      }
      const initCustId = selectedCustomerId || (customers[0]?.id ?? '');
      setCustomerId(initCustId);
      const custProps = properties.filter((p) => p.customer_id === initCustId);
      const preferredProp =
        custProps.find((p) => p.id === selectedPropertyId) || custProps[0];
      setPropertyId(preferredProp?.id || '');
      setWorkDate(getTodayLocalIso());
      setStartTime('07:00');
      setEndTime('17:00');
      setBreakMinutes(60);
      setSelectedRate(50);
      setIsCustomRate(false);
      setCustomRateStr('50');
      setIsLcr(false);
      setHasMaterial(false);
      setDraftMaterials([]);
      setNotes('');
      setOpenSeq((s) => s + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModal, selectedWorkRecordId]);

  if (!isEditing && !isAddingManual) return null;

  const toggleActivityItem = (act: string) => {
    setSelectedActivities((prev) => {
      const exists = prev.includes(act);
      const next = exists ? prev.filter((item) => item !== act) : [...prev, act];
      setTitle(next.join(', '));
      return next;
    });
  };

  const toggleOrderInTitle = (orderTitle: string) => {
    const clean = orderTitle.trim();
    if (!clean) return;
    const currentParts = title
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const exists = currentParts.includes(clean);
    const nextParts = exists
      ? currentParts.filter((p) => p !== clean)
      : [...currentParts, clean];
    const nextTitle = nextParts.join(', ');
    setTitle(nextTitle);
    const allMatch =
      nextParts.length > 0 && nextParts.every((p) => ALL_PRESET_ACTIVITIES.includes(p));
    setSelectedActivities(nextParts.filter((p) => ALL_PRESET_ACTIVITIES.includes(p)));
    setIsCustomTitle(!allMatch && nextParts.length > 0);
  };

  const switchToManualTitle = (clearField: boolean) => {
    if (clearField) {
      setTitle('');
      setSelectedActivities([]);
    }
    setActivityPickerOpen(false);
    setIsCustomTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 30);
  };

  const switchToPresetTitle = () => {
    if (selectedActivities.length > 0) {
      setTitle(selectedActivities.join(', '));
    } else {
      setSelectedActivities([ALL_PRESET_ACTIVITIES[0]]);
      setTitle(ALL_PRESET_ACTIVITIES[0]);
    }
    setIsCustomTitle(false);
    setActivityPickerOpen(true);
  };

  const switchToManualRate = () => {
    setCustomRateStr(selectedRate !== null ? String(selectedRate).replace('.', ',') : '');
    setIsCustomRate(true);
    setTimeout(() => rateInputRef.current?.focus(), 30);
  };

  const switchToWheelRate = () => {
    const parsed = parseGermanDecimalOrNull(customRateStr);
    if (parsed === null) {
      setSelectedRate(null);
    } else {
      const rounded = Math.round(parsed);
      setSelectedRate(PRESET_RATE_NUMBERS.includes(rounded) ? rounded : null);
    }
    setIsCustomRate(false);
  };

  const handleStartTimeChange = (newStart: string) => {
    const prevSpan = parseTimeToMinutes(endTime) - parseTimeToMinutes(startTime);
    const keepSpan = prevSpan > 0 ? prevSpan : 60;
    setStartTime(newStart);

    const newStartMin = parseTimeToMinutes(newStart);
    const currentEndMin = parseTimeToMinutes(endTime);
    if (newStartMin >= currentEndMin) {
      setEndTime(minutesToTimeString(newStartMin + keepSpan));
    }
  };

  // Material handlers
  const handleSelectMaterialOption = (optionValue: string) => {
    if (!optionValue) return;

    if (optionValue === '__custom__') {
      setDraftMaterials((prev) => [
        ...prev,
        {
          uid: `dm-${Date.now()}-${Math.random()}`,
          material_id: `custom-${Date.now()}`,
          name: '',
          quantityStr: '1',
          unit: 'Stück',
          priceStr: ''
        }
      ]);
      return;
    }

    if (optionValue.startsWith('saved:')) {
      const matId = optionValue.slice(6);
      const savedMat = materials.find((m) => m.id === matId);
      if (!savedMat) return;
      setDraftMaterials((prev) => [
        ...prev,
        {
          uid: `dm-${Date.now()}-${Math.random()}`,
          material_id: savedMat.id,
          name: savedMat.name,
          quantityStr: '1',
          unit: savedMat.unit || 'Stück',
          priceStr:
            savedMat.price_per_unit !== null ? String(savedMat.price_per_unit).replace('.', ',') : ''
        }
      ]);
      return;
    }

    if (optionValue.startsWith('preset:')) {
      const tplId = optionValue.slice(7);
      const allPresets = PRESET_MATERIAL_GROUPS.flatMap((g) => g.items);
      const tpl = allPresets.find((p) => p.id === tplId);
      if (!tpl) return;
      setDraftMaterials((prev) => [
        ...prev,
        {
          uid: `dm-${Date.now()}-${Math.random()}`,
          material_id: tpl.id,
          name: tpl.name,
          quantityStr: '1',
          unit: tpl.unit,
          priceStr: ''
        }
      ]);
    }
  };

  const updateDraftMaterial = (uid: string, patch: Partial<DraftMaterialItem>) => {
    setDraftMaterials((prev) => prev.map((item) => (item.uid === uid ? { ...item, ...patch } : item)));
  };

  const stepMaterialQuantity = (uid: string, delta: number) => {
    setDraftMaterials((prev) =>
      prev.map((item) => {
        if (item.uid !== uid) return item;
        const current = parsePositiveQuantity(item.quantityStr);
        const next = Math.max(0.25, Math.round((current + delta) * 100) / 100);
        return { ...item, quantityStr: String(next).replace('.', ',') };
      })
    );
  };

  const removeDraftMaterial = (uid: string) => {
    setDraftMaterials((prev) => prev.filter((item) => item.uid !== uid));
  };

  // Berechnungen
  const computedMaterials: UsedMaterial[] = hasMaterial
    ? draftMaterials
        .filter((dm) => dm.name.trim().length > 0 && parsePositiveQuantity(dm.quantityStr) > 0)
        .map((dm) => {
          const qty = parsePositiveQuantity(dm.quantityStr);
          const unitPrice = parseGermanDecimalOrNull(dm.priceStr);
          const total =
            unitPrice !== null ? Math.round(qty * unitPrice * 100) / 100 : null;
          return {
            material_id: dm.material_id,
            name: dm.name.trim(),
            quantity: qty,
            unit: dm.unit,
            price_per_unit: unitPrice,
            total
          };
        })
    : [];

  const hasPricedMaterial = computedMaterials.some((m) => m.total !== null);
  const materialTotalSum: number | null = hasPricedMaterial
    ? Math.round(computedMaterials.reduce((s, m) => s + (m.total || 0), 0) * 100) / 100
    : null;

  const effectiveRate: number | null = isCustomRate
    ? parseGermanDecimalOrNull(customRateStr)
    : selectedRate;

  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  const grossMinutes = endMin - startMin;
  const netMinutes = grossMinutes - breakMinutes;
  const isValidDuration = grossMinutes > 0 && netMinutes > 0;
  const calcHours = isValidDuration ? Math.round((netMinutes / 60) * 100) / 100 : 0;
  const laborTotal: number | null =
    effectiveRate !== null ? Math.round(calcHours * effectiveRate * 100) / 100 : null;
  const calcTotal: number | null =
    laborTotal !== null
      ? Math.round((laborTotal + (materialTotalSum || 0)) * 100) / 100
      : null;

  // Vorhandene Aufzeichnungen am selben Tag & Kollisionsprüfung
  const sameDayRecords = workRecords
    .filter((w) => w.work_date === workDate && (!isEditing || w.id !== selectedWorkRecordId))
    .sort((a, b) => parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time));

  const collidingRecords =
    grossMinutes > 0
      ? sameDayRecords.filter((r) => {
          const rStart = parseTimeToMinutes(r.start_time);
          const rEnd = parseTimeToMinutes(r.end_time);
          return startMin < rEnd && endMin > rStart;
        })
      : [];

  const hasCollision = collidingRecords.length > 0;
  const collidingIds = new Set(collidingRecords.map((r) => r.id));

  // Nächstes freies Zeitfenster am selben Tag für 1-Tap-Auflösung berechnen
  const desiredSpanMin = grossMinutes > 0 ? grossMinutes : 120;
  const suggestedFreeSlot = (() => {
    if (!hasCollision) return null;
    const candidates = sameDayRecords
      .map((r) => parseTimeToMinutes(r.end_time))
      .filter((m) => m >= 6 * 60 && m + desiredSpanMin <= 23 * 60 + 55)
      .sort((a, b) => a - b);

    for (const candStart of candidates) {
      const candEnd = candStart + desiredSpanMin;
      const overlapsAny = sameDayRecords.some((r) => {
        const rStart = parseTimeToMinutes(r.start_time);
        const rEnd = parseTimeToMinutes(r.end_time);
        return candStart < rEnd && candEnd > rStart;
      });
      if (!overlapsAny) {
        return {
          start: minutesToTimeString(candStart),
          end: minutesToTimeString(candEnd)
        };
      }
    }
    return null;
  })();

  const formattedWorkDate = workDate.includes('-')
    ? workDate.split('-').reverse().join('.')
    : workDate;

  const activeCustomerObj = customers.find((c) => c.id === (customerId || customers[0]?.id));
  const activeDivergentRecipient = getCustomerBillingRecipient(activeCustomerObj, customers);

  const handleSave = () => {
    if (!isValidDuration || !title.trim() || hasCollision) return;
    const targetCustId = customerId || (customers[0]?.id ?? '');
    const custObj = customers.find((c) => c.id === targetCustId);
    const divRecipient = getCustomerBillingRecipient(custObj, customers);

    const recordData = {
      title: title.trim(),
      customer_id: targetCustId,
      billing_customer_id: divRecipient ? divRecipient.id : null,
      property_id: propertyId || null,
      work_date: workDate,
      hours: calcHours,
      start_time: startTime,
      end_time: endTime,
      break_minutes: breakMinutes,
      hourly_rate: effectiveRate,
      material_cost: materialTotalSum,
      accounting_amount: calcTotal,
      is_lcr: isBilled ? existingRecord?.is_lcr ?? false : isLcr,
      notes: notes.trim(),
      materials: computedMaterials
    };

    if (isEditing && selectedWorkRecordId) {
      updateWorkRecord(selectedWorkRecordId, recordData);
    } else {
      addWorkRecord(recordData);
    }

    setActiveModal(null);
  };

  const handleDelete = () => {
    if (selectedWorkRecordId) {
      deleteWorkRecord(selectedWorkRecordId);
      setActiveModal(null);
    }
  };

  const wheelSyncBase = `${activeModal}-${selectedWorkRecordId ?? 'new'}-${openSeq}`;

  return (
    <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-2xs flex flex-col justify-end animate-fade-in">
      <div className="flex-1" onClick={() => setActiveModal(null)} />

      <div className="bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl p-4 max-h-[92%] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900 leading-tight">
              {isEditing ? 'Arbeitsaufzeichnung bearbeiten' : 'Arbeit nachtragen'}
            </h2>
            <p className="text-[11px] text-slate-500">
              {isEditing
                ? 'Nachträgliche Korrektur des Originaldatensatzes'
                : 'Tatsächliche Arbeitsaufzeichnung erfassen (M08)'}
            </p>
          </div>
          <button
            onClick={() => setActiveModal(null)}
            className="w-9 h-9 flex items-center justify-center text-slate-500 hover:text-slate-800 rounded-full hover:bg-slate-100 transition-colors"
            aria-label="Schließen"
          >
            <X size={20} />
          </button>
        </div>

        {isBilled && (
          <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center gap-2">
            <Lock size={15} className="text-amber-700 shrink-0" />
            <span>Dieser Datensatz gehört zu einer ausgestellten Rechnung. L.C.R.-Umschaltung ist gesperrt.</span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto py-3 space-y-3.5 text-xs text-slate-700">
          {/* Tätigkeit / Arbeiten (Mehrfachauswahl + Freitext + Aufträge) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-slate-700 flex items-center gap-1">
                <Briefcase size={13} className="text-slate-500" />
                <span>Arbeiten / Tätigkeit *</span>
                {!isCustomTitle && selectedActivities.length > 1 && (
                  <span className="px-1.5 py-0.5 bg-indigo-100 text-[#3138A0] rounded text-[10px] font-bold">
                    {selectedActivities.length} gewählt
                  </span>
                )}
              </label>
              {isCustomTitle ? (
                <button
                  type="button"
                  onClick={switchToPresetTitle}
                  className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-[#3138A0] font-semibold rounded-md text-[11px] flex items-center gap-1 transition-colors"
                >
                  <ChevronDown size={12} />
                  <span>Mehrfachauswahl</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => switchToManualTitle(false)}
                  className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-[#3138A0] font-semibold rounded-md text-[11px] flex items-center gap-1 transition-colors"
                >
                  <Keyboard size={12} />
                  <span>Freitext bearbeiten</span>
                </button>
              )}
            </div>

            {isCustomTitle ? (
              <input
                ref={titleInputRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Tätigkeiten eingeben (z.B. Rasen mähen, Heckenschnitt)..."
                className="w-full h-11 px-3 bg-white border border-[#3138A0] rounded-xl outline-hidden text-sm text-slate-900 font-medium"
              />
            ) : (
              <div className="border border-slate-200 rounded-xl bg-slate-50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setActivityPickerOpen((prev) => !prev)}
                  className="w-full min-h-[44px] px-3 py-2 flex items-center justify-between gap-2 text-left bg-white hover:bg-slate-50 transition-colors"
                >
                  <span
                    className={`text-xs font-semibold leading-snug ${
                      title.trim() ? 'text-slate-900' : 'text-slate-400'
                    }`}
                  >
                    {title.trim() || 'Arbeiten antippen (Mehrfachauswahl möglich)…'}
                  </span>
                  <span className="px-2 py-0.5 bg-indigo-50 text-[#3138A0] rounded-md text-[10px] font-bold shrink-0 flex items-center gap-1">
                    <span>{activityPickerOpen ? 'Fertig' : 'Wählen'}</span>
                    <ChevronDown
                      size={12}
                      className={`transition-transform ${activityPickerOpen ? 'rotate-180' : ''}`}
                    />
                  </span>
                </button>

                {activityPickerOpen && (
                  <div className="p-2.5 border-t border-slate-200 space-y-2.5 bg-slate-50/90 max-h-56 overflow-y-auto">
                    <div className="flex items-center justify-between text-[10px] text-slate-500 px-0.5">
                      <span>Mehrere Arbeiten per Antippen kombinierbar</span>
                      {selectedActivities.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedActivities([]);
                            setTitle('');
                          }}
                          className="text-[#B42318] font-semibold hover:underline"
                        >
                          Auswahl leeren
                        </button>
                      )}
                    </div>

                    {ACTIVITY_GROUPS.map((grp) => (
                      <div key={grp.group} className="space-y-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block px-0.5">
                          {grp.group}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {grp.items.map((item) => {
                            const active = selectedActivities.includes(item);
                            return (
                              <button
                                key={item}
                                type="button"
                                onClick={() => toggleActivityItem(item)}
                                className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition-all ${
                                  active
                                    ? 'bg-[#3138A0] text-white border-[#3138A0] shadow-2xs'
                                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                                }`}
                              >
                                {active && <Check size={11} strokeWidth={3} />}
                                <span>{item}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Offene Aufträge des gewählten Kunden als Mehrfachauswahl-Chips */}
            {orders.some((o) => o.customer_id === customerId && o.status !== 'erledigt') && (
              <div className="p-2 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-1">
                <span className="text-[10px] font-bold text-[#3138A0] flex items-center gap-1">
                  <CheckSquare size={11} />
                  <span>Aufträge zuordnen / kombinieren (Mehrfachauswahl):</span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {orders
                    .filter((o) => o.customer_id === customerId && o.status !== 'erledigt')
                    .map((ord) => {
                      const currentParts = title
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      const isPicked = currentParts.includes(ord.title.trim());
                      return (
                        <button
                          key={ord.id}
                          type="button"
                          onClick={() => toggleOrderInTitle(ord.title)}
                          className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 transition-all ${
                            isPicked
                              ? 'bg-[#3138A0] text-white border-[#3138A0]'
                              : 'bg-white text-[#3138A0] border-indigo-200 hover:bg-indigo-50'
                          }`}
                        >
                          {isPicked && <Check size={11} strokeWidth={3} />}
                          <span>{ord.title}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          {/* Kunde & Datum */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <User size={13} className="text-slate-500" />
                <span>Kunde</span>
              </label>
              <select
                value={customerId}
                onChange={(e) => {
                  const nextCustId = e.target.value;
                  setCustomerId(nextCustId);
                  const nextProps = properties.filter((p) => p.customer_id === nextCustId);
                  setPropertyId(nextProps[0]?.id || '');
                }}
                className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 font-medium"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.city ? `(${c.city})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Calendar size={13} className="text-slate-500" />
                <span>Datum</span>
              </label>
              <input
                type="date"
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
                className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 font-medium"
              />
            </div>
          </div>

          {/* Kurze übersichtliche Warnung bei vorhandenen Aufzeichnungen am gewählten Tag */}
          {sameDayRecords.length > 0 && (
            <div
              className={`p-2.5 rounded-xl border text-xs space-y-1.5 ${
                hasCollision
                  ? 'bg-red-50 border-red-200 text-[#B42318]'
                  : 'bg-amber-50/90 border-amber-200 text-amber-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-bold leading-tight">
                  <AlertTriangle
                    size={14}
                    className={`shrink-0 ${hasCollision ? 'text-[#B42318]' : 'text-amber-600'}`}
                  />
                  <span>
                    {hasCollision
                      ? `Zeitkollision am ${formattedWorkDate} – nicht speicherbar`
                      : `Bereits ${
                          sameDayRecords.length === 1
                            ? '1 Aufzeichnung'
                            : `${sameDayRecords.length} Aufzeichnungen`
                        } am ${formattedWorkDate}`}
                  </span>
                </div>
              </div>

              <div className="space-y-1 pl-5">
                {sameDayRecords.map((rec) => {
                  const recCustomer = customers.find((c) => c.id === rec.customer_id);
                  const isColliding = collidingIds.has(rec.id);
                  return (
                    <div
                      key={rec.id}
                      className={`text-[11px] flex items-center gap-1.5 leading-snug ${
                        isColliding
                          ? 'font-bold text-[#B42318]'
                          : hasCollision
                            ? 'text-slate-600'
                            : 'text-amber-800'
                      }`}
                    >
                      <span className="font-mono font-bold shrink-0">
                        {rec.start_time}–{rec.end_time}
                      </span>
                      <span className="truncate">
                        · {recCustomer ? `${recCustomer.name}: ` : ''}
                        {rec.title}
                      </span>
                    </div>
                  );
                })}
              </div>

              {hasCollision && suggestedFreeSlot && (
                <div className="pl-5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setStartTime(suggestedFreeSlot.start);
                      setEndTime(suggestedFreeSlot.end);
                    }}
                    className="min-h-[32px] px-2.5 py-1 bg-white hover:bg-red-100/60 border border-red-200 text-[#B42318] font-bold rounded-lg text-[11px] transition-colors shadow-2xs"
                  >
                    Freie Zeit {suggestedFreeSlot.start}–{suggestedFreeSlot.end} übernehmen
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Objekt-Zuordnung (wenn Kunde Objekte besitzt) */}
          {properties.some((p) => p.customer_id === customerId) && (
            <div>
              <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Home size={13} className="text-[#3138A0]" />
                <span>Objekt / Einsatzort</span>
              </label>
              <select
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                className="w-full h-11 px-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 font-medium"
              >
                <option value="">Ohne Objektzuordnung</option>
                {properties
                  .filter((p) => p.customer_id === customerId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.address ? `– ${p.address}` : ''}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* Hinweis bei aktivem abweichendem Rechnungsempfänger (Sub) */}
          {activeDivergentRecipient && (
            <div className="px-3 py-2 bg-indigo-50/70 border border-indigo-200/80 rounded-xl text-[11px] text-[#3138A0] flex items-center justify-between gap-2">
              <span className="font-medium">
                Arbeit bleibt am Objekt · Abrechnung über:
              </span>
              <span className="font-bold truncate">{activeDivergentRecipient.name}</span>
            </div>
          )}

          {/* Arbeitszeit (Von - Bis), horizontales Pausen-Drehrad (0 bis 4h in 15m) & Dauer */}
          <div
            className={`p-3 rounded-2xl space-y-3 border ${
              hasCollision
                ? 'bg-red-50/40 border-red-200'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Clock size={14} className={hasCollision ? 'text-[#B42318]' : 'text-[#3138A0]'} />
                <span>Arbeitszeit & Dauer</span>
              </span>
              {hasCollision ? (
                <span className="px-2 py-0.5 bg-red-100 text-[#B42318] font-bold rounded-lg text-[11px]">
                  Zeit kollidiert
                </span>
              ) : isValidDuration ? (
                <span className="px-2.5 py-1 bg-indigo-50 border border-indigo-100 text-[#3138A0] font-bold rounded-lg text-xs">
                  {calcHours.toLocaleString('de-DE', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2
                  })}{' '}
                  Std. ({formatDurationText(netMinutes)})
                </span>
              ) : (
                <span className="px-2 py-0.5 bg-red-50 text-[#B42318] font-semibold rounded-lg text-[11px]">
                  Zeit prüfen
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Von (Beginn)
                </label>
                <input
                  type="time"
                  step="300"
                  value={startTime}
                  onChange={(e) => handleStartTimeChange(e.target.value)}
                  className={`w-full h-11 px-3 bg-white border rounded-xl outline-hidden text-sm font-semibold text-slate-900 ${
                    hasCollision
                      ? 'border-red-300 focus:border-[#B42318]'
                      : 'border-slate-200 focus:border-[#3138A0]'
                  }`}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  Bis (Ende)
                </label>
                <input
                  type="time"
                  step="300"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={`w-full h-11 px-3 bg-white border rounded-xl outline-hidden text-sm font-semibold text-slate-900 ${
                    hasCollision
                      ? 'border-red-300 focus:border-[#B42318]'
                      : 'border-slate-200 focus:border-[#3138A0]'
                  }`}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                  <Coffee size={12} className="text-slate-500" />
                  <span>Pause (horizontal drehen · 0 bis 4 Std.)</span>
                </label>
                <span className="text-[11px] font-bold text-slate-700">
                  {breakMinutes === 0 ? 'Keine Pause' : `− ${formatDurationText(breakMinutes)}`}
                </span>
              </div>
              <HorizontalWheelPicker
                options={PAUSE_WHEEL_OPTIONS}
                value={breakMinutes}
                onChange={setBreakMinutes}
                syncKey={`pause-${wheelSyncBase}`}
                ariaLabel="Pause in 15-Minuten-Schritten wählen"
              />
            </div>

            {!isValidDuration && (
              <p className="text-[11px] font-medium text-[#B42318]">
                {grossMinutes <= 0
                  ? 'Die Endzeit muss nach der Startzeit liegen.'
                  : 'Die gewählte Pause ist länger als die Arbeitszeit.'}
              </p>
            )}
          </div>

          {/* Stundensatz (kein Standard, horizontales Drehrad + optionale Tastatureingabe) & Abrechnungsbetrag */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-800 flex items-center gap-1">
                  <Euro size={14} className="text-[#3138A0]" />
                  <span>Stundensatz</span>
                </span>
                {isCustomRate ? (
                  <button
                    type="button"
                    onClick={switchToWheelRate}
                    className="px-2 py-0.5 bg-white border border-slate-200 text-[#3138A0] font-semibold rounded-md text-[11px]"
                  >
                    Drehrad
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={switchToManualRate}
                    className="px-2 py-0.5 bg-white border border-slate-200 text-[#3138A0] font-semibold rounded-md text-[11px] flex items-center gap-1"
                  >
                    <Keyboard size={11} />
                    <span>Tastatur</span>
                  </button>
                )}
              </div>

              <div className="text-right">
                <span className="text-[10px] text-slate-500 block leading-none">
                  Abrechnungsbetrag
                </span>
                {calcTotal !== null ? (
                  <span className="font-bold text-sm text-[#B4470B]">
                    {calcTotal.toLocaleString('de-DE', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}{' '}
                    €
                  </span>
                ) : (
                  <span className="font-bold text-xs text-[#B42318]">Kein Satz gewählt</span>
                )}
              </div>
            </div>

            {isCustomRate ? (
              <div className="relative">
                <input
                  ref={rateInputRef}
                  type="text"
                  inputMode="decimal"
                  value={customRateStr}
                  onChange={(e) => setCustomRateStr(e.target.value)}
                  placeholder="Stundensatz eingeben (leer = kein Satz)…"
                  className="w-full h-12 pl-3 pr-14 bg-white border border-[#3138A0] rounded-xl outline-hidden text-sm text-slate-900 font-semibold"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 pointer-events-none">
                  € / Std.
                </span>
              </div>
            ) : (
              <HorizontalWheelPicker
                options={RATE_WHEEL_OPTIONS}
                value={selectedRate}
                onChange={setSelectedRate}
                syncKey={`rate-${wheelSyncBase}-${String(isCustomRate)}`}
                ariaLabel="Stundensatz horizontal wählen"
              />
            )}
          </div>

          {/* Materialverbrauch: Wählbare Option + sinnvolle Eingabemöglichkeiten (ILL-013, DATA-04) */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-2">
                <Package
                  size={18}
                  className={hasMaterial ? 'text-[#3138A0]' : 'text-slate-400'}
                />
                <div>
                  <span className="font-bold text-slate-900 text-xs block">
                    Materialverbrauch erfassen
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    {!hasMaterial
                      ? 'Deaktiviert: Kein Material für diesen Einsatz'
                      : computedMaterials.length === 0
                        ? 'Aktiviert: Vorlage wählen oder frei erfassen'
                        : `${computedMaterials.length} Pos.${
                            materialTotalSum !== null
                              ? ` · Summe ${materialTotalSum.toLocaleString('de-DE', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2
                                })} €`
                              : ' · Preis offen'
                          }`}
                  </span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={hasMaterial}
                onChange={(e) => setHasMaterial(e.target.checked)}
                className="w-5 h-5 accent-[#3138A0] rounded-sm cursor-pointer"
              />
            </label>

            {hasMaterial && (
              <div className="pt-2.5 border-t border-slate-200/80 space-y-2.5 animate-fade-in">
                {/* Auswahlmenü + Freitext-Button */}
                <div className="flex items-center gap-2">
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        handleSelectMaterialOption(e.target.value);
                      }
                    }}
                    className="flex-1 h-10 px-2.5 bg-white border border-slate-200 rounded-xl focus:border-[#3138A0] outline-hidden text-xs text-slate-900 font-semibold"
                  >
                    <option value="">+ Material aus Liste hinzufügen…</option>
                    {materials.length > 0 && (
                      <optgroup label="Eigene Materialien (Stammdaten)">
                        {materials.map((m) => (
                          <option key={m.id} value={`saved:${m.id}`}>
                            {m.name} ({m.unit}
                            {m.price_per_unit !== null ? ` · ${m.price_per_unit} €` : ''})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {PRESET_MATERIAL_GROUPS.map((grp) => (
                      <optgroup key={grp.group} label={grp.group}>
                        {grp.items.map((tpl) => (
                          <option key={tpl.id} value={`preset:${tpl.id}`}>
                            {tpl.name} ({tpl.unit})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    <optgroup label="Manuell">
                      <option value="__custom__">Eigenes Material frei eingeben…</option>
                    </optgroup>
                  </select>

                  <button
                    type="button"
                    onClick={() => handleSelectMaterialOption('__custom__')}
                    className="h-10 px-3 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-[#3138A0] flex items-center gap-1 shrink-0 transition-colors"
                  >
                    <Plus size={14} />
                    <span>Frei</span>
                  </button>
                </div>

                {/* Erfasste Materialpositionen */}
                {draftMaterials.length === 0 ? (
                  <p className="text-[11px] text-slate-500 text-center py-1.5">
                    Wählen Sie oben ein Material aus oder tippen Sie auf „+ Frei“.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {draftMaterials.map((dm) => {
                      const qty = parsePositiveQuantity(dm.quantityStr);
                      const unitPrice = parseGermanDecimalOrNull(dm.priceStr);
                      const rowTotal =
                        unitPrice !== null && qty > 0
                          ? Math.round(qty * unitPrice * 100) / 100
                          : null;

                      return (
                        <div
                          key={dm.uid}
                          className="p-2.5 bg-white border border-slate-200 rounded-xl space-y-2 shadow-2xs"
                        >
                          {/* Zeile 1: Bezeichnung + Positionssumme + Löschen */}
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={dm.name}
                              onChange={(e) =>
                                updateDraftMaterial(dm.uid, { name: e.target.value })
                              }
                              placeholder="Materialbezeichnung eingeben…"
                              className="flex-1 h-9 px-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-[#3138A0] outline-hidden text-xs font-semibold text-slate-900"
                            />
                            <span
                              className={`text-xs font-bold shrink-0 ${
                                rowTotal !== null ? 'text-[#B4470B]' : 'text-slate-400'
                              }`}
                            >
                              {rowTotal !== null
                                ? `${rowTotal.toLocaleString('de-DE', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                  })} €`
                                : 'Offen'}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeDraftMaterial(dm.uid)}
                              className="w-8 h-8 flex items-center justify-center text-red-500 hover:bg-red-50 rounded-lg shrink-0 transition-colors"
                              aria-label="Position entfernen"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          {/* Zeile 2: Menge (− / +) | Einheit | Einzelpreis */}
                          <div className="grid grid-cols-12 gap-1.5">
                            <div className="col-span-5">
                              <span className="text-[10px] font-semibold text-slate-500 block mb-0.5">
                                Menge
                              </span>
                              <div className="flex items-center h-9 bg-slate-50 border border-slate-200 rounded-lg overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() => stepMaterialQuantity(dm.uid, -1)}
                                  className="w-8 h-full flex items-center justify-center text-slate-600 hover:bg-slate-200 active:bg-slate-300 shrink-0"
                                  aria-label="Menge verringern"
                                >
                                  <Minus size={13} />
                                </button>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={dm.quantityStr}
                                  onChange={(e) =>
                                    updateDraftMaterial(dm.uid, { quantityStr: e.target.value })
                                  }
                                  className="w-full h-full text-center bg-transparent outline-hidden text-xs font-bold text-slate-900"
                                />
                                <button
                                  type="button"
                                  onClick={() => stepMaterialQuantity(dm.uid, 1)}
                                  className="w-8 h-full flex items-center justify-center text-[#3138A0] hover:bg-slate-200 active:bg-slate-300 shrink-0"
                                  aria-label="Menge erhöhen"
                                >
                                  <Plus size={13} />
                                </button>
                              </div>
                            </div>

                            <div className="col-span-3">
                              <span className="text-[10px] font-semibold text-slate-500 block mb-0.5">
                                Einheit
                              </span>
                              <select
                                value={dm.unit}
                                onChange={(e) =>
                                  updateDraftMaterial(dm.uid, { unit: e.target.value })
                                }
                                className="w-full h-9 px-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-[#3138A0] outline-hidden text-xs font-medium text-slate-900"
                              >
                                {!MATERIAL_UNITS.includes(dm.unit) && (
                                  <option value={dm.unit}>{dm.unit}</option>
                                )}
                                {MATERIAL_UNITS.map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="col-span-4">
                              <span className="text-[10px] font-semibold text-slate-500 block mb-0.5">
                                € / Einheit
                              </span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={dm.priceStr}
                                onChange={(e) =>
                                  updateDraftMaterial(dm.uid, { priceStr: e.target.value })
                                }
                                placeholder="Offen"
                                className="w-full h-9 px-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-[#3138A0] outline-hidden text-xs font-semibold text-slate-900"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* L.C.R. Kennzeichnung (REQ-015/016/017, ILL-010, WF-014) */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bookmark size={18} className={isLcr ? 'text-[#3138A0]' : 'text-slate-400'} />
              <div>
                <span className="font-bold text-slate-900 text-xs">L.C.R. Kennzeichnung</span>
                <span className="text-[10px] text-slate-500 block">
                  {isLcr
                    ? 'Aktiviert: In L.C.R. referenziert, aus offener Abrechnung ausgeschlossen'
                    : 'Deaktiviert: Regulär offen abzurechnen'}
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              disabled={isBilled}
              checked={isLcr}
              onChange={(e) => setIsLcr(e.target.checked)}
              className="w-5 h-5 accent-[#3138A0] rounded-sm cursor-pointer disabled:opacity-50"
            />
          </div>

          {/* Notiz */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">
              Arbeitsnotiz
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Tätigkeit detaillieren..."
              className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#3138A0] outline-hidden text-xs text-slate-900 resize-none"
            />
          </div>

          {/* Delete Option if Editing */}
          {isEditing && (
            <div className="pt-2 border-t border-slate-100">
              {confirmDelete ? (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-2">
                  <div className="flex items-center gap-1.5 text-xs text-[#B42318] font-bold">
                    <AlertTriangle size={15} />
                    <span>Aufzeichnung unwiderruflich löschen?</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="flex-1 py-1.5 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
                    >
                      Abbrechen
                    </button>
                    <button
                      onClick={handleDelete}
                      className="flex-1 py-1.5 bg-[#B42318] text-white text-xs font-semibold rounded-lg shadow-2xs"
                    >
                      Ja, löschen
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full py-2 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Trash2 size={14} />
                  <span>Aufzeichnung löschen</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
          <button
            onClick={() => setActiveModal(null)}
            className="flex-1 h-12 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 font-semibold rounded-xl text-sm transition-all"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || !isValidDuration || hasCollision}
            className={`flex-1 h-12 active:scale-98 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-all shadow-xs ${
              hasCollision
                ? 'bg-[#B42318]'
                : 'bg-[#3138A0] hover:bg-[#272d82]'
            }`}
          >
            {hasCollision
              ? 'Zeit kollidiert'
              : isEditing
                ? 'Änderungen speichern'
                : 'Arbeit speichern'}
          </button>
        </div>
      </div>
    </div>
  );
};
