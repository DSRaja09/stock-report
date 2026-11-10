// Fake sample data, generated relative to "today" so every forecast shows real values.
import type { Arrival, DB, Movement, Order, Product, Sale, Supplier } from './types';
import { addDays, isoAt, storeDay } from './time';

export const DB_VERSION = 3;

let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter}`;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const STAFF_USER = { name: 'Alex Rivera (Ops)', email: 'ops@example.com' };

export function makeSeed(now = new Date()): DB {
  const today = storeDay(now);
  const d = (n: number, h = 10) => isoAt(addDays(today, -n), h);
  const rand = mulberry32(20261110);

  const suppliers: Supplier[] = [
    { id: 's1', name: 'Northwind Ceramics', contact: 'Mei Tanaka', email: 'orders.northwind@example.com' },
    { id: 's2', name: 'Juniper Textiles', contact: 'Ravi Patel', email: 'sales.juniper@example.com' },
    { id: 's3', name: 'Pinecone Goods Co.', contact: 'Lena Ortiz', email: 'hello.pinecone@example.com' },
  ];

  const products: Product[] = [
    {
      id: 'p1', name: 'Trail Mug 12oz', code: 'TMG', supplierId: 's1', warehouseStock: 520, unshipped: 22, orderSeq: 2,
      skus: [
        { sku: 'TMG-SINGLE', label: 'Single', units: 1 },
        { sku: 'TMG-B2G2', label: 'Buy 2 get 2', units: 4 },
      ],
    },
    {
      id: 'p2', name: 'Linen Apron', code: 'LAP', supplierId: 's2', warehouseStock: 90, unshipped: 9, orderSeq: 1,
      skus: [
        { sku: 'LAP-1', label: 'Single', units: 1 },
        { sku: 'LAP-2PK', label: '2-pack', units: 2 },
      ],
    },
    {
      id: 'p3', name: 'Beeswax Wrap Set', code: 'BWX', supplierId: 's3', warehouseStock: 900, unshipped: 15, orderSeq: 2,
      skus: [
        { sku: 'BWX-SET', label: 'Set', units: 1 },
        { sku: 'BWX-B2G2', label: 'Buy 2 get 2', units: 4 },
      ],
    },
    {
      id: 'p4', name: 'Cedar Candle', code: 'CDC', supplierId: 's3', warehouseStock: 150, unshipped: 4, orderSeq: 1,
      skus: [{ sku: 'CDC-1', label: 'Single', units: 1 }],
    },
    {
      id: 'p5', name: 'Canvas Tote', code: 'CTB', supplierId: 's2', warehouseStock: 140, unshipped: 6, orderSeq: 1,
      skus: [
        { sku: 'CTB-1', label: 'Single', units: 1 },
        { sku: 'CTB-3PK', label: '3-pack', units: 3 },
      ],
    },
    {
      id: 'p6', name: 'Ceramic Pour-over', code: 'CPO', supplierId: 's1', warehouseStock: 0, unshipped: 14, orderSeq: 2,
      skus: [{ sku: 'CPO-1', label: 'Single', units: 1 }],
    },
  ];

  // Daily units by days-ago: TMG speeds up, BWX slows down, others steady.
  const rate: Record<string, (i: number) => number> = {
    p1: (i) => (i < 3 ? 14 : 11),
    p2: () => 6,
    p3: (i) => (i < 3 ? 6 : 9),
    p4: () => 4,
    p5: () => 5,
    p6: () => 3,
  };

  const sales: Sale[] = [];
  for (const p of products) {
    for (let i = 29; i >= 0; i--) {
      const day = addDays(today, -i);
      const units = Math.max(0, Math.round(rate[p.id](i) * (0.85 + rand() * 0.3)));
      const bundle = p.skus.find((s) => s.units > 1);
      const bundles = bundle ? Math.floor((units * 0.2) / bundle.units) : 0;
      const singles = units - bundles * (bundle?.units ?? 0);
      const single = p.skus[0];
      if (singles > 0)
        sales.push({ id: uid('sale'), day, productId: p.id, sku: single.sku, qty: singles, units: singles, source: 'store' });
      if (bundle && bundles > 0)
        sales.push({
          id: uid('sale'), day, productId: p.id, sku: bundle.sku, qty: bundles, units: bundles * bundle.units, source: 'store',
        });
    }
  }
  // A manual (wholesale) sale nine days ago.
  sales.push({
    id: uid('sale'), day: addDays(today, -9), productId: 'p1', units: 12, source: 'manual',
    note: 'Wholesale to Café Pinyon (fake)',
  });

  const ops = STAFF_USER.name;
  const ev = (n: number, text: string, by = ops, h = 10) => ({ at: d(n, h), by, text });

  const orders: Order[] = [
    {
      id: 'o1', name: 'TMG-001', productId: 'p1', supplierId: 's1', units: 600, notes: 'Matte sage glaze',
      createdAt: d(40), confirmedAt: d(38), lastChase: {},
      tracking: [
        { id: 't1', number: '1Z999AA10123456784', carrier: 'UPS', units: 300, shippedAt: d(24), status: 'active' },
        { id: 't2', number: '1Z999AA10123456791', carrier: 'UPS', units: 300, shippedAt: d(22), status: 'active' },
      ],
      history: [
        ev(40, 'Created order for 600 units'),
        ev(38, 'Confirmed order', 'Mei Tanaka (Northwind Ceramics)'),
        ev(24, 'Added tracking 1Z999AA10123456784 (UPS, 300 units)', 'Mei Tanaka (Northwind Ceramics)'),
        ev(22, 'Added tracking 1Z999AA10123456791 (UPS, 300 units)', 'Mei Tanaka (Northwind Ceramics)'),
        ev(5, '300 units arrived (receipt WH-10488)', 'Warehouse feed'),
      ],
    },
    {
      id: 'o2', name: 'TMG-002', productId: 'p1', supplierId: 's1', units: 400, notes: '',
      createdAt: d(4), lastChase: { confirm: d(1, 9) }, tracking: [],
      history: [ev(4, 'Created order for 400 units'), ev(1, 'Sent follow-up: Ask to confirm', ops, 9)],
    },
    {
      id: 'o3', name: 'LAP-001', productId: 'p2', supplierId: 's2', units: 200, notes: 'Natural + charcoal, 50/50',
      createdAt: d(15), confirmedAt: d(14), lastChase: {}, tracking: [],
      history: [ev(15, 'Created order for 200 units'), ev(14, 'Confirmed order', 'Ravi Patel (Juniper Textiles)')],
    },
    {
      id: 'o4', name: 'BWX-001', productId: 'p3', supplierId: 's3', units: 500, notes: '',
      createdAt: d(60), confirmedAt: d(58), lastChase: {},
      tracking: [{ id: 't3', number: '771234567890', carrier: 'FedEx', units: 500, shippedAt: d(45), status: 'active' }],
      history: [
        ev(60, 'Created order for 500 units'),
        ev(58, 'Confirmed order', 'Lena Ortiz (Pinecone Goods Co.)'),
        ev(45, 'Added tracking 771234567890 (FedEx, 500 units)', 'Lena Ortiz (Pinecone Goods Co.)'),
        ev(40, '300 units arrived (receipt WH-10102)', 'Warehouse feed'),
        ev(35, '200 units arrived (receipt WH-10140)', 'Warehouse feed'),
      ],
    },
    {
      id: 'o5', name: 'BWX-002', productId: 'p3', supplierId: 's3', units: 250, notes: 'Include 50 in the large size',
      createdAt: d(20), confirmedAt: d(18), lastChase: {},
      tracking: [
        { id: 't4', number: '771234567891', carrier: 'FedEx', units: 150, shippedAt: d(8), status: 'active' },
        { id: 't5', number: '4567890123', carrier: 'DHL', units: 100, shippedAt: d(9), status: 'returned', replacedById: 't6' },
        { id: 't6', number: '4567890124', carrier: 'DHL', units: 100, shippedAt: d(2), status: 'active', replacesId: 't5' },
      ],
      history: [
        ev(20, 'Created order for 250 units'),
        ev(18, 'Confirmed order', 'Lena Ortiz (Pinecone Goods Co.)'),
        ev(9, 'Added tracking 4567890123 (DHL, 100 units)', 'Lena Ortiz (Pinecone Goods Co.)'),
        ev(8, 'Added tracking 771234567891 (FedEx, 150 units)', 'Lena Ortiz (Pinecone Goods Co.)'),
        ev(2, 'Tracking 4567890123 returned to sender — resent as 4567890124 (DHL, 100 units)'),
      ],
    },
    {
      id: 'o6', name: 'CDC-001', productId: 'p4', supplierId: 's3', units: 80, notes: '',
      createdAt: d(3), lastChase: {}, tracking: [], history: [ev(3, 'Created order for 80 units')],
    },
    {
      id: 'o7', name: 'CTB-001', productId: 'p5', supplierId: 's2', units: 300, notes: '',
      createdAt: d(50), confirmedAt: d(48), closedAt: d(25), lastChase: {},
      tracking: [{ id: 't7', number: '9400111899223344556677', carrier: 'USPS', units: 300, shippedAt: d(38), status: 'active' }],
      history: [
        ev(50, 'Created order for 300 units'),
        ev(48, 'Confirmed order', 'Ravi Patel (Juniper Textiles)'),
        ev(38, 'Added tracking 9400111899223344556677 (USPS, 300 units)', 'Ravi Patel (Juniper Textiles)'),
        ev(30, '280 units arrived (receipt WH-10215)', 'Warehouse feed'),
        ev(25, 'Closed — no more coming (20 short, supplier credited)'),
      ],
    },
    {
      id: 'o8', name: 'CPO-001', productId: 'p6', supplierId: 's1', units: 100, notes: '',
      createdAt: d(30), cancelledAt: d(29), lastChase: {}, tracking: [],
      history: [ev(30, 'Created order for 100 units'), ev(29, 'Cancelled — wrong colourway')],
    },
    {
      id: 'o9', name: 'CPO-002', productId: 'p6', supplierId: 's1', units: 150, notes: 'Speckled white',
      createdAt: d(8), confirmedAt: d(6), lastChase: {}, tracking: [],
      history: [ev(8, 'Created order for 150 units'), ev(6, 'Confirmed order', 'Mei Tanaka (Northwind Ceramics)')],
    },
  ];

  const arrivals: Arrival[] = [
    { id: 'a1', productId: 'p3', units: 300, date: d(40, 14), source: 'warehouse', ref: 'WH-10102', allocations: [{ orderId: 'o4', units: 300 }] },
    { id: 'a2', productId: 'p3', units: 200, date: d(35, 14), source: 'warehouse', ref: 'WH-10140', allocations: [{ orderId: 'o4', units: 200 }] },
    { id: 'a3', productId: 'p5', units: 280, date: d(30, 14), source: 'warehouse', ref: 'WH-10215', allocations: [{ orderId: 'o7', units: 280 }] },
    { id: 'a6', productId: 'p4', units: 10, date: d(6, 11), source: 'warehouse', ref: 'WH-10466', allocations: [{ orderId: null, units: 10 }] },
    { id: 'a4', productId: 'p1', units: 300, date: d(5, 14), source: 'warehouse', ref: 'WH-10488', allocations: [{ orderId: 'o1', units: 300 }] },
    { id: 'a5', productId: 'p5', units: 24, date: d(1, 15), source: 'warehouse', ref: 'WH-10531', allocations: [] },
  ];

  const mv = (
    n: number, productId: string, type: Movement['type'], delta: number, text: string, why: string, by: string, h = 14,
  ): Movement => ({ id: uid('mv'), productId, at: d(n, h), type, delta, text, why, by });

  const movements: Movement[] = [
    mv(40, 'p3', 'arrival', 300, '+300 units arrived — matched 300 to BWX-001', 'Warehouse receipt WH-10102', 'Warehouse feed'),
    mv(35, 'p3', 'arrival', 200, '+200 units arrived — matched 200 to BWX-001', 'Warehouse receipt WH-10140', 'Warehouse feed'),
    mv(30, 'p5', 'arrival', 280, '+280 units arrived — matched 280 to CTB-001', 'Warehouse receipt WH-10215', 'Warehouse feed'),
    mv(6, 'p4', 'arrival', 10, '+10 units arrived', 'Warehouse receipt WH-10466', 'Warehouse feed', 11),
    mv(6, 'p4', 'rematch', 0, '10 units marked "not from an order"', 'Customer return, restocked', ops, 12),
    mv(5, 'p1', 'arrival', 300, '+300 units arrived — matched 300 to TMG-001', 'Warehouse receipt WH-10488', 'Warehouse feed'),
    mv(9, 'p1', 'manual_sale', -12, '−12 units manual sale', 'Wholesale to Café Pinyon (fake)', ops, 11),
    mv(1, 'p5', 'arrival', 24, '+24 units arrived — 24 unmatched (no open order)', 'Warehouse receipt WH-10531', 'Warehouse feed', 15),
  ];

  return {
    version: DB_VERSION,
    seededDay: today,
    products,
    suppliers,
    sales,
    orders,
    arrivals,
    movements,
    outbox: [],
    settings: {
      leadTime: 45,
      safetyDays: 14,
      targetDays: 60,
      alertsEnabled: true,
      alertRecipients: 'ops@example.com, buyer@example.com',
      alertDaysBefore: 7,
      staffNotifyEmail: 'ops@example.com',
      stockSyncedAt: new Date(now.getTime() - 12 * 60000).toISOString(),
      salesSyncedAt: new Date(now.getTime() - 40 * 60000).toISOString(),
    },
  };
}
