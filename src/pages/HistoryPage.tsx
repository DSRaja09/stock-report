import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import type { MovementType } from '../lib/types';
import { fmtDateTime } from '../lib/time';
import { Badge, Card, cx, Empty, PageHeader, Select, type Tone } from '../components/ui';

const TYPE: Record<MovementType, [string, Tone]> = {
  arrival: ['Arrival', 'green'],
  rematch: ['Moved between orders', 'violet'],
  manual_sale: ['Manual sale', 'amber'],
  adjustment: ['Adjustment', 'slate'],
};

export function HistoryPage({ productFilter, setProductFilter }: { productFilter: string; setProductFilter: (p: string) => void }) {
  const { db } = useStore();
  const [type, setType] = useState<'' | MovementType>('');
  const list = useMemo(
    () =>
      db.movements
        .filter((m) => (!productFilter || m.productId === productFilter) && (!type || m.type === type))
        .sort((a, b) => b.at.localeCompare(a.at)),
    [db.movements, productFilter, type],
  );
  const p = db.products.find((x) => x.id === productFilter);

  return (
    <div>
      <PageHeader title="Stock history" sub={p ? `${p.name} — ${p.warehouseStock} in the warehouse now` : 'Every change to stock: what changed, when and why.'} />
      <div className="mb-4 grid max-w-lg grid-cols-2 gap-2">
        <Select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} aria-label="Product">
          <option value="">All products</option>
          {db.products.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value as MovementType | '')} aria-label="Type">
          <option value="">All changes</option>
          {Object.entries(TYPE).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </div>
      {!list.length ? (
        <Empty>No stock changes yet.</Empty>
      ) : (
        <Card className="divide-y divide-slate-100">
          {list.map((m) => {
            const prod = db.products.find((x) => x.id === m.productId);
            const [label, tone] = TYPE[m.type];
            return (
              <div key={m.id} className="flex items-start gap-3 p-4">
                <div className={cx('w-14 shrink-0 text-right text-base font-semibold tabular-nums', m.delta > 0 ? 'text-emerald-700' : m.delta < 0 ? 'text-rose-600' : 'text-slate-400')}>
                  {m.delta > 0 ? `+${m.delta}` : m.delta < 0 ? `−${-m.delta}` : '±0'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={tone}>{label}</Badge>
                    {!productFilter && <span className="text-xs font-medium text-slate-600">{prod?.code}</span>}
                    {m.stockAfter !== undefined && <span className="text-xs text-slate-500">stock after: {m.stockAfter}</span>}
                  </div>
                  <div className="mt-1 text-sm text-slate-800">{m.text}</div>
                  <div className="text-xs text-slate-500">Why: {m.why}</div>
                  <div className="text-xs text-slate-400">{m.by} · {fmtDateTime(m.at)}</div>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
