import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import type { Product, Supplier } from '../lib/types';
import { ago, fmtDateTime, storeDay, addDays } from '../lib/time';
import { Badge, Button, Card, ConfirmModal, Field, Input, Modal, PageHeader, Select, Textarea } from '../components/ui';

function Section({ title, sub, children, actions }: { title: string; sub?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <Card className="mb-5 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {sub && <p className="text-sm text-slate-500">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Card>
  );
}

export function SettingsPage() {
  const { db, act } = useStore();
  const s = db.settings;
  const [f, setF] = useState({ leadTime: '', safetyDays: '', targetDays: '' });
  const [a, setA] = useState({ alertsEnabled: true, alertRecipients: '', alertDaysBefore: '', staffNotifyEmail: '' });
  const [editP, setEditP] = useState<Product | null>(null);
  const [editS, setEditS] = useState<Supplier | null>(null);
  const [delP, setDelP] = useState<Product | null>(null);
  const [delS, setDelS] = useState<Supplier | null>(null);
  const [reset, setReset] = useState(false);
  const [mailOpen, setMailOpen] = useState<string | null>(null);

  useEffect(() => {
    setF({ leadTime: String(s.leadTime), safetyDays: String(s.safetyDays), targetDays: String(s.targetDays) });
    setA({ alertsEnabled: s.alertsEnabled, alertRecipients: s.alertRecipients, alertDaysBefore: String(s.alertDaysBefore), staffNotifyEmail: s.staffNotifyEmail });
  }, [s]);

  const blankProduct = (): Product => ({
    id: '', name: '', code: '', skus: [{ sku: '', label: 'Single', units: 1 }], supplierId: db.suppliers[0]?.id ?? '',
    warehouseStock: 0, unshipped: 0, orderSeq: 0,
  });

  return (
    <div>
      <PageHeader title="Settings" />

      <Section title="Forecast settings" sub="One set of settings applies to every product.">
        <form
          className="grid gap-3 sm:grid-cols-4 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            act.saveSettings({ leadTime: Number(f.leadTime), safetyDays: Number(f.safetyDays), targetDays: Number(f.targetDays) });
          }}
        >
          <Field label="Lead time (days)" hint="Order → in warehouse"><Input type="number" min={0} value={f.leadTime} onChange={(e) => setF({ ...f, leadTime: e.target.value })} /></Field>
          <Field label="Safety (days)" hint="Buffer on top of lead time"><Input type="number" min={0} value={f.safetyDays} onChange={(e) => setF({ ...f, safetyDays: e.target.value })} /></Field>
          <Field label="Target (days)" hint="Stock to cover after arrival"><Input type="number" min={0} value={f.targetDays} onChange={(e) => setF({ ...f, targetDays: e.target.value })} /></Field>
          <div className="flex gap-2 pb-5">
            <Button type="submit" variant="primary">Save</Button>
            <Button type="button" variant="ghost" onClick={() => setF({ leadTime: '45', safetyDays: '14', targetDays: '60' })}>Defaults</Button>
          </div>
        </form>
      </Section>

      <Section title="Products" sub="Name, short code and the sales identifiers (SKUs) used to match sales. Bundles count every unit." actions={<Button size="sm" variant="primary" onClick={() => setEditP(blankProduct())}>Add product</Button>}>
        <div className="divide-y divide-slate-100">
          {db.products.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <div className="font-medium">{p.name} <span className="text-xs text-slate-500">{p.code}</span></div>
                <div className="text-xs text-slate-500">
                  {p.skus.map((k) => `${k.sku}${k.units > 1 ? ` ×${k.units}` : ''}`).join(' · ')} · {db.suppliers.find((x) => x.id === p.supplierId)?.name}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => setEditP(structuredClone(p))}>Edit</Button>
                <Button size="sm" variant="ghost" className="!text-rose-600" onClick={() => setDelP(p)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Suppliers" actions={<Button size="sm" variant="primary" onClick={() => setEditS({ id: '', name: '', contact: '', email: '' })}>Add supplier</Button>}>
        <div className="divide-y divide-slate-100">
          {db.suppliers.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <div className="font-medium">{x.name}</div>
                <div className="break-all text-xs text-slate-500">{x.contact} · {x.email}</div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => setEditS({ ...x })}>Edit</Button>
                <Button size="sm" variant="ghost" className="!text-rose-600" onClick={() => setDelS(x)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Reorder alert emails" sub="Lists products to reorder now and soon, with sells-out date, reorder-by date and suggested order. Sent once a day when there's something to report.">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            act.saveSettings({ alertsEnabled: a.alertsEnabled, alertRecipients: a.alertRecipients, alertDaysBefore: Number(a.alertDaysBefore), staffNotifyEmail: a.staffNotifyEmail });
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-teal-700" checked={a.alertsEnabled} onChange={(e) => setA({ ...a, alertsEnabled: e.target.checked })} />
            Send reorder alert emails
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2"><Field label="Recipients (comma separated)"><Input value={a.alertRecipients} onChange={(e) => setA({ ...a, alertRecipients: e.target.value })} /></Field></div>
            <Field label="Days before reorder date"><Input type="number" min={0} value={a.alertDaysBefore} onChange={(e) => setA({ ...a, alertDaysBefore: e.target.value })} /></Field>
          </div>
          <Field label="Staff email for supplier updates" hint="Gets an email when a supplier confirms an order or changes tracking.">
            <Input value={a.staffNotifyEmail} onChange={(e) => setA({ ...a, staffNotifyEmail: e.target.value })} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary">Save</Button>
            <Button type="button" onClick={() => act.sendReorderAlert(true)}>Send test email</Button>
          </div>
        </form>
      </Section>

      <SalesImport />

      <Section
        title="Email outbox (test mode)"
        sub="Nothing is delivered — every email the system would send is recorded here."
        actions={db.outbox.length > 0 && <Button size="sm" variant="ghost" onClick={() => act.clearOutbox()}>Clear</Button>}
      >
        {db.outbox.length === 0 ? (
          <p className="text-sm text-slate-500">No emails yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {db.outbox.slice(0, 50).map((m) => (
              <div key={m.id} className="py-2.5">
                <button className="w-full text-left" onClick={() => setMailOpen(mailOpen === m.id ? null : m.id)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={m.kind === 'reorder_alert' ? 'red' : m.kind === 'supplier_update' ? 'violet' : m.kind === 'chase' ? 'amber' : 'slate'}>{m.kind.replace('_', ' ')}</Badge>
                    <span className="text-sm font-medium">{m.subject}</span>
                  </div>
                  <div className="break-all text-xs text-slate-500">to {m.to.join(', ')} · {fmtDateTime(m.at)}</div>
                </button>
                {mailOpen === m.id && <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{m.body}</pre>}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Demo data" sub={`Stock synced ${ago(s.stockSyncedAt)} · sales synced ${ago(s.salesSyncedAt)}. Data is stored in this browser only.`}>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => act.simulateSync()}>Run warehouse + sales sync</Button>
          <Button variant="danger" onClick={() => setReset(true)}>Reset demo data</Button>
        </div>
      </Section>

      {editP && <ProductModal p={editP} onClose={() => setEditP(null)} />}
      {editS && <SupplierModal s={editS} onClose={() => setEditS(null)} />}
      <ConfirmModal open={!!delP} onClose={() => setDelP(null)} danger title={`Delete ${delP?.name}?`} confirmLabel="Delete product" body="Its sales, arrivals and stock history are removed too. Products with orders can't be deleted." onConfirm={() => delP && act.deleteProduct(delP.id)} />
      <ConfirmModal open={!!delS} onClose={() => setDelS(null)} danger title={`Delete ${delS?.name}?`} confirmLabel="Delete supplier" body="Suppliers with orders or used as a product's default can't be deleted." onConfirm={() => delS && act.deleteSupplier(delS.id)} />
      <ConfirmModal open={reset} onClose={() => setReset(false)} danger title="Reset demo data?" confirmLabel="Reset" body="All changes made in this browser are replaced with fresh sample data." onConfirm={() => act.resetDemo()} />
    </div>
  );
}

function ProductModal({ p, onClose }: { p: Product; onClose: () => void }) {
  const { db, act } = useStore();
  const [d, setD] = useState<Product>(p);
  const [stock, setStock] = useState(String(p.warehouseStock));
  const [unshipped, setUnshipped] = useState(String(p.unshipped));
  const setSku = (i: number, patch: Partial<Product['skus'][number]>) => setD({ ...d, skus: d.skus.map((k, j) => (j === i ? { ...k, ...patch } : k)) });
  return (
    <Modal open onClose={onClose} title={p.id ? `Edit ${p.name}` : 'Add product'} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (act.upsertProduct({ ...d, warehouseStock: Number(stock), unshipped: Number(unshipped) })) onClose();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2"><Field label="Name"><Input required value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field></div>
          <Field label="Short code" hint="Used in order names"><Input required value={d.code} onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })} /></Field>
        </div>
        <Field label="Default supplier">
          <Select value={d.supplierId} onChange={(e) => setD({ ...d, supplierId: e.target.value })}>
            {db.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-600">Sales identifiers</div>
          <div className="space-y-2">
            {d.skus.map((k, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_5rem_auto] items-center gap-2">
                <Input placeholder="SKU" value={k.sku} onChange={(e) => setSku(i, { sku: e.target.value })} aria-label="SKU" />
                <Input placeholder="Label (e.g. Buy 2 get 2)" value={k.label} onChange={(e) => setSku(i, { label: e.target.value })} aria-label="Label" />
                <Input type="number" min={1} value={k.units} onChange={(e) => setSku(i, { units: Number(e.target.value) })} aria-label="Units per sale" title="Units per sale" />
                <Button type="button" size="sm" variant="ghost" onClick={() => setD({ ...d, skus: d.skus.filter((_, j) => j !== i) })} aria-label="Remove">✕</Button>
              </div>
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs text-slate-500">Last column = units sold per sale (a "buy 2 get 2" listing sells 4).</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setD({ ...d, skus: [...d.skus, { sku: '', label: '', units: 1 }] })}>+ Add SKU</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Warehouse stock" hint={p.id ? 'Changes are logged as an adjustment' : undefined}><Input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} /></Field>
          <Field label="Sold, not shipped"><Input type="number" min={0} value={unshipped} onChange={(e) => setUnshipped(e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Save product</Button>
        </div>
      </form>
    </Modal>
  );
}

function SupplierModal({ s, onClose }: { s: Supplier; onClose: () => void }) {
  const { act } = useStore();
  const [d, setD] = useState(s);
  return (
    <Modal open onClose={onClose} title={s.id ? `Edit ${s.name}` : 'Add supplier'}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (act.upsertSupplier(d)) onClose(); }}>
        <Field label="Company"><Input required value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="Contact name"><Input value={d.contact} onChange={(e) => setD({ ...d, contact: e.target.value })} /></Field>
        <Field label="Email" hint="Use @example.com addresses in this demo"><Input type="email" required value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Save supplier</Button>
        </div>
      </form>
    </Modal>
  );
}

function SalesImport() {
  const { db, act } = useStore();
  const sample = `day,sku,qty\n${storeDay()},TMG-B2G2,2\n${storeDay()},LAP-1,3\n${addDays(storeDay(), -1)},CPO-1,1`;
  const [text, setText] = useState(sample);
  return (
    <Section title="Import sales (CSV)" sub={`Store sales by SKU — bundles are expanded to units. Known SKUs: ${db.products.flatMap((p) => p.skus.map((k) => k.sku)).join(', ')}`}>
      <Textarea rows={5} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex gap-2">
        <Button
          onClick={() => {
            const rows = text
              .trim()
              .split(/\r?\n/)
              .map((l) => l.split(',').map((x) => x.trim()))
              .filter((r) => r.length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && Number(r[2]) > 0)
              .map(([day, sku, qty]) => ({ day, sku, qty: Math.floor(Number(qty)) }));
            act.importSales(rows);
          }}
        >
          Import sales
        </Button>
      </div>
    </Section>
  );
}
