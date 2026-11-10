// Business rules (spec section 4). Pure functions only — easy to test.
import type { Arrival, ChaseKind, DB, Order, Product, Settings, Tracking } from './types';
import { addDays, daysSince, storeDay } from './time';

export const round1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* ---------------------------------------------------------------- orders */

export type OrderStatus =
  | 'cancelled'
  | 'closed'
  | 'received'
  | 'partial'
  | 'on_the_way'
  | 'in_production'
  | 'placed';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  cancelled: 'Cancelled',
  closed: 'Closed',
  received: 'Received',
  partial: 'Partial',
  on_the_way: 'On the way',
  in_production: 'In production',
  placed: 'Placed',
};

export interface TrackingView extends Tracking {
  received: number;
  remaining: number;
}

export interface OrderView {
  order: Order;
  arrived: number;
  activeTracked: number;
  untracked: number; // units with no tracking yet (and not arrived)
  placed: number;
  inProduction: number;
  onTheWay: number;
  remaining: number;
  confirmed: boolean;
  confirmedOn?: string; // ISO — when it first counted as confirmed
  status: OrderStatus;
  open: boolean;
  stage: 'on_the_way' | 'in_production' | 'placed' | 'done';
  tracking: TrackingView[];
}

export function arrivedForOrder(arrivals: Arrival[], orderId: string): number {
  let n = 0;
  for (const a of arrivals) for (const al of a.allocations) if (al.orderId === orderId) n += al.units;
  return n;
}

export function firstArrivalFor(arrivals: Arrival[], orderId: string): string | undefined {
  const dates = arrivals
    .filter((a) => a.allocations.some((al) => al.orderId === orderId && al.units > 0))
    .map((a) => a.date)
    .sort();
  return dates[0];
}

export function viewOrder(order: Order, arrivals: Arrival[]): OrderView {
  const arrived = arrivedForOrder(arrivals, order.id);
  const active = order.tracking
    .filter((t) => t.status === 'active')
    .sort((a, b) => a.shippedAt.localeCompare(b.shippedAt));
  const activeTracked = active.reduce((s, t) => s + t.units, 0);

  // Arrived units are attributed to tracking numbers oldest-shipment first.
  let pool = arrived;
  const tracking: TrackingView[] = order.tracking.map((t) => ({ ...t, received: 0, remaining: 0 }));
  for (const t of active) {
    const tv = tracking.find((x) => x.id === t.id)!;
    tv.received = Math.min(pool, t.units);
    tv.remaining = t.units - tv.received;
    pool -= tv.received;
  }

  const shipped = Math.min(order.units, Math.max(activeTracked, arrived));
  const untracked = Math.max(0, order.units - shipped);
  const onTheWay = Math.max(0, Math.min(activeTracked, order.units) - arrived);
  const remaining = Math.max(0, order.units - arrived);

  const firstTrack = active.map((t) => t.shippedAt).sort()[0];
  const firstArrival = firstArrivalFor(arrivals, order.id);
  const confirmedOn = [order.confirmedAt, firstTrack, firstArrival].filter(Boolean).sort()[0] as
    | string
    | undefined;
  const confirmed = Boolean(confirmedOn);

  let status: OrderStatus;
  if (order.cancelledAt) status = 'cancelled';
  else if (order.closedAt) status = 'closed';
  else if (arrived >= order.units) status = 'received';
  else if (arrived > 0) status = 'partial';
  else if (onTheWay > 0) status = 'on_the_way';
  else if (confirmed) status = 'in_production';
  else status = 'placed';

  const open = status === 'partial' || status === 'on_the_way' || status === 'in_production' || status === 'placed';

  const placed = open && !confirmed ? untracked : 0;
  const inProduction = open && confirmed ? untracked : 0;
  const otw = open ? onTheWay : 0;

  let stage: OrderView['stage'] = 'done';
  if (open) stage = otw > 0 ? 'on_the_way' : confirmed ? 'in_production' : 'placed';

  return {
    order,
    arrived,
    activeTracked,
    untracked,
    placed,
    inProduction,
    onTheWay: otw,
    remaining,
    confirmed,
    confirmedOn,
    status,
    open,
    stage,
    tracking,
  };
}

/* -------------------------------------------------------------- forecast */

export interface Forecast {
  product: Product;
  stock: number;
  unshipped: number;
  owedMoreThanStock: boolean;
  placed: number;
  inProduction: number;
  onTheWay: number;
  ordered: number;
  sold7: number;
  last3: number;
  prior4: number;
  dailyBurn: number;
  trend: number;
  adjustedBurn: number;
  daysOfStock: number | null;
  daysWithOrdered: number | null;
  sellsOutOn: string | null;
  reorderBy: string | null;
  suggestedOrder: number;
  flags: Flags;
}

export interface Flags {
  outOfStock: boolean;
  reorderNow: boolean;
  orderedNotEnough: boolean; // reorder now even though units are already on order
  low: 'urgent' | 'watch' | null;
  reorderSoon: boolean; // reorder-by date falls within alert window
}

export function unitsByDay(db: DB, productId: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of db.sales) if (s.productId === productId) m.set(s.day, (m.get(s.day) ?? 0) + s.units);
  return m;
}

export function forecast(db: DB, product: Product, today = storeDay(), views?: OrderView[]): Forecast {
  const s = db.settings;
  const byDay = unitsByDay(db, product.id);
  const sumDays = (from: number, to: number) => {
    let n = 0;
    for (let i = from; i <= to; i++) n += byDay.get(addDays(today, -i)) ?? 0;
    return n;
  };
  // "Last 7 days" = today and the 6 days before it (store time).
  const last3 = sumDays(0, 2);
  const prior4 = sumDays(3, 6);
  const sold7 = last3 + prior4;
  const dailyBurn = round1(sold7 / 7);
  const trend = prior4 === 0 ? 1 : clamp(last3 / 3 / (prior4 / 4), 0.5, 2);
  const adjustedBurn = round1(dailyBurn * trend);

  const ovs = (views ?? db.orders.map((o) => viewOrder(o, db.arrivals))).filter(
    (v) => v.order.productId === product.id && v.open,
  );
  const placed = ovs.reduce((n, v) => n + v.placed, 0);
  const inProduction = ovs.reduce((n, v) => n + v.inProduction, 0);
  const onTheWay = ovs.reduce((n, v) => n + v.onTheWay, 0);
  const ordered = placed + inProduction + onTheWay;
  const stock = product.warehouseStock;

  const daysOfStock = adjustedBurn > 0 ? stock / adjustedBurn : null;
  const daysWithOrdered = adjustedBurn > 0 ? (stock + ordered) / adjustedBurn : null;
  const sellsOutOn = daysOfStock === null ? null : addDays(today, Math.floor(daysOfStock));
  const reorderBy =
    daysWithOrdered === null ? null : addDays(today, Math.floor(daysWithOrdered - s.leadTime - s.safetyDays));
  // Round away float noise (105 × 7.4 = 777.0000000000001) before rounding up to whole units.
  const suggestedOrder = Math.max(0, Math.ceil(Math.round(((s.targetDays + s.leadTime) * adjustedBurn - stock - ordered) * 1e6) / 1e6));

  const reorderNow = daysWithOrdered !== null && daysWithOrdered < s.leadTime + s.safetyDays;
  const reorderSoon =
    !reorderNow &&
    daysWithOrdered !== null &&
    daysWithOrdered - s.leadTime - s.safetyDays <= s.alertDaysBefore;

  const flags: Flags = {
    outOfStock: stock <= 0,
    reorderNow,
    orderedNotEnough: reorderNow && ordered > 0,
    low:
      daysOfStock === null ? null : daysOfStock < 21 ? 'urgent' : daysOfStock < 45 ? 'watch' : null,
    reorderSoon,
  };

  return {
    product,
    stock,
    unshipped: product.unshipped,
    owedMoreThanStock: product.unshipped > stock,
    placed,
    inProduction,
    onTheWay,
    ordered,
    sold7,
    last3,
    prior4,
    dailyBurn,
    trend,
    adjustedBurn,
    daysOfStock,
    daysWithOrdered,
    sellsOutOn,
    reorderBy,
    suggestedOrder,
    flags,
  };
}

/** "Try an order": days of stock if `extra` more units were ordered today. Nothing saved. */
export function tryOrder(f: Forecast, extra: number): number | null {
  if (f.adjustedBurn <= 0) return null;
  return (f.stock + f.ordered + extra) / f.adjustedBurn;
}

/* ----------------------------------------------------------------- chase */

export interface Chase {
  kind: ChaseKind;
  view: OrderView;
  reason: string;
  due: boolean; // false = already chased within the last 2 days
  lastSent?: string;
  nextOn?: string;
}

export const CHASE_LABEL: Record<ChaseKind, string> = {
  confirm: 'Ask to confirm',
  tracking: 'Ask for tracking',
  where: 'Ask where it is',
};

export function chasesFor(v: OrderView, now = new Date()): Chase[] {
  if (!v.open) return [];
  const o = v.order;
  const out: Chase[] = [];
  const push = (kind: ChaseKind, reason: string) => {
    const last = o.lastChase[kind];
    const since = last ? daysSince(last, now) : Infinity;
    out.push({
      kind,
      view: v,
      reason,
      due: since >= 2,
      lastSent: last,
      nextOn: last ? addDays(storeDay(last), 2) : undefined,
    });
  };
  const age = daysSince(o.createdAt, now);
  if (!v.confirmed && age >= 2) push('confirm', `Placed ${age} days ago, not confirmed`);
  if (v.confirmed && v.confirmedOn && v.untracked > 0) {
    const c = daysSince(v.confirmedOn, now);
    if (c >= 10) push('tracking', `Confirmed ${c} days ago, ${v.untracked} units still without tracking`);
  }
  const late = v.tracking.filter(
    (t) => t.status === 'active' && t.remaining > 0 && daysSince(t.shippedAt, now) > 10,
  );
  if (late.length)
    push(
      'where',
      late.map((t) => `${t.number} on the way ${daysSince(t.shippedAt, now)} days`).join('; '),
    );
  return out;
}

/* -------------------------------------------------------------- matching */

/** Open orders for a product, oldest first, with room left for arrivals. */
export function openOrdersForMatch(db: DB, productId: string, ignoreArrivalId?: string) {
  const arrivals = ignoreArrivalId ? db.arrivals.filter((a) => a.id !== ignoreArrivalId) : db.arrivals;
  return db.orders
    .filter((o) => o.productId === productId && !o.cancelledAt && !o.closedAt)
    .map((o) => ({ order: o, room: Math.max(0, o.units - arrivedForOrder(arrivals, o.id)) }))
    .filter((x) => x.room > 0)
    .sort((a, b) => a.order.createdAt.localeCompare(b.order.createdAt));
}

/** Oldest open order first, spilling into the next. Remainder stays unmatched. */
export function autoMatch(db: DB, productId: string, units: number) {
  const allocations: { orderId: string; units: number }[] = [];
  let left = units;
  for (const { order, room } of openOrdersForMatch(db, productId)) {
    if (left <= 0) break;
    const take = Math.min(room, left);
    allocations.push({ orderId: order.id, units: take });
    left -= take;
  }
  return { allocations, unmatched: left };
}

export function unmatchedUnits(a: Arrival): number {
  return Math.max(0, a.units - a.allocations.reduce((n, x) => n + x.units, 0));
}

/* --------------------------------------------------------------- reorder */

export function reorderLists(db: DB, today = storeDay()) {
  const views = db.orders.map((o) => viewOrder(o, db.arrivals));
  const fs = db.products.map((p) => forecast(db, p, today, views));
  return {
    now: fs.filter((f) => f.flags.reorderNow),
    soon: fs.filter((f) => f.flags.reorderSoon),
  };
}

export function staleness(settings: Settings, now = new Date()) {
  const stockMins = (now.getTime() - new Date(settings.stockSyncedAt).getTime()) / 60000;
  const salesMins = (now.getTime() - new Date(settings.salesSyncedAt).getTime()) / 60000;
  return {
    stockStale: stockMins > 60, // warehouse feed runs every 15 min — >1h means it stopped
    salesStale: salesMins > 24 * 60,
  };
}
