import crypto from 'node:crypto';
import {
  hydrateStoreFromCloudOrDisk,
  persistStoreToDiskAndCloud,
  readLocalJsonSync
} from './cloudPersistence.ts';
import type {
  Appointment,
  BusinessExpense,
  Customer,
  CustomerProperty,
  Equipment,
  ExpenseCategory,
  Inquiry,
  Invoice,
  InvoiceLineItem,
  Material,
  Offer,
  OfferItem,
  Order,
  PaymentItem,
  TaxCalculationMethod,
  TaxSettings,
  UsedMaterial,
  WorkRecord
} from '../types/index.ts';
import {
  addDaysIso,
  buildLineItemsFromRecords,
  buildPaymentTermsClause,
  computeNextInvoiceNumber,
  computeServicePeriod,
  getEffectiveBillingCustomerId,
  getTodayLocalIso,
  resolveCustomerNumber,
  resolveInvoiceDisplayData
} from '../utils/invoicePdf.ts';
import { calculateGuvSummary } from '../utils/guvCalculator.ts';
import {
  findDayConflictingAppointmentIds,
  parseAppointmentTime,
  suggestNextFreeAppointmentSlot
} from '../utils/appointmentConflict.ts';

export const COLLECTION_NAMES = [
  'customers',
  'properties',
  'appointments',
  'workRecords',
  'invoices',
  'inquiries',
  'offers',
  'orders',
  'equipments',
  'materials',
  'expenses'
] as const;

export type CollectionName = (typeof COLLECTION_NAMES)[number];

export interface AppDataSnapshot {
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
}

export interface PersistedAppStore {
  revision: number;
  updatedAt: string;
  lastActor: 'android' | 'web' | 'app' | 'mcp' | 'init';
  lastActionSummary: string;
  lastAndroidSyncAt: string | null;
  data: AppDataSnapshot;
}

export interface McpConfig {
  adminToken: string;
  requireToken: true;
  tokenSource: 'env' | 'file';
  createdAt: string;
  lastAccessAt: string | null;
  lastOperation: string | null;
  totalCalls: number;
}

const STORE_KEY = 'app_state';
const STORE_FILENAME = 'app-state.json';
const CONFIG_KEY = 'mcp_config';
const CONFIG_FILENAME = 'mcp-config.json';

const DEFAULT_TAX_SETTINGS: TaxSettings = {
  selected_year: 2026,
  preferred_method: 'auto_best',
  svs_paid: 0,
  workplace_allowance: 0,
  transit_ticket_full: 0,
  manual_extra_income: 0
};

const VALID_EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  'wareneinsatz',
  'treibstoff_kfz',
  'werkzeug_anlage',
  'versicherung_buero',
  'sonstiges'
];

const VALID_TAX_METHODS: readonly TaxCalculationMethod[] = [
  'auto_best',
  'ku_pauschal_45',
  'ku_pauschal_20',
  'basis_pauschal_15',
  'ear_echt'
];

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function generateSecureToken(): string {
  return `hgh_mcp_${crypto.randomBytes(24).toString('hex')}`;
}

function writeSecretConfigFile(cfg: Omit<McpConfig, 'tokenSource'>): void {
  persistStoreToDiskAndCloud(CONFIG_KEY, CONFIG_FILENAME, cfg);
}

function assertIsoDate(dateStr: string, fieldName: string): string {
  const trimmed = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error(`Ungültiges Datumsformat für "${fieldName}": Erwartet YYYY-MM-DD.`);
  }
  return trimmed;
}

function assertOptionalTime(timeVal: unknown, fieldName: string): string | null {
  if (timeVal === null || timeVal === undefined || timeVal === '') return null;
  const s = String(timeVal).trim();
  if (!/^\d{2}:\d{2}$/.test(s) || parseAppointmentTime(s) === null) {
    throw new Error(`Ungültiges Zeitformat für "${fieldName}": Erwartet HH:MM oder null.`);
  }
  return s;
}

function createEmptySnapshot(): AppDataSnapshot {
  return {
    customers: [],
    properties: [],
    appointments: [],
    workRecords: [],
    invoices: [],
    inquiries: [],
    offers: [],
    orders: [],
    equipments: [],
    materials: [],
    expenses: [],
    taxSettings: { ...DEFAULT_TAX_SETTINGS }
  };
}

function normalizeSnapshot(input: Partial<AppDataSnapshot> | undefined | null): AppDataSnapshot {
  const empty = createEmptySnapshot();
  if (!input || typeof input !== 'object') return empty;
  return {
    customers: Array.isArray(input.customers) ? input.customers : [],
    properties: Array.isArray(input.properties) ? input.properties : [],
    appointments: Array.isArray(input.appointments) ? input.appointments : [],
    workRecords: Array.isArray(input.workRecords) ? input.workRecords : [],
    invoices: Array.isArray(input.invoices) ? input.invoices : [],
    inquiries: Array.isArray(input.inquiries) ? input.inquiries : [],
    offers: Array.isArray(input.offers) ? input.offers : [],
    orders: Array.isArray(input.orders) ? input.orders : [],
    equipments: Array.isArray(input.equipments) ? input.equipments : [],
    materials: Array.isArray(input.materials) ? input.materials : [],
    expenses: Array.isArray(input.expenses) ? input.expenses : [],
    taxSettings:
      input.taxSettings && typeof input.taxSettings === 'object'
        ? { ...DEFAULT_TAX_SETTINGS, ...input.taxSettings }
        : { ...DEFAULT_TAX_SETTINGS }
  };
}

let cachedStore: PersistedAppStore | null = null;
let cachedFileConfig: Omit<McpConfig, 'tokenSource'> | null = null;

type StoreChangeListener = (store: PersistedAppStore) => void;
const changeListeners = new Set<StoreChangeListener>();

export function subscribeStoreChanges(listener: StoreChangeListener): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function notifyStoreListeners(store: PersistedAppStore): void {
  for (const fn of changeListeners) {
    try {
      fn(store);
    } catch {
      // ignore individual SSE listener error
    }
  }
}

function normalizePersistedAppStore(raw: Partial<PersistedAppStore> | null | undefined): PersistedAppStore {
  if (!raw || typeof raw !== 'object') {
    return {
      revision: 0,
      updatedAt: new Date().toISOString(),
      lastActor: 'init',
      lastActionSummary: 'Initialisiert',
      lastAndroidSyncAt: null,
      data: createEmptySnapshot()
    };
  }
  const actor: PersistedAppStore['lastActor'] =
    raw.lastActor === 'android' ||
    raw.lastActor === 'web' ||
    raw.lastActor === 'app' ||
    raw.lastActor === 'mcp'
      ? raw.lastActor
      : 'init';
  return {
    revision: typeof raw.revision === 'number' ? raw.revision : 0,
    updatedAt: raw.updatedAt || new Date().toISOString(),
    lastActor: actor,
    lastActionSummary: raw.lastActionSummary || 'Initialisiert',
    lastAndroidSyncAt:
      typeof raw.lastAndroidSyncAt === 'string'
        ? raw.lastAndroidSyncAt
        : actor === 'android'
          ? raw.updatedAt || null
          : null,
    data: normalizeSnapshot(raw.data)
  };
}

function normalizePersistedMcpConfig(
  raw: Partial<McpConfig> | null | undefined
): Omit<McpConfig, 'tokenSource'> {
  return {
    adminToken:
      typeof raw?.adminToken === 'string' && raw.adminToken.trim().length >= 24
        ? raw.adminToken.trim()
        : generateSecureToken(),
    requireToken: true,
    createdAt: raw?.createdAt || new Date().toISOString(),
    lastAccessAt: raw?.lastAccessAt || null,
    lastOperation: raw?.lastOperation || null,
    totalCalls: typeof raw?.totalCalls === 'number' ? raw.totalCalls : 0
  };
}

export async function hydrateAdminEngineStores(): Promise<void> {
  const hydratedStore = await hydrateStoreFromCloudOrDisk<Partial<PersistedAppStore>>(
    STORE_KEY,
    STORE_FILENAME,
    true
  );
  if (hydratedStore) {
    cachedStore = normalizePersistedAppStore(hydratedStore);
  } else {
    cachedStore = normalizePersistedAppStore(null);
    persistStoreToDiskAndCloud(STORE_KEY, STORE_FILENAME, cachedStore);
  }

  const hydratedCfg = await hydrateStoreFromCloudOrDisk<Partial<McpConfig>>(
    CONFIG_KEY,
    CONFIG_FILENAME,
    false
  );
  if (hydratedCfg) {
    cachedFileConfig = normalizePersistedMcpConfig(hydratedCfg);
  } else {
    cachedFileConfig = normalizePersistedMcpConfig(null);
    writeSecretConfigFile(cachedFileConfig);
  }
}

export function getStore(): PersistedAppStore {
  if (cachedStore) return cachedStore;
  const localRaw = readLocalJsonSync<Partial<PersistedAppStore>>(STORE_FILENAME);
  if (localRaw) {
    cachedStore = normalizePersistedAppStore(localRaw);
    return cachedStore;
  }
  cachedStore = normalizePersistedAppStore(null);
  persistStoreToDiskAndCloud(STORE_KEY, STORE_FILENAME, cachedStore);
  return cachedStore;
}

export function saveStore(
  nextData: AppDataSnapshot,
  actor: PersistedAppStore['lastActor'],
  summary: string
): PersistedAppStore {
  const current = getStore();
  const nowIso = new Date().toISOString();
  const updated: PersistedAppStore = {
    revision: current.revision + 1,
    updatedAt: nowIso,
    lastActor: actor,
    lastActionSummary: summary,
    lastAndroidSyncAt: actor === 'android' ? nowIso : current.lastAndroidSyncAt,
    data: normalizeSnapshot(nextData)
  };
  cachedStore = updated;
  persistStoreToDiskAndCloud(STORE_KEY, STORE_FILENAME, updated);
  notifyStoreListeners(updated);
  return updated;
}

function loadOrInitFileConfig(): Omit<McpConfig, 'tokenSource'> {
  if (cachedFileConfig) return cachedFileConfig;
  const localRaw = readLocalJsonSync<Partial<McpConfig>>(CONFIG_FILENAME);
  cachedFileConfig = normalizePersistedMcpConfig(localRaw);
  writeSecretConfigFile(cachedFileConfig);
  return cachedFileConfig;
}

export function getMcpConfig(): McpConfig {
  const fileCfg = loadOrInitFileConfig();
  const envToken = process.env.MCP_ADMIN_TOKEN?.trim();
  const hasEnvToken = Boolean(envToken && envToken.length >= 16);
  return {
    ...fileCfg,
    adminToken: hasEnvToken ? envToken! : fileCfg.adminToken,
    requireToken: true,
    tokenSource: hasEnvToken ? 'env' : 'file'
  };
}

export function rotateMcpToken(): McpConfig {
  const fileCfg = loadOrInitFileConfig();
  const nextFileCfg: Omit<McpConfig, 'tokenSource'> = {
    ...fileCfg,
    adminToken: generateSecureToken(),
    requireToken: true,
    createdAt: new Date().toISOString()
  };
  cachedFileConfig = nextFileCfg;
  writeSecretConfigFile(nextFileCfg);
  return getMcpConfig();
}

export function recordMcpAccess(operation: string): void {
  const fileCfg = loadOrInitFileConfig();
  const safeOp = operation.replace(/hgh_mcp_[a-f0-9]+/gi, '[REDACTED]').slice(0, 120);
  const nextFileCfg: Omit<McpConfig, 'tokenSource'> = {
    ...fileCfg,
    requireToken: true,
    lastAccessAt: new Date().toISOString(),
    lastOperation: safeOp,
    totalCalls: fileCfg.totalCalls + 1
  };
  cachedFileConfig = nextFileCfg;
  writeSecretConfigFile(nextFileCfg);
}

export function isValidAdminToken(candidate: string | undefined | null): boolean {
  const cfg = getMcpConfig();
  if (!candidate || typeof candidate !== 'string') return false;
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  const candidateHash = crypto.createHash('sha256').update(trimmed, 'utf8').digest();
  const expectedHash = crypto.createHash('sha256').update(cfg.adminToken, 'utf8').digest();
  return crypto.timingSafeEqual(candidateHash, expectedHash);
}

export function isCollectionName(name: string): name is CollectionName {
  return (COLLECTION_NAMES as readonly string[]).includes(name);
}

function stripHeavyPhotos<T>(item: T, includePhotos = false): T {
  if (includePhotos || !item || typeof item !== 'object') return item;
  const clone = { ...(item as Record<string, unknown>) };
  if (Array.isArray(clone.photos)) {
    clone.photo_count = clone.photos.length;
    delete clone.photos;
  }
  if (typeof clone.photo === 'string' && clone.photo.startsWith('data:')) {
    clone.has_photo = true;
    delete clone.photo;
  }
  return clone as T;
}

export function getAdminOverview(includeFullSnapshot = false) {
  const store = getStore();
  const { data } = store;
  const today = getTodayLocalIso();

  const openWork = data.workRecords.filter((w) => !w.settlement_id && !w.is_lcr && w.billable);
  const lcrWork = data.workRecords.filter((w) => w.is_lcr && !w.settlement_id);
  const unpaidInvoices = data.invoices.filter(
    (i) => !i.is_storno && (i.status === 'unpaid' || i.status === 'partially_paid')
  );
  const upcomingAppointments = data.appointments
    .filter((a) => a.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.tour_order ?? 0) - (b.tour_order ?? 0));

  const guv = calculateGuvSummary(data.invoices, data.expenses, data.taxSettings);

  return {
    revision: store.revision,
    updatedAt: store.updatedAt,
    lastActor: store.lastActor,
    lastActionSummary: store.lastActionSummary,
    counts: {
      customers: data.customers.length,
      properties: data.properties.length,
      appointments: data.appointments.length,
      upcomingAppointments: upcomingAppointments.length,
      workRecords: data.workRecords.length,
      openWorkRecords: openWork.length,
      lcrWorkRecords: lcrWork.length,
      invoices: data.invoices.length,
      unpaidInvoices: unpaidInvoices.length,
      inquiries: data.inquiries.length,
      offers: data.offers.length,
      orders: data.orders.length,
      equipments: data.equipments.length,
      materials: data.materials.length,
      expenses: data.expenses.length
    },
    totals: {
      openWorkHours: round2(openWork.reduce((s, w) => s + (w.hours || 0), 0)),
      openWorkAmountEur: round2(openWork.reduce((s, w) => s + (w.accounting_amount || 0), 0)),
      lcrHours: round2(lcrWork.reduce((s, w) => s + (w.hours || 0), 0)),
      lcrAmountEur: round2(lcrWork.reduce((s, w) => s + (w.accounting_amount || 0), 0)),
      combinedOpenPlusLcrEur: round2(
        openWork.reduce((s, w) => s + (w.accounting_amount || 0), 0) +
          lcrWork.reduce((s, w) => s + (w.accounting_amount || 0), 0)
      ),
      unpaidInvoicesAmountEur: round2(
        unpaidInvoices.reduce((s, inv) => {
          const paid = inv.payments.reduce((ps, p) => ps + p.amount, 0);
          return s + Math.max(0, inv.total_amount - paid);
        }, 0)
      )
    },
    guvOverview: {
      year: guv.year,
      totalCashIncomeEur: guv.totalCashIncome,
      invoicedIncomeInYearEur: guv.invoicedIncomeInYear,
      openReceivablesTotalEur: guv.openReceivablesTotal,
      kuStatus: guv.kuStatus,
      kuLimitUsedPercent: guv.kuLimitUsedPercent,
      activeMethodKey: guv.activeMethodKey,
      bestMethodKey: guv.bestMethodKey,
      taxableProfitEur: guv.activeResult.taxableProfit,
      estimatedIncomeTaxEur: guv.activeResult.estimatedIncomeTax
    },
    upcomingAppointments: upcomingAppointments.slice(0, 15),
    openWorkPreview: openWork.slice(0, 20).map((w) => stripHeavyPhotos(w, false)),
    unpaidInvoicesPreview: unpaidInvoices.slice(0, 20),
    ...(includeFullSnapshot
      ? {
          snapshot: {
            ...data,
            properties: data.properties.map((p) => stripHeavyPhotos(p, false)),
            workRecords: data.workRecords.map((w) => stripHeavyPhotos(w, false)),
            equipments: data.equipments.map((e) => stripHeavyPhotos(e, false))
          }
        }
      : {})
  };
}

export function queryCollection(params: {
  collection: CollectionName | 'taxSettings' | 'all';
  id?: string;
  customer_id?: string;
  status?: string;
  is_lcr?: boolean;
  unbilled_only?: boolean;
  date_from?: string;
  date_to?: string;
  search?: string;
  limit?: number;
  include_photos?: boolean;
}) {
  const { data, revision } = getStore();
  if (params.collection === 'taxSettings') {
    return {
      revision,
      collection: 'taxSettings',
      data: data.taxSettings,
      guvSummary: calculateGuvSummary(data.invoices, data.expenses, data.taxSettings)
    };
  }

  if (params.collection === 'all') {
    const perCollectionLimit = params.limit && params.limit > 0 ? params.limit : 25;
    const grouped: Record<string, unknown[]> = {};
    let totalMatched = 0;
    for (const col of COLLECTION_NAMES) {
      const sub = queryCollection({
        ...params,
        collection: col,
        limit: perCollectionLimit
      }) as { totalMatched: number; items: unknown[] };
      if (sub.items.length > 0) {
        grouped[col] = sub.items;
        totalMatched += sub.totalMatched;
      }
    }
    return {
      revision,
      collection: 'all',
      totalMatched,
      resultsByCollection: grouped
    };
  }

  let items = [...(data[params.collection] as unknown as Array<Record<string, unknown>>)];

  if (params.id) {
    items = items.filter((item) => String(item.id) === params.id);
  }
  if (params.customer_id) {
    items = items.filter(
      (item) =>
        String(item.customer_id || '') === params.customer_id ||
        String(item.billing_customer_id || '') === params.customer_id ||
        String(item.default_billing_customer_id || '') === params.customer_id ||
        (params.collection === 'workRecords' &&
          getEffectiveBillingCustomerId(item as unknown as WorkRecord, data.customers) ===
            params.customer_id)
    );
  }
  if (params.status) {
    items = items.filter((item) => String(item.status || '') === params.status);
  }
  if (typeof params.is_lcr === 'boolean' && params.collection === 'workRecords') {
    items = items.filter((item) => Boolean(item.is_lcr) === params.is_lcr);
  }
  if (params.unbilled_only && params.collection === 'workRecords') {
    items = items.filter((item) => !item.settlement_id);
  }
  if (params.date_from || params.date_to) {
    items = items.filter((item) => {
      const d = String(
        item.date || item.work_date || item.issue_date || item.desired_date || item.scheduled_date || ''
      );
      if (!d) return false;
      if (params.date_from && d < params.date_from) return false;
      if (params.date_to && d > params.date_to) return false;
      return true;
    });
  }
  if (params.search && params.search.trim()) {
    const q = params.search.trim().toLowerCase();
    items = items.filter((item) => JSON.stringify(stripHeavyPhotos(item, false)).toLowerCase().includes(q));
  }

  const totalMatched = items.length;
  if (params.limit && params.limit > 0) {
    items = items.slice(0, params.limit);
  }

  // Enrich appointments with exact App conflict detection
  if (params.collection === 'appointments') {
    const conflictsByDay = new Map<string, Set<string>>();
    for (const item of items) {
      const day = String(item.date || '');
      if (day && !conflictsByDay.has(day)) {
        const dayApps = data.appointments.filter((a) => a.date === day);
        conflictsByDay.set(day, findDayConflictingAppointmentIds(dayApps));
      }
    }
    items = items.map((item) => ({
      ...item,
      has_time_conflict: conflictsByDay.get(String(item.date || ''))?.has(String(item.id)) ?? false
    }));
  }

  // Enrich single invoice read with exact App PDF display resolution
  if (params.collection === 'invoices' && params.id && items.length === 1) {
    const inv = items[0] as unknown as Invoice;
    return {
      revision,
      collection: 'invoices',
      totalMatched: 1,
      items,
      resolvedDisplay: resolveInvoiceDisplayData(inv, data.customers, data.workRecords)
    };
  }

  return {
    revision,
    collection: params.collection,
    totalMatched,
    items: items.map((i) => stripHeavyPhotos(i, Boolean(params.include_photos)))
  };
}

function mutateUpsertOnSnapshot(
  next: AppDataSnapshot,
  collection: CollectionName,
  payload: Record<string, unknown>
): {
  action: 'created' | 'updated';
  summary: string;
  record: unknown;
  extra?: Record<string, unknown>;
} {
  const nowIso = new Date().toISOString();
  const today = getTodayLocalIso();
  const requestedId = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : '';

  if (collection === 'customers') {
    const existingIdx = requestedId ? next.customers.findIndex((c) => c.id === requestedId) : -1;
    const prev = existingIdx >= 0 ? next.customers[existingIdx] : undefined;
    const id = prev?.id || requestedId || `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const rawName = payload.name !== undefined ? String(payload.name).trim() : prev?.name?.trim();
    if (!rawName) {
      throw new Error('Kundenname ("name") darf nicht leer sein.');
    }

    const billingMode: Customer['billing_mode'] =
      payload.billing_mode === 'divergent_recipient' || payload.billing_mode === 'standard'
        ? payload.billing_mode
        : (prev?.billing_mode ?? 'standard');

    let defaultBillingId: string | null = null;
    if (billingMode === 'divergent_recipient') {
      const candidateId =
        payload.default_billing_customer_id !== undefined
          ? (payload.default_billing_customer_id as string | null)
          : (prev?.default_billing_customer_id ?? null);
      if (candidateId) {
        if (candidateId === id) {
          throw new Error('Abweichender Rechnungsempfänger darf nicht der Kunde selbst sein.');
        }
        if (!next.customers.some((c) => c.id === candidateId)) {
          throw new Error(`Abweichender Rechnungsempfänger "${candidateId}" existiert nicht.`);
        }
        defaultBillingId = candidateId;
      }
    }

    const consent =
      typeof payload.electronic_invoice_consent === 'boolean'
        ? payload.electronic_invoice_consent
        : (prev?.electronic_invoice_consent ?? false);

    const gardenArea =
      payload.garden_area !== undefined
        ? payload.garden_area === null
          ? null
          : Math.max(0, Number(payload.garden_area))
        : (prev?.garden_area ?? null);

    const record: Customer = {
      ...(prev || {}),
      ...(payload as Partial<Customer>),
      id,
      name: rawName,
      company: String(payload.company ?? prev?.company ?? ''),
      phone: String(payload.phone ?? prev?.phone ?? ''),
      email: String(payload.email ?? prev?.email ?? ''),
      street: String(payload.street ?? prev?.street ?? ''),
      city: String(payload.city ?? prev?.city ?? ''),
      zip: String(payload.zip ?? prev?.zip ?? ''),
      notes: String(payload.notes ?? prev?.notes ?? ''),
      active: typeof payload.active === 'boolean' ? payload.active : (prev?.active ?? true),
      electronic_invoice_consent: consent,
      electronic_invoice_consent_date: consent
        ? ((payload.electronic_invoice_consent_date as string | null | undefined) ??
          prev?.electronic_invoice_consent_date ??
          today)
        : null,
      billing_mode: billingMode,
      default_billing_customer_id: defaultBillingId,
      garden_area: Number.isFinite(gardenArea as number) ? gardenArea : null,
      created_at: prev?.created_at || nowIso,
      updated_at: nowIso
    };

    if (existingIdx >= 0) next.customers[existingIdx] = record;
    else next.customers.push(record);

    // Sync open work records billing_customer_id (identical to AppContext.updateCustomer)
    next.workRecords = next.workRecords.map((w) =>
      w.customer_id === id && !w.settlement_id
        ? { ...w, billing_customer_id: defaultBillingId }
        : w
    );

    // Sync billing_customer_name on existing invoices if name changed (identical to AppContext.updateCustomer)
    if (prev && prev.name !== record.name) {
      next.invoices = next.invoices.map((inv) =>
        inv.customer_id === id ? { ...inv, billing_customer_name: record.name } : inv
      );
    }

    return {
      action: existingIdx >= 0 ? 'updated' : 'created',
      summary: `${existingIdx >= 0 ? 'Kunde aktualisiert' : 'Kunde angelegt'}: ${record.name}`,
      record
    };
  }

  if (collection === 'properties') {
    const existingIdx = requestedId ? next.properties.findIndex((p) => p.id === requestedId) : -1;
    const prev = existingIdx >= 0 ? next.properties[existingIdx] : undefined;
    const id = prev?.id || requestedId || `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const customerId = String(payload.customer_id ?? prev?.customer_id ?? '').trim();
    if (!customerId || !next.customers.some((c) => c.id === customerId)) {
      throw new Error('Gültige "customer_id" eines bestehenden Kunden ist für ein Objekt erforderlich.');
    }

    const record: CustomerProperty = {
      ...(prev || {}),
      ...(payload as Partial<CustomerProperty>),
      id,
      customer_id: customerId,
      name: String(payload.name ?? prev?.name ?? 'Hausgarten').trim() || 'Hausgarten',
      property_type: String(payload.property_type ?? prev?.property_type ?? 'Hausgarten'),
      address: String(payload.address ?? prev?.address ?? '').trim(),
      area_sqm:
        payload.area_sqm !== undefined
          ? payload.area_sqm === null
            ? null
            : Number(payload.area_sqm)
          : (prev?.area_sqm ?? null),
      hedge_length_m:
        payload.hedge_length_m !== undefined
          ? payload.hedge_length_m === null
            ? null
            : Number(payload.hedge_length_m)
          : (prev?.hedge_length_m ?? null),
      access_info: String(payload.access_info ?? prev?.access_info ?? '').trim(),
      features: Array.isArray(payload.features)
        ? (payload.features as string[])
        : (prev?.features ?? []),
      photos: Array.isArray(payload.photos)
        ? (payload.photos as string[])
        : (prev?.photos ?? []),
      notes: String(payload.notes ?? prev?.notes ?? '').trim(),
      created_at: prev?.created_at || today,
      updated_at: nowIso
    };
    if (existingIdx >= 0) next.properties[existingIdx] = record;
    else next.properties.push(record);
    return {
      action: existingIdx >= 0 ? 'updated' : 'created',
      summary: `${existingIdx >= 0 ? 'Objekt aktualisiert' : 'Objekt angelegt'}: ${record.name}`,
      record: stripHeavyPhotos(record, false)
    };
  }

  if (collection === 'appointments') {
    const existingIdx = requestedId ? next.appointments.findIndex((a) => a.id === requestedId) : -1;
    const prev = existingIdx >= 0 ? next.appointments[existingIdx] : undefined;
    const id = prev?.id || requestedId || `app-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const date = assertIsoDate(String(payload.date ?? prev?.date ?? today), 'date');
    const startTime =
      payload.start_time !== undefined
        ? assertOptionalTime(payload.start_time, 'start_time')
        : (prev?.start_time ?? null);
    const endTime =
      payload.end_time !== undefined
        ? assertOptionalTime(payload.end_time, 'end_time')
        : (prev?.end_time ?? null);

    const customerId =
      payload.customer_id !== undefined
        ? payload.customer_id
          ? String(payload.customer_id)
          : null
        : (prev?.customer_id ?? null);
    if (customerId && !next.customers.some((c) => c.id === customerId)) {
      throw new Error(`Kunde "${customerId}" existiert nicht.`);
    }

    const propertyId =
      payload.property_id !== undefined
        ? payload.property_id
          ? String(payload.property_id)
          : null
        : (prev?.property_id ?? null);
    if (propertyId && !next.properties.some((p) => p.id === propertyId)) {
      throw new Error(`Objekt "${propertyId}" existiert nicht.`);
    }

    const record: Appointment = {
      ...(prev || {}),
      ...(payload as Partial<Appointment>),
      id,
      title: String(payload.title ?? prev?.title ?? 'Termin').trim() || 'Termin',
      date,
      start_time: startTime,
      end_time: endTime,
      duration_minutes:
        payload.duration_minutes !== undefined
          ? payload.duration_minutes === null
            ? null
            : Number(payload.duration_minutes)
          : (prev?.duration_minutes ?? null),
      customer_id: customerId,
      property_id: propertyId,
      address:
        payload.address !== undefined
          ? payload.address === null
            ? null
            : String(payload.address)
          : (prev?.address ?? null),
      notes: String(payload.notes ?? prev?.notes ?? ''),
      tour_order:
        typeof payload.tour_order === 'number'
          ? payload.tour_order
          : (prev?.tour_order ?? next.appointments.filter((a) => a.date === date).length + 1)
    };
    if (existingIdx >= 0) next.appointments[existingIdx] = record;
    else next.appointments.push(record);

    const dayApps = next.appointments.filter((a) => a.date === date);
    const conflictIds = findDayConflictingAppointmentIds(dayApps);
    const hasConflict = conflictIds.has(id);
    const suggestedSlot = hasConflict
      ? suggestNextFreeAppointmentSlot(
          dayApps.filter((a) => a.id !== id),
          record.duration_minutes || 60,
          Boolean(record.end_time)
        )
      : null;

    return {
      action: existingIdx >= 0 ? 'updated' : 'created',
      summary: `${existingIdx >= 0 ? 'Termin aktualisiert' : 'Termin angelegt'}: ${record.title} (${record.date})`,
      record,
      extra: {
        has_time_conflict: hasConflict,
        ...(suggestedSlot ? { suggested_free_slot: suggestedSlot } : {})
      }
    };
  }

  if (collection === 'workRecords') {
    const existingIdx = requestedId ? next.workRecords.findIndex((w) => w.id === requestedId) : -1;
    const prev = existingIdx >= 0 ? next.workRecords[existingIdx] : undefined;
    const id = prev?.id || requestedId || `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const customerId = String(payload.customer_id ?? prev?.customer_id ?? '').trim();
    if (!customerId || !next.customers.some((c) => c.id === customerId)) {
      throw new Error('Gültige "customer_id" eines bestehenden Kunden ist für eine Arbeitsaufzeichnung erforderlich.');
    }

    // Enforce App L.C.R. lock rule (REQ-015/016/017)
    if (
      prev?.settlement_id &&
      typeof payload.is_lcr === 'boolean' &&
      payload.is_lcr !== prev.is_lcr
    ) {
      throw new Error(
        'Gesperrt: Diese Arbeit ist fest an eine ausgestellte Rechnung gebunden. Stornierung nötig.'
      );
    }

    const workDate = assertIsoDate(String(payload.work_date ?? prev?.work_date ?? today), 'work_date');
    const cust = next.customers.find((c) => c.id === customerId);
    const autoBillingId =
      cust?.billing_mode === 'divergent_recipient' && cust.default_billing_customer_id
        ? cust.default_billing_customer_id
        : null;

    const hours =
      payload.hours !== undefined ? Math.max(0, Number(payload.hours)) : (prev?.hours ?? 8);
    if (!Number.isFinite(hours)) {
      throw new Error('Ungültige Stundenanzahl ("hours").');
    }

    const hourlyRate =
      payload.hourly_rate !== undefined
        ? payload.hourly_rate === null
          ? null
          : Number(payload.hourly_rate)
        : (prev?.hourly_rate !== undefined ? prev.hourly_rate : 50);

    const rawMaterials: UsedMaterial[] = Array.isArray(payload.materials)
      ? (payload.materials as UsedMaterial[]).map((m, idx) => {
          const qty = Number(m.quantity ?? 1);
          const ppu =
            m.price_per_unit === null || m.price_per_unit === undefined
              ? null
              : Number(m.price_per_unit);
          const tot =
            m.total !== undefined && m.total !== null
              ? round2(Number(m.total))
              : ppu !== null
                ? round2(qty * ppu)
                : null;
          return {
            material_id: String(m.material_id || `mat-used-${idx}`),
            name: String(m.name || 'Material'),
            quantity: qty,
            unit: String(m.unit || 'Stück'),
            price_per_unit: ppu,
            total: tot
          };
        })
      : (prev?.materials ?? []);

    // Exact App calculation from AppContext.addWorkRecord / updateWorkRecord
    const materialCost =
      payload.material_cost !== undefined
        ? payload.material_cost === null
          ? null
          : round2(Number(payload.material_cost))
        : rawMaterials.some((m) => m.total !== null)
          ? round2(rawMaterials.reduce((s, m) => s + (m.total || 0), 0))
          : null;

    const accountingAmount =
      payload.accounting_amount !== undefined && existingIdx < 0
        ? payload.accounting_amount === null
          ? null
          : round2(Number(payload.accounting_amount))
        : hourlyRate !== null
          ? round2(hours * hourlyRate + (materialCost || 0))
          : null;

    const nextIsLcr = prev?.settlement_id
      ? prev.is_lcr
      : typeof payload.is_lcr === 'boolean'
        ? payload.is_lcr
        : (prev?.is_lcr ?? false);

    const record: WorkRecord = {
      ...(prev || {}),
      ...(payload as Partial<WorkRecord>),
      id,
      work_date: workDate,
      title: String(payload.title ?? prev?.title ?? 'Gartenarbeit').trim() || 'Gartenarbeit',
      customer_id: customerId,
      billing_customer_id:
        payload.billing_customer_id !== undefined
          ? (payload.billing_customer_id as string | null)
          : (prev?.billing_customer_id ?? autoBillingId),
      property_id:
        payload.property_id !== undefined
          ? (payload.property_id as string | null)
          : (prev?.property_id ?? null),
      order_id:
        payload.order_id !== undefined
          ? (payload.order_id as string | null)
          : (prev?.order_id ?? null),
      appointment_id:
        payload.appointment_id !== undefined
          ? (payload.appointment_id as string | null)
          : (prev?.appointment_id ?? null),
      session_id: prev?.session_id ?? null,
      hours,
      start_time: String(payload.start_time ?? prev?.start_time ?? '07:00'),
      end_time: String(payload.end_time ?? prev?.end_time ?? '16:00'),
      break_minutes:
        typeof payload.break_minutes === 'number'
          ? payload.break_minutes
          : (prev?.break_minutes ?? 60),
      hourly_rate: hourlyRate,
      accounting_amount: accountingAmount,
      material_cost: materialCost,
      disposal_cost:
        payload.disposal_cost !== undefined
          ? payload.disposal_cost === null
            ? null
            : round2(Number(payload.disposal_cost))
          : (prev?.disposal_cost ?? null),
      billable: typeof payload.billable === 'boolean' ? payload.billable : (prev?.billable ?? true),
      is_lcr: nextIsLcr,
      settlement_id:
        payload.settlement_id !== undefined
          ? (payload.settlement_id as string | null)
          : (prev?.settlement_id ?? null),
      customer_visible:
        typeof payload.customer_visible === 'boolean'
          ? payload.customer_visible
          : (prev?.customer_visible ?? true),
      notes: String(payload.notes ?? prev?.notes ?? ''),
      materials: rawMaterials,
      photos: Array.isArray(payload.photos)
        ? (payload.photos as string[])
        : (prev?.photos ?? []),
      created_at: prev?.created_at || nowIso,
      updated_at: nowIso
    };

    if (existingIdx >= 0) next.workRecords[existingIdx] = record;
    else next.workRecords.unshift(record);

    // Recalculate bound invoice if editing an already-settled WorkRecord (identical to AppContext.updateWorkRecord)
    if (record.settlement_id) {
      const sid = record.settlement_id;
      next.invoices = next.invoices.map((inv) => {
        if (inv.id !== sid || inv.is_storno) return inv;
        const boundSum = round2(
          next.workRecords
            .filter((r) => r.settlement_id === sid)
            .reduce((s, r) => s + (r.accounting_amount || 0), 0)
        );
        const paidSum = round2(inv.payments.reduce((s, p) => s + p.amount, 0));
        const nextStatus: Invoice['status'] =
          inv.status === 'cancelled'
            ? 'cancelled'
            : paidSum >= boundSum && boundSum > 0
              ? 'paid'
              : paidSum > 0
                ? 'partially_paid'
                : 'unpaid';
        return { ...inv, total_amount: boundSum, status: nextStatus };
      });
    }

    return {
      action: existingIdx >= 0 ? 'updated' : 'created',
      summary: `${existingIdx >= 0 ? 'Arbeit aktualisiert' : 'Arbeit erfasst'}: ${record.title} (${record.hours} Std.)`,
      record: stripHeavyPhotos(record, false)
    };
  }

  if (collection === 'invoices') {
    const existingIdx = requestedId ? next.invoices.findIndex((i) => i.id === requestedId) : -1;
    if (existingIdx >= 0) {
      // Exact AppContext.updateInvoice logic
      const existing = next.invoices[existingIdx];
      const patch = payload as Partial<Invoice>;
      const nextCustomerId = patch.customer_id ?? existing.customer_id;
      const cust = next.customers.find((c) => c.id === nextCustomerId);
      const nextBillingName =
        patch.billing_customer_name !== undefined
          ? patch.billing_customer_name
          : patch.customer_id && cust
            ? cust.name
            : existing.billing_customer_name;

      const nextTotal =
        patch.total_amount !== undefined ? round2(Number(patch.total_amount)) : existing.total_amount;
      let nextPayments = Array.isArray(patch.payments) ? patch.payments : [...existing.payments];
      let nextStatus = patch.status ?? existing.status;

      if (!existing.is_storno) {
        const currentPaid = round2(nextPayments.reduce((s, p) => s + p.amount, 0));
        if (patch.status === 'paid' && currentPaid < nextTotal) {
          const diff = round2(nextTotal - currentPaid);
          nextPayments = [
            ...nextPayments,
            {
              id: `pay-${Date.now()}`,
              date: patch.issue_date || existing.issue_date || today,
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

        if (nextStatus === 'cancelled' && existing.status !== 'cancelled') {
          next.workRecords = next.workRecords.map((w) =>
            w.settlement_id === existing.id ? { ...w, settlement_id: null } : w
          );
        } else if (existing.status === 'cancelled' && nextStatus !== 'cancelled') {
          next.workRecords = next.workRecords.map((w) =>
            existing.work_record_ids.includes(w.id) && !w.settlement_id && !w.is_lcr
              ? { ...w, settlement_id: existing.id }
              : w
          );
        }
      }

      const finalPaid = round2(nextPayments.reduce((s, p) => s + p.amount, 0));
      const nextOpenRefund =
        nextStatus === 'cancelled' && !existing.is_storno ? Math.max(0, finalPaid) : 0;

      const updatedInv: Invoice = {
        ...existing,
        ...patch,
        id: existing.id,
        customer_id: nextCustomerId,
        billing_customer_name: nextBillingName,
        total_amount: nextTotal,
        payments: nextPayments,
        status: nextStatus,
        open_refund_amount:
          patch.open_refund_amount !== undefined ? Number(patch.open_refund_amount) : nextOpenRefund
      };
      next.invoices[existingIdx] = updatedInv;
      return {
        action: 'updated',
        summary: `Rechnung aktualisiert: ${updatedInv.invoice_number}`,
        record: updatedInv
      };
    }

    // Creating a standalone invoice via upsert
    const issueDate = assertIsoDate(String(payload.issue_date || today), 'issue_date');
    const customerId = String(payload.customer_id || '').trim();
    const cust = next.customers.find((c) => c.id === customerId);
    if (!cust) {
      throw new Error('Gültige "customer_id" eines bestehenden Kunden ist für eine Rechnung erforderlich.');
    }
    const dueDate = payload.due_date
      ? assertIsoDate(String(payload.due_date), 'due_date')
      : addDaysIso(issueDate, 14);
    const invNumber =
      typeof payload.invoice_number === 'string' && payload.invoice_number.trim()
        ? payload.invoice_number.trim()
        : computeNextInvoiceNumber(next.invoices, issueDate).formatted;

    const lineItems = Array.isArray(payload.line_items)
      ? (payload.line_items as InvoiceLineItem[])
      : [];
    const totalAmount =
      payload.total_amount !== undefined
        ? round2(Number(payload.total_amount))
        : round2(lineItems.reduce((s, li) => s + Number(li.amount || 0), 0));

    const newInv: Invoice = {
      id: requestedId || `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      invoice_number: invNumber,
      customer_id: cust.id,
      customer_number:
        typeof payload.customer_number === 'string' && payload.customer_number.trim()
          ? payload.customer_number.trim()
          : resolveCustomerNumber(cust.id, next.customers),
      billing_customer_name: String(payload.billing_customer_name || cust.name),
      recipient_street: String(payload.recipient_street ?? cust.street ?? ''),
      recipient_zip: String(payload.recipient_zip ?? cust.zip ?? ''),
      recipient_city: String(payload.recipient_city ?? cust.city ?? ''),
      service_period:
        typeof payload.service_period === 'string'
          ? payload.service_period
          : computeServicePeriod([], issueDate),
      line_items: lineItems,
      issue_date: issueDate,
      due_date: dueDate,
      payment_terms_text:
        typeof payload.payment_terms_text === 'string'
          ? payload.payment_terms_text
          : buildPaymentTermsClause(14, Boolean(payload.paid_in_cash)),
      paid_in_cash: Boolean(payload.paid_in_cash),
      total_amount: totalAmount,
      status: (payload.status as Invoice['status']) || 'unpaid',
      work_record_ids: Array.isArray(payload.work_record_ids)
        ? (payload.work_record_ids as string[])
        : [],
      is_storno: Boolean(payload.is_storno),
      storno_reference_id: (payload.storno_reference_id as string | null) ?? null,
      storno_reason: (payload.storno_reason as string | null) ?? null,
      payments: Array.isArray(payload.payments) ? (payload.payments as PaymentItem[]) : [],
      open_refund_amount: Number(payload.open_refund_amount || 0),
      sent_at: (payload.sent_at as string | null) ?? null,
      sent_via: (payload.sent_via as string | null) ?? null
    };
    next.invoices.unshift(newInv);
    return {
      action: 'created',
      summary: `Rechnung angelegt: ${newInv.invoice_number}`,
      record: newInv
    };
  }

  // Remaining collections: inquiries, offers, orders, equipments, materials, expenses
  const arr = next[collection] as unknown as Array<Record<string, unknown>>;
  const existingIdx = requestedId ? arr.findIndex((item) => item.id === requestedId) : -1;
  const prev = existingIdx >= 0 ? arr[existingIdx] : undefined;
  const prefixMap: Record<CollectionName, string> = {
    customers: 'c',
    properties: 'p',
    appointments: 'app',
    workRecords: 'w',
    invoices: 'inv',
    inquiries: 'inq',
    offers: 'off',
    orders: 'ord',
    equipments: 'eq',
    materials: 'mat',
    expenses: 'exp'
  };
  const id = String(
    prev?.id || requestedId || `${prefixMap[collection]}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );

  const merged: Record<string, unknown> = {
    ...(prev || {}),
    ...payload,
    id
  };

  if (collection === 'orders') {
    const custId = String(merged.customer_id || '').trim();
    if (!custId || !next.customers.some((c) => c.id === custId)) {
      throw new Error('Gültige "customer_id" eines bestehenden Kunden ist für einen Auftrag erforderlich.');
    }
    const status = String(merged.status || 'geplant');
    if (!['geplant', 'in_arbeit', 'erledigt'].includes(status)) {
      throw new Error('Ungültiger Auftragsstatus: Erlaubt sind geplant, in_arbeit, erledigt.');
    }
    merged.customer_id = custId;
    merged.title = String(merged.title || 'Neuer Auftrag').trim() || 'Neuer Auftrag';
    merged.status = status;
    merged.billing_customer_id = merged.billing_customer_id ?? null;
    merged.property_id = merged.property_id ?? null;
    merged.offer_id = merged.offer_id ?? null;
    merged.inquiry_id = merged.inquiry_id ?? null;
    merged.customer_visible = typeof merged.customer_visible === 'boolean' ? merged.customer_visible : true;
    merged.notes = String(merged.notes || '');
    merged.scheduled_date = merged.scheduled_date ? assertIsoDate(String(merged.scheduled_date), 'scheduled_date') : null;
    merged.planned_hours = merged.planned_hours !== undefined && merged.planned_hours !== null ? Number(merged.planned_hours) : null;
    merged.estimated_amount = merged.estimated_amount !== undefined && merged.estimated_amount !== null ? round2(Number(merged.estimated_amount)) : null;
    merged.accounting_amount = merged.accounting_amount !== undefined && merged.accounting_amount !== null ? round2(Number(merged.accounting_amount)) : null;
    merged.created_at = prev?.created_at || nowIso;
    merged.updated_at = nowIso;
  } else if (collection === 'inquiries') {
    const custId = String(merged.customer_id || '').trim();
    if (!custId || !next.customers.some((c) => c.id === custId)) {
      throw new Error('Gültige "customer_id" eines bestehenden Kunden ist für eine Anfrage erforderlich.');
    }
    const status = String(merged.status || 'neu');
    if (!['neu', 'angebot_vorbereitet', 'angenommen'].includes(status)) {
      throw new Error('Ungültiger Anfragestatus: Erlaubt sind neu, angebot_vorbereitet, angenommen.');
    }
    merged.customer_id = custId;
    merged.title = String(merged.title || 'Neue Anfrage').trim() || 'Neue Anfrage';
    merged.desired_date = assertIsoDate(String(merged.desired_date || today), 'desired_date');
    merged.notes = String(merged.notes || '');
    merged.status = status;
  } else if (collection === 'offers') {
    const custId = String(merged.customer_id || '').trim();
    if (!custId || !next.customers.some((c) => c.id === custId)) {
      throw new Error('Gültige "customer_id" eines bestehenden Kunden ist für ein Angebot erforderlich.');
    }
    const status = String(merged.status || 'entwurf');
    if (!['entwurf', 'freigegeben', 'angenommen', 'abgelehnt'].includes(status)) {
      throw new Error('Ungültiger Angebotsstatus: Erlaubt sind entwurf, freigegeben, angenommen, abgelehnt.');
    }
    const items: OfferItem[] = Array.isArray(merged.items)
      ? (merged.items as OfferItem[]).map((it) => {
          const qty = Number(it.quantity ?? 1);
          const price = Number(it.price ?? 0);
          return {
            description: String(it.description || 'Position'),
            quantity: qty,
            unit: String(it.unit || 'pauschal'),
            price,
            total: it.total !== undefined ? round2(Number(it.total)) : round2(qty * price)
          };
        })
      : [];
    merged.customer_id = custId;
    merged.title = String(merged.title || 'Angebot').trim() || 'Angebot';
    merged.items = items;
    merged.total_amount =
      payload.total_amount !== undefined
        ? round2(Number(payload.total_amount))
        : round2(items.reduce((s, i) => s + i.total, 0));
    merged.status = status;
  } else if (collection === 'equipments') {
    const itemType = merged.item_type === 'zubehoer' ? 'zubehoer' : 'geraet';
    const status = String(merged.status || 'einsatzbereit');
    if (!['faellig', 'einsatzbereit', 'wartung'].includes(status)) {
      throw new Error('Ungültiger Gerätestatus: Erlaubt sind faellig, einsatzbereit, wartung.');
    }
    const name = String(merged.name || '').trim();
    if (!name) {
      throw new Error('Gerätename ("name") darf nicht leer sein.');
    }
    merged.item_type = itemType;
    merged.category = merged.category || (itemType === 'zubehoer' ? 'zub_kette_schiene' : 'motorsaegen');
    merged.parent_equipment_id = merged.parent_equipment_id ?? null;
    merged.name = name;
    merged.model = String(merged.model || '');
    merged.photo = merged.photo ?? null;
    merged.specs = merged.specs && typeof merged.specs === 'object' ? merged.specs : {};
    merged.quantity =
      merged.quantity !== undefined
        ? merged.quantity
        : itemType === 'zubehoer'
          ? 1
          : null;
    merged.notes = String(merged.notes || '');
    merged.status = status;
    merged.last_maintenance = assertIsoDate(String(merged.last_maintenance || today), 'last_maintenance');
    merged.next_maintenance = assertIsoDate(
      String(merged.next_maintenance || addDaysIso(today, 180)),
      'next_maintenance'
    );
    merged.maintenance_plan =
      merged.maintenance_plan !== undefined
        ? String(merged.maintenance_plan)
        : itemType === 'zubehoer'
          ? ''
          : 'Regelmäßige Prüfung';
    merged.interval_months = typeof merged.interval_months === 'number' ? merged.interval_months : 6;
    merged.history = Array.isArray(merged.history) ? merged.history : [];
  } else if (collection === 'materials') {
    const name = String(merged.name || '').trim();
    if (!name) {
      throw new Error('Materialname ("name") darf nicht leer sein.');
    }
    merged.name = name;
    merged.unit = String(merged.unit || 'Stück');
    merged.price_per_unit =
      merged.price_per_unit === null || merged.price_per_unit === undefined
        ? null
        : round2(Number(merged.price_per_unit));
    merged.cost_price_per_unit =
      merged.cost_price_per_unit === null || merged.cost_price_per_unit === undefined
        ? null
        : round2(Number(merged.cost_price_per_unit));
    merged.category = String(merged.category || 'Allgemein');
    merged.item_number = String(merged.item_number || '');
    merged.notes = String(merged.notes || '');
    merged.active = typeof merged.active === 'boolean' ? merged.active : true;
    merged.created_at = prev?.created_at || nowIso;
    merged.updated_at = nowIso;
  } else if (collection === 'expenses') {
    const cat = String(merged.category || 'sonstiges') as ExpenseCategory;
    if (!VALID_EXPENSE_CATEGORIES.includes(cat)) {
      throw new Error(
        `Ungültige Ausgabenkategorie "${cat}". Erlaubt: ${VALID_EXPENSE_CATEGORIES.join(', ')}.`
      );
    }
    merged.date = assertIsoDate(String(merged.date || today), 'date');
    merged.title = String(merged.title || 'Betriebsausgabe').trim() || 'Betriebsausgabe';
    merged.amount = Math.max(0, round2(Number(merged.amount || 0)));
    merged.category = cat;
    merged.useful_life_years =
      merged.useful_life_years === null || merged.useful_life_years === undefined
        ? null
        : Math.max(2, Math.min(20, Math.round(Number(merged.useful_life_years))));
    merged.notes = String(merged.notes || '').trim();
  }

  if (existingIdx >= 0) arr[existingIdx] = merged;
  else arr.unshift(merged);

  return {
    action: existingIdx >= 0 ? 'updated' : 'created',
    summary: `${collection}: ${existingIdx >= 0 ? 'aktualisiert' : 'erstellt'} (${id})`,
    record: stripHeavyPhotos(merged, false)
  };
}

export function upsertCollectionRecord(
  collection: CollectionName,
  payload: Record<string, unknown>,
  actor: PersistedAppStore['lastActor'] = 'mcp'
) {
  const store = getStore();
  const next: AppDataSnapshot = structuredClone(store.data);
  const res = mutateUpsertOnSnapshot(next, collection, payload);
  const saved = saveStore(next, actor, res.summary);
  return {
    revision: saved.revision,
    action: res.action,
    record: res.record,
    ...(res.extra || {})
  };
}

function mutateDeleteOnSnapshot(
  next: AppDataSnapshot,
  collection: CollectionName,
  id: string
): { deleted: boolean; reason?: string; summary?: string } {
  const arr = next[collection] as unknown as Array<Record<string, unknown>>;
  const target = arr.find((item) => String(item.id) === id);
  if (!target) {
    return { deleted: false, reason: `Eintrag "${id}" in "${collection}" nicht gefunden.` };
  }

  if (collection === 'workRecords') {
    const wr = target as unknown as WorkRecord;
    if (wr.settlement_id) {
      throw new Error(
        `Gesperrt: Arbeitsaufzeichnung "${id}" ist an Rechnung "${wr.settlement_id}" gebunden. Bitte zuerst die Rechnung stornieren oder löschen.`
      );
    }
  }

  if (collection === 'invoices') {
    // Exact AppContext.deleteInvoice logic (handles both Stornobeleg reactivation & regular invoice release!)
    const targetInv = target as unknown as Invoice;
    if (targetInv.is_storno) {
      const origId = targetInv.storno_reference_id;
      const otherStornoExists =
        origId !== null &&
        next.invoices.some(
          (i) => i.id !== id && i.is_storno && i.storno_reference_id === origId
        );
      const origInvoice = origId ? next.invoices.find((i) => i.id === origId) : undefined;

      next.invoices = next.invoices
        .filter((i) => i.id !== id)
        .map((i) => {
          if (origId && i.id === origId && !otherStornoExists) {
            const paidSum = round2(i.payments.reduce((s, p) => s + p.amount, 0));
            const restoredStatus: Invoice['status'] =
              paidSum >= i.total_amount && i.total_amount > 0
                ? 'paid'
                : paidSum > 0
                  ? 'partially_paid'
                  : 'unpaid';
            return { ...i, status: restoredStatus, open_refund_amount: 0 };
          }
          return i;
        });

      if (origInvoice && !otherStornoExists) {
        next.workRecords = next.workRecords.map((w) =>
          origInvoice.work_record_ids.includes(w.id) && !w.settlement_id && !w.is_lcr
            ? { ...w, settlement_id: origInvoice.id }
            : w
        );
      }
    } else {
      next.invoices = next.invoices
        .filter((i) => i.id !== id)
        .map((i) => (i.storno_reference_id === id ? { ...i, storno_reference_id: null } : i));
      next.workRecords = next.workRecords.map((w) =>
        w.settlement_id === id ? { ...w, settlement_id: null } : w
      );
    }

    return {
      deleted: true,
      summary: `Rechnung ${targetInv.invoice_number} gelöscht`
    };
  }

  (next[collection] as unknown) = arr.filter((item) => String(item.id) !== id);

  if (collection === 'customers') {
    const deletedPropIds = new Set(
      next.properties.filter((p) => p.customer_id === id).map((p) => p.id)
    );
    next.customers = next.customers.map((c) =>
      c.default_billing_customer_id === id
        ? { ...c, billing_mode: 'standard', default_billing_customer_id: null }
        : c
    );
    next.properties = next.properties.filter((p) => p.customer_id !== id);
    next.appointments = next.appointments
      .filter((a) => a.customer_id !== id)
      .map((a) =>
        a.property_id && deletedPropIds.has(a.property_id) ? { ...a, property_id: null } : a
      );
    next.workRecords = next.workRecords
      .filter((w) => !(w.customer_id === id && !w.settlement_id))
      .map((w) => ({
        ...w,
        billing_customer_id: w.billing_customer_id === id ? null : w.billing_customer_id,
        property_id: w.property_id && deletedPropIds.has(w.property_id) ? null : w.property_id
      }));
    next.inquiries = next.inquiries.filter((i) => i.customer_id !== id);
    next.offers = next.offers.filter((o) => o.customer_id !== id);
    next.orders = next.orders.filter((o) => o.customer_id !== id);
  } else if (collection === 'properties') {
    next.workRecords = next.workRecords.map((w) =>
      w.property_id === id ? { ...w, property_id: null } : w
    );
    next.appointments = next.appointments.map((a) =>
      a.property_id === id ? { ...a, property_id: null } : a
    );
    next.orders = next.orders.map((o) =>
      o.property_id === id ? { ...o, property_id: null } : o
    );
  } else if (collection === 'workRecords') {
    next.invoices = next.invoices.map((inv) =>
      inv.work_record_ids.includes(id)
        ? { ...inv, work_record_ids: inv.work_record_ids.filter((wid) => wid !== id) }
        : inv
    );
  } else if (collection === 'equipments') {
    next.equipments = next.equipments.map((eq) =>
      eq.parent_equipment_id === id ? { ...eq, parent_equipment_id: null } : eq
    );
  }

  return {
    deleted: true,
    summary: `${collection}: Eintrag ${id} gelöscht`
  };
}

export function deleteCollectionRecord(
  collection: CollectionName,
  id: string,
  actor: PersistedAppStore['lastActor'] = 'mcp'
) {
  const store = getStore();
  const next: AppDataSnapshot = structuredClone(store.data);
  const res = mutateDeleteOnSnapshot(next, collection, id);
  if (!res.deleted) {
    return { deleted: false, reason: res.reason };
  }
  const saved = saveStore(next, actor, res.summary || `${collection}: Eintrag ${id} gelöscht`);
  return { deleted: true, revision: saved.revision, id, collection };
}

export function toggleLcrAdminAction(
  params: { work_record_ids: string[]; is_lcr?: boolean },
  actor: PersistedAppStore['lastActor'] = 'mcp'
) {
  const store = getStore();
  const next: AppDataSnapshot = structuredClone(store.data);
  const ids = params.work_record_ids.map((x) => String(x).trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new Error('Mindestens eine Arbeitsaufzeichnungs-ID ("work_record_ids") ist erforderlich.');
  }

  const changedIds: string[] = [];
  for (const id of ids) {
    const idx = next.workRecords.findIndex((w) => w.id === id);
    if (idx < 0) {
      throw new Error(`Arbeitsaufzeichnung "${id}" nicht gefunden.`);
    }
    const rec = next.workRecords[idx];
    if (rec.settlement_id) {
      throw new Error(
        `Gesperrt: Arbeit "${rec.title}" (${rec.id}) ist fest an eine ausgestellte Rechnung gebunden. Stornierung nötig.`
      );
    }
    const targetState = typeof params.is_lcr === 'boolean' ? params.is_lcr : !rec.is_lcr;
    if (rec.is_lcr !== targetState) {
      next.workRecords[idx] = {
        ...rec,
        is_lcr: targetState,
        updated_at: new Date().toISOString()
      };
      changedIds.push(id);
    }
  }

  const saved = saveStore(
    next,
    actor,
    `L.C.R.-Status für ${changedIds.length} Arbeitsaufzeichnung(en) aktualisiert`
  );
  return {
    revision: saved.revision,
    changedCount: changedIds.length,
    changedIds,
    records: next.workRecords
      .filter((w) => ids.includes(w.id))
      .map((w) => stripHeavyPhotos(w, false))
  };
}

export function createInvoiceAdminAction(
  params: {
    customer_id: string;
    work_record_ids?: string[];
    extra_items?: InvoiceLineItem[];
    issue_date?: string;
    due_days?: number;
    invoice_number?: string;
    customer_number?: string;
    service_period?: string;
    payment_terms_text?: string;
    paid_in_cash?: boolean;
  },
  actor: PersistedAppStore['lastActor'] = 'mcp'
) {
  const store = getStore();
  const next: AppDataSnapshot = structuredClone(store.data);
  const billingCust = next.customers.find((c) => c.id === params.customer_id);
  if (!billingCust) {
    throw new Error(`Kunde mit ID "${params.customer_id}" nicht gefunden.`);
  }

  let candidateRecords: WorkRecord[] = [];
  if (Array.isArray(params.work_record_ids) && params.work_record_ids.length > 0) {
    for (const wid of params.work_record_ids) {
      const rec = next.workRecords.find((w) => w.id === wid);
      if (!rec) {
        throw new Error(`Arbeitsaufzeichnung "${wid}" nicht gefunden.`);
      }
      if (rec.settlement_id) {
        throw new Error(
          `Arbeitsaufzeichnung "${rec.title}" (${wid}) ist bereits in Rechnung "${rec.settlement_id}" abgerechnet.`
        );
      }
      if (rec.is_lcr) {
        throw new Error(
          `Arbeitsaufzeichnung "${rec.title}" (${wid}) ist als L.C.R. markiert und kann nicht regulär fakturiert werden.`
        );
      }
      if (!rec.billable) {
        throw new Error(
          `Arbeitsaufzeichnung "${rec.title}" (${wid}) ist als nicht abrechenbar ("billable: false") markiert.`
        );
      }
      candidateRecords.push(rec);
    }
  } else {
    candidateRecords = next.workRecords.filter(
      (w) =>
        !w.settlement_id &&
        !w.is_lcr &&
        w.billable &&
        getEffectiveBillingCustomerId(w, next.customers) === params.customer_id
    );
  }

  if (candidateRecords.length === 0 && (!params.extra_items || params.extra_items.length === 0)) {
    throw new Error(
      'Keine offenen abrechenbaren Arbeitsaufzeichnungen oder Zusatzpositionen für diesen Kunden vorhanden.'
    );
  }

  const issueDate = params.issue_date
    ? assertIsoDate(params.issue_date, 'issue_date')
    : getTodayLocalIso();
  const paidInCash = Boolean(params.paid_in_cash);
  const dueDays = paidInCash ? 0 : (params.due_days ?? 14);
  const dueDate = addDaysIso(issueDate, dueDays);

  const normalizedExtras: InvoiceLineItem[] = (params.extra_items || []).map((extra, i) => {
    const amt = round2(Number(extra.amount || 0));
    return {
      id: extra.id || `li-extra-${Date.now()}-${i}`,
      description: String(extra.description || 'Zusatzposition'),
      quantity_label: String(extra.quantity_label || '1,00 Psch'),
      unit_price_label: String(
        extra.unit_price_label ||
          `${amt.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`
      ),
      amount: amt
    };
  });

  // Exact shared App functions from src/utils/invoicePdf.ts
  const lineItems = buildLineItemsFromRecords(candidateRecords, normalizedExtras, {
    billingCustomerId: billingCust.id,
    customers: next.customers,
    properties: next.properties
  });
  const totalAmount = round2(lineItems.reduce((sum, item) => sum + item.amount, 0));
  const invoiceNumber =
    params.invoice_number?.trim() || computeNextInvoiceNumber(next.invoices, issueDate).formatted;
  const servicePeriod =
    params.service_period?.trim() || computeServicePeriod(candidateRecords, issueDate);
  const paymentTermsText =
    params.payment_terms_text?.trim() || buildPaymentTermsClause(dueDays, paidInCash);

  const payments: PaymentItem[] =
    paidInCash && totalAmount > 0
      ? [
          {
            id: `pay-cash-${Date.now()}`,
            date: issueDate,
            amount: totalAmount,
            is_reversal: false,
            reversal_of: null,
            note: 'Barzahlung bei Rechnungslegung'
          }
        ]
      : [];

  const recordIds = candidateRecords.map((r) => r.id);
  const newInvoice: Invoice = {
    id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    invoice_number: invoiceNumber,
    customer_id: billingCust.id,
    customer_number:
      params.customer_number?.trim() || resolveCustomerNumber(billingCust.id, next.customers),
    billing_customer_name: billingCust.name,
    recipient_street: billingCust.street || '',
    recipient_zip: billingCust.zip || '',
    recipient_city: billingCust.city || '',
    service_period: servicePeriod,
    line_items: lineItems,
    issue_date: issueDate,
    due_date: dueDate,
    payment_terms_text: paymentTermsText,
    paid_in_cash: paidInCash,
    total_amount: totalAmount,
    status: paidInCash && totalAmount > 0 ? 'paid' : 'unpaid',
    work_record_ids: recordIds,
    is_storno: false,
    storno_reference_id: null,
    storno_reason: null,
    payments,
    open_refund_amount: 0,
    sent_at: null,
    sent_via: null
  };

  next.workRecords = next.workRecords.map((w) =>
    recordIds.includes(w.id) ? { ...w, settlement_id: newInvoice.id } : w
  );
  next.invoices.unshift(newInvoice);

  const saved = saveStore(
    next,
    actor,
    `Rechnung ${newInvoice.invoice_number} erstellt (${newInvoice.total_amount.toFixed(2)} €)`
  );
  return { revision: saved.revision, invoice: newInvoice };
}

export function payInvoiceAdminAction(
  params: {
    invoice_id: string;
    action?: 'pay' | 'update_payment' | 'reverse_payment' | 'delete_payment' | 'refund';
    amount?: number;
    payment_id?: string;
    date?: string;
    note?: string;
  },
  actor: PersistedAppStore['lastActor'] = 'mcp'
) {
  const store = getStore();
  const next: AppDataSnapshot = structuredClone(store.data);
  const idx = next.invoices.findIndex(
    (i) => i.id === params.invoice_id || i.invoice_number === params.invoice_id
  );
  if (idx < 0) {
    throw new Error(`Rechnung "${params.invoice_id}" nicht gefunden.`);
  }
  const inv = next.invoices[idx];
  const mode = params.action || 'pay';
  const date = params.date ? assertIsoDate(params.date, 'date') : getTodayLocalIso();

  if (mode === 'update_payment') {
    if (!params.payment_id || !inv.payments.some((p) => p.id === params.payment_id)) {
      throw new Error(`Zahlung "${params.payment_id || ''}" in Rechnung ${inv.invoice_number} nicht gefunden.`);
    }
    const updatedPayments = inv.payments.map((p) =>
      p.id === params.payment_id
        ? {
            ...p,
            ...(params.date ? { date } : {}),
            ...(typeof params.amount === 'number' ? { amount: round2(params.amount) } : {}),
            ...(typeof params.note === 'string' ? { note: params.note } : {})
          }
        : p
    );
    const totalPaid = round2(updatedPayments.reduce((s, p) => s + p.amount, 0));
    const status: Invoice['status'] =
      inv.status === 'cancelled'
        ? 'cancelled'
        : totalPaid >= inv.total_amount && inv.total_amount > 0
          ? 'paid'
          : totalPaid > 0
            ? 'partially_paid'
            : 'unpaid';
    const nextRefund =
      inv.status === 'cancelled' && !inv.is_storno ? Math.max(0, totalPaid) : inv.open_refund_amount;
    next.invoices[idx] = {
      ...inv,
      payments: updatedPayments,
      status,
      open_refund_amount: nextRefund
    };
    const saved = saveStore(next, actor, `Zahlungseintrag auf ${inv.invoice_number} geändert`);
    return { revision: saved.revision, invoice: next.invoices[idx] };
  }

  if (mode === 'reverse_payment') {
    // Exact AppContext.correctPayment (Gegenbuchung)
    const origPayment = inv.payments.find((p) => p.id === params.payment_id);
    if (!origPayment) {
      throw new Error(`Zahlung "${params.payment_id || ''}" in Rechnung ${inv.invoice_number} nicht gefunden.`);
    }
    const reversal: PaymentItem = {
      id: `rev-${Date.now()}`,
      date,
      amount: -origPayment.amount,
      is_reversal: true,
      reversal_of: origPayment.id,
      note: `Gegenbuchung: ${params.note || 'Korrektur'}`
    };
    const updatedPayments = [...inv.payments, reversal];
    const totalPaid = round2(updatedPayments.reduce((s, p) => s + p.amount, 0));
    const status: Invoice['status'] =
      inv.status === 'cancelled'
        ? 'cancelled'
        : totalPaid >= inv.total_amount && inv.total_amount > 0
          ? 'paid'
          : totalPaid > 0
            ? 'partially_paid'
            : 'unpaid';
    next.invoices[idx] = { ...inv, payments: updatedPayments, status };
    const saved = saveStore(next, actor, `Gegenbuchung auf ${inv.invoice_number} erfasst`);
    return { revision: saved.revision, invoice: next.invoices[idx] };
  }

  if (mode === 'delete_payment') {
    if (!params.payment_id || !inv.payments.some((p) => p.id === params.payment_id)) {
      throw new Error(`Zahlung "${params.payment_id || ''}" in Rechnung ${inv.invoice_number} nicht gefunden.`);
    }
    const updatedPayments = inv.payments.filter((p) => p.id !== params.payment_id);
    const totalPaid = round2(updatedPayments.reduce((s, p) => s + p.amount, 0));
    const status: Invoice['status'] =
      inv.status === 'cancelled'
        ? 'cancelled'
        : totalPaid >= inv.total_amount && inv.total_amount > 0
          ? 'paid'
          : totalPaid > 0
            ? 'partially_paid'
            : 'unpaid';
    const nextRefund =
      inv.status === 'cancelled' && !inv.is_storno ? Math.max(0, totalPaid) : inv.open_refund_amount;
    next.invoices[idx] = {
      ...inv,
      payments: updatedPayments,
      status,
      open_refund_amount: nextRefund
    };
    const saved = saveStore(next, actor, `Zahlungseintrag auf ${inv.invoice_number} gelöscht`);
    return { revision: saved.revision, invoice: next.invoices[idx] };
  }

  if (mode === 'refund') {
    // Exact AppContext.recordRefund
    const refundAmount = round2(Math.max(0, Number(params.amount ?? inv.open_refund_amount)));
    if (refundAmount <= 0) {
      throw new Error('Rückzahlungsbetrag ("amount") muss größer als 0 sein.');
    }
    const targetOrigId = inv.is_storno && inv.storno_reference_id ? inv.storno_reference_id : inv.id;
    next.invoices = next.invoices.map((candidate) => {
      if (candidate.id === targetOrigId || candidate.storno_reference_id === targetOrigId) {
        const remainingRefund = Math.max(0, round2(candidate.open_refund_amount - refundAmount));
        const refundPayment: PaymentItem = {
          id: `ref-${Date.now()}`,
          date,
          amount: -refundAmount,
          is_reversal: false,
          reversal_of: null,
          note: `Tatsächliche Rückzahlung: ${params.note || 'Erstattung'}`
        };
        return {
          ...candidate,
          open_refund_amount: remainingRefund,
          payments: [...candidate.payments, refundPayment]
        };
      }
      return candidate;
    });
    const saved = saveStore(
      next,
      actor,
      `Rückzahlung ${refundAmount.toFixed(2)} € zu ${inv.invoice_number} erfasst`
    );
    return {
      revision: saved.revision,
      invoice: next.invoices.find((i) => i.id === inv.id)
    };
  }

  // Standard payment ('pay')
  if (inv.is_storno || inv.status === 'cancelled') {
    throw new Error('Auf eine stornierte Rechnung kann keine reguläre Zahlung gebucht werden.');
  }
  const alreadyPaid = round2(inv.payments.reduce((s, p) => s + p.amount, 0));
  const remaining = Math.max(0, round2(inv.total_amount - alreadyPaid));
  const payAmount =
    typeof params.amount === 'number' ? round2(params.amount) : remaining;
  if (payAmount <= 0) {
    throw new Error('Zahlungsbetrag muss größer als 0 EUR sein (oder Rechnung ist bereits vollständig bezahlt).');
  }

  const payment: PaymentItem = {
    id: `pay-${Date.now()}`,
    date,
    amount: payAmount,
    is_reversal: false,
    reversal_of: null,
    note: params.note || 'Zahlung über MCP erfasst'
  };
  const updatedPayments = [...inv.payments, payment];
  const totalPaid = round2(updatedPayments.reduce((s, p) => s + p.amount, 0));
  const status: Invoice['status'] =
    totalPaid >= inv.total_amount && inv.total_amount > 0
      ? 'paid'
      : totalPaid > 0
        ? 'partially_paid'
        : 'unpaid';

  next.invoices[idx] = {
    ...inv,
    payments: updatedPayments,
    status
  };

  const saved = saveStore(
    next,
    actor,
    `Zahlung ${payAmount.toFixed(2)} € auf ${inv.invoice_number} gebucht`
  );
  return { revision: saved.revision, invoice: next.invoices[idx] };
}

export function stornoInvoiceAdminAction(
  params: { invoice_id: string; reason?: string; issue_date?: string },
  actor: PersistedAppStore['lastActor'] = 'mcp'
) {
  // Exact AppContext.stornoInvoice logic
  const store = getStore();
  const next: AppDataSnapshot = structuredClone(store.data);
  const orig = next.invoices.find(
    (i) => i.id === params.invoice_id || i.invoice_number === params.invoice_id
  );
  if (!orig) {
    throw new Error(`Rechnung "${params.invoice_id}" nicht gefunden.`);
  }
  if (orig.is_storno) {
    throw new Error('Ein Stornobeleg kann nicht erneut storniert werden.');
  }
  if (orig.status === 'cancelled') {
    throw new Error(`Rechnung "${orig.invoice_number}" ist bereits storniert.`);
  }

  const issueDate = params.issue_date
    ? assertIsoDate(params.issue_date, 'issue_date')
    : getTodayLocalIso();
  const year = issueDate.slice(0, 4) || '2026';
  const reason = params.reason?.trim() || 'Rechnungskorrektur / Storno';
  const totalPaid = round2(orig.payments.reduce((s, p) => s + p.amount, 0));

  const existingStornoNums = next.invoices
    .filter((i) => i.is_storno)
    .map((i) => {
      const m = i.invoice_number.match(/S(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    });
  const nextStornoSeq = (existingStornoNums.length > 0 ? Math.max(...existingStornoNums) : 0) + 1;
  const stornoNum = `RE-S${String(nextStornoSeq).padStart(2, '0')}/${year}`;

  const stornoItems = orig.line_items?.map((li) => ({
    ...li,
    id: `storno-${li.id}`,
    amount: -Math.abs(li.amount)
  }));

  const stornoDoc: Invoice = {
    id: `storno-${Date.now()}`,
    invoice_number: stornoNum,
    customer_id: orig.customer_id,
    customer_number: orig.customer_number,
    billing_customer_name: orig.billing_customer_name,
    recipient_street: orig.recipient_street,
    recipient_zip: orig.recipient_zip,
    recipient_city: orig.recipient_city,
    service_period: orig.service_period,
    line_items: stornoItems,
    issue_date: issueDate,
    due_date: issueDate,
    total_amount: -Math.abs(orig.total_amount),
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

  next.invoices = [
    stornoDoc,
    ...next.invoices.map((i) =>
      i.id === orig.id
        ? {
            ...i,
            status: 'cancelled' as const,
            open_refund_amount: totalPaid > 0 ? totalPaid : 0
          }
        : i
    )
  ];

  // Unbind work records so they become open again (unless L.C.R.)
  next.workRecords = next.workRecords.map((w) =>
    orig.work_record_ids.includes(w.id) || w.settlement_id === orig.id
      ? { ...w, settlement_id: null }
      : w
  );

  const saved = saveStore(
    next,
    actor,
    `Rechnung ${orig.invoice_number} storniert (${stornoDoc.invoice_number})`
  );
  return {
    revision: saved.revision,
    stornoInvoice: stornoDoc,
    cancelledOriginalId: orig.id
  };
}

export function recordMaintenanceAdminAction(
  params: {
    equipment_id: string;
    plan?: string;
    note?: string;
    date?: string;
    next_maintenance?: string;
  },
  actor: PersistedAppStore['lastActor'] = 'mcp'
) {
  const store = getStore();
  const next: AppDataSnapshot = structuredClone(store.data);
  const idx = next.equipments.findIndex((eq) => eq.id === params.equipment_id);
  if (idx < 0) {
    throw new Error(`Gerät "${params.equipment_id}" nicht gefunden.`);
  }
  const eq = next.equipments[idx];
  const maintDate = params.date ? assertIsoDate(params.date, 'date') : getTodayLocalIso();
  const nextDate = params.next_maintenance
    ? assertIsoDate(params.next_maintenance, 'next_maintenance')
    : addDaysIso(maintDate, (eq.interval_months || 6) * 30);
  const plan = params.plan?.trim() || eq.maintenance_plan || 'Regelmäßige Prüfung';
  const note = params.note?.trim() || 'Wartung durchgeführt';

  next.equipments[idx] = {
    ...eq,
    status: 'einsatzbereit',
    last_maintenance: maintDate,
    next_maintenance: nextDate,
    maintenance_plan: plan,
    history: [{ date: maintDate, note, plan }, ...(eq.history || [])]
  };

  const saved = saveStore(next, actor, `Wartung für Gerät "${eq.name}" dokumentiert`);
  return { revision: saved.revision, equipment: stripHeavyPhotos(next.equipments[idx], false) };
}

export function updateTaxSettingsAdmin(
  patch: Partial<TaxSettings>,
  actor: PersistedAppStore['lastActor'] = 'mcp'
) {
  const store = getStore();
  const next: AppDataSnapshot = structuredClone(store.data);

  if (patch.preferred_method !== undefined && !VALID_TAX_METHODS.includes(patch.preferred_method)) {
    throw new Error(
      `Ungültige Gewinnermittlungsart "${String(patch.preferred_method)}". Erlaubt: ${VALID_TAX_METHODS.join(', ')}.`
    );
  }
  if (
    patch.workplace_allowance !== undefined &&
    ![0, 300, 1200].includes(Number(patch.workplace_allowance))
  ) {
    throw new Error('Arbeitsplatzpauschale ("workplace_allowance") darf nur 0, 300 oder 1200 sein.');
  }

  next.taxSettings = {
    ...next.taxSettings,
    ...(patch.selected_year !== undefined ? { selected_year: Math.round(Number(patch.selected_year)) } : {}),
    ...(patch.preferred_method !== undefined ? { preferred_method: patch.preferred_method } : {}),
    ...(patch.svs_paid !== undefined ? { svs_paid: Math.max(0, round2(Number(patch.svs_paid))) } : {}),
    ...(patch.workplace_allowance !== undefined
      ? { workplace_allowance: Number(patch.workplace_allowance) as 0 | 300 | 1200 }
      : {}),
    ...(patch.transit_ticket_full !== undefined
      ? { transit_ticket_full: Math.max(0, round2(Number(patch.transit_ticket_full))) }
      : {}),
    ...(patch.manual_extra_income !== undefined
      ? { manual_extra_income: Math.max(0, round2(Number(patch.manual_extra_income))) }
      : {})
  };

  const saved = saveStore(next, actor, 'Steuer- & GuV-Einstellungen aktualisiert');
  return {
    revision: saved.revision,
    taxSettings: next.taxSettings,
    guvSummary: calculateGuvSummary(next.invoices, next.expenses, next.taxSettings)
  };
}

export function calculateGuvAdminAction(yearOverride?: number) {
  const store = getStore();
  const settings: TaxSettings =
    typeof yearOverride === 'number' && Number.isFinite(yearOverride)
      ? { ...store.data.taxSettings, selected_year: Math.round(yearOverride) }
      : store.data.taxSettings;
  return {
    revision: store.revision,
    guvSummary: calculateGuvSummary(store.data.invoices, store.data.expenses, settings)
  };
}

export interface BatchOperation {
  op: 'upsert' | 'delete';
  collection: CollectionName;
  id?: string;
  record?: Record<string, unknown>;
}

export function executeBatchAdmin(
  operations: BatchOperation[],
  actor: PersistedAppStore['lastActor'] = 'mcp'
) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('Mindestens eine Operation in "operations" ist erforderlich.');
  }
  const store = getStore();
  const next: AppDataSnapshot = structuredClone(store.data);
  const results: unknown[] = [];

  // Atomic execution on cloned snapshot: if any step throws, nothing is persisted
  for (const item of operations) {
    if (!isCollectionName(item.collection)) {
      throw new Error(`Ungültige Collection: "${String(item.collection)}".`);
    }
    if (item.op === 'delete') {
      const targetId = item.id || String(item.record?.id || '');
      if (!targetId) {
        throw new Error(`Fehlende "id" bei Löschoperation in "${item.collection}".`);
      }
      const delRes = mutateDeleteOnSnapshot(next, item.collection, targetId);
      results.push({ op: 'delete', collection: item.collection, id: targetId, ...delRes });
    } else {
      const payload = { ...(item.record || {}), ...(item.id ? { id: item.id } : {}) };
      const upRes = mutateUpsertOnSnapshot(next, item.collection, payload);
      results.push({
        op: 'upsert',
        collection: item.collection,
        action: upRes.action,
        record: upRes.record,
        ...(upRes.extra || {})
      });
    }
  }

  const saved = saveStore(next, actor, `MCP Batch (${results.length} Operationen) ausgeführt`);
  return {
    revision: saved.revision,
    executedCount: results.length,
    results
  };
}

// ==================== MCP TOOLS DEFINITIONS & EXECUTION ====================

export const MCP_TOOLS = [
  {
    name: 'admin_get_overview',
    description:
      'Liefert die komplette Echtzeit-Betriebsübersicht der App (Kunden, Objekte, anstehende Termine, offene Arbeitsstunden & Beträge, L.C.R.-Summen, offene Rechnungen, aktuelle GuV-/Steuerkennzahlen) und optional den gesamten Datenbestand.',
    annotations: {
      title: 'Betriebsübersicht lesen',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        include_full_snapshot: {
          type: 'boolean',
          description: 'Wenn true, wird zusätzlich der gesamte Datenbestand aller Tabellen zurückgegeben.'
        }
      }
    }
  },
  {
    name: 'admin_read_records',
    description:
      'Liest, filtert und durchsucht Datensätze derselben App-Datenbasis (customers, properties, appointments, workRecords, invoices, inquiries, offers, orders, equipments, materials, expenses, taxSettings). Inklusive Termin-Konfliktprüfung und aufgelöster Rechnungs-Darstellung.',
    annotations: {
      title: 'Datensätze lesen & suchen',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['collection'],
      properties: {
        collection: {
          type: 'string',
          enum: [...COLLECTION_NAMES, 'taxSettings', 'all'],
          description: 'Name der abzufragenden Tabelle / Collection oder "all" für globale Suche über alle Bereiche.'
        },
        id: { type: 'string', description: 'Optionale exakte Datensatz-ID.' },
        customer_id: {
          type: 'string',
          description: 'Optionaler Filter auf eine Kunden-ID (berücksichtigt auch Sub-Abrechnungsempfänger).'
        },
        status: { type: 'string', description: 'Optionaler Status-Filter (z.B. unpaid, paid, geplant).' },
        is_lcr: {
          type: 'boolean',
          description: 'Bei workRecords: Filtert gezielt auf L.C.R.-Einträge (true) oder Nicht-L.C.R. (false).'
        },
        unbilled_only: {
          type: 'boolean',
          description: 'Bei workRecords: Wenn true, nur noch nicht abgerechnete Arbeiten (settlement_id == null).'
        },
        date_from: { type: 'string', description: 'Optionales Startdatum YYYY-MM-DD.' },
        date_to: { type: 'string', description: 'Optionales Enddatum YYYY-MM-DD.' },
        search: { type: 'string', description: 'Freitextsuche über alle Felder.' },
        limit: { type: 'number', description: 'Maximale Anzahl an Ergebnissen.' },
        include_photos: {
          type: 'boolean',
          description: 'Standard false (spart Token). Wenn true, werden Base64-Fotos mitgeliefert.'
        }
      }
    }
  },
  {
    name: 'admin_calculate_guv',
    description:
      'Führt die identische österreichische GuV-, Kleinunternehmer- und Pauschalierungsberechnung der App aus (KU-Pauschale 45 % / 20 %, Basispauschale 15 % + Wareneinsatz, echte E/A-Rechnung inkl. GWG § 13 & Halbjahres-AfA § 7 EStG, Grundfreibetrag § 10 EStG und ESt-Orientierung § 33 EStG).',
    annotations: {
      title: 'GuV & Steuer-Günstigkeitsvergleich berechnen',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        year: {
          type: 'number',
          description: 'Optionales Steuerjahr (z.B. 2026). Standard ist das in der App gewählte Steuerjahr.'
        }
      }
    }
  },
  {
    name: 'admin_upsert_record',
    description:
      'Anlegen & Ändern: Erstellt einen neuen Datensatz oder aktualisiert einen bestehenden Datensatz (wenn record.id angegeben ist) in jeder beliebigen Tabelle unter Anwendung exakt derselben App-Prüfungen und Berechnungen (z.B. Betragsberechnung Stunden × Satz + Material, L.C.R.-Sperre bei abgerechneten Arbeiten, Sub-Rechnungsempfänger, Termin-Konfliktprüfung).',
    annotations: {
      title: 'Datensatz anlegen oder ändern',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['collection', 'record'],
      properties: {
        collection: {
          type: 'string',
          enum: [...COLLECTION_NAMES],
          description: 'Zieltabelle für das Anlegen oder Aktualisieren.'
        },
        record: {
          type: 'object',
          additionalProperties: true,
          description:
            'Felder des Datensatzes. Mit bestehender record.id wird aktualisiert; ohne id wird neu angelegt.'
        }
      }
    }
  },
  {
    name: 'admin_delete_record',
    description:
      'Löscht einen Datensatz anhand seiner ID inklusive identischer App-Referenzbereinigung (z.B. Kaskadenbereinigung bei Kunden unter Erhalt abgerechneter Belege, Freigabe abgerechneter Arbeiten beim Löschen einer Rechnung, Reaktivierung bei Löschung eines Stornobelegs).',
    annotations: {
      title: 'Datensatz löschen',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['collection', 'id'],
      properties: {
        collection: {
          type: 'string',
          enum: [...COLLECTION_NAMES],
          description: 'Tabelle, aus der gelöscht werden soll.'
        },
        id: {
          type: 'string',
          description: 'ID des zu löschenden Datensatzes.'
        }
      }
    }
  },
  {
    name: 'admin_toggle_lcr',
    description:
      'Schaltet die L.C.R.-Kennzeichnung für eine oder mehrere offene Arbeitsaufzeichnungen um oder setzt sie gezielt (gesperrt für bereits an eine Rechnung gebundene Arbeiten).',
    annotations: {
      title: 'L.C.R.-Status umschalten',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['work_record_ids'],
      properties: {
        work_record_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'IDs der Arbeitsaufzeichnungen.'
        },
        is_lcr: {
          type: 'boolean',
          description: 'Optionaler Zielwert (true/false). Wenn weggelassen, wird der aktuelle Zustand umgeschaltet.'
        }
      }
    }
  },
  {
    name: 'admin_create_invoice',
    description:
      'Erstellt eine Rechnung (Format RE-75/2026, § 6 Abs. 1 Z 27 UStG Kleinunternehmerregelung) für einen Kunden aus offenen abrechenbaren Arbeitsaufzeichnungen (inkl. Sub-Abrechnung, Materialpositionen, Leistungszeitraum und automatischer Nummernvergabe) und sperrt die abgerechneten Arbeiten.',
    annotations: {
      title: 'Rechnung erstellen',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['customer_id'],
      properties: {
        customer_id: { type: 'string', description: 'ID des Rechnungsempfängers (Kunde).' },
        work_record_ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optionale Liste der abzurechnenden Arbeits-IDs. Wenn leer, werden alle offenen abrechenbaren Nicht-L.C.R.-Arbeiten dieses Rechnungsempfängers abgerechnet.'
        },
        extra_items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['description', 'amount'],
            properties: {
              description: { type: 'string' },
              quantity_label: { type: 'string' },
              unit_price_label: { type: 'string' },
              amount: { type: 'number' }
            }
          }
        },
        issue_date: { type: 'string', description: 'Rechnungsdatum YYYY-MM-DD.' },
        due_days: { type: 'number', description: 'Zahlungsziel in Tagen (Standard 14).' },
        invoice_number: { type: 'string', description: 'Optionale manuelle Rechnungsnummer.' },
        customer_number: { type: 'string', description: 'Optionale Kundennummer.' },
        service_period: { type: 'string', description: 'Optionaler Leistungszeitraum.' },
        payment_terms_text: { type: 'string', description: 'Optionaler Zahlungsbedingungstext.' },
        paid_in_cash: { type: 'boolean', description: 'Wenn true, sofort als Barzahlung verbuchen.' }
      }
    }
  },
  {
    name: 'admin_pay_invoice',
    description:
      'Bucht Zahlungen, Teilzahlungen, Gegenbuchungen (Zahlungskorrektur), Zahlungslöschungen oder Rückerstattungen auf eine bestehende Rechnung.',
    annotations: {
      title: 'Rechnungszahlung / Korrektur buchen',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['invoice_id'],
      properties: {
        invoice_id: {
          type: 'string',
          description: 'ID oder Rechnungsnummer (z.B. RE-75/2026) der Rechnung.'
        },
        action: {
          type: 'string',
          enum: ['pay', 'update_payment', 'reverse_payment', 'delete_payment', 'refund'],
          description: 'Standard "pay". Weitere Optionen: "update_payment" (Zahlung ändern), "reverse_payment" (Gegenbuchung), "delete_payment", "refund" (Rückzahlung nach Storno).'
        },
        amount: {
          type: 'number',
          description: 'Betrag in EUR (bei "pay" ohne Angabe wird der gesamte offene Restbetrag gebucht).'
        },
        payment_id: {
          type: 'string',
          description: 'Erforderlich bei "update_payment", "reverse_payment" oder "delete_payment": ID des Zahlungseintrags.'
        },
        date: { type: 'string', description: 'Buchungsdatum YYYY-MM-DD.' },
        note: { type: 'string', description: 'Optionale Buchungsnotiz / Begründung.' }
      }
    }
  },
  {
    name: 'admin_storno_invoice',
    description:
      'Storniert eine ausgestellte Rechnung buchhalterisch korrekt per Stornobeleg (z.B. RE-S01/2026), setzt etwaige bereits gezahlte Beträge als offenen Rückzahlungsbetrag und gibt die verknüpften Arbeitsaufzeichnungen wieder zur Abrechnung frei.',
    annotations: {
      title: 'Rechnung stornieren',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['invoice_id'],
      properties: {
        invoice_id: {
          type: 'string',
          description: 'ID oder Rechnungsnummer der zu stornierenden Rechnung.'
        },
        reason: { type: 'string', description: 'Stornogrund (z.B. Rechnungskorrektur).' },
        issue_date: { type: 'string', description: 'Optionales Stornodatum YYYY-MM-DD.' }
      }
    }
  },
  {
    name: 'admin_record_maintenance',
    description:
      'Dokumentiert eine durchgeführte Wartung an einem Gerät (setzt Status auf einsatzbereit, aktualisiert Wartungshistorie und nächstes Fälligkeitsdatum).',
    annotations: {
      title: 'Gerätewartung eintragen',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['equipment_id'],
      properties: {
        equipment_id: { type: 'string', description: 'ID des Geräts.' },
        plan: { type: 'string', description: 'Durchgeführter Wartungsplan.' },
        note: { type: 'string', description: 'Wartungsnotiz.' },
        date: { type: 'string', description: 'Wartungsdatum YYYY-MM-DD.' },
        next_maintenance: { type: 'string', description: 'Nächster Wartungstermin YYYY-MM-DD.' }
      }
    }
  },
  {
    name: 'admin_update_tax_settings',
    description:
      'Aktualisiert die Steuer- und Pauschalierungs-Einstellungen (Steuerjahr, bevorzugte Methode, SVS-Beiträge, Arbeitsplatzpauschale, Öffi-Ticket, Zusatz-Einnahmen) und liefert sofort die neu berechnete GuV-Übersicht.',
    annotations: {
      title: 'Steuereinstellungen ändern',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['settings'],
      properties: {
        settings: {
          type: 'object',
          additionalProperties: false,
          properties: {
            selected_year: { type: 'number' },
            preferred_method: {
              type: 'string',
              enum: [...VALID_TAX_METHODS]
            },
            svs_paid: { type: 'number' },
            workplace_allowance: { type: 'number', enum: [0, 300, 1200] },
            transit_ticket_full: { type: 'number' },
            manual_extra_income: { type: 'number' }
          }
        }
      }
    }
  },
  {
    name: 'admin_batch_mutate',
    description:
      'Führt mehrere Anlege-, Änderungs- und Löschoperationen atomar in einem einzigen Aufruf aus (bei einem Validierungsfehler wird keine Teiländerung gespeichert).',
    annotations: {
      title: 'Stapelverarbeitung (Batch)',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['operations'],
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['op', 'collection'],
            properties: {
              op: { type: 'string', enum: ['upsert', 'delete'] },
              collection: { type: 'string', enum: [...COLLECTION_NAMES] },
              id: { type: 'string' },
              record: { type: 'object', additionalProperties: true }
            }
          }
        }
      }
    }
  }
];

export function callMcpTool(name: string, args: Record<string, unknown> = {}): unknown {
  recordMcpAccess(`mcp:${name}`);
  switch (name) {
    case 'admin_get_overview':
      return getAdminOverview(Boolean(args.include_full_snapshot));
    case 'admin_read_records': {
      const col = String(args.collection || '');
      if (col !== 'taxSettings' && col !== 'all' && !isCollectionName(col)) {
        throw new Error(`Unbekannte Collection "${col}".`);
      }
      return queryCollection({
        collection: col,
        id: typeof args.id === 'string' ? args.id : undefined,
        customer_id: typeof args.customer_id === 'string' ? args.customer_id : undefined,
        status: typeof args.status === 'string' ? args.status : undefined,
        is_lcr: typeof args.is_lcr === 'boolean' ? args.is_lcr : undefined,
        unbilled_only: Boolean(args.unbilled_only),
        date_from: typeof args.date_from === 'string' ? args.date_from : undefined,
        date_to: typeof args.date_to === 'string' ? args.date_to : undefined,
        search: typeof args.search === 'string' ? args.search : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
        include_photos: Boolean(args.include_photos)
      });
    }
    case 'admin_calculate_guv':
      return calculateGuvAdminAction(
        typeof args.year === 'number' ? args.year : undefined
      );
    case 'admin_upsert_record': {
      const col = String(args.collection || '');
      if (!isCollectionName(col)) {
        throw new Error(`Unbekannte Collection "${col}".`);
      }
      const rec =
        args.record && typeof args.record === 'object'
          ? (args.record as Record<string, unknown>)
          : {};
      return upsertCollectionRecord(col, rec, 'mcp');
    }
    case 'admin_delete_record': {
      const col = String(args.collection || '');
      if (!isCollectionName(col)) {
        throw new Error(`Unbekannte Collection "${col}".`);
      }
      const id = String(args.id || '').trim();
      if (!id) throw new Error('Parameter "id" ist erforderlich.');
      return deleteCollectionRecord(col, id, 'mcp');
    }
    case 'admin_toggle_lcr':
      return toggleLcrAdminAction(
        {
          work_record_ids: Array.isArray(args.work_record_ids)
            ? (args.work_record_ids as string[])
            : [],
          is_lcr: typeof args.is_lcr === 'boolean' ? args.is_lcr : undefined
        },
        'mcp'
      );
    case 'admin_create_invoice':
      return createInvoiceAdminAction(
        {
          customer_id: String(args.customer_id || ''),
          work_record_ids: Array.isArray(args.work_record_ids)
            ? (args.work_record_ids as string[])
            : undefined,
          extra_items: Array.isArray(args.extra_items)
            ? (args.extra_items as InvoiceLineItem[])
            : undefined,
          issue_date: typeof args.issue_date === 'string' ? args.issue_date : undefined,
          due_days: typeof args.due_days === 'number' ? args.due_days : undefined,
          invoice_number:
            typeof args.invoice_number === 'string' ? args.invoice_number : undefined,
          customer_number:
            typeof args.customer_number === 'string' ? args.customer_number : undefined,
          service_period:
            typeof args.service_period === 'string' ? args.service_period : undefined,
          payment_terms_text:
            typeof args.payment_terms_text === 'string' ? args.payment_terms_text : undefined,
          paid_in_cash: Boolean(args.paid_in_cash)
        },
        'mcp'
      );
    case 'admin_pay_invoice':
      return payInvoiceAdminAction(
        {
          invoice_id: String(args.invoice_id || ''),
          action:
            args.action === 'update_payment' ||
            args.action === 'reverse_payment' ||
            args.action === 'delete_payment' ||
            args.action === 'refund'
              ? args.action
              : 'pay',
          amount: typeof args.amount === 'number' ? args.amount : undefined,
          payment_id: typeof args.payment_id === 'string' ? args.payment_id : undefined,
          date: typeof args.date === 'string' ? args.date : undefined,
          note: typeof args.note === 'string' ? args.note : undefined
        },
        'mcp'
      );
    case 'admin_storno_invoice':
      return stornoInvoiceAdminAction(
        {
          invoice_id: String(args.invoice_id || ''),
          reason: typeof args.reason === 'string' ? args.reason : undefined,
          issue_date: typeof args.issue_date === 'string' ? args.issue_date : undefined
        },
        'mcp'
      );
    case 'admin_record_maintenance':
      return recordMaintenanceAdminAction(
        {
          equipment_id: String(args.equipment_id || ''),
          plan: typeof args.plan === 'string' ? args.plan : undefined,
          note: typeof args.note === 'string' ? args.note : undefined,
          date: typeof args.date === 'string' ? args.date : undefined,
          next_maintenance:
            typeof args.next_maintenance === 'string' ? args.next_maintenance : undefined
        },
        'mcp'
      );
    case 'admin_update_tax_settings':
      return updateTaxSettingsAdmin(
        (args.settings as Partial<TaxSettings>) || {},
        'mcp'
      );
    case 'admin_batch_mutate':
      return executeBatchAdmin(
        Array.isArray(args.operations) ? (args.operations as BatchOperation[]) : [],
        'mcp'
      );
    default:
      throw new Error(`Unbekanntes MCP-Werkzeug "${name}".`);
  }
}
