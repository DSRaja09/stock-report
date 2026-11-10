import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { forecast, tryOrder, viewOrder, type Forecast } from '../lib/calc';
import { fmtDay, storeDay } from '../lib/time';
import { Badge, Button, Card, cx, fmt1, fmtInt, Input, PageHeader, Stat } from '../components/ui';
import { ManualSaleModal, OrderFormModal } from '../components/forms';

type Filter = 'all' | 'oos' | 'reorder' | 'urgent' | 'watch';

export function FlagBadges({ f, compact }: { f: Forecast; compact?: boolean }) {
  const out = [];
  if (f.flags.outOfStock) out.push(<Badge key="oos" tone="red">Out of stock</Badge>);
  if (f.flags.reorderNow)
    out.push(
      <Badge key="re" tone="red" title={f.flags.orderedNotEnough ? 'Even counting units already ordered, stock runs out before a new order can land' : 'Nothing on order covers lead time + safety days'}>
        Reorder now{compact ? '' : f.flags.orderedNotEnough ? ' — ordered units not enough' : ' — nothing on order'}
      </Badge>,
    );
  if (!f.flags.outOfStock && f.flags.low === 'urgent') out.push(<Badge key="lo" tone="amber">Low — urgent</Badge>);
  if (f.flags.low === 'watch') out.push(<Badge key="lw" tone="blue">Low — watch</Badge>);
  if (!out.length) out.push(<Badge key="ok" tone="green">OK</Badge>);
  return <div className="flex flex-wrap gap-1">{out}</div>;
}

function Trend({ f }: { f: Forecast }) {
  if (f.prior4 === 0) return <span className="text-slate-400">no prior sales</span>;
  const pct = Math.round((f.trend - 1) * 100);
  if (Math.abs(pct) < 5) return <span className="text-slate-500">steady</span>;
  return (
    <span className={pct > 0 ? 'text-emerald-700' : 'text-amber-700'} title={`Trend factor ×${f.trend.toFixed(2)} (last 3 days vs prior 4)`}>
      {pct > 0 ? '▲ speeding up' : '▼ slowing'} ×{f.trend.toFixed(2)}
    </span>
  );
}

function TryOrder({ f }: { f: Forecast }) {
  const [v, setV] = useState('');
  const n = Number(v);
  const days = v && n >= 0 ? tryOrder(f, n) : null;
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        placeholder="units"
        aria-label={`Try an order for ${f.product.name}`}
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="!w-20 !px-2 !py-1"
      />
      <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">
        {v === '' ? '' : days === null ? 'no sales' : <>→ <b className="text-slate-900">{fmt1(days)}</b> days</>}
      </span>
    </div>
  );
}

const daysTone = (d: number | null) => (d === null ? 'muted' : d < 21 ? 'red' : d < 45 ? 'amber' : undefined);

export function StockPage() {
  const { db, session } = useStore();
  const staff = session?.role === 'staff';
  const [filter, setFilter] = useState<Filter>('all');
  const [orderFor, setOrderFor] = useState<Forecast | null>(null);
  const [saleFor, setSaleFor] = useState<string | undefined | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const today = storeDay();

  const all = useMemo(() => {
    const views = db.orders.map((o) => viewOrder(o, db.arrivals));
    let products = db.products;
    if (session?.role === 'supplier') {
      const mine = new Set(db.orders.filter((o) => o.supplierId === session.supplierId).map((o) => o.productId));
      products = products.filter((p) => p.supplierId === session.supplierId || mine.has(p.id));
    }
    return products.map((p) => forecast(db, p, today, views));
  }, [db, today, session]);

  const counts = {
    oos: all.filter((f) => f.flags.outOfStock).length,
    reorder: all.filter((f) => f.flags.reorderNow).length,
    urgent: all.filter((f) => f.flags.low === 'urgent').length,
    watch: all.filter((f) => f.flags.low === 'watch').length,
  };
  const list = all.filter((f) =>
    filter === 'all' ? true : filter === 'oos' ? f.flags.outOfStock : filter === 'reorder' ? f.flags.reorderNow : f.flags.low === filter,
  );

  const chips: { k: Filter; label: string; n: number; tone: string }[] = [
    { k: 'all', label: 'All products', n: all.length, tone: 'bg-slate-800 text-white' },
    { k: 'oos', label: 'Out of stock', n: counts.oos, tone: 'bg-rose-600 text-white' },
    { k: 'reorder', label: 'Reorder now', n: counts.reorder, tone: 'bg-rose-600 text-white' },
    { k: 'urgent', label: 'Under 21 days', n: counts.urgent, tone: 'bg-amber-500 text-white' },
    { k: 'watch', label: 'Under 45 days', n: counts.watch, tone: 'bg-sky-600 text-white' },
  ];

  const s = db.settings;

  return (
    <div>
      <PageHeader
        title="Stock Report"
        sub={<>Today {fmtDay(today)} (Denver) · lead time {s.leadTime} d · safety {s.safetyDays} d · target {s.targetDays} d</>}
        actions={staff && (
          <>
            <Button onClick={() => setSaleFor(undefined)}>Log manual sale</Button>
            <Button variant="primary" onClick={() => setOrderFor(all[0] ?? null)}>New order</Button>
          </>
        )}
      />

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {chips.map((c) => (
          <button
            key={c.k}
            onClick={() => setFilter(c.k)}
            className={cx(
              'flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition',
              filter === c.k ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            {c.label}
            <span className={cx('rounded-full px-1.5 text-xs font-semibold', filter === c.k ? 'bg-white/20' : c.n ? c.tone : 'bg-slate-100 text-slate-500')}>{c.n}</span>
          </button>
        ))}
      </div>

      {/* Desktop table */}
      <Card className="hidden overflow-x-auto lg:block">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 font-medium">Product</th>
              <th className="px-2 py-2.5 text-right font-medium">In warehouse</th>
              <th className="px-2 py-2.5 text-right font-medium">Unshipped</th>
              <th className="px-2 py-2.5 text-right font-medium">Placed</th>
              <th className="px-2 py-2.5 text-right font-medium">In prod.</th>
              <th className="px-2 py-2.5 text-right font-medium">On the way</th>
              <th className="px-2 py-2.5 text-right font-medium">Sold 7d</th>
              <th className="px-2 py-2.5 text-right font-medium">Burn / day</th>
              <th className="px-2 py-2.5 text-right font-medium">Days of stock</th>
              <th className="px-3 py-2.5 font-medium">Try an order</th>
              <th className="px-3 py-2.5 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((f) => (
              <tr key={f.product.id} className="align-top hover:bg-slate-50/60">
                <td className="px-3 py-3">
                  <button className="text-left" onClick={() => setOpen(open === f.product.id ? null : f.product.id)}>
                    <div className="font-medium text-slate-900 hover:text-teal-700">{f.product.name}</div>
                    <div className="text-xs text-slate-500">{f.product.code} · {open === f.product.id ? 'hide details' : 'details'}</div>
                  </button>
                  {open === f.product.id && <Details f={f} staff={staff} onOrder={() => setOrderFor(f)} onSale={() => setSaleFor(f.product.id)} />}
                </td>
                <td className="px-2 py-3 text-right font-semibold tabular-nums">{fmtInt(f.stock)}</td>
                <td className={cx('px-2 py-3 text-right tabular-nums', f.owedMoreThanStock && 'font-semibold text-rose-600')} title={f.owedMoreThanStock ? 'Customers are owed more units than the warehouse holds' : undefined}>
                  {fmtInt(f.unshipped)}
                </td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{fmtInt(f.placed)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{fmtInt(f.inProduction)}</td>
                <td className="px-2 py-3 text-right tabular-nums text-slate-600">{fmtInt(f.onTheWay)}</td>
                <td className="px-2 py-3 text-right tabular-nums">{fmtInt(f.sold7)}</td>
                <td className="px-2 py-3 text-right tabular-nums">
                  <div className="font-semibold">{fmt1(f.adjustedBurn)}</div>
                  <div className="text-[11px] text-slate-500">avg {fmt1(f.dailyBurn)}</div>
                  <div className="text-[11px]"><Trend f={f} /></div>
                </td>
                <td className="px-2 py-3 text-right tabular-nums">
                  <div className={cx('font-semibold', daysTone(f.daysOfStock) === 'red' && 'text-rose-600', daysTone(f.daysOfStock) === 'amber' && 'text-amber-700')}>
                    {f.daysOfStock === null ? '' : fmt1(f.daysOfStock)}
                  </div>
                  {f.ordered > 0 && f.daysWithOrdered !== null && (
                    <div className="text-[11px] text-slate-500" title="Days with everything ordered">w/ ordered {fmt1(f.daysWithOrdered)}</div>
                  )}
                </td>
                <td className="px-3 py-3"><TryOrder f={f} /></td>
                <td className="px-3 py-3"><FlagBadges f={f} compact /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <div className="p-8 text-center text-sm text-slate-500">No products match this filter.</div>}
      </Card>

      {/* Mobile / tablet cards */}
      <div className="space-y-3 lg:hidden">
        {list.map((f) => (
          <Card key={f.product.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">{f.product.name}</div>
                <div className="text-xs text-slate-500">{f.product.code}</div>
              </div>
              <FlagBadges f={f} compact />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-3">
              <Stat label="In warehouse" value={fmtInt(f.stock)} />
              <Stat label="Unshipped" value={fmtInt(f.unshipped)} tone={f.owedMoreThanStock ? 'red' : undefined} sub={f.owedMoreThanStock ? 'more than stock' : undefined} />
              <Stat label="Sold 7 days" value={fmtInt(f.sold7)} />
              <Stat label="Placed" value={fmtInt(f.placed)} />
              <Stat label="In production" value={fmtInt(f.inProduction)} />
              <Stat label="On the way" value={fmtInt(f.onTheWay)} />
              <Stat label="Burn / day" value={fmt1(f.adjustedBurn)} sub={<>avg {fmt1(f.dailyBurn)} · <Trend f={f} /></>} />
              <Stat label="Days of stock" value={f.daysOfStock === null ? '—' : fmt1(f.daysOfStock)} tone={daysTone(f.daysOfStock)} />
              {f.ordered > 0 && <Stat label="W/ ordered" value={fmt1(f.daysWithOrdered)} />}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-600">Try an order</span>
                <TryOrder f={f} />
              </div>
              <Button size="sm" variant="ghost" onClick={() => setOpen(open === f.product.id ? null : f.product.id)}>
                {open === f.product.id ? 'Hide details' : 'Details'}
              </Button>
            </div>
            {open === f.product.id && <Details f={f} staff={staff} onOrder={() => setOrderFor(f)} onSale={() => setSaleFor(f.product.id)} />}
          </Card>
        ))}
        {!list.length && <div className="p-8 text-center text-sm text-slate-500">No products match this filter.</div>}
      </div>

      <OrderFormModal
        open={orderFor !== null}
        onClose={() => setOrderFor(null)}
        defaults={{ productId: orderFor?.product.id, units: orderFor?.suggestedOrder }}
      />
      <ManualSaleModal open={saleFor !== null} onClose={() => setSaleFor(null)} productId={saleFor ?? undefined} />
    </div>
  );
}

function Details({ f, staff, onOrder, onSale }: { f: Forecast; staff: boolean; onOrder: () => void; onSale: () => void }) {
  const { db } = useStore();
  const s = db.settings;
  return (
    <div className="mt-3 max-w-md rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
      <FlagBadges f={f} />
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt>Sold last 3 days / prior 4</dt><dd className="tabular-nums">{f.last3} / {f.prior4}</dd>
        <dt>Sells out on</dt><dd>{f.sellsOutOn ? fmtDay(f.sellsOutOn) : '—'}</dd>
        <dt>Reorder by</dt>
        <dd className={f.flags.reorderNow ? 'font-semibold text-rose-600' : ''}>
          {f.reorderBy ? fmtDay(f.reorderBy) : '—'}{f.flags.reorderNow ? ' (passed)' : ''}
        </dd>
        <dt>Suggested order</dt><dd className="font-semibold text-slate-900">{fmtInt(f.suggestedOrder)} units</dd>
        <dt>Days with everything ordered</dt><dd>{fmt1(f.daysWithOrdered)} (needs ≥ {s.leadTime + s.safetyDays})</dd>
        <dt>Sales IDs</dt><dd>{f.product.skus.map((k) => `${k.sku}${k.units > 1 ? ` (${k.label} = ${k.units})` : ''}`).join(', ')}</dd>
      </dl>
      {staff && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={onOrder}>Order {f.suggestedOrder > 0 ? `${fmtInt(f.suggestedOrder)} units` : ''}</Button>
          <Button size="sm" onClick={onSale}>Log manual sale</Button>
          <a href={`#history?product=${f.product.id}`} className="inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50">Stock history →</a>
        </div>
      )}
    </div>
  );
}
