import { useEffect, useState } from 'react';
import type { Carrier, Order } from '../lib/types';
import { useStore } from '../lib/store';
import { guessCarrier, mailto } from '../lib/messages';
import { Button, CopyButton, Field, Input, Modal, Select, Textarea } from './ui';

/* ------------------------------------------------------------ order form */
export function OrderFormModal({
  open, onClose, order, defaults, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  order?: Order;
  defaults?: { productId?: string; units?: number };
  onCreated?: (o: Order) => void;
}) {
  const { db, act } = useStore();
  const [productId, setProductId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [units, setUnits] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    const pid = order?.productId ?? defaults?.productId ?? db.products[0]?.id ?? '';
    setProductId(pid);
    setSupplierId(order?.supplierId ?? db.products.find((p) => p.id === pid)?.supplierId ?? db.suppliers[0]?.id ?? '');
    setUnits(String(order?.units ?? (defaults?.units || '')));
    setNotes(order?.notes ?? '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const product = db.products.find((p) => p.id === productId);
  const nextName = product ? `${product.code}-${String(product.orderSeq + 1).padStart(3, '0')}` : '';

  const submit = () => {
    const n = Number(units);
    if (order) {
      if (act.updateOrder(order.id, { units: n, supplierId, notes })) onClose();
    } else {
      const o = act.createOrder({ productId, supplierId, units: n, notes });
      if (o) {
        onClose();
        onCreated?.(o);
      }
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={order ? `Edit ${order.name}` : 'New supplier order'}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Product">
          <Select
            value={productId}
            disabled={Boolean(order)}
            onChange={(e) => {
              setProductId(e.target.value);
              const p = db.products.find((x) => x.id === e.target.value);
              if (p) setSupplierId(p.supplierId);
            }}
          >
            {db.products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
            ))}
          </Select>
        </Field>
        <Field label="Supplier">
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            {db.suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Units">
          <Input type="number" inputMode="numeric" min={1} step={1} required value={units} onChange={(e) => setUnits(e.target.value)} />
        </Field>
        <Field label="Notes (optional)">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Colour, packaging, anything the supplier needs to know" />
        </Field>
        {!order && nextName && <p className="text-xs text-slate-500">This order will be named <b className="text-slate-700">{nextName}</b>.</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">{order ? 'Save changes' : 'Create order'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------- tracking form */
const CARRIERS: Carrier[] = ['UPS', 'FedEx', 'USPS', 'DHL', 'Other'];

export function TrackingModal({
  open, onClose, order, trackingId, mode, maxUnits,
}: {
  open: boolean;
  onClose: () => void;
  order: Order;
  trackingId?: string;
  mode: 'add' | 'edit' | 'return';
  maxUnits: number;
}) {
  const { act } = useStore();
  const existing = order.tracking.find((t) => t.id === trackingId);
  const [number, setNumber] = useState('');
  const [carrier, setCarrier] = useState<Carrier>('UPS');
  const [auto, setAuto] = useState(true);
  const [units, setUnits] = useState('');

  useEffect(() => {
    if (!open) return;
    setNumber(mode === 'edit' ? existing?.number ?? '' : '');
    setCarrier(existing?.carrier ?? 'UPS');
    setAuto(mode !== 'edit');
    setUnits(String(mode === 'add' ? maxUnits || '' : existing?.units ?? ''));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNumber = (v: string) => {
    setNumber(v);
    if (auto) {
      const g = guessCarrier(v);
      if (g !== 'Other') setCarrier(g);
    }
  };

  const submit = () => {
    const n = Number(units);
    let ok = false;
    if (mode === 'add') ok = act.addTracking(order.id, { number, carrier, units: n });
    else if (mode === 'edit' && trackingId) ok = act.updateTracking(order.id, trackingId, { number, carrier, units: n });
    else if (mode === 'return' && trackingId) ok = act.returnTracking(order.id, trackingId, number, carrier);
    if (ok) onClose();
  };

  const title = mode === 'add' ? `Add tracking to ${order.name}` : mode === 'edit' ? 'Change tracking' : 'Returned — resend under a new number';

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {mode === 'return' && existing && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <b>{existing.number}</b> will be marked as returned. Its {existing.units} units count as on the way again under the new number until the warehouse receives them.
          </p>
        )}
        <Field label={mode === 'return' ? 'New tracking number' : 'Tracking number'} hint="Carrier is detected from the number format — change it if needed.">
          <Input required value={number} onChange={(e) => onNumber(e.target.value)} placeholder="e.g. 1Z999AA10123456784" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Carrier">
            <Select value={carrier} onChange={(e) => { setCarrier(e.target.value as Carrier); setAuto(false); }}>
              {CARRIERS.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          {mode !== 'return' && (
            <Field label="Units in this shipment" hint={mode === 'add' ? `${maxUnits} units still without tracking` : undefined}>
              <Input type="number" inputMode="numeric" min={1} step={1} required value={units} onChange={(e) => setUnits(e.target.value)} />
            </Field>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">{mode === 'return' ? 'Mark returned & resend' : 'Save tracking'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------- message preview */
export function MessageModal({
  open, onClose, title, msg, onSend, sendLabel = 'Log as sent',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  msg: { to: string; subject: string; body: string };
  onSend?: () => void;
  sendLabel?: string;
}) {
  const [body, setBody] = useState(msg.body);
  useEffect(() => { if (open) setBody(msg.body); }, [open, msg.body]);
  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-[4rem_1fr] gap-y-1">
          <span className="text-slate-500">To</span><span className="break-all font-medium">{msg.to}</span>
          <span className="text-slate-500">Subject</span><span className="font-medium">{msg.subject}</span>
        </div>
        <Textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-xs" />
        <div className="flex flex-wrap justify-end gap-2">
          <CopyButton text={`Subject: ${msg.subject}\n\n${body}`} label="Copy message" />
          <a href={mailto(msg.to, msg.subject, body)} className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Open in email app
          </a>
          {onSend && (
            <Button size="sm" variant="primary" onClick={() => { onSend(); onClose(); }}>
              {sendLabel}
            </Button>
          )}
        </div>
        <p className="text-xs text-slate-500">Test mode: “{sendLabel}” writes the email to the outbox in Settings. Nothing is delivered.</p>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------- manual sale */
export function ManualSaleModal({ open, onClose, productId }: { open: boolean; onClose: () => void; productId?: string }) {
  const { db, act } = useStore();
  const [pid, setPid] = useState('');
  const [units, setUnits] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (open) {
      setPid(productId ?? db.products[0]?.id ?? '');
      setUnits('');
      setNote('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = db.products.find((x) => x.id === pid);
  return (
    <Modal open={open} onClose={onClose} title="Log a manual sale">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (act.logManualSale(pid, Number(units), note)) onClose();
        }}
      >
        <p className="text-sm text-slate-500">Units sold outside the store (wholesale, markets, replacements). They leave the warehouse now and count toward sales speed.</p>
        <Field label="Product">
          <Select value={pid} onChange={(e) => setPid(e.target.value)}>
            {db.products.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
          </Select>
        </Field>
        <Field label="Units" hint={p ? `${p.warehouseStock} in the warehouse` : undefined}>
          <Input type="number" inputMode="numeric" min={1} step={1} required value={units} onChange={(e) => setUnits(e.target.value)} />
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Wholesale to Café Pinyon" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">Log sale</Button>
        </div>
      </form>
    </Modal>
  );
}
