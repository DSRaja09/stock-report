import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { arrivedForOrder, unmatchedUnits } from '../lib/calc';
import type { Arrival } from '../lib/types';
import { fmtDateTime, isoAt, storeDay } from '../lib/time';
import { Badge, Button, Card, cx, Empty, Field, fmtInt, Input, Modal, PageHeader, Select, Textarea } from '../components/ui';

export function ArrivalsPage() {
  const { db, act } = useStore();
  const [fix, setFix] = useState<Arrival | null>(null);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [product, setProduct] = useState('');

  const sorted = useMemo(
    () => [...db.arrivals].filter((a) => !product || a.productId === product).sort((a, b) => b.date.localeCompare(a.date)),
    [db.arrivals, product],
  );
  const unmatched = sorted.filter((a) => unmatchedUnits(a) > 0);

  return (
    <div>
      <PageHeader
        title="Warehouse arrivals"
        sub="Receipts from the warehouse system (every 15 min in production). Matched to open orders automatically — oldest order first."
        actions={
          <>
            <Button onClick={() => act.simulateSync()}>Run warehouse sync</Button>
            <Button onClick={() => setImporting(true)}>Import CSV</Button>
            <Button variant="primary" onClick={() => setAdding(true)}>Add arrival</Button>
          </>
        }
      />

      <div className="mb-4 max-w-xs">
        <Select value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Filter by product">
          <option value="">All products</option>
          {db.products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
        </Select>
      </div>

      <section className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-700">
          Needs attention — matched no order <span className="rounded-full bg-rose-100 px-1.5 text-xs">{unmatched.length}</span>
        </h2>
        {unmatched.length === 0 ? (
          <Empty>Every arrival is matched. ✓</Empty>
        ) : (
          <div className="space-y-2">{unmatched.map((a) => <ArrivalRow key={a.id} a={a} onFix={() => setFix(a)} highlight />)}</div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">All arrivals</h2>
        <div className="space-y-2">{sorted.map((a) => <ArrivalRow key={a.id} a={a} onFix={() => setFix(a)} />)}</div>
      </section>

      {fix && <AllocationModal arrival={db.arrivals.find((x) => x.id === fix.id)!} onClose={() => setFix(null)} />}
      <ImportModal open={importing} onClose={() => setImporting(false)} />
      <AddArrivalModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function ArrivalRow({ a, onFix, highlight }: { a: Arrival; onFix: () => void; highlight?: boolean }) {
  const { db, session } = useStore();
  const p = db.products.find((x) => x.id === a.productId);
  const un = unmatchedUnits(a);
  return (
    <Card className={cx('p-4', highlight && 'border-rose-200 bg-rose-50/40')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{p?.name ?? 'Unknown product'}</span>
            <span className="text-xs text-slate-500">{p?.code}</span>
            <Badge>{a.ref}</Badge>
            {un > 0 && <Badge tone="red">{un} unmatched</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {fmtDateTime(a.date)} · {a.source === 'warehouse' ? 'warehouse feed' : a.source === 'import' ? 'imported' : 'received by hand'}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {a.allocations.map((al, i) => {
              const o = db.orders.find((x) => x.id === al.orderId);
              return (
                <span key={i} className="rounded-md bg-slate-100 px-2 py-0.5">
                  {al.orderId ? (o ? <b>{o.name}</b> : <i>deleted order</i>) : <i>not from an order</i>}: {al.units}
                </span>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums">+{fmtInt(a.units)}</div>
            <div className="text-[11px] text-slate-500">units</div>
          </div>
          {session?.role === 'staff' && <Button size="sm" onClick={onFix}>{un > 0 ? 'Match' : 'Fix match'}</Button>}
        </div>
      </div>
    </Card>
  );
}

function AllocationModal({ arrival, onClose }: { arrival: Arrival; onClose: () => void }) {
  const { db, act } = useStore();
  const others = db.arrivals.filter((x) => x.id !== arrival.id);
  // Candidate orders: any non-cancelled order for this product, plus ones already allocated.
  const candidates = db.orders
    .filter((o) => o.productId === arrival.productId && (!o.cancelledAt || arrival.allocations.some((al) => al.orderId === o.id)))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const [vals, setVals] = useState<Record<string, string>>({});
  const [why, setWhy] = useState('');
  useEffect(() => {
    const v: Record<string, string> = {};
    for (const al of arrival.allocations) v[al.orderId ?? 'none'] = String(al.units);
    setVals(v);
  }, [arrival]);

  const total = Object.values(vals).reduce((n, x) => n + (Number(x) || 0), 0);
  const left = arrival.units - total;
  const set = (k: string, v: string) => setVals((s) => ({ ...s, [k]: v }));

  const save = () => {
    const allocations = Object.entries(vals)
      .map(([k, v]) => ({ orderId: k === 'none' ? null : k, units: Number(v) || 0 }))
      .filter((x) => x.units > 0);
    if (act.setAllocations(arrival.id, allocations, why)) onClose();
  };

  const p = db.products.find((x) => x.id === arrival.productId);

  return (
    <Modal open onClose={onClose} title={`Match receipt ${arrival.ref}`} wide>
      <p className="mb-4 text-sm text-slate-600">
        {arrival.units} units of <b>{p?.name}</b> arrived {fmtDateTime(arrival.date)}. Split them across orders, or mark units as not from an order (returns, samples, miscounts).
      </p>
      <div className="space-y-2">
        {candidates.map((o) => {
          const elsewhere = arrivedForOrder(others, o.id);
          const room = Math.max(0, o.units - elsewhere);
          const closed = o.closedAt || o.cancelledAt;
          return (
            <div key={o.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
              <div className="min-w-0 text-sm">
                <div className="font-medium">{o.name} {closed && <Badge>{o.cancelledAt ? 'cancelled' : 'closed'}</Badge>}</div>
                <div className="text-xs text-slate-500">{o.units} ordered · {elsewhere} arrived on other receipts · room for {room}</div>
              </div>
              <div className="flex items-center gap-1">
                <Input type="number" min={0} step={1} className="!w-24" value={vals[o.id] ?? ''} placeholder="0" onChange={(e) => set(o.id, e.target.value)} aria-label={`Units for ${o.name}`} />
                <Button size="sm" variant="ghost" title="Fill" onClick={() => set(o.id, String(Math.min(room, (Number(vals[o.id]) || 0) + Math.max(0, left))))}>Fill</Button>
              </div>
            </div>
          );
        })}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 p-3">
          <div className="text-sm">
            <div className="font-medium">Not from an order</div>
            <div className="text-xs text-slate-500">Units that are in stock but don't belong to a supplier order</div>
          </div>
          <div className="flex items-center gap-1">
            <Input type="number" min={0} step={1} className="!w-24" value={vals.none ?? ''} placeholder="0" onChange={(e) => set('none', e.target.value)} aria-label="Units not from an order" />
            <Button size="sm" variant="ghost" onClick={() => set('none', String((Number(vals.none) || 0) + Math.max(0, left)))}>Fill</Button>
          </div>
        </div>
      </div>
      <div className={cx('mt-3 text-sm font-medium', left < 0 ? 'text-rose-600' : left > 0 ? 'text-amber-700' : 'text-emerald-700')}>
        {left < 0 ? `${-left} units too many` : left > 0 ? `${left} units still unmatched` : 'All units assigned ✓'}
      </div>
      <div className="mt-3">
        <Field label="Why (saved in stock history)">
          <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Packing slip says these belong to TMG-002" />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={left < 0} onClick={save}>Save match</Button>
      </div>
    </Modal>
  );
}

const SAMPLE_CSV = `code,units,date,ref
TMG,150,${storeDay()},WH-20001
CPO,40,${storeDay()},WH-20002`;

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, act, toast } = useStore();
  const [text, setText] = useState(SAMPLE_CSV);
  useEffect(() => { if (open) setText(SAMPLE_CSV); }, [open]);
  const run = () => {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    const rows = [];
    const errors: string[] = [];
    for (const [i, line] of lines.entries()) {
      const [code, units, date, ref] = line.split(',').map((x) => x.trim());
      if (i === 0 && code.toLowerCase() === 'code') continue;
      const p = db.products.find((x) => x.code.toLowerCase() === code?.toLowerCase());
      const n = Number(units);
      if (!p) { errors.push(`line ${i + 1}: unknown code "${code}"`); continue; }
      if (!Number.isInteger(n) || n <= 0) { errors.push(`line ${i + 1}: bad units`); continue; }
      const day = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : storeDay();
      rows.push({ productId: p.id, units: n, date: day === storeDay() ? new Date().toISOString() : isoAt(day, 12), ref, source: 'import' as const });
    }
    if (errors.length) { toast(errors.join('; '), 'error'); return; }
    if (act.addArrivals(rows)) onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Import arrivals (CSV)" wide>
      <p className="mb-2 text-sm text-slate-600">One receipt per line: <code className="rounded bg-slate-100 px-1">code,units,date,ref</code>. Date (YYYY-MM-DD) and ref are optional. Product codes: {db.products.map((p) => p.code).join(', ')}.</p>
      <Textarea rows={8} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={run}>Import & match</Button>
      </div>
    </Modal>
  );
}

function AddArrivalModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, act } = useStore();
  const [pid, setPid] = useState('');
  const [units, setUnits] = useState('');
  const [day, setDay] = useState(storeDay());
  const [ref, setRef] = useState('');
  useEffect(() => {
    if (open) { setPid(db.products[0]?.id ?? ''); setUnits(''); setDay(storeDay()); setRef(''); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} title="Add a warehouse arrival">
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        if (act.addArrivals([{ productId: pid, units: Number(units), date: day === storeDay() ? new Date().toISOString() : isoAt(day, 12), ref, source: 'import' }])) onClose();
      }}>
        <Field label="Product">
          <Select value={pid} onChange={(e) => setPid(e.target.value)}>
            {db.products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Units"><Input type="number" min={1} step={1} required value={units} onChange={(e) => setUnits(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" required value={day} max={storeDay()} onChange={(e) => setDay(e.target.value)} /></Field>
        </div>
        <Field label="Receipt reference (optional)"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="WH-…" /></Field>
        <p className="text-xs text-slate-500">Units are added to the warehouse and matched to the oldest open order first, spilling into the next.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Add & match</Button>
        </div>
      </form>
    </Modal>
  );
}
