import React, { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react';
import {
  ScreenId,
  Customer,
  CustomerProperty,
  Appointment,
  WorkRecord,
  Invoice,
  InvoiceLineItem,
  Inquiry,
  Offer,
  Order,
  Equipment,
  Material,
  PaymentItem,
  UsedMaterial,
  OfferItem,
  BusinessExpense,
  TaxSettings
} from '../types/index.ts';
import {
  addDaysIso,
  buildLineItemsFromRecords,
  buildPaymentTermsClause,
  computeNextInvoiceNumber,
  computeServicePeriod,
  getTodayLocalIso
} from '../utils/invoicePdf.ts';
import {
  getNativeBackupMeta,
  isNativeAndroidApp,
  loadNativeStoreJson,
  migrateLegacyWebStorageCredentialsIfNeeded,
  registerNativeBackHandler,
  resolveBackendEndpoint,
  restoreNativeVerifiedBackup,
  runNativeVerifiedBackup,
  saveNativeStoreJson,
  subscribeNativeRemoteState,
  syncNativeCanGoBack
} from '../services/nativeBridge.ts';
import { validateFirestoreBootConnection } from '../services/firebaseClient.ts';
import { consumeOAuthReturnScreen } from '../services/gmailService.ts';

// Re-export canonical data contracts (DATA-02, DATA-04, DATA-09, DATA-10, M11) directly from AppContext
export type {
  Customer,
  Order,
  WorkRecord,
  Material,
  UsedMaterial,
  CustomerProperty,
  Appointment,
  Invoice,
  InvoiceLineItem,
  PaymentItem,
  Inquiry,
  Offer,
  OfferItem,
  Equipment,
  BusinessExpense,
  TaxSettings,
  ScreenId
};

export type CustomerTab = 'objekte' | 'vorgaenge' | 'geld';

interface ReturnNavEntry {
  screen: ScreenId;
  customerId: string | null;
  customerTab: CustomerTab;
  customerWorkViewOpen?: boolean;
  customerTermineViewOpen?: boolean;
  invoiceId: string | null;
}

interface AppContextType {
  currentScreen: ScreenId;
  setCurrentScreen: (screen: ScreenId) => void;
  screenHistory: ScreenId[];
  canGoBack: boolean;
  canSystemGoBack: boolean;
  navigate: (screen: ScreenId) => void;
  switchMainTab: (screen: ScreenId) => void;
  goBack: () => void;
  triggerSystemBack: () => boolean;
  registerLocalBackLayer: (
    id: string,
    onBackRef: React.MutableRefObject<() => void>
  ) => () => void;

  // Selected contexts
  selectedCustomerId: string | null;
  setSelectedCustomerId: (id: string | null) => void;
  customerTab: CustomerTab;
  setCustomerTab: (tab: CustomerTab) => void;
  customerWorkViewOpen: boolean;
  setCustomerWorkViewOpen: (open: boolean) => void;
  customerTermineViewOpen: boolean;
  setCustomerTermineViewOpen: (open: boolean) => void;
  selectedPropertyId: string | null;
  setSelectedPropertyId: (id: string | null) => void;
  selectedInvoiceId: string | null;
  setSelectedInvoiceId: (id: string | null) => void;
  selectedWorkRecordId: string | null;
  setSelectedWorkRecordId: (id: string | null) => void;
  selectedEquipmentId: string | null;
  setSelectedEquipmentId: (id: string | null) => void;
  sendingInvoiceId: string | null;
  setSendingInvoiceId: (id: string | null) => void;
  preselectedWorkRecordIds: string[];
  setPreselectedWorkRecordIds: (ids: string[]) => void;
  prefilledWorkTitle: string | null;
  setPrefilledWorkTitle: (title: string | null) => void;

  // Modals & Panels
  isPlusMenuOpen: boolean;
  setIsPlusMenuOpen: (open: boolean) => void;
  isThreeDotsMenuOpen: boolean;
  setIsThreeDotsMenuOpen: (open: boolean) => void;
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  activeModal: string | null;
  setActiveModal: (modal: string | null) => void;

  // Data
  customers: Customer[];
  properties: CustomerProperty[];
  appointments: Appointment[];
  workRecords: WorkRecord[];
  invoices: Invoice[];
  inquiries: Inquiry[];
  offers: Offer[];
  orders: Order[];
  equipments: Equipment[];
  materials: Material[];
  expenses: BusinessExpense[];
  taxSettings: TaxSettings;

  // Undo notification state (e.g. 5 seconds payment undo)
  undoToast: {
    visible: boolean;
    message: string;
    actionLabel: string;
    onUndo: () => void;
  } | null;
  setUndoToast: React.Dispatch<React.SetStateAction<{
    visible: boolean;
    message: string;
    actionLabel: string;
    onUndo: () => void;
  } | null>>;

  // CRUD & Business operations
  addAppointment: (app: Partial<Appointment>) => Appointment;
  updateAppointment: (id: string, app: Partial<Appointment>) => void;
  deleteAppointment: (id: string) => void;

  addCustomer: (cust: Partial<Customer>) => Customer;
  updateCustomer: (id: string, cust: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;

  addProperty: (prop: Partial<CustomerProperty>) => CustomerProperty;
  updateProperty: (id: string, prop: Partial<CustomerProperty>) => void;
  deleteProperty: (id: string) => void;

  addWorkRecord: (work: Partial<WorkRecord>) => WorkRecord;
  updateWorkRecord: (id: string, work: Partial<WorkRecord>) => void;
  deleteWorkRecord: (id: string) => void;
  deleteWorkRecordsBatch: (ids: string[]) => void;
  toggleLcrWorkRecord: (id: string) => { success: boolean; reason?: string };
  setLcrWorkRecordsBatch: (ids: string[], lcrState: boolean) => number;

  createInvoiceFromRecords: (
    customerId: string,
    recordIds: string[],
    options?: {
      extraItems?: InvoiceLineItem[];
      issueDate?: string;
      servicePeriod?: string;
      invoiceNumber?: string;
      dueDays?: number;
      customerNumber?: string;
      paymentTermsText?: string;
      paidInCash?: boolean;
    }
  ) => Invoice;
  updateInvoice: (invoiceId: string, patch: Partial<Invoice>) => void;
  deleteInvoice: (invoiceId: string) => void;
  payInvoice: (invoiceId: string, customAmount?: number, customDate?: string) => void;
  updatePayment: (invoiceId: string, paymentId: string, patch: Partial<PaymentItem>) => void;
  deletePayment: (invoiceId: string, paymentId: string) => void;
  correctPayment: (invoiceId: string, paymentId: string, reason: string) => void;
  stornoInvoice: (invoiceId: string, reason: string) => Invoice;
  recordRefund: (invoiceId: string, amount: number, note: string) => void;

  addOrder: (order: Partial<Order>) => Order;
  updateOrder: (id: string, order: Partial<Order>) => void;
  updateOrdersStatusBatch: (ids: string[], status: Order['status']) => void;
  deleteOrder: (id: string) => void;
  deleteOrdersBatch: (ids: string[]) => void;

  addEquipment: (eq: Partial<Equipment> & { name: string }) => Equipment;
  updateEquipment: (id: string, eq: Partial<Equipment>) => void;
  deleteEquipment: (id: string) => void;
  recordMaintenance: (equipmentId: string, plan: string, note: string, nextDate: string) => void;
  addMaterial: (mat: Partial<Material>) => Material;
  updateMaterial: (id: string, mat: Partial<Material>) => void;

  // Gewinn- & Verlustrechnung / Pauschalierung
  addExpense: (exp: Omit<BusinessExpense, 'id'> & { id?: string }) => BusinessExpense;
  updateExpense: (id: string, patch: Partial<BusinessExpense>) => void;
  deleteExpense: (id: string) => void;
  updateTaxSettings: (patch: Partial<TaxSettings>) => void;

  // Backup & Restore
  lastBackupDate: string | null;
  performBackup: (forcePickTarget?: boolean) => Promise<boolean>;
  restoreBackup: (pickExternalFile?: boolean) => Promise<boolean>;

  // Device orientation / Pixel frame toggle (for comfortable testing)
  pixelFrameEnabled: boolean;
  setPixelFrameEnabled: (enabled: boolean) => void;

  // Sync status & pending synchronization queue
  appSyncStatus: {
    pendingSyncCount: number;
    syncInFlight: boolean;
    online: boolean;
    revision: number;
    lastSyncAt: string | null;
    lastSyncError: string | null;
  };
  flushPendingAppSync: () => Promise<void>;
}

const STORAGE_KEY = 'eisbaer_app_clean_v1';
const PENDING_SYNC_COUNT_KEY = `${STORAGE_KEY}_pending_sync_count`;
const LAST_KNOWN_REV_KEY = `${STORAGE_KEY}_last_known_rev`;
const LAST_SYNC_AT_KEY = `${STORAGE_KEY}_last_sync_at`;

const initialCustomers: Customer[] = [];
const initialProperties: CustomerProperty[] = [];
const initialAppointments: Appointment[] = [];
const initialWorkRecords: WorkRecord[] = [];
const initialInvoices: Invoice[] = [];
const initialEquipments: Equipment[] = [];
const initialMaterials: Material[] = [];
const initialInquiries: Inquiry[] = [];
const initialOffers: Offer[] = [];
const initialOrders: Order[] = [];
const initialExpenses: BusinessExpense[] = [];
const defaultTaxSettings: TaxSettings = {
  selected_year: 2026,
  preferred_method: 'auto_best',
  svs_paid: 0,
  workplace_allowance: 0,
  transit_ticket_full: 0,
  manual_extra_income: 0
};

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [initialBootScreen] = useState<ScreenId>(() => {
    const returned = consumeOAuthReturnScreen();
    if (
      returned === 'M02_PLANUNG' ||
      returned === 'M13_EINSTELLUNGEN' ||
      returned === 'M04_ABRECHNUNG'
    ) {
      return returned;
    }
    return 'M01_HEUTE';
  });
  const [currentScreen, setCurrentScreen] = useState<ScreenId>(initialBootScreen);
  const [screenHistory, setScreenHistory] = useState<ScreenId[]>(
    initialBootScreen === 'M01_HEUTE' ? ['M01_HEUTE'] : ['M01_HEUTE', initialBootScreen]
  );
  const [returnStack, setReturnStack] = useState<ReturnNavEntry[]>([]);
  const [localBackLayers, setLocalBackLayers] = useState<
    Array<{ id: string; onBackRef: React.MutableRefObject<() => void> }>
  >([]);
  const [popStateTick, setPopStateTick] = useState(0);

  const registerLocalBackLayer = useCallback(
    (id: string, onBackRef: React.MutableRefObject<() => void>) => {
      setLocalBackLayers((prev) => [...prev.filter((item) => item.id !== id), { id, onBackRef }]);
      return () => {
        setLocalBackLayers((prev) => prev.filter((item) => item.id !== id));
      };
    },
    []
  );

  const [selectedCustomerId, setSelectedCustomerIdState] = useState<string | null>(null);
  const [customerTab, setCustomerTab] = useState<CustomerTab>('objekte');
  const [customerWorkViewOpen, setCustomerWorkViewOpen] = useState(false);
  const [customerTermineViewOpen, setCustomerTermineViewOpen] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);

  const setSelectedCustomerId = (id: string | null) => {
    setCustomerTab('objekte');
    setCustomerWorkViewOpen(false);
    setCustomerTermineViewOpen(false);
    setSelectedCustomerIdState(id);
  };
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedWorkRecordId, setSelectedWorkRecordId] = useState<string | null>(null);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(null);
  const [sendingInvoiceId, setSendingInvoiceId] = useState<string | null>(null);
  const [preselectedWorkRecordIds, setPreselectedWorkRecordIds] = useState<string[]>([]);
  const [prefilledWorkTitle, setPrefilledWorkTitle] = useState<string | null>(null);

  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const [isThreeDotsMenuOpen, setIsThreeDotsMenuOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<string | null>(null);

  const [pixelFrameEnabled, setPixelFrameEnabled] = useState(true);

  // Undo Toast (e.g. 5 seconds payment undo)
  const [undoToast, setUndoToast] = useState<{
    visible: boolean;
    message: string;
    actionLabel: string;
    onUndo: () => void;
  } | null>(null);

  // Clear any previously saved active work session data (REQ: Timer & Arbeit starten entfernt)
  useEffect(() => {
    localStorage.removeItem(`${STORAGE_KEY}_active_session`);
    localStorage.removeItem('eisbaer_active_session');
    localStorage.removeItem('active_work_session');
  }, []);

  // Data states initialized from localStorage or defaults
  const [customers, setCustomers] = useState<Customer[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_customers`);
    return saved ? JSON.parse(saved) : initialCustomers;
  });

  const [properties, setProperties] = useState<CustomerProperty[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_properties`);
    return saved ? JSON.parse(saved) : initialProperties;
  });

  const [appointments, setAppointments] = useState<Appointment[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_appointments`);
    return saved ? JSON.parse(saved) : initialAppointments;
  });

  const [workRecords, setWorkRecords] = useState<WorkRecord[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_workRecords`);
    return saved ? JSON.parse(saved) : initialWorkRecords;
  });

  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_invoices`);
    return saved ? JSON.parse(saved) : initialInvoices;
  });

  const [equipments, setEquipments] = useState<Equipment[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_equipments`);
    return saved ? JSON.parse(saved) : initialEquipments;
  });

  const [materials, setMaterials] = useState<Material[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_materials`);
    return saved ? JSON.parse(saved) : initialMaterials;
  });

  const [inquiries, setInquiries] = useState<Inquiry[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_inquiries`);
    return saved ? JSON.parse(saved) : initialInquiries;
  });

  const [offers, setOffers] = useState<Offer[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_offers`);
    return saved ? JSON.parse(saved) : initialOffers;
  });

  const [orders, setOrders] = useState<Order[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_orders`);
    return saved ? JSON.parse(saved) : initialOrders;
  });

  const [expenses, setExpenses] = useState<BusinessExpense[]>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_expenses`);
    return saved ? JSON.parse(saved) : initialExpenses;
  });

  const [taxSettings, setTaxSettings] = useState<TaxSettings>(() => {
    const saved = localStorage.getItem(`${STORAGE_KEY}_taxSettings`);
    return saved ? { ...defaultTaxSettings, ...JSON.parse(saved) } : defaultTaxSettings;
  });

  const [lastBackupDate, setLastBackupDate] = useState<string | null>(() => {
    const nativeMeta = getNativeBackupMeta();
    if (nativeMeta?.lastBackupDate) return nativeMeta.lastBackupDate;
    return localStorage.getItem(`${STORAGE_KEY}_lastBackupDate`) || null;
  });

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_customers`, JSON.stringify(customers));
  }, [customers]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_properties`, JSON.stringify(properties));
  }, [properties]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_appointments`, JSON.stringify(appointments));
  }, [appointments]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_workRecords`, JSON.stringify(workRecords));
  }, [workRecords]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_invoices`, JSON.stringify(invoices));
  }, [invoices]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_equipments`, JSON.stringify(equipments));
  }, [equipments]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_materials`, JSON.stringify(materials));
  }, [materials]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_inquiries`, JSON.stringify(inquiries));
  }, [inquiries]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_offers`, JSON.stringify(offers));
  }, [offers]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_orders`, JSON.stringify(orders));
  }, [orders]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_expenses`, JSON.stringify(expenses));
  }, [expenses]);

  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEY}_taxSettings`, JSON.stringify(taxSettings));
  }, [taxSettings]);

  // Live Bidirectional Sync mit Backend (für vollen lesenden & schreibenden MCP / ChatGPT-Plugin Zugriff)
  const serverSyncInitializedRef = useRef(false);
  const lastKnownRevisionRef = useRef<number>(
    (() => {
      const saved = Number(localStorage.getItem(LAST_KNOWN_REV_KEY) || '0');
      return Number.isFinite(saved) && saved >= 0 ? saved : 0;
    })()
  );
  const lastSyncedSnapshotJsonRef = useRef<string>('');
  const lastTrackedMutationJsonRef = useRef<string>('');
  const pendingSyncCountRef = useRef<number>(
    (() => {
      const saved = Number(localStorage.getItem(PENDING_SYNC_COUNT_KEY) || '0');
      return Number.isFinite(saved) && saved > 0 ? saved : 0;
    })()
  );

  const [appSyncStatus, setAppSyncStatus] = useState<{
    pendingSyncCount: number;
    syncInFlight: boolean;
    online: boolean;
    revision: number;
    lastSyncAt: string | null;
    lastSyncError: string | null;
  }>(() => ({
    pendingSyncCount: pendingSyncCountRef.current,
    syncInFlight: false,
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    revision: lastKnownRevisionRef.current,
    lastSyncAt: localStorage.getItem(LAST_SYNC_AT_KEY),
    lastSyncError: null
  }));

  const updateSyncMeta = useCallback(
    (patch: {
      pendingSyncCount?: number;
      syncInFlight?: boolean;
      online?: boolean;
      revision?: number;
      lastSyncAt?: string | null;
      lastSyncError?: string | null;
    }) => {
      if (typeof patch.pendingSyncCount === 'number') {
        pendingSyncCountRef.current = Math.max(0, patch.pendingSyncCount);
        localStorage.setItem(PENDING_SYNC_COUNT_KEY, String(pendingSyncCountRef.current));
      }
      if (typeof patch.revision === 'number') {
        lastKnownRevisionRef.current = patch.revision;
        localStorage.setItem(LAST_KNOWN_REV_KEY, String(patch.revision));
      }
      if (patch.lastSyncAt) {
        localStorage.setItem(LAST_SYNC_AT_KEY, patch.lastSyncAt);
      }
      setAppSyncStatus((prev) => ({
        ...prev,
        ...patch,
        pendingSyncCount:
          typeof patch.pendingSyncCount === 'number'
            ? Math.max(0, patch.pendingSyncCount)
            : prev.pendingSyncCount
      }));
    },
    []
  );

  const buildCurrentSnapshot = () => ({
    customers,
    properties,
    appointments,
    workRecords,
    invoices,
    inquiries,
    offers,
    orders,
    equipments,
    materials,
    expenses,
    taxSettings
  });

  const applyServerData = (remote: Partial<ReturnType<typeof buildCurrentSnapshot>>) => {
    const normalized = {
      customers: Array.isArray(remote.customers) ? remote.customers : [],
      properties: Array.isArray(remote.properties) ? remote.properties : [],
      appointments: Array.isArray(remote.appointments) ? remote.appointments : [],
      workRecords: Array.isArray(remote.workRecords) ? remote.workRecords : [],
      invoices: Array.isArray(remote.invoices) ? remote.invoices : [],
      inquiries: Array.isArray(remote.inquiries) ? remote.inquiries : [],
      offers: Array.isArray(remote.offers) ? remote.offers : [],
      orders: Array.isArray(remote.orders) ? remote.orders : [],
      equipments: Array.isArray(remote.equipments) ? remote.equipments : [],
      materials: Array.isArray(remote.materials) ? remote.materials : [],
      expenses: Array.isArray(remote.expenses) ? remote.expenses : [],
      taxSettings:
        remote.taxSettings && typeof remote.taxSettings === 'object'
          ? { ...defaultTaxSettings, ...remote.taxSettings }
          : { ...defaultTaxSettings }
    };
    const serialized = JSON.stringify(normalized);
    lastSyncedSnapshotJsonRef.current = serialized;
    lastTrackedMutationJsonRef.current = serialized;
    setCustomers(normalized.customers);
    setProperties(normalized.properties);
    setAppointments(normalized.appointments);
    setWorkRecords(normalized.workRecords);
    setInvoices(normalized.invoices);
    setInquiries(normalized.inquiries);
    setOffers(normalized.offers);
    setOrders(normalized.orders);
    setEquipments(normalized.equipments);
    setMaterials(normalized.materials);
    setExpenses(normalized.expenses);
    setTaxSettings(normalized.taxSettings);
  };

  const lastNativeSavedJsonRef = useRef<string>('');
  const nativeHydratedRef = useRef<boolean>(!isNativeAndroidApp());

  // Hydrate from Kotlin atomic filesDir storage + live NativeMcpSyncManager listener on Pixel 10 Pro
  useEffect(() => {
    if (!isNativeAndroidApp()) return;
    migrateLegacyWebStorageCredentialsIfNeeded();

    const rawNative = loadNativeStoreJson();
    if (rawNative) {
      try {
        const parsed = JSON.parse(rawNative) as Partial<ReturnType<typeof buildCurrentSnapshot>>;
        if (parsed && typeof parsed === 'object') {
          applyServerData(parsed);
          lastNativeSavedJsonRef.current = lastSyncedSnapshotJsonRef.current;
        }
      } catch {
        // Ignore malformed native snapshot
      }
    } else {
      lastNativeSavedJsonRef.current = JSON.stringify(buildCurrentSnapshot());
    }
    nativeHydratedRef.current = true;

    const unsubRemote = subscribeNativeRemoteState((stateJson, revision) => {
      try {
        const parsed = JSON.parse(stateJson) as Partial<ReturnType<typeof buildCurrentSnapshot>>;
        if (parsed && typeof parsed === 'object') {
          updateSyncMeta({ revision, lastSyncAt: new Date().toISOString() });
          applyServerData(parsed);
          lastNativeSavedJsonRef.current = lastSyncedSnapshotJsonRef.current;
        }
      } catch {
        // Ignore malformed remote payload
      }
    });

    return () => {
      unsubRemote();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushSnapshotToServer = useCallback(
    async (
      snap: ReturnType<typeof buildCurrentSnapshot>,
      snapJson: string,
      summary: string
    ): Promise<boolean> => {
      const endpoint = resolveBackendEndpoint('/api/internal/state');
      if (!endpoint.url) return false;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        updateSyncMeta({
          online: false,
          syncInFlight: false,
          lastSyncError: 'Offline – Synchronisation wartet auf Verbindung'
        });
        return false;
      }

      const countAtStart = pendingSyncCountRef.current;
      updateSyncMeta({ syncInFlight: true, online: true });

      try {
        const res = await fetch(endpoint.url, {
          method: 'PUT',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...endpoint.headers
          },
          body: JSON.stringify({
            data: snap,
            baseRevision: lastKnownRevisionRef.current,
            summary
          })
        });

        if (!res.ok) {
          updateSyncMeta({
            syncInFlight: false,
            lastSyncError:
              res.status === 401
                ? 'Sitzung gesperrt – Synchronisation ausstehend'
                : `Synchronisation ausstehend (HTTP ${res.status})`
          });
          return false;
        }

        const info = (await res.json()) as {
          revision: number;
          merged?: boolean;
          data?: Partial<ReturnType<typeof buildCurrentSnapshot>>;
        };

        lastSyncedSnapshotJsonRef.current = snapJson;
        const remaining = Math.max(0, pendingSyncCountRef.current - Math.max(1, countAtStart));
        const nowIso = new Date().toISOString();

        updateSyncMeta({
          pendingSyncCount: remaining,
          syncInFlight: false,
          online: true,
          revision: typeof info.revision === 'number' ? info.revision : lastKnownRevisionRef.current,
          lastSyncAt: nowIso,
          lastSyncError: null
        });

        if (info.merged && info.data) {
          applyServerData(info.data);
        }
        return true;
      } catch {
        updateSyncMeta({
          syncInFlight: false,
          online: typeof navigator !== 'undefined' ? navigator.onLine : false,
          lastSyncError: 'Verbindung unterbrochen – Synchronisation ausstehend'
        });
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateSyncMeta]
  );

  const flushPendingAppSync = useCallback(async () => {
    if (isNativeAndroidApp()) return;
    const snap = buildCurrentSnapshot();
    const snapJson = JSON.stringify(snap);
    await pushSnapshotToServer(snap, snapJson, 'Manueller Abgleich aus App');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    customers,
    properties,
    appointments,
    workRecords,
    invoices,
    inquiries,
    offers,
    orders,
    equipments,
    materials,
    expenses,
    taxSettings,
    pushSnapshotToServer
  ]);

  useEffect(() => {
    if (isNativeAndroidApp()) {
      serverSyncInitializedRef.current = true;
      return;
    }

    void validateFirestoreBootConnection();

    let cancelled = false;
    let eventSource: EventSource | null = null;

    const connectEventStream = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        eventSource?.close();
        eventSource = null;
        return;
      }
      const eventsEndpoint = resolveBackendEndpoint('/api/internal/events');
      if (!eventsEndpoint.url || cancelled) return;
      eventSource?.close();
      eventSource = new EventSource(eventsEndpoint.url, { withCredentials: true });
      eventSource.onmessage = async (ev) => {
        try {
          const payload = JSON.parse(ev.data) as { revision?: number };
          if (
            typeof payload.revision === 'number' &&
            payload.revision > lastKnownRevisionRef.current
          ) {
            if (pendingSyncCountRef.current > 0) {
              const currentSnap = buildCurrentSnapshot();
              await pushSnapshotToServer(
                currentSnap,
                JSON.stringify(currentSnap),
                'Abgleich ausstehender Änderungen'
              );
              return;
            }
            const latestEndpoint = resolveBackendEndpoint('/api/internal/state');
            if (!latestEndpoint.url) return;
            const latestRes = await fetch(latestEndpoint.url, {
              headers: latestEndpoint.headers,
              credentials: 'include'
            });
            if (!latestRes.ok || cancelled) return;
            const latestStore = (await latestRes.json()) as {
              revision: number;
              data: Partial<ReturnType<typeof buildCurrentSnapshot>>;
            };
            if (latestStore.revision > lastKnownRevisionRef.current) {
              updateSyncMeta({
                revision: latestStore.revision,
                lastSyncAt: new Date().toISOString(),
                lastSyncError: null
              });
              applyServerData(latestStore.data);
            }
          }
        } catch {
          // ignore keepalive/event parse errors
        }
      };
    };

    const initSync = async () => {
      try {
        const endpoint = resolveBackendEndpoint('/api/internal/state');
        if (!endpoint.url) {
          serverSyncInitializedRef.current = true;
          return;
        }

        const localSnap = buildCurrentSnapshot();
        const localJson = JSON.stringify(localSnap);
        if (!lastTrackedMutationJsonRef.current) {
          lastTrackedMutationJsonRef.current = localJson;
        }

        // Falls aus einer Offline-Phase ungesendete Änderungen ausstehen, diese zuerst übertragen (inkl. Server-Merge)
        if (pendingSyncCountRef.current > 0) {
          const flushed = await pushSnapshotToServer(
            localSnap,
            localJson,
            'Nachsynchronisation ausstehender Offline-Änderungen'
          );
          if (flushed) {
            serverSyncInitializedRef.current = true;
            connectEventStream();
            return;
          }
        }

        const res = await fetch(endpoint.url, {
          headers: endpoint.headers,
          credentials: 'include'
        });
        if (!res.ok) {
          serverSyncInitializedRef.current = true;
          return;
        }
        const store = (await res.json()) as {
          revision: number;
          data: Partial<ReturnType<typeof buildCurrentSnapshot>>;
        };
        if (cancelled) return;

        const hasLocalData =
          localSnap.customers.length > 0 ||
          localSnap.properties.length > 0 ||
          localSnap.appointments.length > 0 ||
          localSnap.workRecords.length > 0 ||
          localSnap.invoices.length > 0 ||
          localSnap.orders.length > 0 ||
          localSnap.equipments.length > 0 ||
          localSnap.materials.length > 0 ||
          localSnap.expenses.length > 0;

        if (store.revision === 0 && hasLocalData) {
          updateSyncMeta({ pendingSyncCount: Math.max(1, pendingSyncCountRef.current) });
          await pushSnapshotToServer(localSnap, localJson, 'Initiale Synchronisation aus App');
        } else if (store.revision > 0 && store.data && pendingSyncCountRef.current === 0) {
          updateSyncMeta({
            revision: store.revision,
            online: true,
            lastSyncAt: new Date().toISOString(),
            lastSyncError: null
          });
          applyServerData(store.data);
        } else {
          lastSyncedSnapshotJsonRef.current = localJson;
          lastTrackedMutationJsonRef.current = localJson;
          updateSyncMeta({
            revision: store.revision,
            online: true,
            lastSyncAt: new Date().toISOString(),
            lastSyncError: null
          });
        }

        serverSyncInitializedRef.current = true;
        connectEventStream();
      } catch {
        updateSyncMeta({
          online: typeof navigator !== 'undefined' ? navigator.onLine : false
        });
        serverSyncInitializedRef.current = true;
      }
    };

    const handleBrowserOnline = () => {
      updateSyncMeta({ online: true });
      void initSync();
    };

    const handleBrowserOffline = () => {
      updateSyncMeta({
        online: false,
        lastSyncError:
          pendingSyncCountRef.current > 0
            ? 'Offline – Synchronisation wartet auf Verbindung'
            : null
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        eventSource?.close();
        eventSource = null;
      } else {
        void initSync();
      }
    };

    void initSync();
    window.addEventListener('online', handleBrowserOnline);
    window.addEventListener('offline', handleBrowserOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener('online', handleBrowserOnline);
      window.removeEventListener('offline', handleBrowserOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      eventSource?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const snap = buildCurrentSnapshot();
    const snapJson = JSON.stringify(snap);

    if (isNativeAndroidApp()) {
      if (!nativeHydratedRef.current) return;
      if (snapJson === lastNativeSavedJsonRef.current) return;
      lastNativeSavedJsonRef.current = snapJson;
      saveNativeStoreJson(snapJson);
      return;
    }

    if (!serverSyncInitializedRef.current) return;
    if (snapJson === lastSyncedSnapshotJsonRef.current) return;

    if (snapJson !== lastTrackedMutationJsonRef.current) {
      lastTrackedMutationJsonRef.current = snapJson;
      updateSyncMeta({
        pendingSyncCount: pendingSyncCountRef.current + 1
      });
    }

    const timer = setTimeout(() => {
      void pushSnapshotToServer(snap, snapJson, 'Änderung in App');
    }, 180);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    customers,
    properties,
    appointments,
    workRecords,
    invoices,
    inquiries,
    offers,
    orders,
    equipments,
    materials,
    expenses,
    taxSettings
  ]);

  // Navigation handlers
  const canGoBack = returnStack.length > 0;

  const switchMainTab = (screen: ScreenId) => {
    setReturnStack([]);
    setCustomerWorkViewOpen(false);
    setCustomerTermineViewOpen(false);
    if (screen === 'M03_KUNDEN') {
      setSelectedCustomerIdState(null);
      setCustomerTab('objekte');
    }
    if (screen === 'M04_ABRECHNUNG') {
      setSelectedInvoiceId(null);
    }
    setScreenHistory([screen]);
    setCurrentScreen(screen);
    setIsPlusMenuOpen(false);
    setIsThreeDotsMenuOpen(false);
  };

  const navigate = (screen: ScreenId) => {
    if (screen !== currentScreen) {
      setReturnStack(prev => [
        ...prev,
        {
          screen: currentScreen,
          customerId: selectedCustomerId,
          customerTab,
          customerWorkViewOpen,
          customerTermineViewOpen,
          invoiceId: selectedInvoiceId
        }
      ]);
      setScreenHistory(prev => [...prev, screen]);
    }
    setCurrentScreen(screen);
    setIsPlusMenuOpen(false);
    setIsThreeDotsMenuOpen(false);
  };

  const goBack = () => {
    if (
      currentScreen === 'M03_KUNDEN' &&
      selectedCustomerId &&
      (customerWorkViewOpen || customerTermineViewOpen)
    ) {
      setCustomerWorkViewOpen(false);
      setCustomerTermineViewOpen(false);
      return;
    }
    if (returnStack.length > 0) {
      const entry = returnStack[returnStack.length - 1];
      setReturnStack(prev => prev.slice(0, -1));
      setScreenHistory(prev => (prev.length > 1 ? prev.slice(0, -1) : [entry.screen]));
      setSelectedCustomerIdState(entry.customerId);
      setCustomerTab(entry.customerTab);
      setCustomerWorkViewOpen(Boolean(entry.customerWorkViewOpen));
      setCustomerTermineViewOpen(Boolean(entry.customerTermineViewOpen));
      setSelectedInvoiceId(entry.invoiceId);
      setCurrentScreen(entry.screen);
      return;
    }
    if (currentScreen === 'M03_KUNDEN' && selectedCustomerId) {
      setSelectedCustomerIdState(null);
      setCustomerTab('objekte');
      setCustomerWorkViewOpen(false);
      setCustomerTermineViewOpen(false);
      return;
    }
    if (currentScreen === 'M04_ABRECHNUNG' && selectedInvoiceId) {
      setSelectedInvoiceId(null);
      return;
    }
    switchMainTab('M01_HEUTE');
  };

  // Pixel 10 Pro Android Zurück-Funktion (Edge-Swipe, Predictive Back, Browser/PWA popstate & Escape)
  const canSystemGoBack = Boolean(
    localBackLayers.length > 0 ||
      sendingInvoiceId ||
      activeModal ||
      isPlusMenuOpen ||
      isThreeDotsMenuOpen ||
      isSearchOpen ||
      returnStack.length > 0 ||
      (currentScreen === 'M03_KUNDEN' && selectedCustomerId) ||
      (currentScreen === 'M04_ABRECHNUNG' && selectedInvoiceId) ||
      currentScreen !== 'M01_HEUTE'
  );

  const triggerSystemBack = (): boolean => {
    if (localBackLayers.length > 0) {
      const topLayer = localBackLayers[localBackLayers.length - 1];
      topLayer.onBackRef.current();
      return true;
    }
    if (sendingInvoiceId) {
      setSendingInvoiceId(null);
      return true;
    }
    if (activeModal) {
      setActiveModal(null);
      return true;
    }
    if (isSearchOpen) {
      setIsSearchOpen(false);
      return true;
    }
    if (isPlusMenuOpen) {
      setIsPlusMenuOpen(false);
      return true;
    }
    if (isThreeDotsMenuOpen) {
      setIsThreeDotsMenuOpen(false);
      return true;
    }
    if (
      returnStack.length > 0 ||
      (currentScreen === 'M03_KUNDEN' && selectedCustomerId) ||
      (currentScreen === 'M04_ABRECHNUNG' && selectedInvoiceId) ||
      currentScreen !== 'M01_HEUTE'
    ) {
      goBack();
      return true;
    }
    return false;
  };

  const canSystemGoBackRef = useRef(canSystemGoBack);
  const triggerSystemBackRef = useRef<() => boolean>(triggerSystemBack);
  const historyGuardPushedRef = useRef(false);
  const ignoringProgrammaticBackRef = useRef(false);

  useEffect(() => {
    canSystemGoBackRef.current = canSystemGoBack;
    triggerSystemBackRef.current = triggerSystemBack;
  });

  // Synchronisiere aktiven In-App-Back-Status mit Kotlin OnBackPressedDispatcher (Android 16 Predictive Back)
  useEffect(() => {
    syncNativeCanGoBack(canSystemGoBack);
  }, [canSystemGoBack]);

  // Browser / Mobile Chrome / PWA History-Guard (popstate)
  useEffect(() => {
    if (isNativeAndroidApp()) return;

    if (canSystemGoBack && !historyGuardPushedRef.current) {
      window.history.pushState({ eisbaerInternalBack: true }, '');
      historyGuardPushedRef.current = true;
    } else if (!canSystemGoBack && historyGuardPushedRef.current) {
      historyGuardPushedRef.current = false;
      if (window.history.state?.eisbaerInternalBack === true) {
        ignoringProgrammaticBackRef.current = true;
        window.history.back();
      }
    }
  }, [canSystemGoBack, popStateTick]);

  useEffect(() => {
    const handlePopState = () => {
      if (ignoringProgrammaticBackRef.current) {
        ignoringProgrammaticBackRef.current = false;
        return;
      }
      historyGuardPushedRef.current = false;
      if (canSystemGoBackRef.current) {
        triggerSystemBackRef.current();
        setPopStateTick((n) => n + 1);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && canSystemGoBackRef.current) {
        e.preventDefault();
        triggerSystemBackRef.current();
      }
    };

    if (!isNativeAndroidApp()) {
      window.addEventListener('popstate', handlePopState);
    }
    window.addEventListener('keydown', handleKeyDown);

    const unregisterNativeBack = registerNativeBackHandler(() => {
      return triggerSystemBackRef.current();
    });

    return () => {
      if (!isNativeAndroidApp()) {
        window.removeEventListener('popstate', handlePopState);
      }
      window.removeEventListener('keydown', handleKeyDown);
      unregisterNativeBack();
    };
  }, []);

  // CRUD Implementations
  const addAppointment = (app: Partial<Appointment>): Appointment => {
    const newApp: Appointment = {
      id: `app-${Date.now()}`,
      title: app.title?.trim() || 'Termin', // Optional title -> default 'Termin' per REQ-013
      date: app.date || '2026-11-10',
      start_time: app.start_time !== undefined ? app.start_time : null,
      end_time: app.end_time !== undefined ? app.end_time : null,
      duration_minutes: app.duration_minutes || null,
      customer_id: app.customer_id || null,
      property_id: app.property_id || null,
      address: app.address || null,
      notes: app.notes || '',
      tour_order: appointments.filter(a => a.date === (app.date || '2026-11-10')).length + 1
    };
    setAppointments(prev => [...prev, newApp]);
    return newApp;
  };

  const updateAppointment = (id: string, updated: Partial<Appointment>) => {
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, ...updated } : a));
  };

  const deleteAppointment = (id: string) => {
    setAppointments(prev => prev.filter(a => a.id !== id));
  };

  const addCustomer = (cust: Partial<Customer>): Customer => {
    const newCust: Customer = {
      id: cust.id || `c-${Date.now()}`,
      name: cust.name?.trim() || 'Neuer Kunde',
      company: cust.company || '',
      phone: cust.phone || '',
      email: cust.email || '',
      street: cust.street || '',
      city: cust.city || '',
      zip: cust.zip || '',
      notes: cust.notes || '',
      active: cust.active ?? true,
      electronic_invoice_consent: cust.electronic_invoice_consent ?? false,
      electronic_invoice_consent_date: cust.electronic_invoice_consent ? (cust.electronic_invoice_consent_date || '2026-11-10') : null,
      default_billing_customer_id: cust.default_billing_customer_id || null,
      billing_mode: cust.billing_mode || 'standard',
      garden_area: cust.garden_area || null,
      created_at: cust.created_at || new Date().toISOString(),
      updated_at: cust.updated_at || new Date().toISOString()
    };
    setCustomers(prev => [...prev, newCust]);
    return newCust;
  };

  const updateCustomer = (id: string, cust: Partial<Customer>) => {
    const existing = customers.find(c => c.id === id);
    const nextMode = cust.billing_mode ?? existing?.billing_mode ?? 'standard';
    const nextBillingCustId =
      nextMode === 'divergent_recipient'
        ? (cust.default_billing_customer_id !== undefined
            ? cust.default_billing_customer_id
            : existing?.default_billing_customer_id ?? null)
        : null;

    setCustomers(prev =>
      prev.map(c =>
        c.id === id
          ? {
              ...c,
              ...cust,
              billing_mode: nextMode,
              default_billing_customer_id: nextBillingCustId,
              updated_at: new Date().toISOString()
            }
          : c
      )
    );

    // Offene (noch nicht abgerechnete) Arbeitsaufzeichnungen dieses Kunden synchronisieren
    if (cust.billing_mode !== undefined || cust.default_billing_customer_id !== undefined) {
      setWorkRecords(prev =>
        prev.map(w =>
          w.customer_id === id && !w.settlement_id
            ? { ...w, billing_customer_id: nextBillingCustId }
            : w
        )
      );
    }

    if (cust.name?.trim()) {
      const nextName = cust.name.trim();
      setInvoices(prev =>
        prev.map(inv => (inv.customer_id === id ? { ...inv, billing_customer_name: nextName } : inv))
      );
    }
  };

  const deleteCustomer = (id: string) => {
    const target = customers.find(c => c.id === id);
    if (!target) return;

    const prevCustomers = [...customers];
    const prevProps = [...properties];
    const prevApps = [...appointments];
    const prevWorks = [...workRecords];
    const prevInquiries = [...inquiries];
    const prevOffers = [...offers];
    const prevOrders = [...orders];

    const deletedPropIds = new Set(
      properties.filter(p => p.customer_id === id).map(p => p.id)
    );

    setCustomers(prev =>
      prev
        .filter(c => c.id !== id)
        .map(c =>
          c.default_billing_customer_id === id
            ? { ...c, billing_mode: 'standard', default_billing_customer_id: null }
            : c
        )
    );
    setProperties(prev => prev.filter(p => p.customer_id !== id));
    setAppointments(prev =>
      prev
        .filter(a => a.customer_id !== id)
        .map(a =>
          a.property_id && deletedPropIds.has(a.property_id)
            ? { ...a, property_id: null }
            : a
        )
    );
    // Nicht abgerechnete Arbeiten des Kunden entfernen; bereits abgerechnete Arbeiten für Belegintegrität behalten
    setWorkRecords(prev =>
      prev
        .filter(w => !(w.customer_id === id && !w.settlement_id))
        .map(w => ({
          ...w,
          billing_customer_id: w.billing_customer_id === id ? null : w.billing_customer_id,
          property_id:
            w.property_id && deletedPropIds.has(w.property_id) ? null : w.property_id
        }))
    );
    setInquiries(prev => prev.filter(i => i.customer_id !== id));
    setOffers(prev => prev.filter(o => o.customer_id !== id));
    setOrders(prev => prev.filter(o => o.customer_id !== id));

    if (selectedCustomerId === id) {
      setSelectedCustomerId(null);
    }
    if (selectedPropertyId && deletedPropIds.has(selectedPropertyId)) {
      setSelectedPropertyId(null);
    }

    setUndoToast({
      visible: true,
      message: `Kunde „${target.name}“ gelöscht`,
      actionLabel: 'Rückgängig',
      onUndo: () => {
        setCustomers(prevCustomers);
        setProperties(prevProps);
        setAppointments(prevApps);
        setWorkRecords(prevWorks);
        setInquiries(prevInquiries);
        setOffers(prevOffers);
        setOrders(prevOrders);
      }
    });
  };

  const addOrder = (order: Partial<Order>): Order => {
    const newOrder: Order = {
      id: order.id || `ord-${Date.now()}`,
      order_id: order.order_id,
      customer_id: order.customer_id || (customers[0]?.id ?? ''),
      billing_customer_id: order.billing_customer_id || null,
      property_id: order.property_id || null,
      offer_id: order.offer_id || null,
      inquiry_id: order.inquiry_id || null,
      title: order.title?.trim() || 'Neuer Auftrag',
      status: order.status || 'geplant',
      customer_visible: order.customer_visible ?? true,
      notes: order.notes || '',
      scheduled_date: order.scheduled_date || null,
      planned_hours: order.planned_hours || null,
      estimated_amount: order.estimated_amount || null,
      accounting_amount: order.accounting_amount || null,
      created_at: order.created_at || new Date().toISOString(),
      updated_at: order.updated_at || new Date().toISOString()
    };
    setOrders(prev => [newOrder, ...prev]);
    return newOrder;
  };

  const updateOrder = (id: string, order: Partial<Order>) => {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, ...order, updated_at: new Date().toISOString() } : o));
  };

  const updateOrdersStatusBatch = (ids: string[], status: Order['status']) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const nowIso = new Date().toISOString();
    setOrders(prev =>
      prev.map(o => (idSet.has(o.id) ? { ...o, status, updated_at: nowIso } : o))
    );
  };

  const deleteOrder = (id: string) => {
    setOrders(prev => prev.filter(o => o.id !== id));
  };

  const deleteOrdersBatch = (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const snapshot = [...orders];
    const removedCount = orders.filter(o => idSet.has(o.id)).length;
    if (removedCount === 0) return;

    setOrders(prev => prev.filter(o => !idSet.has(o.id)));
    setUndoToast({
      visible: true,
      message: `${removedCount} ${removedCount === 1 ? 'Auftrag' : 'Aufträge'} gelöscht`,
      actionLabel: 'Rückgängig',
      onUndo: () => {
        setOrders(snapshot);
      }
    });
  };

  const addProperty = (prop: Partial<CustomerProperty>): CustomerProperty => {
    const nowIso = new Date().toISOString();
    const newProp: CustomerProperty = {
      id: prop.id || `p-${Date.now()}`,
      customer_id: prop.customer_id || selectedCustomerId || (customers[0]?.id ?? ''),
      name: prop.name?.trim() || 'Hausgarten',
      property_type: prop.property_type || 'Hausgarten',
      address: prop.address?.trim() || '',
      area_sqm: prop.area_sqm !== undefined ? prop.area_sqm : null,
      hedge_length_m: prop.hedge_length_m !== undefined ? prop.hedge_length_m : null,
      access_info: prop.access_info?.trim() || '',
      features: prop.features || [],
      photos: prop.photos || [],
      notes: prop.notes?.trim() || '',
      created_at: prop.created_at || nowIso.slice(0, 10),
      updated_at: nowIso
    };
    setProperties(prev => [...prev, newProp]);
    return newProp;
  };

  const updateProperty = (id: string, prop: Partial<CustomerProperty>) => {
    setProperties(prev =>
      prev.map(p =>
        p.id === id
          ? { ...p, ...prop, updated_at: new Date().toISOString() }
          : p
      )
    );
  };

  const deleteProperty = (id: string) => {
    const target = properties.find(p => p.id === id);
    if (!target) return;
    const prevProps = [...properties];
    const prevWorks = [...workRecords];
    const prevApps = [...appointments];
    const prevOrders = [...orders];

    setProperties(prev => prev.filter(p => p.id !== id));
    setWorkRecords(prev => prev.map(w => (w.property_id === id ? { ...w, property_id: null } : w)));
    setAppointments(prev => prev.map(a => (a.property_id === id ? { ...a, property_id: null } : a)));
    setOrders(prev => prev.map(o => (o.property_id === id ? { ...o, property_id: null } : o)));
    if (selectedPropertyId === id) {
      setSelectedPropertyId(null);
    }

    setUndoToast({
      visible: true,
      message: `Objekt „${target.name}“ gelöscht`,
      actionLabel: 'Rückgängig',
      onUndo: () => {
        setProperties(prevProps);
        setWorkRecords(prevWorks);
        setAppointments(prevApps);
        setOrders(prevOrders);
      }
    });
  };

  const addWorkRecord = (work: Partial<WorkRecord>): WorkRecord => {
    const hours = work.hours !== undefined ? work.hours : 9;
    const rate = work.hourly_rate !== undefined ? work.hourly_rate : 50;
    const mats = work.materials || [];
    const matCost =
      work.material_cost !== undefined
        ? work.material_cost
        : mats.some((m) => m.total !== null)
          ? Math.round(mats.reduce((s, m) => s + (m.total || 0), 0) * 100) / 100
          : null;
    const accounting_amount =
      work.accounting_amount !== undefined
        ? work.accounting_amount
        : hours !== null && rate !== null
          ? Math.round((hours * rate + (matCost || 0)) * 100) / 100
          : null;
    const resolvedCustId = work.customer_id || (customers[0]?.id ?? '');
    const workCust = customers.find(c => c.id === resolvedCustId);
    const autoBillingCustId =
      workCust?.billing_mode === 'divergent_recipient' && workCust.default_billing_customer_id
        ? workCust.default_billing_customer_id
        : null;

    const newRec: WorkRecord = {
      id: work.id || `w-${Date.now()}`,
      work_record_id: work.work_record_id,
      work_date: work.work_date || '2026-11-10',
      title: work.title?.trim() || 'Gartenarbeit',
      customer_id: resolvedCustId,
      billing_customer_id:
        work.billing_customer_id !== undefined ? work.billing_customer_id : autoBillingCustId,
      property_id: work.property_id || null,
      order_id: work.order_id || null,
      appointment_id: work.appointment_id || null,
      session_id: work.session_id || null,
      hours: hours,
      start_time: work.start_time || '07:00',
      end_time: work.end_time || '17:00',
      break_minutes: work.break_minutes !== undefined ? work.break_minutes : 60,
      hourly_rate: rate,
      accounting_amount: accounting_amount,
      material_cost: matCost,
      disposal_cost: work.disposal_cost || null,
      billable: work.billable ?? true,
      is_lcr: work.is_lcr || false,
      settlement_id: null,
      customer_visible: work.customer_visible ?? true,
      notes: work.notes || '',
      materials: mats,
      photos: work.photos || [],
      created_at: work.created_at || new Date().toISOString(),
      updated_at: work.updated_at || new Date().toISOString()
    };
    setWorkRecords(prev => [newRec, ...prev]);
    return newRec;
  };

  const updateWorkRecord = (id: string, work: Partial<WorkRecord>) => {
    const nextRecords = workRecords.map(w => {
      if (w.id === id) {
        const hours = work.hours !== undefined ? work.hours : w.hours;
        const rate = work.hourly_rate !== undefined ? work.hourly_rate : w.hourly_rate;
        const mats = work.materials !== undefined ? work.materials : w.materials;
        const matCost =
          work.material_cost !== undefined
            ? work.material_cost
            : mats && mats.some((m) => m.total !== null)
              ? Math.round(mats.reduce((s, m) => s + (m.total || 0), 0) * 100) / 100
              : null;
        const accounting_amount =
          hours !== null && rate !== null
            ? Math.round((hours * rate + (matCost || 0)) * 100) / 100
            : null;
        return {
          ...w,
          ...work,
          materials: mats,
          material_cost: matCost,
          hourly_rate: rate,
          accounting_amount,
          updated_at: new Date().toISOString()
        };
      }
      return w;
    });

    setWorkRecords(nextRecords);

    const edited = nextRecords.find(w => w.id === id);
    if (edited?.settlement_id) {
      const sid = edited.settlement_id;
      setInvoices(prev =>
        prev.map(inv => {
          if (inv.id !== sid || inv.is_storno) return inv;
          const boundSum = Math.round(
            nextRecords
              .filter(r => r.settlement_id === sid)
              .reduce((s, r) => s + (r.accounting_amount || 0), 0) * 100
          ) / 100;
          const paidSum = Math.round(inv.payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
          const nextStatus =
            inv.status === 'cancelled'
              ? 'cancelled'
              : paidSum >= boundSum && boundSum > 0
                ? 'paid'
                : paidSum > 0
                  ? 'partially_paid'
                  : 'unpaid';
          return { ...inv, total_amount: boundSum, status: nextStatus };
        })
      );
    }
  };

  const deleteWorkRecord = (id: string) => {
    setWorkRecords(prev => prev.filter(w => w.id !== id));
    setInvoices(prev =>
      prev.map(inv =>
        inv.work_record_ids.includes(id)
          ? { ...inv, work_record_ids: inv.work_record_ids.filter(wid => wid !== id) }
          : inv
      )
    );
  };

  const deleteWorkRecordsBatch = (ids: string[]) => {
    const deletableIds = ids.filter(id => {
      const rec = workRecords.find(w => w.id === id);
      return rec && !rec.settlement_id;
    });
    if (deletableIds.length === 0) return;
    const idSet = new Set(deletableIds);
    const snapshot = [...workRecords];

    setWorkRecords(prev => prev.filter(w => !idSet.has(w.id)));
    setUndoToast({
      visible: true,
      message: `${deletableIds.length} ${deletableIds.length === 1 ? 'Aufzeichnung' : 'Aufzeichnungen'} gelöscht`,
      actionLabel: 'Rückgängig',
      onUndo: () => {
        setWorkRecords(snapshot);
      }
    });
  };

  const setLcrWorkRecordsBatch = (ids: string[], lcrState: boolean): number => {
    const idSet = new Set(ids);
    let changed = 0;
    setWorkRecords(prev =>
      prev.map(w => {
        if (idSet.has(w.id) && !w.settlement_id && w.is_lcr !== lcrState) {
          changed++;
          return { ...w, is_lcr: lcrState };
        }
        return w;
      })
    );
    return changed;
  };

  // Toggle L.C.R. on a work record (REQ-015/016/017):
  // Can only be switched if the work is UNBOUND (not attached to an issued invoice).
  const toggleLcrWorkRecord = (id: string): { success: boolean; reason?: string } => {
    const record = workRecords.find(w => w.id === id);
    if (!record) return { success: false, reason: 'Datensatz nicht gefunden' };
    if (record.settlement_id) {
      return {
        success: false,
        reason: 'Gesperrt: Diese Arbeit ist fest an eine ausgestellte Rechnung gebunden. Stornierung nötig.'
      };
    }
    const nextState = !record.is_lcr;
    setWorkRecords(prev => prev.map(w => w.id === id ? { ...w, is_lcr: nextState } : w));
    return { success: true };
  };

  // Billing & Invoices (Design: Michael Hafner - Grünraum Handwerk, RE-75/2026)
  const createInvoiceFromRecords = (
    customerId: string,
    recordIds: string[],
    options?: {
      extraItems?: InvoiceLineItem[];
      issueDate?: string;
      servicePeriod?: string;
      invoiceNumber?: string;
      dueDays?: number;
      customerNumber?: string;
      paymentTermsText?: string;
      paidInCash?: boolean;
    }
  ): Invoice => {
    const selectedRecords = workRecords.filter(w => recordIds.includes(w.id));
    const cust = customers.find(c => c.id === customerId);
    const issueDate = options?.issueDate || getTodayLocalIso();
    const paidInCash = Boolean(options?.paidInCash);
    const dueDays = paidInCash ? 0 : (options?.dueDays ?? 14);
    const dueDate = addDaysIso(issueDate, dueDays);

    const lineItems = buildLineItemsFromRecords(selectedRecords, options?.extraItems || [], {
      billingCustomerId: customerId,
      customers,
      properties
    });
    const total = Math.round(lineItems.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;

    const autoInvoiceNum = computeNextInvoiceNumber(invoices, issueDate).formatted;
    const invoiceNum = options?.invoiceNumber?.trim() || autoInvoiceNum;

    const servicePeriod =
      options?.servicePeriod?.trim() || computeServicePeriod(selectedRecords, issueDate);

    const paymentTermsText =
      options?.paymentTermsText?.trim() || buildPaymentTermsClause(dueDays, paidInCash);

    const initialPayments: PaymentItem[] =
      paidInCash && total > 0
        ? [
            {
              id: `pay-cash-${Date.now()}`,
              date: issueDate,
              amount: total,
              is_reversal: false,
              reversal_of: null,
              note: 'Barzahlung bei Rechnungslegung'
            }
          ]
        : [];

    const newInvoice: Invoice = {
      id: `inv-${Date.now()}`,
      invoice_number: invoiceNum,
      customer_id: customerId,
      customer_number: options?.customerNumber?.trim() || undefined,
      billing_customer_name: cust?.name || 'Kunde',
      recipient_street: cust?.street || '',
      recipient_zip: cust?.zip || '',
      recipient_city: cust?.city || '',
      service_period: servicePeriod,
      line_items: lineItems,
      issue_date: issueDate,
      due_date: dueDate,
      payment_terms_text: paymentTermsText,
      paid_in_cash: paidInCash,
      total_amount: total,
      status: paidInCash && total > 0 ? 'paid' : 'unpaid',
      work_record_ids: recordIds,
      is_storno: false,
      storno_reference_id: null,
      storno_reason: null,
      payments: initialPayments,
      open_refund_amount: 0,
      sent_at: null,
      sent_via: null
    };

    // Bind records to settlement_id
    setWorkRecords(prev => prev.map(w => recordIds.includes(w.id) ? { ...w, settlement_id: newInvoice.id } : w));
    setInvoices(prev => [newInvoice, ...prev]);
    return newInvoice;
  };

  const updateInvoice = (invoiceId: string, patch: Partial<Invoice>) => {
    const existing = invoices.find(i => i.id === invoiceId);
    if (!existing) return;

    const nextCustomerId = patch.customer_id ?? existing.customer_id;
    const cust = customers.find(c => c.id === nextCustomerId);
    const nextBillingName =
      patch.billing_customer_name !== undefined
        ? patch.billing_customer_name
        : patch.customer_id && cust
          ? cust.name
          : existing.billing_customer_name;

    const nextTotal =
      patch.total_amount !== undefined
        ? Math.round(patch.total_amount * 100) / 100
        : existing.total_amount;

    let nextPayments = patch.payments !== undefined ? patch.payments : [...existing.payments];
    let nextStatus = patch.status ?? existing.status;

    if (!existing.is_storno) {
      const currentPaid = nextPayments.reduce((s, p) => s + p.amount, 0);

      if (patch.status === 'paid' && currentPaid < nextTotal) {
        const diff = Math.round((nextTotal - currentPaid) * 100) / 100;
        nextPayments = [
          ...nextPayments,
          {
            id: `pay-${Date.now()}`,
            date: patch.issue_date || existing.issue_date || '2026-11-10',
            amount: diff,
            is_reversal: false,
            reversal_of: null,
            note: 'Zahlung erfasst (Bearbeitung)'
          }
        ];
      } else if (patch.status === 'unpaid' && existing.status !== 'unpaid') {
        nextPayments = [];
      } else if (patch.status === undefined && nextStatus !== 'cancelled') {
        nextStatus =
          currentPaid >= nextTotal && nextTotal > 0
            ? 'paid'
            : currentPaid > 0
              ? 'partially_paid'
              : 'unpaid';
      }

      // Synchronisiere Arbeitsaufzeichnungen bei Statuswechsel auf/von Storniert
      if (nextStatus === 'cancelled' && existing.status !== 'cancelled') {
        setWorkRecords(prev =>
          prev.map(w => (w.settlement_id === invoiceId ? { ...w, settlement_id: null } : w))
        );
      } else if (existing.status === 'cancelled' && nextStatus !== 'cancelled') {
        setWorkRecords(prev =>
          prev.map(w =>
            existing.work_record_ids.includes(w.id) && !w.settlement_id && !w.is_lcr
              ? { ...w, settlement_id: invoiceId }
              : w
          )
        );
      }
    }

    const finalPaid = nextPayments.reduce((s, p) => s + p.amount, 0);
    const nextOpenRefund =
      nextStatus === 'cancelled' && !existing.is_storno ? Math.max(0, finalPaid) : 0;

    setInvoices(prev =>
      prev.map(inv =>
        inv.id === invoiceId
          ? {
              ...inv,
              ...patch,
              customer_id: nextCustomerId,
              billing_customer_name: nextBillingName,
              total_amount: nextTotal,
              payments: nextPayments,
              status: nextStatus,
              open_refund_amount:
                patch.open_refund_amount !== undefined ? patch.open_refund_amount : nextOpenRefund
            }
          : inv
      )
    );
  };

  const deleteInvoice = (invoiceId: string) => {
    const target = invoices.find(i => i.id === invoiceId);
    if (!target) return;

    const snapshotInvoices = [...invoices];
    const snapshotWorkRecords = [...workRecords];

    if (selectedInvoiceId === invoiceId) {
      setSelectedInvoiceId(null);
    }

    if (target.is_storno) {
      // Wenn ein Stornobeleg gelöscht wird: Ursprüngliche Rechnung reaktivieren, falls vorhanden
      const origId = target.storno_reference_id;
      const otherStornoExists =
        origId !== null &&
        invoices.some(i => i.id !== invoiceId && i.is_storno && i.storno_reference_id === origId);
      const origInvoice = origId ? invoices.find(i => i.id === origId) : undefined;

      setInvoices(prev =>
        prev
          .filter(i => i.id !== invoiceId)
          .map(i => {
            if (origId && i.id === origId && !otherStornoExists) {
              const paidSum = i.payments.reduce((s, p) => s + p.amount, 0);
              const restoredStatus =
                paidSum >= i.total_amount && i.total_amount > 0
                  ? 'paid'
                  : paidSum > 0
                    ? 'partially_paid'
                    : 'unpaid';
              return {
                ...i,
                status: restoredStatus,
                open_refund_amount: 0
              };
            }
            return i;
          })
      );

      if (origInvoice && !otherStornoExists) {
        setWorkRecords(prev =>
          prev.map(w =>
            origInvoice.work_record_ids.includes(w.id) && !w.settlement_id && !w.is_lcr
              ? { ...w, settlement_id: origInvoice.id }
              : w
          )
        );
      }
    } else {
      // Reguläre Rechnung löschen -> Gebundene Arbeiten sofort wieder freigeben
      setInvoices(prev =>
        prev
          .filter(i => i.id !== invoiceId)
          .map(i => (i.storno_reference_id === invoiceId ? { ...i, storno_reference_id: null } : i))
      );

      setWorkRecords(prev =>
        prev.map(w => (w.settlement_id === invoiceId ? { ...w, settlement_id: null } : w))
      );
    }

    setUndoToast({
      visible: true,
      message: `${target.invoice_number} gelöscht`,
      actionLabel: 'Rückgängig',
      onUndo: () => {
        setInvoices(snapshotInvoices);
        setWorkRecords(snapshotWorkRecords);
      }
    });
  };

  // Pay invoice with 5-second undo (REQ-018, ILL-007, CONS-10)
  const payInvoice = (invoiceId: string, customAmount?: number, customDate?: string) => {
    const targetInvoice = invoices.find(i => i.id === invoiceId);
    if (!targetInvoice) return;

    const remaining = targetInvoice.total_amount - targetInvoice.payments.reduce((s, p) => s + p.amount, 0);
    const amountToPay = customAmount !== undefined ? customAmount : remaining;
    const paymentDate = customDate || '2026-11-10';

    if (customAmount === undefined) {
      // Full payment with 5 seconds undo window
      let cancelled = false;
      const timeoutId = setTimeout(() => {
        if (!cancelled) {
          executePayment(invoiceId, amountToPay, paymentDate, 'Vollständige Zahlung verbucht');
        }
      }, 5000);

      setUndoToast({
        visible: true,
        message: `Zahlung von ${amountToPay.toFixed(2)} € wird vorgemerkt...`,
        actionLabel: 'Rückgängig (5s)',
        onUndo: () => {
          cancelled = true;
          clearTimeout(timeoutId);
          setUndoToast(null);
        }
      });
    } else {
      executePayment(invoiceId, amountToPay, paymentDate, 'Teilzahlung gebucht');
    }
  };

  const executePayment = (invoiceId: string, amount: number, date: string, note: string) => {
    setInvoices(prev => prev.map(inv => {
      if (inv.id === invoiceId) {
        const newPayment: PaymentItem = {
          id: `pay-${Date.now()}`,
          date,
          amount,
          is_reversal: false,
          reversal_of: null,
          note
        };
        const allPayments = [...inv.payments, newPayment];
        const totalPaid = allPayments.reduce((s, p) => s + p.amount, 0);
        const status = totalPaid >= inv.total_amount ? 'paid' : (totalPaid > 0 ? 'partially_paid' : 'unpaid');
        return {
          ...inv,
          payments: allPayments,
          status: status
        };
      }
      return inv;
    }));
  };

  const updatePayment = (invoiceId: string, paymentId: string, patch: Partial<PaymentItem>) => {
    setInvoices(prev =>
      prev.map(inv => {
        if (inv.id !== invoiceId) return inv;
        const updatedPayments = inv.payments.map(p =>
          p.id === paymentId
            ? {
                ...p,
                ...patch,
                amount:
                  patch.amount !== undefined ? Math.round(patch.amount * 100) / 100 : p.amount
              }
            : p
        );
        const totalPaid = Math.round(updatedPayments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
        const nextStatus =
          inv.status === 'cancelled'
            ? 'cancelled'
            : totalPaid >= inv.total_amount && inv.total_amount > 0
              ? 'paid'
              : totalPaid > 0
                ? 'partially_paid'
                : 'unpaid';
        const nextRefund =
          inv.status === 'cancelled' && !inv.is_storno ? Math.max(0, totalPaid) : inv.open_refund_amount;

        return {
          ...inv,
          payments: updatedPayments,
          status: nextStatus,
          open_refund_amount: nextRefund
        };
      })
    );
  };

  const deletePayment = (invoiceId: string, paymentId: string) => {
    const snapshotInvoices = [...invoices];
    setInvoices(prev =>
      prev.map(inv => {
        if (inv.id !== invoiceId) return inv;
        const updatedPayments = inv.payments.filter(p => p.id !== paymentId);
        const totalPaid = Math.round(updatedPayments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
        const nextStatus =
          inv.status === 'cancelled'
            ? 'cancelled'
            : totalPaid >= inv.total_amount && inv.total_amount > 0
              ? 'paid'
              : totalPaid > 0
                ? 'partially_paid'
                : 'unpaid';
        const nextRefund =
          inv.status === 'cancelled' && !inv.is_storno ? Math.max(0, totalPaid) : inv.open_refund_amount;

        return {
          ...inv,
          payments: updatedPayments,
          status: nextStatus,
          open_refund_amount: nextRefund
        };
      })
    );

    setUndoToast({
      visible: true,
      message: 'Zahlungseintrag gelöscht',
      actionLabel: 'Rückgängig',
      onUndo: () => {
        setInvoices(snapshotInvoices);
      }
    });
  };

  // Payment correction / Gegenbuchung (ILL-008)
  const correctPayment = (invoiceId: string, paymentId: string, reason: string) => {
    setInvoices(prev => prev.map(inv => {
      if (inv.id === invoiceId) {
        const origPayment = inv.payments.find(p => p.id === paymentId);
        if (!origPayment) return inv;

        const reversalPayment: PaymentItem = {
          id: `rev-${Date.now()}`,
          date: '2026-11-10',
          amount: -origPayment.amount,
          is_reversal: true,
          reversal_of: origPayment.id,
          note: `Gegenbuchung: ${reason}`
        };

        const updatedPayments = [...inv.payments, reversalPayment];
        const totalPaid = updatedPayments.reduce((s, p) => s + p.amount, 0);
        const status = totalPaid >= inv.total_amount ? 'paid' : (totalPaid > 0 ? 'partially_paid' : 'unpaid');

        return {
          ...inv,
          payments: updatedPayments,
          status
        };
      }
      return inv;
    }));
  };

  // Storno / Rechnungsstorno (ILL-008, ILL-009)
  const stornoInvoice = (invoiceId: string, reason: string): Invoice => {
    const orig = invoices.find(i => i.id === invoiceId);
    if (!orig) throw new Error('Rechnung nicht gefunden');

    const totalPaid = orig.payments.reduce((s, p) => s + p.amount, 0);

    const existingStornoNums = invoices
      .filter(i => i.is_storno)
      .map(i => {
        const m = i.invoice_number.match(/S(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      });
    const nextStornoSeq = (existingStornoNums.length > 0 ? Math.max(...existingStornoNums) : 0) + 1;
    const stornoNum = `RE-S${String(nextStornoSeq).padStart(2, '0')}/2026`;

    const stornoItems = orig.line_items?.map(li => ({
      ...li,
      id: `storno-${li.id}`,
      amount: -Math.abs(li.amount)
    }));

    const stornoDoc: Invoice = {
      id: `storno-${Date.now()}`,
      invoice_number: stornoNum,
      customer_id: orig.customer_id,
      billing_customer_name: orig.billing_customer_name,
      recipient_street: orig.recipient_street,
      recipient_zip: orig.recipient_zip,
      recipient_city: orig.recipient_city,
      service_period: orig.service_period,
      line_items: stornoItems,
      issue_date: '2026-11-11',
      due_date: '2026-11-11',
      total_amount: -orig.total_amount,
      status: 'cancelled',
      work_record_ids: orig.work_record_ids,
      is_storno: true,
      storno_reference_id: orig.id,
      storno_reason: reason,
      payments: [],
      open_refund_amount: totalPaid > 0 ? totalPaid : 0,
      sent_at: null,
      sent_via: null
    };

    // Mark original invoice as cancelled; if paid, set open_refund_amount
    setInvoices(prev => [
      stornoDoc,
      ...prev.map(i => i.id === invoiceId ? {
        ...i,
        status: 'cancelled' as const,
        open_refund_amount: totalPaid
      } : i)
    ]);

    // Unbind work records so they become open again (unless L.C.R.)
    setWorkRecords(prev => prev.map(w => orig.work_record_ids.includes(w.id) ? { ...w, settlement_id: null } : w));

    return stornoDoc;
  };

  // Record refund for paid cancelled invoice (ILL-009)
  const recordRefund = (invoiceId: string, amount: number, note: string) => {
    setInvoices(prev => prev.map(inv => {
      if (inv.id === invoiceId || inv.storno_reference_id === invoiceId) {
        const remainingRefund = Math.max(0, inv.open_refund_amount - amount);
        const refundPayment: PaymentItem = {
          id: `ref-${Date.now()}`,
          date: '2026-11-10',
          amount: -amount,
          is_reversal: false,
          reversal_of: null,
          note: `Tatsächliche Rückzahlung: ${note}`
        };
        return {
          ...inv,
          open_refund_amount: remainingRefund,
          payments: [...inv.payments, refundPayment]
        };
      }
      return inv;
    }));
  };

  // Equipment & Zubehör
  const addEquipment = (eq: Partial<Equipment> & { name: string }): Equipment => {
    const itemType = eq.item_type || 'geraet';
    const newEq: Equipment = {
      id: eq.id || `eq-${Date.now()}`,
      item_type: itemType,
      category: eq.category || (itemType === 'zubehoer' ? 'zub_kette_schiene' : 'motorsaegen'),
      parent_equipment_id: eq.parent_equipment_id || null,
      name: eq.name.trim(),
      model: eq.model || '',
      photo: eq.photo || null,
      specs: eq.specs || {},
      quantity: eq.quantity !== undefined ? eq.quantity : itemType === 'zubehoer' ? 1 : null,
      notes: eq.notes || '',
      status: eq.status || 'einsatzbereit',
      last_maintenance: eq.last_maintenance || '2026-11-10',
      next_maintenance: eq.next_maintenance || '2027-05-10',
      maintenance_plan:
        eq.maintenance_plan !== undefined
          ? eq.maintenance_plan
          : itemType === 'zubehoer'
            ? ''
            : 'Regelmäßige Prüfung',
      interval_months: eq.interval_months || 6,
      history: eq.history || []
    };
    setEquipments(prev => [newEq, ...prev]);
    return newEq;
  };

  const updateEquipment = (id: string, patch: Partial<Equipment>) => {
    setEquipments(prev =>
      prev.map(eq => (eq.id === id ? { ...eq, ...patch } : eq))
    );
  };

  const deleteEquipment = (id: string) => {
    const target = equipments.find(eq => eq.id === id);
    if (!target) return;
    const prevSnapshot = [...equipments];

    setEquipments(prev =>
      prev
        .filter(eq => eq.id !== id)
        .map(eq =>
          eq.parent_equipment_id === id ? { ...eq, parent_equipment_id: null } : eq
        )
    );
    if (selectedEquipmentId === id) {
      setSelectedEquipmentId(null);
    }

    const typeLabel = target.item_type === 'zubehoer' ? 'Zubehör' : 'Gerät';
    setUndoToast({
      visible: true,
      message: `${typeLabel} „${target.name}“ gelöscht`,
      actionLabel: 'Rückgängig',
      onUndo: () => {
        setEquipments(prevSnapshot);
      }
    });
  };

  const recordMaintenance = (equipmentId: string, plan: string, note: string, nextDate: string) => {
    setEquipments(prev => prev.map(eq => {
      if (eq.id === equipmentId) {
        return {
          ...eq,
          status: 'einsatzbereit',
          last_maintenance: '2026-11-10',
          next_maintenance: nextDate,
          maintenance_plan: plan,
          history: [{ date: '2026-11-10', note, plan }, ...eq.history]
        };
      }
      return eq;
    }));
  };

  const addMaterial = (mat: Partial<Material>): Material => {
    const newMat: Material = {
      id: mat.id || `mat-${Date.now()}`,
      entry_id: mat.entry_id,
      name: mat.name?.trim() || 'Neues Material',
      unit: mat.unit || 'Stück',
      price_per_unit: mat.price_per_unit !== undefined ? mat.price_per_unit : null,
      cost_price_per_unit: mat.cost_price_per_unit || null,
      category: mat.category || 'Allgemein',
      item_number: mat.item_number || '',
      notes: mat.notes || '',
      active: mat.active ?? true,
      created_at: mat.created_at || new Date().toISOString(),
      updated_at: mat.updated_at || new Date().toISOString()
    };
    setMaterials(prev => [...prev, newMat]);
    return newMat;
  };

  const updateMaterial = (id: string, mat: Partial<Material>) => {
    setMaterials(prev => prev.map(m => m.id === id ? { ...m, ...mat, updated_at: new Date().toISOString() } : m));
  };

  const addExpense = (exp: Omit<BusinessExpense, 'id'> & { id?: string }): BusinessExpense => {
    const newExp: BusinessExpense = {
      id: exp.id || `exp-${Date.now()}`,
      date: exp.date || `${taxSettings.selected_year}-11-10`,
      title: exp.title.trim() || 'Betriebsausgabe',
      amount: Math.max(0, Math.round(exp.amount * 100) / 100),
      category: exp.category || 'sonstiges',
      useful_life_years: exp.useful_life_years ?? null,
      notes: exp.notes?.trim() || ''
    };
    setExpenses(prev => [newExp, ...prev]);
    return newExp;
  };

  const updateExpense = (id: string, patch: Partial<BusinessExpense>) => {
    setExpenses(prev =>
      prev.map(e =>
        e.id === id
          ? {
              ...e,
              ...patch,
              amount:
                patch.amount !== undefined
                  ? Math.max(0, Math.round(patch.amount * 100) / 100)
                  : e.amount
            }
          : e
      )
    );
  };

  const deleteExpense = (id: string) => {
    const target = expenses.find(e => e.id === id);
    if (!target) return;
    const snapshot = [...expenses];
    setExpenses(prev => prev.filter(e => e.id !== id));

    setUndoToast({
      visible: true,
      message: `Ausgabe „${target.title}“ gelöscht`,
      actionLabel: 'Rückgängig',
      onUndo: () => {
        setExpenses(snapshot);
      }
    });
  };

  const updateTaxSettings = (patch: Partial<TaxSettings>) => {
    setTaxSettings(prev => ({ ...prev, ...patch }));
  };

  // Backup & Restore (REQ-020 bis REQ-022, M12 – echt verifiziertes ZIP über Kotlin SAF auf Pixel 10 Pro)
  const performBackup = async (forcePickTarget = false): Promise<boolean> => {
    const nowIso = new Date().toISOString();
    const backupData = {
      version: '1.0.2',
      date: nowIso,
      customers,
      properties,
      appointments,
      workRecords,
      invoices,
      equipments,
      materials,
      inquiries,
      offers,
      orders,
      expenses,
      taxSettings
    };
    const jsonPayload = JSON.stringify(backupData);
    localStorage.setItem('hausgarten_backup_file', jsonPayload);

    if (isNativeAndroidApp()) {
      try {
        const res = await runNativeVerifiedBackup(jsonPayload, forcePickTarget);
        const verifiedTime = res.isoTimestamp || nowIso;
        setLastBackupDate(verifiedTime);
        localStorage.setItem(`${STORAGE_KEY}_lastBackupDate`, verifiedTime);
        return Boolean(res.ok);
      } catch {
        return false;
      }
    }

    setLastBackupDate(nowIso);
    localStorage.setItem(`${STORAGE_KEY}_lastBackupDate`, nowIso);
    return true;
  };

  const restoreBackup = async (pickExternalFile = false): Promise<boolean> => {
    try {
      let rawBackup: string | null = null;
      if (isNativeAndroidApp()) {
        rawBackup = await restoreNativeVerifiedBackup(pickExternalFile);
      } else {
        rawBackup = localStorage.getItem('hausgarten_backup_file');
      }
      if (!rawBackup) return false;

      const data = JSON.parse(rawBackup);
      if (data.customers) setCustomers(data.customers);
      if (data.properties) setProperties(data.properties);
      if (data.appointments) setAppointments(data.appointments);
      if (data.workRecords) setWorkRecords(data.workRecords);
      if (data.invoices) setInvoices(data.invoices);
      if (data.equipments) setEquipments(data.equipments);
      if (data.materials) setMaterials(data.materials);
      if (data.inquiries) setInquiries(data.inquiries);
      if (data.offers) setOffers(data.offers);
      if (data.orders) setOrders(data.orders);
      if (data.expenses) setExpenses(data.expenses);
      if (data.taxSettings) setTaxSettings({ ...defaultTaxSettings, ...data.taxSettings });
      return true;
    } catch {
      return false;
    }
  };

  return (
    <AppContext.Provider
      value={{
        currentScreen,
        setCurrentScreen,
        screenHistory,
        canGoBack,
        canSystemGoBack,
        navigate,
        switchMainTab,
        goBack,
        triggerSystemBack,
        registerLocalBackLayer,
        selectedCustomerId,
        setSelectedCustomerId,
        customerTab,
        setCustomerTab,
        customerWorkViewOpen,
        setCustomerWorkViewOpen,
        customerTermineViewOpen,
        setCustomerTermineViewOpen,
        selectedPropertyId,
        setSelectedPropertyId,
        selectedInvoiceId,
        setSelectedInvoiceId,
        selectedWorkRecordId,
        setSelectedWorkRecordId,
        selectedEquipmentId,
        setSelectedEquipmentId,
        sendingInvoiceId,
        setSendingInvoiceId,
        preselectedWorkRecordIds,
        setPreselectedWorkRecordIds,
        prefilledWorkTitle,
        setPrefilledWorkTitle,
        isPlusMenuOpen,
        setIsPlusMenuOpen,
        isThreeDotsMenuOpen,
        setIsThreeDotsMenuOpen,
        isSearchOpen,
        setIsSearchOpen,
        activeModal,
        setActiveModal,
        customers,
        properties,
        appointments,
        workRecords,
        invoices,
        inquiries,
        offers,
        orders,
        equipments,
        materials,
        expenses,
        taxSettings,
        undoToast,
        setUndoToast,
        addAppointment,
        updateAppointment,
        deleteAppointment,
        addCustomer,
        updateCustomer,
        deleteCustomer,
        addProperty,
        updateProperty,
        deleteProperty,
        addWorkRecord,
        updateWorkRecord,
        deleteWorkRecord,
        deleteWorkRecordsBatch,
        toggleLcrWorkRecord,
        setLcrWorkRecordsBatch,
        createInvoiceFromRecords,
        updateInvoice,
        deleteInvoice,
        payInvoice,
        updatePayment,
        deletePayment,
        correctPayment,
        stornoInvoice,
        recordRefund,
        addOrder,
        updateOrder,
        updateOrdersStatusBatch,
        deleteOrder,
        deleteOrdersBatch,
        addEquipment,
        updateEquipment,
        deleteEquipment,
        recordMaintenance,
        addMaterial,
        updateMaterial,
        addExpense,
        updateExpense,
        deleteExpense,
        updateTaxSettings,
        lastBackupDate,
        performBackup,
        restoreBackup,
        pixelFrameEnabled,
        setPixelFrameEnabled,
        appSyncStatus,
        flushPendingAppSync
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

/**
 * Registriert einen lokalen Dialog / Lightbox / Auswahlmodus auf dem Pixel 10 Pro Zurück-Stack (LIFO).
 * Solange `isActive === true`, schließt die Android-Zurück-Geste zuerst diese Ebene.
 */
export function usePixelBackLayer(isActive: boolean, onBack: () => void): void {
  const { registerLocalBackLayer } = useApp();
  const idRef = useRef(`back_${Math.random().toString(36).slice(2, 10)}`);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!isActive) return;
    return registerLocalBackLayer(idRef.current, onBackRef);
  }, [isActive, registerLocalBackLayer]);
}
