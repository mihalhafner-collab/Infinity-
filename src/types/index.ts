export type ScreenId =
  | 'M01_HEUTE'
  | 'M02_PLANUNG'
  | 'M03_KUNDEN'
  | 'M04_ABRECHNUNG'
  | 'M05_ANFRAGEN'
  | 'M06_ANGEBOTE'
  | 'M07_AUFTRAEGE'
  | 'M08_ARBEITEN'
  | 'M09_LCR'
  | 'M10_GERAETE'
  | 'M11_MATERIAL'
  | 'M12_SICHERUNG'
  | 'M13_EINSTELLUNGEN'
  | 'M15_SPEICHER_APP'
  | 'M16_FOTOS'
  | 'M17_OBJEKTE'
  | 'M18_SUCHE'
  | 'M19_ZEITERFASSUNG'
  | 'M20_UMSAETZE_KORREKTUREN';

// DATA-02: Kunde (PDF S. 78, M03)
export interface Customer {
  id: string;
  record_hash?: string;
  customer_number?: string;
  name: string;
  company?: string;
  photo?: string | null;
  phone: string;
  email: string;
  street: string;
  city: string;
  zip: string;
  notes?: string;
  active: boolean;
  electronic_invoice_consent: boolean;
  electronic_invoice_consent_date: string | null;
  default_billing_customer_id: string | null;
  billing_mode?: 'standard' | 'divergent_recipient';
  garden_area?: number | null; // Fläche in m², kein Geldbetrag (DATA-02)
  custom_fields?: Record<string, string | number | boolean | null>;
  created_at?: string;
  updated_at?: string;
}

export interface CustomerProperty {
  id: string;
  customer_id: string;
  name: string;
  property_type?: string;
  address: string;
  area_sqm?: number | null;
  hedge_length_m?: number | null;
  access_info?: string;
  features?: string[];
  photos?: string[];
  notes: string;
  created_at: string;
  updated_at?: string;
}

export interface Appointment {
  id: string;
  title?: string; // Optional per REQ-011. Default display: "Termin"
  date: string; // YYYY-MM-DD
  start_time: string | null; // e.g. "09:00" or null ("Ohne Uhrzeit")
  end_time: string | null; // e.g. "11:00" or null ("Ende offen")
  duration_minutes: number | null;
  customer_id: string | null;
  property_id: string | null;
  address: string | null;
  notes: string;
  tour_order: number;
  created_at?: string;
  updated_at?: string;
}

// DATA-04 & DATA-09: Verbrauchtes Material an einer Arbeit (PDF S. 82, M11)
export interface UsedMaterial {
  material_id: string;
  name: string;
  quantity: number;
  unit: string;
  price_per_unit: number | null; // Unbekannt/null ist nicht 0 EUR
  total: number | null;
}

// DATA-09, DATA-10: Arbeitsaufzeichnung (PDF S. 82, M08)
export interface WorkRecord {
  id: string;
  work_record_id?: string;
  record_hash?: string;
  work_date: string; // YYYY-MM-DD
  title: string;
  customer_id: string;
  billing_customer_id?: string | null;
  property_id?: string | null;
  order_id?: string | null;
  appointment_id?: string | null;
  session_id?: string | null;
  hours: number;
  start_time: string;
  end_time: string;
  break_minutes: number;
  hourly_rate: number | null; // Kann null sein (fehlend, ungleich 0 EUR)
  accounting_amount: number | null; // Kann null sein (rot dargestellt)
  material_cost?: number | null;
  disposal_cost?: number | null;
  billable: boolean; // Abrechenbar (true/false)
  is_lcr: boolean; // L.C.R. Kennzeichnung am Original
  settlement_id: string | null; // Gehört zu ausgestellter Rechnung, sperrt L.C.R.-Umschaltung!
  customer_visible?: boolean;
  notes: string;
  materials: UsedMaterial[];
  photos: string[];
  created_at?: string;
  updated_at?: string;
}

export interface PaymentItem {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number; // positive for payment, negative for reversal or refund
  is_reversal: boolean;
  reversal_of: string | null;
  note: string;
}

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity_label: string;
  unit_price_label: string;
  amount: number;
}

export interface Invoice {
  id: string;
  invoice_number: string; // e.g. "RE-75/2026"
  customer_id: string;
  customer_number?: string;
  billing_customer_name: string;
  recipient_street?: string;
  recipient_zip?: string;
  recipient_city?: string;
  service_period?: string | null;
  subject_text?: string;
  intro_text?: string;
  closing_text?: string;
  is_pauschal?: boolean;
  merged_invoice_ids?: string[];
  line_items?: InvoiceLineItem[];
  issue_date: string;
  due_date: string;
  payment_terms_text?: string;
  paid_in_cash?: boolean;
  total_amount: number;
  status: 'draft' | 'unpaid' | 'partially_paid' | 'paid' | 'cancelled';
  work_record_ids: string[];
  is_storno: boolean;
  storno_reference_id: string | null;
  storno_reason: string | null;
  payments: PaymentItem[];
  open_refund_amount: number; // Stornierte bezahlte Rechnung bis Rückzahlung erfolgt
  sent_at?: string | null;
  sent_via?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Inquiry {
  id: string;
  customer_id: string;
  title: string;
  desired_date: string;
  notes: string;
  status: 'neu' | 'angebot_vorbereitet' | 'angenommen';
  created_at?: string;
  updated_at?: string;
}

export interface OfferItem {
  description: string;
  quantity: number;
  unit: string;
  price: number;
  total: number;
}

export interface Offer {
  id: string;
  customer_id: string;
  title: string;
  items: OfferItem[];
  total_amount: number;
  status: 'entwurf' | 'freigegeben' | 'angenommen' | 'abgelehnt';
  created_at?: string;
  updated_at?: string;
}

// DATA-04: Auftrag (PDF S. 79, M07)
export interface Order {
  id: string;
  order_id?: string;
  record_hash?: string;
  customer_id: string;
  billing_customer_id?: string | null;
  property_id?: string | null;
  offer_id: string | null; // Angebotsreferenz
  inquiry_id?: string | null;
  title: string;
  status: 'geplant' | 'in_arbeit' | 'erledigt';
  customer_visible?: boolean;
  notes?: string;
  scheduled_date?: string | null; // ISO-Kalendertag
  planned_hours?: number | null;
  estimated_amount?: number | null;
  accounting_amount?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface Equipment {
  id: string;
  item_type?: 'geraet' | 'zubehoer';
  category?: string;
  parent_equipment_id?: string | null;
  name: string;
  model: string;
  photo?: string | null;
  specs?: Record<string, string>;
  quantity?: number | null;
  notes?: string;
  status: 'faellig' | 'einsatzbereit' | 'wartung';
  last_maintenance: string;
  next_maintenance: string;
  maintenance_plan: string;
  interval_months: number;
  history: Array<{ date: string; note: string; plan: string }>;
  created_at?: string;
  updated_at?: string;
}

// DATA-04 / M11: Material (PDF S. 42 & S. 79)
export interface Material {
  id: string;
  entry_id?: string;
  record_hash?: string;
  name: string;
  unit: string; // z.B. 'Stück', 'kg', 'l', 'm²', 'm', 'Sack'
  price_per_unit: number | null; // Unbekannter Preis bleibt unbekannt (null ungleich 0 EUR)
  cost_price_per_unit?: number | null;
  category?: string;
  item_number?: string;
  notes: string;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type ExpenseCategory =
  | 'wareneinsatz'
  | 'treibstoff_kfz'
  | 'werkzeug_anlage'
  | 'versicherung_buero'
  | 'sonstiges';

export interface BusinessExpense {
  id: string;
  date: string; // YYYY-MM-DD (Zahlungs- bzw. Inbetriebnahmedatum gem. § 19 / § 7 EStG)
  title: string;
  amount: number; // Bruttobetrag in EUR (Kleinunternehmer ohne Vorsteuerabzug)
  category: ExpenseCategory;
  useful_life_years?: number | null; // Für Anlagen > 1.000 € (AfA § 7 EStG, z.B. 5 Jahre)
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export type TaxCalculationMethod =
  | 'auto_best'
  | 'ku_pauschal_45'
  | 'ku_pauschal_20'
  | 'basis_pauschal_15'
  | 'ear_echt';

export interface TaxSettings {
  selected_year: number;
  preferred_method: TaxCalculationMethod;
  svs_paid: number;
  workplace_allowance: 0 | 300 | 1200;
  transit_ticket_full: number;
  manual_extra_income: number;
}
export type DeletedTombstoneMap = Record<string, string>;
