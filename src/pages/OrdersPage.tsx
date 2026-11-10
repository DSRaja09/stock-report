import { useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { CHASE_LABEL, chasesFor, STATUS_LABEL, viewOrder, type OrderStatus, type OrderView, type TrackingView } from '../lib/calc';
import { chaseMessage, orderMessage, trackingUrl } from '../lib/messages';
import { ago, daysSince, fmtDateTime, fmtDay, storeDay } from '../lib/time';
import type { ChaseKind, Order } from '../lib/types';
import { Badge, Button, Card, ConfirmModal, cx, Empty, Field, fmtInt, Input, Modal, PageHeader, Select, type Tone } from '../components/ui';
import { MessageModal, OrderFormModal, TrackingModal } from '../components/forms';

const STATUS_TONE: Record<OrderStatus, Tone> = {
  placed: 'slate',
  in_production: 'violet',
  on_the_way: 'blue',
  partial: 'teal',
  received: 'green',
  closed: 'slate',
  cancelled: 'red',
};

export function OrdersPage({ productFilter, setProductFilter }: { productFilter: string; setProductFilter: (p: string) => void }) {
  const { db, session } = useStore();
  const staff = session?.role === 'staff';
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const views = useMemo(() => {
    let v = db.orders.map((o) => viewOrder(o, db.arrivals));
    if (!staff) v = v.filter((x) => x.order.supplierId === session?.supplierId);
    if (productFilter) v = v.filter((x) => x.order.productId === productFilter);
    return v.sort((a, b) => b.order.createdAt.localeCompare(a.order.createdAt));
  }, [db, staff, session, productFilter]);

  const needsReview = staff ? [] : views.filter((v) => v.open && (!v.confirmed || v.untracked > 0));
  const reviewIds = new Set(needsReview.map((v) => v.order.id));
  const rest = views.filter((v) => !reviewIds.has(v.order.id));
  const group = (stage: OrderView['stage']) => rest.filter((v) => v.stage === stage);
  const done = (s: OrderStatus) => rest.filter((v) => v.status === s);

  const products = staff
    ? db.products
    : db.products.filter((p) => db.orders.some((o) => o.productId === p.id && o.supplierId === session?.supplierId));

  const card = (v: OrderView) => (
    <OrderCard key={v.order.id} v={v} expanded={expanded === v.order.id} onToggle={() => setExpanded(expanded === v.order.id ? null : v.order.id)} />
  );

  return (
    <div>
      <PageHeader
        title={staff ? 'Supplier orders' : 'Your orders'}
        sub={staff ? 'Every batch ordered from suppliers, by stage.' : `Signed in as ${session?.name}. Confirm orders and add tracking here.`}
        actions={staff && <Button variant="primary" onClick={() => setCreating(true)}>New order</Button>}
      />

      <div className="mb-4 max-w-xs">
        <Select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} aria-label="Filter by product">
          <option value="">All products</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
        </Select>
      </div>

      {!views.length && <Empty>No orders{productFilter ? ' for this product' : ''} yet.</Empty>}

      {!staff && (
        <Group title="Needs review" hint="Waiting for you to confirm, or to add tracking" tone="amber" items={needsReview} render={card} alwaysShow />
      )}
      <Group title="On the way" items={group('on_the_way')} render={card} />
      <Group title="In production" items={group('in_production')} render={card} />
      <Group title="Placed" hint="Not confirmed by the supplier yet" items={group('placed')} render={card} />

      {(done('received').length > 0 || done('closed').length > 0 || done('cancelled').length > 0) && (
        <div className="mt-6 space-y-2">
          <Folded title="Arrived" items={done('received')} render={card} />
          <Folded title="Closed" items={done('closed')} render={card} />
          <Folded title="Cancelled" items={done('cancelled')} render={card} />
        </div>
      )}

      <OrderFormModal
        open={creating}
        onClose={() => setCreating(false)}
        defaults={{ productId: productFilter || undefined }}
        onCreated={(o) => setExpanded(o.id)}
      />
    </div>
  );
}

function Group({ title, hint, items, render, tone, alwaysShow }: { title: string; hint?: string; items: OrderView[]; render: (v: OrderView) => ReactNode; tone?: 'amber'; alwaysShow?: boolean }) {
  if (!items.length && !alwaysShow) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-semibold text-slate-700">
        <span className={tone === 'amber' ? 'text-amber-700' : ''}>{title}</span>
        <span className="rounded-full bg-slate-200 px-1.5 text-xs text-slate-600">{items.length}</span>
        {hint && <span className="text-xs font-normal text-slate-500">{hint}</span>}
      </h2>
      {items.length ? <div className="space-y-2">{items.map(render)}</div> : <Empty>Nothing waiting for you. 🎉</Empty>}
    </section>
  );
}

function Folded({ title, items, render }: { title: string; items: OrderView[]; render: (v: OrderView) => ReactNode }) {
  if (!items.length) return null;
  return (
    <details className="group rounded-xl border border-slate-200 bg-slate-50/60">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-600">
        <span className="mr-1 inline-block transition group-open:rotate-90">▸</span> {title} <span className="ml-1 rounded-full bg-slate-200 px-1.5 text-xs">{items.length}</span>
      </summary>
      <div className="space-y-2 px-2 pb-2">{items.map(render)}</div>
    </details>
  );
}

function ProgressBar({ v }: { v: OrderView }) {
  const u = v.order.units || 1;
  const seg = [
    { n: v.arrived, c: 'bg-emerald-500', l: 'arrived' },
    { n: v.open ? v.onTheWay : 0, c: 'bg-sky-500', l: 'on the way' },
    { n: v.inProduction, c: 'bg-violet-400', l: 'in production' },
    { n: v.placed, c: 'bg-slate-300', l: 'placed' },
  ];
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
        {seg.map((s) => s.n > 0 && <div key={s.l} className={s.c} style={{ width: `${(Math.min(s.n, u) / u) * 100}%` }} />)}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
        {seg.filter((s) => s.n > 0).map((s) => (
          <span key={s.l} className="inline-flex items-center gap-1"><span className={cx('h-2 w-2 rounded-full', s.c)} />{fmtInt(s.n)} {s.l}</span>
        ))}
      </div>
    </div>
  );
}

function OrderCard({ v, expanded, onToggle }: { v: OrderView; expanded: boolean; onToggle: () => void }) {
  const { db, session, act } = useStore();
  const staff = session?.role === 'staff';
  const o = v.order;
  const p = db.products.find((x) => x.id === o.productId);
  const sup = db.suppliers.find((x) => x.id === o.supplierId);
  const chases = chasesFor(v);

  const [edit, setEdit] = useState(false);
  const [trk, setTrk] = useState<{ mode: 'add' | 'edit' | 'return'; id?: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [stateOp, setStateOp] = useState<'cancel' | 'close' | 'reopen' | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ kind: 'order' | ChaseKind; reason?: string } | null>(null);
  const [receive, setReceive] = useState(false);
  const [recvUnits, setRecvUnits] = useState('');

  const from = staff ? `${session?.name}` : '';
  const message = msg
    ? msg.kind === 'order'
      ? orderMessage(db, o, from)
      : chaseMessage(db, o, msg.kind, msg.reason ?? '', from)
    : { to: '', subject: '', body: '' };

  const canSupplierEdit = !staff && v.open;

  return (
    <Card className={cx('overflow-hidden', expanded && 'ring-1 ring-teal-600/30')}>
      <button onClick={onToggle} className="block w-full p-4 text-left hover:bg-slate-50/70">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{o.name}</span>
              <Badge tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</Badge>
              {staff && chases.filter((c) => c.due).map((c) => <Badge key={c.kind} tone="amber">{CHASE_LABEL[c.kind]}</Badge>)}
            </div>
            <div className="mt-0.5 truncate text-sm text-slate-500">
              {p?.name} · {sup?.name} · ordered {fmtDay(storeDay(o.createdAt))}
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums">{fmtInt(o.units)}</div>
            <div className="text-[11px] text-slate-500">units</div>
          </div>
        </div>
        <div className="mt-3"><ProgressBar v={v} /></div>
      </button>

      {expanded && (
        <div className="space-y-5 border-t border-slate-100 bg-slate-50/50 p-4">
          {o.notes && <p className="text-sm text-slate-600"><span className="font-medium text-slate-700">Notes:</span> {o.notes}</p>}

          {/* actions */}
          <div className="flex flex-wrap gap-2">
            {!v.confirmed && v.open && (staff || canSupplierEdit) && (
              <Button size="sm" variant="primary" onClick={() => act.confirmOrder(o.id)}>Mark confirmed</Button>
            )}
            {v.open && v.untracked > 0 && (staff || canSupplierEdit) && (
              <Button size="sm" variant={staff ? 'secondary' : 'primary'} onClick={() => setTrk({ mode: 'add' })}>Add tracking</Button>
            )}
            {staff && (
              <>
                {v.open && <Button size="sm" onClick={() => { setRecvUnits(String(v.remaining)); setReceive(true); }}>Receive units</Button>}
                <Button size="sm" onClick={() => setMsg({ kind: 'order' })}>Order message</Button>
                <Button size="sm" onClick={() => setEdit(true)}>Edit</Button>
                {v.open && <Button size="sm" onClick={() => { setReason(''); setStateOp('close'); }}>Close (no more coming)</Button>}
                {v.open && <Button size="sm" onClick={() => { setReason(''); setStateOp('cancel'); }}>Cancel order</Button>}
                {(o.cancelledAt || o.closedAt) && <Button size="sm" onClick={() => { setReason(''); setStateOp('reopen'); }}>Reopen</Button>}
                <Button size="sm" variant="ghost" className="!text-rose-600" onClick={() => setConfirmDel(true)}>Delete</Button>
              </>
            )}
          </div>

          {/* chase */}
          {staff && chases.length > 0 && (
            <div className="space-y-2">
              {chases.map((c) => (
                <div key={c.kind} className={cx('flex flex-wrap items-center justify-between gap-2 rounded-lg p-3 text-sm', c.due ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-600')}>
                  <div>
                    <b>{CHASE_LABEL[c.kind]}</b> — {c.reason}
                    {!c.due && c.lastSent && <div className="text-xs">Chased {ago(c.lastSent)}; repeats from {fmtDay(c.nextOn!)}</div>}
                  </div>
                  <Button size="sm" variant={c.due ? 'primary' : 'secondary'} onClick={() => setMsg({ kind: c.kind, reason: c.reason })}>
                    {c.due ? 'Prepare follow-up' : 'Preview'}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* numbers */}
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {[
              ['Ordered', o.units],
              ['Arrived', v.arrived],
              ['On the way', v.onTheWay],
              ['Without tracking', v.untracked],
              ['Still to come', v.open ? v.remaining : 0],
            ].map(([l, n]) => (
              <div key={l as string} className="rounded-lg bg-white p-2.5 ring-1 ring-slate-200">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">{l}</div>
                <div className="font-semibold tabular-nums">{fmtInt(n as number)}</div>
              </div>
            ))}
          </div>

          {/* tracking */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Tracking</h3>
            {v.tracking.length === 0 ? (
              <p className="text-sm text-slate-500">No tracking yet.{v.open ? ' Tracking can be added in parts as shipments go out.' : ''}</p>
            ) : (
              <ul className="space-y-2">
                {v.tracking.map((t) => (
                  <TrackingRow key={t.id} t={t} order={o} canEdit={staff || canSupplierEdit} onEdit={() => setTrk({ mode: 'edit', id: t.id })} onReturn={() => setTrk({ mode: 'return', id: t.id })} onRemove={() => act.removeTracking(o.id, t.id)} />
                ))}
              </ul>
            )}
          </div>

          {/* history */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">History</h3>
            <ol className="space-y-1.5 border-l-2 border-slate-200 pl-3 text-sm">
              {[...o.history].reverse().map((h, i) => (
                <li key={i}>
                  <span className="text-slate-800">{h.text}</span>
                  <div className="text-xs text-slate-500">{h.by} · {fmtDateTime(h.at)}</div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {/* modals */}
      <OrderFormModal open={edit} onClose={() => setEdit(false)} order={o} />
      {trk && (
        <TrackingModal open onClose={() => setTrk(null)} order={o} trackingId={trk.id} mode={trk.mode} maxUnits={v.untracked} />
      )}
      <ConfirmModal
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        danger
        title={`Delete ${o.name}?`}
        confirmLabel="Delete order"
        body={<>This removes the order and its history for good. {v.arrived > 0 && <b>{v.arrived} units already matched to it will show as unmatched arrivals.</b>} To keep a record, cancel or close it instead.</>}
        onConfirm={() => act.deleteOrder(o.id)}
      />
      <Modal open={stateOp !== null} onClose={() => setStateOp(null)} title={stateOp === 'cancel' ? `Cancel ${o.name}` : stateOp === 'close' ? `Close ${o.name}` : `Reopen ${o.name}`}>
        <p className="mb-3 text-sm text-slate-600">
          {stateOp === 'cancel' && 'The order stops counting toward stock. You can reopen it later.'}
          {stateOp === 'close' && `No more units are coming. The ${v.remaining} units still outstanding stop counting toward stock.`}
          {stateOp === 'reopen' && 'The order counts toward stock again.'}
        </p>
        <Field label="Reason (optional, saved in history)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setStateOp(null)}>Back</Button>
          <Button variant={stateOp === 'cancel' ? 'danger' : 'primary'} onClick={() => { if (act.setOrderState(o.id, stateOp!, reason)) setStateOp(null); }}>
            {stateOp === 'cancel' ? 'Cancel order' : stateOp === 'close' ? 'Close order' : 'Reopen'}
          </Button>
        </div>
      </Modal>
      <Modal open={receive} onClose={() => setReceive(false)} title={`Receive units on ${o.name}`}>
        <p className="mb-3 text-sm text-slate-600">Use this when the warehouse confirms a delivery by hand. Arrivals from the warehouse feed are matched automatically on the Arrivals page.</p>
        <Field label="Units arrived" hint={`${v.remaining} still to come`}>
          <Input type="number" min={1} step={1} value={recvUnits} onChange={(e) => setRecvUnits(e.target.value)} />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setReceive(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => { if (act.receiveForOrder(o.id, Number(recvUnits))) setReceive(false); }}>Receive</Button>
        </div>
      </Modal>
      {msg && (
        <MessageModal
          open
          onClose={() => setMsg(null)}
          title={msg.kind === 'order' ? `Order message — ${o.name}` : `${CHASE_LABEL[msg.kind]} — ${o.name}`}
          msg={message}
          sendLabel={msg.kind === 'order' ? 'Send (test outbox)' : 'Send follow-up (test outbox)'}
          onSend={() =>
            msg.kind === 'order'
              ? act.sendEmail({ ...message, kind: 'order' })
              : act.recordChase(o.id, msg.kind, message)
          }
        />
      )}
    </Card>
  );
}

function TrackingRow({ t, order, canEdit, onEdit, onReturn, onRemove }: { t: TrackingView; order: Order; canEdit: boolean; onEdit: () => void; onReturn: () => void; onRemove: () => void }) {
  const url = trackingUrl(t.carrier, t.number);
  const replacement = t.replacedById ? order.tracking.find((x) => x.id === t.replacedById) : undefined;
  const replaces = t.replacesId ? order.tracking.find((x) => x.id === t.replacesId) : undefined;
  const locked = t.received > 0;
  const returned = t.status === 'returned';
  return (
    <li className={cx('rounded-lg bg-white p-3 text-sm ring-1 ring-slate-200', returned && 'opacity-60')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" className={cx('break-all font-mono text-teal-700 underline-offset-2 hover:underline', returned && 'line-through')}>{t.number}</a>
            ) : (
              <span className={cx('break-all font-mono', returned && 'line-through')}>{t.number}</span>
            )}
            <Badge>{t.carrier}</Badge>
            {returned && <Badge tone="amber">Returned{replacement ? ` → ${replacement.number}` : ''}</Badge>}
            {replaces && <Badge tone="blue">Resent (was {replaces.number})</Badge>}
            {!returned && t.remaining === 0 && <Badge tone="green">Received</Badge>}
            {!returned && t.received > 0 && t.remaining > 0 && <Badge tone="teal">{t.received} received</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {t.units} units · shipped {fmtDay(storeDay(t.shippedAt))}
            {!returned && t.remaining > 0 && ` · on the way ${daysSince(t.shippedAt)} days`}
          </div>
        </div>
        {canEdit && !returned && (
          locked ? (
            <span className="text-xs text-slate-400" title="The warehouse already received units on this tracking number">Locked — received</span>
          ) : (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={onEdit}>Change</Button>
              <Button size="sm" variant="ghost" onClick={onReturn}>Returned…</Button>
              <Button size="sm" variant="ghost" className="!text-rose-600" onClick={onRemove}>Remove</Button>
            </div>
          )
        )}
      </div>
    </li>
  );
}
