import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { CHASE_LABEL, chasesFor, forecast, viewOrder, type Chase } from '../lib/calc';
import { chaseMessage } from '../lib/messages';
import { ago, fmtDay, storeDay } from '../lib/time';
import { Badge, Button, Card, Empty, fmt1, fmtInt, PageHeader } from '../components/ui';
import { MessageModal } from '../components/forms';
import { FlagBadges } from './StockPage';

export function useAlerts() {
  const { db } = useStore();
  return useMemo(() => {
    const views = db.orders.map((o) => viewOrder(o, db.arrivals));
    const chases = views.flatMap((v) => chasesFor(v));
    const fs = db.products.map((p) => forecast(db, p, storeDay(), views));
    return {
      due: chases.filter((c) => c.due),
      snoozed: chases.filter((c) => !c.due),
      reorderNow: fs.filter((f) => f.flags.reorderNow),
      reorderSoon: fs.filter((f) => f.flags.reorderSoon),
    };
  }, [db]);
}

export function AlertsPage({ go }: { go: (route: string) => void }) {
  const { db, session, act } = useStore();
  const { due, snoozed, reorderNow, reorderSoon } = useAlerts();
  const [open, setOpen] = useState<Chase | null>(null);
  const msg = open ? chaseMessage(db, open.view.order, open.kind, open.reason, session?.name ?? '') : { to: '', subject: '', body: '' };

  const row = (c: Chase) => {
    const p = db.products.find((x) => x.id === c.view.order.productId);
    const s = db.suppliers.find((x) => x.id === c.view.order.supplierId);
    return (
      <Card key={c.view.order.id + c.kind} className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={c.due ? 'amber' : 'slate'}>{CHASE_LABEL[c.kind]}</Badge>
            <span className="font-semibold">{c.view.order.name}</span>
            <span className="text-sm text-slate-500">{p?.name} · {s?.name}</span>
          </div>
          <div className="mt-1 text-sm text-slate-600">{c.reason}</div>
          {c.lastSent && <div className="text-xs text-slate-500">Last chased {ago(c.lastSent)}{!c.due && ` — repeats from ${fmtDay(c.nextOn!)}`}</div>}
        </div>
        <Button size="sm" variant={c.due ? 'primary' : 'secondary'} onClick={() => setOpen(c)}>{c.due ? 'Prepare follow-up' : 'Preview'}</Button>
      </Card>
    );
  };

  return (
    <div>
      <PageHeader title="Follow-ups" sub="Supplier orders that need chasing, and products to reorder." />

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-amber-800">Orders to chase <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-xs">{due.length}</span></h2>
        <p className="mb-2 text-xs text-slate-500">Ask to confirm: not confirmed 2+ days after ordering · Ask for tracking: confirmed 10+ days ago with units still untracked · Ask where it is: a shipment on the way more than 10 days. Each alert repeats at most every 2 days.</p>
        {due.length ? <div className="space-y-2">{due.map(row)}</div> : <Empty>No orders need chasing right now.</Empty>}
      </section>

      {snoozed.length > 0 && (
        <details className="mb-6">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">Recently chased — waiting <span className="ml-1 rounded-full bg-slate-200 px-1.5 text-xs">{snoozed.length}</span></summary>
          <div className="mt-2 space-y-2">{snoozed.map(row)}</div>
        </details>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-rose-700">Reorder now <span className="ml-1 rounded-full bg-rose-100 px-1.5 text-xs">{reorderNow.length}</span></h2>
        {reorderNow.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {reorderNow.map((f) => (
              <Card key={f.product.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold">{f.product.name}</div>
                  <FlagBadges f={f} compact />
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {f.flags.orderedNotEnough
                    ? `Even with ${fmtInt(f.ordered)} units on order, stock covers only ${fmt1(f.daysWithOrdered)} days — less than lead time + safety (${db.settings.leadTime + db.settings.safetyDays}).`
                    : `Nothing on order. ${fmt1(f.daysOfStock)} days of stock left.`}
                </div>
                <div className="mt-2 text-xs text-slate-500">Sells out {f.sellsOutOn ? fmtDay(f.sellsOutOn) : '—'} · suggested order <b className="text-slate-800">{fmtInt(f.suggestedOrder)}</b> units</div>
              </Card>
            ))}
          </div>
        ) : (
          <Empty>Nothing needs reordering now.</Empty>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Reorder soon — within {db.settings.alertDaysBefore} days <span className="ml-1 rounded-full bg-slate-200 px-1.5 text-xs">{reorderSoon.length}</span></h2>
        {reorderSoon.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {reorderSoon.map((f) => (
              <Card key={f.product.id} className="p-4 text-sm">
                <div className="font-semibold">{f.product.name}</div>
                <div className="mt-1 text-slate-600">Reorder by <b>{f.reorderBy ? fmtDay(f.reorderBy) : '—'}</b> · sells out {f.sellsOutOn ? fmtDay(f.sellsOutOn) : '—'} · suggested {fmtInt(f.suggestedOrder)} units</div>
              </Card>
            ))}
          </div>
        ) : (
          <Empty>No products reach their reorder date in the next {db.settings.alertDaysBefore} days.</Empty>
        )}
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => go('settings')}>Reorder email settings →</Button>
      </section>

      {open && (
        <MessageModal
          open
          onClose={() => setOpen(null)}
          title={`${CHASE_LABEL[open.kind]} — ${open.view.order.name}`}
          msg={msg}
          sendLabel="Send follow-up (test outbox)"
          onSend={() => act.recordChase(open.view.order.id, open.kind, msg)}
        />
      )}
    </div>
  );
}
