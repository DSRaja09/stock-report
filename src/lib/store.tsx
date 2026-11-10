// Zero-config local "database": one JSON document in localStorage, with every
// mutation going through a named action that also writes the audit trail.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Allocation, Arrival, Carrier, ChaseKind, DB, Email, Order, Product, Session, Supplier } from './types';
import { DB_VERSION, makeSeed, STAFF_USER, uid } from './seed';
import { autoMatch, CHASE_LABEL, reorderLists, viewOrder } from './calc';
import { reorderEmail } from './messages';
import { storeDay } from './time';

const DB_KEY = 'stock-report-db';
const SESSION_KEY = 'stock-report-session';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* storage unavailable — app still works in memory */
  }
}

function loadDB(): DB {
  const raw = safeGet(DB_KEY);
  if (raw) {
    try {
      const db = JSON.parse(raw) as DB;
      // Untouched demo data is regenerated each store day so the forecasts stay current.
      if (db.version === DB_VERSION && (db.touched || db.seededDay === storeDay())) return db;
    } catch {
      /* fall through to seed */
    }
  }
  return makeSeed();
}

export class ActionError extends Error {}
const fail = (msg: string): never => {
  throw new ActionError(msg);
};

type Toast = { id: number; text: string; kind: 'ok' | 'error' };

interface StoreCtx {
  db: DB;
  session: Session | null;
  login: (s: Session) => void;
  logout: () => void;
  toasts: Toast[];
  toast: (text: string, kind?: Toast['kind']) => void;
  act: ReturnType<typeof makeActions>;
}

const Ctx = createContext<StoreCtx | null>(null);

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useStore outside provider');
  return c;
}

function makeActions(
  mutate: (fn: (d: DB) => string | void) => boolean,
  getSession: () => Session | null,
  replace: (db: DB) => void,
) {
  const who = () => getSession()?.name ?? 'Unknown';
  const now = () => new Date().toISOString();
  const findOrder = (d: DB, id: string) => d.orders.find((o) => o.id === id) ?? fail('Order not found');
  const productOf = (d: DB, id: string) => d.products.find((p) => p.id === id) ?? fail('Product not found');
  const log = (o: Order, text: string) => o.history.push({ at: now(), by: who(), text });
  const mail = (d: DB, e: Omit<Email, 'id' | 'at'>) => d.outbox.unshift({ ...e, id: uid('mail'), at: now() });
  const notifyStaff = (d: DB, o: Order, what: string) => {
    if (getSession()?.role !== 'supplier') return;
    mail(d, {
      kind: 'supplier_update',
      to: [d.settings.staffNotifyEmail],
      subject: `Supplier update on ${o.name}: ${what}`,
      body: `${who()} — ${what} on order ${o.name}.\n\nOpen the Stock Report to review.`,
    });
  };
  const assertCanEdit = (o: Order) => {
    const s = getSession();
    if (s?.role === 'supplier' && s.supplierId !== o.supplierId) fail('This order belongs to another supplier');
  };
  const staffOnly = () => {
    if (getSession()?.role !== 'staff') fail('Only staff can do this');
  };
  const checkTrackingTotal = (o: Order) => {
    const total = o.tracking.filter((t) => t.status === 'active').reduce((n, t) => n + t.units, 0);
    if (total > o.units) fail(`Tracking units (${total}) can't add up to more than the order (${o.units})`);
  };
  const posInt = (n: number, what = 'Units') => {
    if (!Number.isInteger(n) || n <= 0) fail(`${what} must be a whole number above 0`);
  };

  /** Applies arrivals to the warehouse and auto-matches them. */
  const ingestArrival = (d: DB, a: Omit<Arrival, 'id' | 'allocations'>, by: string) => {
    const p = productOf(d, a.productId);
    const { allocations, unmatched } = autoMatch(d, a.productId, a.units);
    const arrival: Arrival = { ...a, id: uid('arr'), allocations };
    d.arrivals.push(arrival);
    p.warehouseStock += a.units;
    const parts = allocations.map((al) => {
      const o = d.orders.find((x) => x.id === al.orderId)!;
      o.history.push({ at: now(), by, text: `${al.units} units arrived (receipt ${a.ref})` });
      return `${al.units} to ${o.name}`;
    });
    if (unmatched > 0) parts.push(`${unmatched} unmatched`);
    d.movements.push({
      id: uid('mv'),
      productId: p.id,
      at: a.date,
      type: 'arrival',
      delta: a.units,
      stockAfter: p.warehouseStock,
      text: `+${a.units} units arrived${parts.length ? ' — ' + parts.join(', ') : ''}`,
      why: `${a.source === 'warehouse' ? 'Warehouse receipt' : a.source === 'import' ? 'Imported receipt' : 'Received by hand'} ${a.ref}`,
      by,
    });
    return arrival;
  };

  return {
    /* ------------------------------------------------------------ orders */
    createOrder(input: { productId: string; supplierId: string; units: number; notes: string }) {
      let created: Order | undefined;
      const ok = mutate((d) => {
        staffOnly();
        posInt(input.units);
        const p = productOf(d, input.productId);
        if (!d.suppliers.some((s) => s.id === input.supplierId)) fail('Pick a supplier');
        p.orderSeq += 1;
        let name = `${p.code}-${String(p.orderSeq).padStart(3, '0')}`;
        while (d.orders.some((o) => o.name === name)) {
          p.orderSeq += 1;
          name = `${p.code}-${String(p.orderSeq).padStart(3, '0')}`;
        }
        created = {
          id: uid('ord'),
          name,
          productId: p.id,
          supplierId: input.supplierId,
          units: input.units,
          notes: input.notes.trim(),
          createdAt: now(),
          tracking: [],
          history: [],
          lastChase: {},
        };
        log(created, `Created order for ${input.units} units`);
        d.orders.push(created);
        return `Order ${name} created`;
      });
      return ok ? created : undefined;
    },

    updateOrder(id: string, patch: { units: number; supplierId: string; notes: string }) {
      return mutate((d) => {
        staffOnly();
        posInt(patch.units);
        const o = findOrder(d, id);
        const v = viewOrder(o, d.arrivals);
        if (patch.units < v.arrived) fail(`Can't go below the ${v.arrived} units already arrived`);
        if (patch.units < v.activeTracked) fail(`Can't go below the ${v.activeTracked} units already on tracking`);
        const changes: string[] = [];
        if (patch.units !== o.units) changes.push(`units ${o.units} → ${patch.units}`);
        if (patch.supplierId !== o.supplierId) {
          const a = d.suppliers.find((s) => s.id === o.supplierId)?.name;
          const b = d.suppliers.find((s) => s.id === patch.supplierId)?.name;
          changes.push(`supplier ${a} → ${b}`);
        }
        if (patch.notes.trim() !== o.notes) changes.push('notes updated');
        if (!changes.length) return 'Nothing changed';
        Object.assign(o, { units: patch.units, supplierId: patch.supplierId, notes: patch.notes.trim() });
        log(o, `Edited: ${changes.join(', ')}`);
        return `${o.name} saved`;
      });
    },

    confirmOrder(id: string) {
      return mutate((d) => {
        const o = findOrder(d, id);
        assertCanEdit(o);
        if (o.confirmedAt) fail('Already confirmed');
        o.confirmedAt = now();
        log(o, 'Confirmed order — in production');
        notifyStaff(d, o, 'order confirmed');
        return `${o.name} confirmed`;
      });
    },

    setOrderState(id: string, op: 'cancel' | 'close' | 'reopen', reason = '') {
      return mutate((d) => {
        staffOnly();
        const o = findOrder(d, id);
        const r = reason.trim() ? ` — ${reason.trim()}` : '';
        if (op === 'cancel') {
          o.cancelledAt = now();
          log(o, `Cancelled${r}`);
        } else if (op === 'close') {
          o.closedAt = now();
          log(o, `Closed — no more coming${r}`);
        } else {
          delete o.cancelledAt;
          delete o.closedAt;
          log(o, `Reopened${r}`);
        }
        return `${o.name} ${op === 'reopen' ? 'reopened' : op === 'cancel' ? 'cancelled' : 'closed'}`;
      });
    },

    deleteOrder(id: string) {
      return mutate((d) => {
        staffOnly();
        const o = findOrder(d, id);
        // Units that had been matched to this order become unmatched arrivals.
        for (const a of d.arrivals) {
          const had = a.allocations.filter((al) => al.orderId === id).reduce((n, al) => n + al.units, 0);
          if (had > 0) {
            a.allocations = a.allocations.filter((al) => al.orderId !== id);
            d.movements.push({
              id: uid('mv'),
              productId: a.productId,
              at: now(),
              type: 'rematch',
              delta: 0,
              text: `${had} units from receipt ${a.ref} unmatched`,
              why: `Order ${o.name} was deleted`,
              by: who(),
            });
          }
        }
        d.orders = d.orders.filter((x) => x.id !== id);
        return `${o.name} deleted`;
      });
    },

    /* ---------------------------------------------------------- tracking */
    addTracking(orderId: string, t: { number: string; carrier: Carrier; units: number }) {
      return mutate((d) => {
        const o = findOrder(d, orderId);
        assertCanEdit(o);
        posInt(t.units);
        const number = t.number.trim();
        if (!number) fail('Enter a tracking number');
        if (o.tracking.some((x) => x.number === number)) fail('That tracking number is already on this order');
        o.tracking.push({ id: uid('trk'), number, carrier: t.carrier, units: t.units, shippedAt: now(), status: 'active' });
        checkTrackingTotal(o);
        log(o, `Added tracking ${number} (${t.carrier}, ${t.units} units)`);
        notifyStaff(d, o, `tracking ${number} added`);
        return `Tracking added to ${o.name}`;
      });
    },

    updateTracking(orderId: string, trackingId: string, t: { number: string; carrier: Carrier; units: number }) {
      return mutate((d) => {
        const o = findOrder(d, orderId);
        assertCanEdit(o);
        posInt(t.units);
        const v = viewOrder(o, d.arrivals).tracking.find((x) => x.id === trackingId) ?? fail('Tracking not found');
        if (v.received > 0) fail('The warehouse already received units on this tracking number — it can’t be changed');
        const tr = o.tracking.find((x) => x.id === trackingId)!;
        const before = `${tr.number} (${tr.carrier}, ${tr.units})`;
        Object.assign(tr, { number: t.number.trim(), carrier: t.carrier, units: t.units });
        checkTrackingTotal(o);
        log(o, `Changed tracking ${before} → ${tr.number} (${tr.carrier}, ${tr.units})`);
        notifyStaff(d, o, `tracking ${tr.number} changed`);
        return 'Tracking updated';
      });
    },

    removeTracking(orderId: string, trackingId: string) {
      return mutate((d) => {
        const o = findOrder(d, orderId);
        assertCanEdit(o);
        const v = viewOrder(o, d.arrivals).tracking.find((x) => x.id === trackingId) ?? fail('Tracking not found');
        if (v.received > 0) fail('The warehouse already received units on this tracking number — it can’t be removed');
        o.tracking = o.tracking.filter((x) => x.id !== trackingId);
        log(o, `Removed tracking ${v.number}`);
        notifyStaff(d, o, `tracking ${v.number} removed`);
        return 'Tracking removed';
      });
    },

    /** Returned to sender and resent under a new number: units count as on the way again. */
    returnTracking(orderId: string, trackingId: string, newNumber: string, carrier: Carrier) {
      return mutate((d) => {
        const o = findOrder(d, orderId);
        assertCanEdit(o);
        const v = viewOrder(o, d.arrivals).tracking.find((x) => x.id === trackingId) ?? fail('Tracking not found');
        if (v.status !== 'active') fail('Already returned');
        if (v.received > 0) fail('Units on this tracking already arrived');
        const num = newNumber.trim();
        if (!num) fail('Enter the new tracking number');
        const tr = o.tracking.find((x) => x.id === trackingId)!;
        const fresh = { id: uid('trk'), number: num, carrier, units: tr.units, shippedAt: now(), status: 'active' as const, replacesId: tr.id };
        tr.status = 'returned';
        tr.replacedById = fresh.id;
        o.tracking.push(fresh);
        log(o, `Tracking ${tr.number} returned — resent as ${num} (${carrier}, ${tr.units} units)`);
        notifyStaff(d, o, `tracking ${tr.number} resent as ${num}`);
        return 'Marked returned and resent';
      });
    },

    /* ---------------------------------------------------------- arrivals */
    addArrivals(rows: { productId: string; units: number; date: string; ref?: string; source: Arrival['source'] }[]) {
      return mutate((d) => {
        if (!rows.length) fail('Nothing to import');
        let n = 0;
        for (const r of rows) {
          posInt(r.units);
          ingestArrival(
            d,
            { productId: r.productId, units: r.units, date: r.date, source: r.source, ref: r.ref || `RCPT-${Math.floor(Math.random() * 90000 + 10000)}` },
            r.source === 'warehouse' ? 'Warehouse feed' : who(),
          );
          n += r.units;
        }
        d.settings.stockSyncedAt = now();
        return `${rows.length} arrival${rows.length > 1 ? 's' : ''} (${n} units) brought in and matched`;
      });
    },

    receiveForOrder(orderId: string, units: number) {
      return mutate((d) => {
        staffOnly();
        posInt(units);
        const o = findOrder(d, orderId);
        const v = viewOrder(o, d.arrivals);
        if (units > v.remaining) fail(`Only ${v.remaining} units left to come on ${o.name}`);
        const p = productOf(d, o.productId);
        const ref = `MAN-${Math.floor(Math.random() * 90000 + 10000)}`;
        d.arrivals.push({ id: uid('arr'), productId: p.id, units, date: now(), source: 'manual', ref, allocations: [{ orderId, units }] });
        p.warehouseStock += units;
        log(o, `${units} units arrived (received by hand, ${ref})`);
        d.movements.push({
          id: uid('mv'), productId: p.id, at: now(), type: 'arrival', delta: units, stockAfter: p.warehouseStock,
          text: `+${units} units arrived — matched ${units} to ${o.name}`, why: `Received by hand ${ref}`, by: who(),
        });
        return `${units} units received on ${o.name}`;
      });
    },

    setAllocations(arrivalId: string, allocations: Allocation[], why: string) {
      return mutate((d) => {
        staffOnly();
        const a = d.arrivals.find((x) => x.id === arrivalId) ?? fail('Arrival not found');
        const clean = allocations.filter((x) => x.units > 0);
        for (const x of clean) if (!Number.isInteger(x.units)) fail('Units must be whole numbers');
        const total = clean.reduce((n, x) => n + x.units, 0);
        if (total > a.units) fail(`You assigned ${total} units but the arrival has only ${a.units}`);
        const others = d.arrivals.filter((x) => x.id !== arrivalId);
        for (const x of clean) {
          if (!x.orderId) continue;
          const o = findOrder(d, x.orderId);
          if (o.productId !== a.productId) fail(`${o.name} is for a different product`);
          const room = o.units - others.reduce((n, ar) => n + ar.allocations.filter((al) => al.orderId === o.id).reduce((m, al) => m + al.units, 0), 0);
          if (x.units > room) fail(`${o.name} only has room for ${room} more units`);
        }
        // Describe the change per order.
        const key = (id: string | null) => id ?? '__none__';
        const before = new Map<string, number>();
        const after = new Map<string, number>();
        for (const x of a.allocations) before.set(key(x.orderId), (before.get(key(x.orderId)) ?? 0) + x.units);
        for (const x of clean) after.set(key(x.orderId), (after.get(key(x.orderId)) ?? 0) + x.units);
        const keys = new Set([...before.keys(), ...after.keys()]);
        const parts: string[] = [];
        for (const k of keys) {
          const delta = (after.get(k) ?? 0) - (before.get(k) ?? 0);
          if (!delta) continue;
          const label = k === '__none__' ? '“not from an order”' : d.orders.find((o) => o.id === k)?.name ?? '?';
          parts.push(`${delta > 0 ? '+' : ''}${delta} ${label}`);
          if (k !== '__none__') {
            const o = d.orders.find((x) => x.id === k);
            if (o) log(o, `Arrival ${a.ref}: ${delta > 0 ? '+' : ''}${delta} units matched by hand`);
          }
        }
        if (!parts.length) return 'Nothing changed';
        const un = a.units - total;
        a.allocations = clean;
        d.movements.push({
          id: uid('mv'), productId: a.productId, at: now(), type: 'rematch', delta: 0,
          text: `Receipt ${a.ref} re-matched: ${parts.join(', ')}${un ? ` (${un} still unmatched)` : ''}`,
          why: why.trim() || 'Fixed by hand', by: who(),
        });
        return 'Match updated';
      });
    },

    /* ------------------------------------------------------------- sales */
    logManualSale(productId: string, units: number, note: string) {
      return mutate((d) => {
        staffOnly();
        posInt(units);
        const p = productOf(d, productId);
        if (units > p.warehouseStock) fail(`Only ${p.warehouseStock} units in the warehouse`);
        p.warehouseStock -= units;
        d.sales.push({ id: uid('sale'), day: storeDay(), productId, units, source: 'manual', note: note.trim() });
        d.movements.push({
          id: uid('mv'), productId, at: now(), type: 'manual_sale', delta: -units, stockAfter: p.warehouseStock,
          text: `−${units} units manual sale`, why: note.trim() || 'Sold outside the store', by: who(),
        });
        return `Logged ${units} units sold`;
      });
    },

    importSales(rows: { day: string; sku: string; qty: number }[]) {
      let skipped: string[] = [];
      const ok = mutate((d) => {
        staffOnly();
        if (!rows.length) fail('No valid rows — use day,sku,qty (YYYY-MM-DD)');
        let units = 0;
        skipped = [];
        for (const r of rows) {
          const p = d.products.find((x) => x.skus.some((s) => s.sku.toLowerCase() === r.sku.toLowerCase()));
          if (!p) {
            skipped.push(r.sku);
            continue;
          }
          const sku = p.skus.find((s) => s.sku.toLowerCase() === r.sku.toLowerCase())!;
          d.sales.push({ id: uid('sale'), day: r.day, productId: p.id, sku: sku.sku, qty: r.qty, units: r.qty * sku.units, source: 'import' });
          units += r.qty * sku.units;
        }
        if (units === 0 && skipped.length) fail(`No rows matched a product (unknown: ${[...new Set(skipped)].join(', ')})`);
        d.settings.salesSyncedAt = now();
        return `Imported ${units} units of sales${skipped.length ? ` — skipped unknown: ${[...new Set(skipped)].join(', ')}` : ''}`;
      });
      return ok;
    },

    /* ---------------------------------------------------------- settings */
    saveSettings(patch: Partial<DB['settings']>) {
      return mutate((d) => {
        staffOnly();
        for (const k of ['leadTime', 'safetyDays', 'targetDays', 'alertDaysBefore'] as const) {
          if (k in patch) {
            const v = patch[k] as number;
            if (!Number.isInteger(v) || v < 0) fail('Days must be whole numbers, 0 or more');
          }
        }
        Object.assign(d.settings, patch);
        return 'Settings saved';
      });
    },

    upsertProduct(p: Product) {
      return mutate((d) => {
        staffOnly();
        if (!p.name.trim()) fail('Name is required');
        const code = p.code.trim().toUpperCase();
        if (!/^[A-Z0-9]{2,8}$/.test(code)) fail('Code: 2–8 letters or digits');
        if (d.products.some((x) => x.code === code && x.id !== p.id)) fail('Another product uses that code');
        const skus = p.skus.map((s) => ({ ...s, sku: s.sku.trim(), label: s.label.trim() })).filter((s) => s.sku);
        if (!skus.length) fail('Add at least one sales identifier (SKU)');
        for (const s of skus) if (!Number.isInteger(s.units) || s.units < 1) fail(`${s.sku}: units per sale must be 1 or more`);
        const all = d.products.filter((x) => x.id !== p.id).flatMap((x) => x.skus.map((s) => s.sku.toLowerCase()));
        for (const s of skus) if (all.includes(s.sku.toLowerCase())) fail(`SKU ${s.sku} already belongs to another product`);
        if (!Number.isInteger(p.warehouseStock) || p.warehouseStock < 0) fail('Warehouse stock must be 0 or more');
        if (!Number.isInteger(p.unshipped) || p.unshipped < 0) fail('Unshipped must be 0 or more');
        const existing = d.products.find((x) => x.id === p.id);
        const next = { ...p, name: p.name.trim(), code, skus };
        if (existing) {
          if (existing.warehouseStock !== next.warehouseStock) {
            d.movements.push({
              id: uid('mv'), productId: p.id, at: now(), type: 'adjustment', delta: next.warehouseStock - existing.warehouseStock,
              stockAfter: next.warehouseStock, text: `Stock adjusted ${existing.warehouseStock} → ${next.warehouseStock}`,
              why: 'Edited in Settings (stock count correction)', by: who(),
            });
          }
          Object.assign(existing, next);
        } else {
          d.products.push({ ...next, id: uid('prod'), orderSeq: 0 });
        }
        return `${next.name} saved`;
      });
    },

    deleteProduct(id: string) {
      return mutate((d) => {
        staffOnly();
        if (d.orders.some((o) => o.productId === id)) fail('This product has orders — delete those first');
        d.products = d.products.filter((p) => p.id !== id);
        d.sales = d.sales.filter((s) => s.productId !== id);
        d.arrivals = d.arrivals.filter((a) => a.productId !== id);
        d.movements = d.movements.filter((m) => m.productId !== id);
        return 'Product deleted';
      });
    },

    upsertSupplier(s: Supplier) {
      return mutate((d) => {
        staffOnly();
        if (!s.name.trim()) fail('Name is required');
        if (!/^[^@\s]+@[^@\s]+$/.test(s.email.trim())) fail('Enter a valid email');
        const ex = d.suppliers.find((x) => x.id === s.id);
        const next = { ...s, name: s.name.trim(), email: s.email.trim(), contact: s.contact.trim() };
        if (ex) Object.assign(ex, next);
        else d.suppliers.push({ ...next, id: uid('sup') });
        return `${next.name} saved`;
      });
    },

    deleteSupplier(id: string) {
      return mutate((d) => {
        staffOnly();
        if (d.orders.some((o) => o.supplierId === id)) fail('This supplier has orders — it can’t be deleted');
        if (d.products.some((p) => p.supplierId === id)) fail('A product uses this supplier as its default');
        d.suppliers = d.suppliers.filter((x) => x.id !== id);
        return 'Supplier deleted';
      });
    },

    /* ------------------------------------------------------------- email */
    sendEmail(e: { to: string; subject: string; body: string; kind: Email['kind'] }) {
      return mutate((d) => {
        const to = e.to.split(',').map((x) => x.trim()).filter(Boolean);
        if (!to.length) fail('No recipient');
        mail(d, { ...e, to });
        return `Email logged to the test outbox (nothing delivered)`;
      });
    },

    recordChase(orderId: string, kind: ChaseKind, msg: { to: string; subject: string; body: string }) {
      return mutate((d) => {
        staffOnly();
        const o = findOrder(d, orderId);
        o.lastChase[kind] = now();
        log(o, `Sent follow-up: ${CHASE_LABEL[kind]}`);
        mail(d, { kind: 'chase', to: [msg.to], subject: msg.subject, body: msg.body });
        return `Follow-up for ${o.name} sent (test outbox)`;
      });
    },

    sendReorderAlert(test: boolean) {
      return mutate((d) => {
        const recips = d.settings.alertRecipients.split(',').map((x) => x.trim()).filter(Boolean);
        if (!recips.length) fail('Add at least one recipient');
        const { now: n, soon } = reorderLists(d);
        const e = reorderEmail(n, soon, d.settings.alertDaysBefore);
        mail(d, { kind: test ? 'test' : 'reorder_alert', to: recips, subject: (test ? '[TEST] ' : '') + e.subject, body: e.body });
        if (!test) d.settings.lastAlertDay = storeDay();
        return test ? 'Test alert written to the outbox (nothing delivered)' : 'Reorder alert sent';
      });
    },

    clearOutbox() {
      return mutate((d) => {
        d.outbox = [];
        return 'Outbox cleared';
      });
    },

    /* -------------------------------------------------------------- demo */
    /** Simulates the 15-minute warehouse + sales sync: refresh timestamps and receive one shipment. */
    simulateSync() {
      return mutate((d) => {
        d.settings.stockSyncedAt = now();
        d.settings.salesSyncedAt = now();
        const candidates = d.orders
          .map((o) => viewOrder(o, d.arrivals))
          .filter((v) => v.open && v.onTheWay > 0)
          .sort((a, b) => a.order.createdAt.localeCompare(b.order.createdAt));
        const v = candidates[0];
        if (!v) return 'Synced — no shipments arrived';
        const t = v.tracking.filter((x) => x.status === 'active' && x.remaining > 0).sort((a, b) => a.shippedAt.localeCompare(b.shippedAt))[0];
        const units = t ? t.remaining : v.onTheWay;
        ingestArrival(
          d,
          { productId: v.order.productId, units, date: now(), source: 'warehouse', ref: `WH-${Math.floor(Math.random() * 9000 + 11000)}` },
          'Warehouse feed',
        );
        const p = d.products.find((x) => x.id === v.order.productId)!;
        return `Synced — warehouse received ${units} × ${p.code}`;
      });
    },

    resetDemo() {
      replace(makeSeed());
    },
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>(loadDB);
  const [session, setSession] = useState<Session | null>(() => {
    // Shareable demo links: ?as=staff or ?as=<supplierId> signs straight in.
    const as = new URLSearchParams(window.location.search).get('as');
    if (as) {
      const sup = db.suppliers.find((s) => s.id === as);
      const s: Session | null =
        as === 'staff'
          ? { role: 'staff', ...STAFF_USER }
          : sup
            ? { role: 'supplier', name: `${sup.contact} (${sup.name})`, email: sup.email, supplierId: sup.id }
            : null;
      if (s) {
        safeSet(SESSION_KEY, JSON.stringify(s));
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
        return s;
      }
    }
    try {
      return JSON.parse(safeGet(SESSION_KEY) ?? 'null');
    } catch {
      return null;
    }
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dbRef = useRef(db);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  const commit = useCallback((next: DB) => {
    dbRef.current = next;
    setDb(next);
    safeSet(DB_KEY, JSON.stringify(next));
  }, []);

  const mutate = useCallback(
    (fn: (d: DB) => string | void) => {
      const draft = structuredClone(dbRef.current);
      try {
        const msg = fn(draft);
        draft.touched = true;
        commit(draft);
        if (msg) toast(msg);
        return true;
      } catch (e) {
        if (e instanceof ActionError) toast(e.message, 'error');
        else {
          console.error(e);
          toast('Something went wrong', 'error');
        }
        return false;
      }
    },
    [commit, toast],
  );

  const act = useMemo(
    () =>
      makeActions(mutate, () => sessionRef.current, (fresh) => {
        commit(fresh);
        toast('Demo data reset');
      }),
    [mutate, commit, toast],
  );

  // Daily reorder alert email (test outbox) — fires once per store day when enabled.
  useEffect(() => {
    const s = dbRef.current.settings;
    if (session?.role === 'staff' && s.alertsEnabled && s.lastAlertDay !== storeDay()) {
      const { now: n, soon } = reorderLists(dbRef.current);
      if (n.length || soon.length) {
        const draft = structuredClone(dbRef.current);
        const e = reorderEmail(n, soon, s.alertDaysBefore);
        draft.outbox.unshift({
          id: uid('mail'), at: new Date().toISOString(), kind: 'reorder_alert',
          to: s.alertRecipients.split(',').map((x) => x.trim()).filter(Boolean), subject: e.subject, body: e.body,
        });
        draft.settings.lastAlertDay = storeDay();
        commit(draft);
      }
    }
  }, [session, commit]);

  const login = useCallback((s: Session) => {
    setSession(s);
    safeSet(SESSION_KEY, JSON.stringify(s));
  }, []);
  const logout = useCallback(() => {
    setSession(null);
    safeSet(SESSION_KEY, null);
  }, []);

  const value = useMemo(() => ({ db, session, login, logout, toasts, toast, act }), [db, session, login, logout, toasts, toast, act]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
