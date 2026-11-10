import { describe, expect, it } from 'vitest';
import { autoMatch, chasesFor, forecast, tryOrder, viewOrder } from './calc';
import { makeSeed } from './seed';
import { addDays } from './time';
import type { DB, Order } from './types';

const TODAY = '2026-11-10';
const iso = (daysAgo: number) => `${addDays(TODAY, -daysAgo)}T18:00:00.000Z`; // noon Denver
const NOW = new Date(`${TODAY}T18:00:00.000Z`);

function baseDB(): DB {
  const db = makeSeed(NOW);
  db.products = [{ id: 'p', name: 'Test', code: 'TST', skus: [{ sku: 'T', label: '', units: 1 }], supplierId: 's1', warehouseStock: 100, unshipped: 0, orderSeq: 0 }];
  db.sales = [];
  db.orders = [];
  db.arrivals = [];
  return db;
}
const order = (o: Partial<Order>): Order => ({
  id: 'o', name: 'TST-001', productId: 'p', supplierId: 's1', units: 200, notes: '', createdAt: iso(5),
  tracking: [], history: [], lastChase: {}, ...o,
});

describe('forecast (spec section 4)', () => {
  it('computes burn, trend, days and suggested order exactly', () => {
    const db = baseDB();
    // prior 4 days: 4/day (16), last 3 days: 6/day (18). Older sales must be ignored.
    for (let i = 0; i < 3; i++) db.sales.push({ id: `a${i}`, day: addDays(TODAY, -i), productId: 'p', units: 6, source: 'store' });
    for (let i = 3; i < 7; i++) db.sales.push({ id: `b${i}`, day: addDays(TODAY, -i), productId: 'p', units: 4, source: 'store' });
    db.sales.push({ id: 'old', day: addDays(TODAY, -7), productId: 'p', units: 999, source: 'store' });
    db.orders = [order({})]; // 200 placed

    const f = forecast(db, db.products[0], TODAY);
    expect(f.sold7).toBe(34);
    expect(f.dailyBurn).toBe(4.9); // 34/7 = 4.857 → 4.9
    expect(f.trend).toBe(1.5); // (18/3)/(16/4)
    expect(f.adjustedBurn).toBe(7.4); // 4.9 × 1.5 = 7.35 → 7.4
    expect(f.placed).toBe(200);
    expect(f.daysOfStock).toBeCloseTo(100 / 7.4);
    expect(f.daysWithOrdered).toBeCloseTo(300 / 7.4);
    expect(f.sellsOutOn).toBe(addDays(TODAY, 13));
    expect(f.reorderBy).toBe(addDays(TODAY, Math.floor(300 / 7.4 - 45 - 14)));
    expect(f.suggestedOrder).toBe(477); // (60+45)×7.4 − 100 − 200 = 477
    expect(tryOrder(f, 500)).toBeCloseTo(800 / 7.4);
    expect(f.flags.reorderNow).toBe(true);
    expect(f.flags.orderedNotEnough).toBe(true);
    expect(f.flags.low).toBe('urgent');
  });

  it('clamps the trend between 0.5 and 2, and uses 1 when the prior 4 days had no sales', () => {
    const db = baseDB();
    db.sales.push({ id: 'x', day: TODAY, productId: 'p', units: 70, source: 'store' });
    expect(forecast(db, db.products[0], TODAY).trend).toBe(1);
    db.sales.push({ id: 'y', day: addDays(TODAY, -5), productId: 'p', units: 1, source: 'store' });
    expect(forecast(db, db.products[0], TODAY).trend).toBe(2);
    db.sales = [
      { id: 'a', day: TODAY, productId: 'p', units: 1, source: 'store' },
      { id: 'b', day: addDays(TODAY, -4), productId: 'p', units: 100, source: 'store' },
    ];
    expect(forecast(db, db.products[0], TODAY).trend).toBe(0.5);
  });

  it('leaves days blank when nothing sells and flags out of stock', () => {
    const db = baseDB();
    db.products[0].warehouseStock = 0;
    const f = forecast(db, db.products[0], TODAY);
    expect(f.daysOfStock).toBeNull();
    expect(f.flags.outOfStock).toBe(true);
    expect(f.flags.reorderNow).toBe(false);
  });

  it('only counts open orders toward stock numbers', () => {
    const db = baseDB();
    db.orders = [order({ id: 'c', cancelledAt: iso(1) }), order({ id: 'cl', closedAt: iso(1) })];
    const f = forecast(db, db.products[0], TODAY);
    expect(f.ordered).toBe(0);
  });
});

describe('order stages', () => {
  it('moves from placed → in production → on the way → partial → received', () => {
    const db = baseDB();
    let o = order({});
    expect(viewOrder(o, []).status).toBe('placed');
    o = { ...o, confirmedAt: iso(4) };
    let v = viewOrder(o, []);
    expect([v.status, v.inProduction, v.placed]).toEqual(['in_production', 200, 0]);
    o = { ...o, tracking: [{ id: 't', number: 'X', carrier: 'UPS', units: 120, shippedAt: iso(3), status: 'active' }] };
    v = viewOrder(o, []);
    expect([v.status, v.onTheWay, v.inProduction]).toEqual(['on_the_way', 120, 80]);
    db.arrivals = [{ id: 'a', productId: 'p', units: 50, date: iso(1), source: 'warehouse', ref: 'R', allocations: [{ orderId: 'o', units: 50 }] }];
    v = viewOrder(o, db.arrivals);
    expect([v.status, v.arrived, v.onTheWay, v.inProduction]).toEqual(['partial', 50, 70, 80]);
    expect(v.tracking[0].received).toBe(50);
    db.arrivals[0].allocations[0].units = 200;
    db.arrivals[0].units = 200;
    expect(viewOrder(o, db.arrivals).status).toBe('received');
  });

  it('counts an order as confirmed once it has tracking or an arrival', () => {
    const o = order({ tracking: [{ id: 't', number: 'X', carrier: 'UPS', units: 10, shippedAt: iso(1), status: 'active' }] });
    expect(viewOrder(o, []).confirmed).toBe(true);
    const arr = [{ id: 'a', productId: 'p', units: 5, date: iso(1), source: 'warehouse' as const, ref: 'R', allocations: [{ orderId: 'o', units: 5 }] }];
    expect(viewOrder(order({}), arr).confirmed).toBe(true);
  });

  it('a returned tracking stops counting; its replacement counts as on the way', () => {
    const o = order({
      confirmedAt: iso(9),
      tracking: [
        { id: 't1', number: 'OLD', carrier: 'DHL', units: 100, shippedAt: iso(8), status: 'returned', replacedById: 't2' },
        { id: 't2', number: 'NEW', carrier: 'DHL', units: 100, shippedAt: iso(1), status: 'active', replacesId: 't1' },
      ],
    });
    const v = viewOrder(o, []);
    expect(v.onTheWay).toBe(100);
    expect(v.inProduction).toBe(100);
  });
});

describe('arrival matching', () => {
  it('fills the oldest open order first and spills into the next', () => {
    const db = baseDB();
    db.orders = [
      order({ id: 'new', name: 'TST-002', units: 100, createdAt: iso(2) }),
      order({ id: 'old', name: 'TST-001', units: 100, createdAt: iso(20) }),
      order({ id: 'cx', name: 'TST-000', units: 100, createdAt: iso(30), cancelledAt: iso(29) }),
    ];
    db.arrivals = [{ id: 'a', productId: 'p', units: 60, date: iso(3), source: 'warehouse', ref: 'R', allocations: [{ orderId: 'old', units: 60 }] }];
    expect(autoMatch(db, 'p', 90)).toEqual({ allocations: [{ orderId: 'old', units: 40 }, { orderId: 'new', units: 50 }], unmatched: 0 });
    expect(autoMatch(db, 'p', 200).unmatched).toBe(60);
  });
});

describe('chase rules', () => {
  it('asks to confirm after 2 days, repeating at most every 2 days', () => {
    const o = order({ createdAt: iso(2) });
    expect(chasesFor(viewOrder(o, []), NOW).map((c) => [c.kind, c.due])).toEqual([['confirm', true]]);
    expect(chasesFor(viewOrder(order({ createdAt: iso(1) }), []), NOW)).toEqual([]);
    const chased = order({ createdAt: iso(5), lastChase: { confirm: iso(1) } });
    expect(chasesFor(viewOrder(chased, []), NOW)[0].due).toBe(false);
    const chased2 = order({ createdAt: iso(5), lastChase: { confirm: iso(2) } });
    expect(chasesFor(viewOrder(chased2, []), NOW)[0].due).toBe(true);
  });

  it('asks for tracking 10+ days after confirmation and where it is after 10+ days on the way', () => {
    const o = order({
      createdAt: iso(30),
      confirmedAt: iso(10),
      tracking: [{ id: 't', number: 'X', carrier: 'UPS', units: 50, shippedAt: iso(11), status: 'active' }],
    });
    // confirmedOn = earliest of confirmedAt and first tracking (11 days ago)
    const kinds = chasesFor(viewOrder(o, []), NOW).map((c) => c.kind);
    expect(kinds).toEqual(['tracking', 'where']);
    const ten = order({ createdAt: iso(30), confirmedAt: iso(30), units: 50, tracking: [{ id: 't', number: 'X', carrier: 'UPS', units: 50, shippedAt: iso(10), status: 'active' }] });
    expect(chasesFor(viewOrder(ten, []), NOW)).toEqual([]); // exactly 10 days is not "more than 10"
  });
});
