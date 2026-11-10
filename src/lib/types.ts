// Data model for the Stock Report. Everything lives in one JSON document
// (persisted to localStorage) so the app runs with zero setup.

export type Role = 'staff' | 'supplier';

export interface Session {
  role: Role;
  name: string;
  email: string;
  supplierId?: string; // set when role === 'supplier'
}

/** A sales identifier (SKU / listing) that maps to a product. `units` handles bundles: "buy 2 get 2" = 4. */
export interface Sku {
  sku: string;
  label: string;
  units: number;
}

export interface Product {
  id: string;
  name: string;
  code: string; // short code, also the order-name prefix
  skus: Sku[];
  supplierId: string; // default supplier
  warehouseStock: number;
  unshipped: number; // sold but not shipped yet
  orderSeq: number; // last order number used (never reused, even after delete)
}

export interface Supplier {
  id: string;
  name: string;
  contact: string;
  email: string;
}

export interface Sale {
  id: string;
  day: string; // store day YYYY-MM-DD (America/Denver)
  productId: string;
  sku?: string;
  qty?: number;
  units: number; // resolved units (qty × sku units)
  source: 'store' | 'manual' | 'import';
  note?: string;
}

export type Carrier = 'UPS' | 'FedEx' | 'USPS' | 'DHL' | 'Other';

export interface Tracking {
  id: string;
  number: string;
  carrier: Carrier;
  units: number;
  shippedAt: string; // ISO
  status: 'active' | 'returned';
  replacedById?: string;
  replacesId?: string;
}

export interface OrderEvent {
  at: string; // ISO
  by: string;
  text: string;
}

export type ChaseKind = 'confirm' | 'tracking' | 'where';

export interface Order {
  id: string;
  name: string; // readable unique name, e.g. TMG-003
  productId: string;
  supplierId: string;
  units: number;
  notes: string;
  createdAt: string;
  confirmedAt?: string;
  closedAt?: string;
  cancelledAt?: string;
  tracking: Tracking[];
  history: OrderEvent[];
  lastChase: Partial<Record<ChaseKind, string>>;
}

export interface Allocation {
  orderId: string | null; // null = "not from an order"
  units: number;
}

export interface Arrival {
  id: string;
  productId: string;
  units: number;
  date: string; // ISO
  source: 'warehouse' | 'import' | 'manual';
  ref: string; // warehouse receipt reference
  allocations: Allocation[];
}

export type MovementType = 'arrival' | 'rematch' | 'manual_sale' | 'adjustment';

export interface Movement {
  id: string;
  productId: string;
  at: string;
  type: MovementType;
  delta: number; // change in warehouse stock (0 for re-matches)
  stockAfter?: number;
  text: string; // what changed
  why: string; // why / source
  by: string;
}

export interface Email {
  id: string;
  at: string;
  to: string[];
  subject: string;
  body: string;
  kind: 'reorder_alert' | 'supplier_update' | 'chase' | 'order' | 'test';
}

export interface Settings {
  leadTime: number;
  safetyDays: number;
  targetDays: number;
  alertsEnabled: boolean;
  alertRecipients: string; // comma separated
  alertDaysBefore: number;
  staffNotifyEmail: string;
  lastAlertDay?: string;
  stockSyncedAt: string;
  salesSyncedAt: string;
}

export interface DB {
  version: number;
  seededDay: string;
  touched?: boolean; // false until a user changes something; untouched demo data re-seeds daily
  products: Product[];
  suppliers: Supplier[];
  sales: Sale[];
  orders: Order[];
  arrivals: Arrival[];
  movements: Movement[];
  outbox: Email[];
  settings: Settings;
}
