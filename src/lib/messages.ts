import type { Carrier, DB, Order } from './types';
import type { ChaseKind } from './types';
import type { Forecast } from './calc';
import { fmtDay, storeDay } from './time';

/* ---------------------------------------------------------------- carriers */

export function guessCarrier(num: string): Carrier {
  const n = num.replace(/\s+/g, '').toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return 'UPS';
  if (/^(94|93|92|95)\d{18,20}$/.test(n)) return 'USPS';
  if (/^\d{12}$|^\d{15}$/.test(n)) return 'FedEx';
  if (/^\d{10}$/.test(n)) return 'DHL';
  return 'Other';
}

export function trackingUrl(carrier: Carrier, num: string): string | null {
  const n = encodeURIComponent(num.trim());
  switch (carrier) {
    case 'UPS':
      return `https://www.ups.com/track?tracknum=${n}`;
    case 'FedEx':
      return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
    case 'USPS':
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
    case 'DHL':
      return `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`;
    default:
      return null;
  }
}

/* ---------------------------------------------------------------- messages */

const productOf = (db: DB, o: Order) => db.products.find((p) => p.id === o.productId);
const supplierOf = (db: DB, o: Order) => db.suppliers.find((s) => s.id === o.supplierId);

export function orderMessage(db: DB, o: Order, from: string) {
  const p = productOf(db, o);
  const s = supplierOf(db, o);
  const subject = `Purchase order ${o.name} — ${o.units} × ${p?.name ?? ''}`;
  const body = [
    `Hi ${s?.contact ?? 'there'},`,
    '',
    `Please find our new order below.`,
    '',
    `Order:    ${o.name}`,
    `Product:  ${p?.name} (${p?.code})`,
    `Units:    ${o.units}`,
    `Date:     ${fmtDay(storeDay(o.createdAt))}`,
    o.notes ? `Notes:    ${o.notes}` : '',
    '',
    `Please confirm the order and expected ship date, and send tracking numbers (with units per shipment) once it ships.`,
    '',
    `Thanks,`,
    from,
  ]
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n');
  return { to: s?.email ?? '', subject, body };
}

export function chaseMessage(db: DB, o: Order, kind: ChaseKind, reason: string, from: string) {
  const p = productOf(db, o);
  const s = supplierOf(db, o);
  const ask: Record<ChaseKind, [string, string]> = {
    confirm: [
      `Please confirm order ${o.name}`,
      `Could you please confirm order ${o.name} (${o.units} × ${p?.name}) and let us know the expected ship date?`,
    ],
    tracking: [
      `Tracking needed for ${o.name}`,
      `Order ${o.name} (${p?.name}) was confirmed a while ago, but some units still have no tracking number. Could you send tracking numbers with the units in each shipment?`,
    ],
    where: [
      `Where is order ${o.name}?`,
      `A shipment for order ${o.name} (${p?.name}) has been on the way for more than 10 days and hasn't arrived at our warehouse yet. Could you check with the carrier and let us know where it is?`,
    ],
  };
  const [subject, line] = ask[kind];
  const body = `Hi ${s?.contact ?? 'there'},\n\n${line}\n\n(${reason})\n\nThanks,\n${from}`;
  return { to: s?.email ?? '', subject, body };
}

export function reorderEmail(now: Forecast[], soon: Forecast[], daysBefore: number) {
  const line = (f: Forecast) =>
    `• ${f.product.name} (${f.product.code}) — sells out ${f.sellsOutOn ? fmtDay(f.sellsOutOn) : '—'}, reorder by ${
      f.reorderBy ? fmtDay(f.reorderBy) : '—'
    }, suggested order ${f.suggestedOrder} units`;
  const body = [
    'Stock Report — reorder alert',
    '',
    `REORDER NOW (${now.length})`,
    ...(now.length ? now.map(line) : ['  none']),
    '',
    `REORDER SOON — within ${daysBefore} days (${soon.length})`,
    ...(soon.length ? soon.map(line) : ['  none']),
  ].join('\n');
  return { subject: `Reorder alert: ${now.length} now, ${soon.length} soon`, body };
}

export function mailto(to: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
