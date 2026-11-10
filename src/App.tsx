import { useEffect, useMemo, useState } from 'react';
import { useStore } from './lib/store';
import { STAFF_USER } from './lib/seed';
import { staleness, unmatchedUnits, viewOrder } from './lib/calc';
import { ago } from './lib/time';
import { Button, Card, cx } from './components/ui';
import { StockPage } from './pages/StockPage';
import { OrdersPage } from './pages/OrdersPage';
import { ArrivalsPage } from './pages/ArrivalsPage';
import { HistoryPage } from './pages/HistoryPage';
import { AlertsPage, useAlerts } from './pages/AlertsPage';
import { SettingsPage } from './pages/SettingsPage';

type Route = 'stock' | 'orders' | 'arrivals' | 'alerts' | 'history' | 'settings';

function parseHash(): { route: Route; product: string } {
  const [r, q] = window.location.hash.replace(/^#/, '').split('?');
  const product = new URLSearchParams(q ?? '').get('product') ?? '';
  const valid: Route[] = ['stock', 'orders', 'arrivals', 'alerts', 'history', 'settings'];
  return { route: (valid.includes(r as Route) ? r : 'stock') as Route, product };
}

export default function App() {
  const { session } = useStore();
  if (!session) return <Login />;
  return <Shell />;
}

function Shell() {
  const { db, session, logout, toasts, act } = useStore();
  const [{ route, product }, setLoc] = useState(parseHash);
  useEffect(() => {
    const h = () => setLoc(parseHash());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);
  const go = (r: string, p = '') => { window.location.hash = p ? `${r}?product=${p}` : r; };
  const setProduct = (p: string) => go(route, p);

  const staff = session?.role === 'staff';
  const alerts = useAlerts();
  const unmatched = db.arrivals.filter((a) => unmatchedUnits(a) > 0).length;
  const supplierReview = useMemo(
    () =>
      staff ? 0 : db.orders.map((o) => viewOrder(o, db.arrivals)).filter((v) => v.order.supplierId === session?.supplierId && v.open && (!v.confirmed || v.untracked > 0)).length,
    [db, staff, session],
  );
  const { stockStale, salesStale } = staleness(db.settings);

  const nav: { r: Route; label: string; icon: string; badge?: number }[] = staff
    ? [
        { r: 'stock', label: 'Stock', icon: '▦' },
        { r: 'orders', label: 'Orders', icon: '⇄' },
        { r: 'arrivals', label: 'Arrivals', icon: '↓', badge: unmatched },
        { r: 'alerts', label: 'Follow-ups', icon: '!', badge: alerts.due.length },
        { r: 'history', label: 'History', icon: '≡' },
        { r: 'settings', label: 'Settings', icon: '⚙' },
      ]
    : [
        { r: 'orders', label: 'Your orders', icon: '⇄', badge: supplierReview },
        { r: 'stock', label: 'Stock', icon: '▦' },
      ];
  const current = nav.some((n) => n.r === route) ? route : nav[0].r;

  return (
    <div className="min-h-screen pb-20 lg:pb-8">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <a href="#stock" className="flex items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="hidden sm:inline">Stock Report</span>
          </a>
          <nav className="hidden flex-1 gap-1 lg:flex">
            {nav.map((n) => (
              <a key={n.r} href={`#${n.r}`} className={cx('relative rounded-lg px-3 py-1.5 text-sm font-medium', current === n.r ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-100')}>
                {n.label}
                {!!n.badge && <span className="ml-1.5 rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold text-white">{n.badge}</span>}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <div className="min-w-0 text-right">
              <div className="truncate text-xs font-medium">{session?.name}</div>
              <div className="text-[11px] text-slate-500">{staff ? 'Operations staff' : 'Supplier'}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={logout}>Switch user</Button>
          </div>
        </div>
      </header>

      {staff && (stockStale || salesStale) && (
        <div className="border-b border-amber-200 bg-amber-50">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-amber-900">
            <span>
              ⚠ Data may be out of date —{stockStale && <> warehouse stock last synced <b>{ago(db.settings.stockSyncedAt)}</b></>}
              {stockStale && salesStale && ';'}
              {salesStale && <> sales last synced <b>{ago(db.settings.salesSyncedAt)}</b></>}.
            </span>
            <Button size="sm" onClick={() => act.simulateSync()}>Sync now</Button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-5">
        {current === 'stock' && <StockPage />}
        {current === 'orders' && <OrdersPage productFilter={product} setProductFilter={setProduct} />}
        {current === 'arrivals' && <ArrivalsPage />}
        {current === 'alerts' && <AlertsPage go={go} />}
        {current === 'history' && <HistoryPage productFilter={product} setProductFilter={setProduct} />}
        {current === 'settings' && <SettingsPage />}
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto flex max-w-xl">
          {nav.map((n) => (
            <a key={n.r} href={`#${n.r}`} className={cx('relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium', current === n.r ? 'text-teal-700' : 'text-slate-500')}>
              <span className="text-base leading-none">{n.icon}</span>
              {n.label}
              {!!n.badge && <span className="absolute right-[calc(50%-1.4rem)] top-1 rounded-full bg-rose-600 px-1 text-[9px] font-semibold text-white">{n.badge}</span>}
            </a>
          ))}
        </div>
      </nav>

      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={cx('pointer-events-auto max-w-md rounded-lg px-4 py-2.5 text-sm shadow-lg', t.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white')}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Login() {
  const { db, login } = useStore();
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-10 w-10" />
          <div>
            <h1 className="text-xl font-semibold">Stock Report</h1>
            <p className="text-sm text-slate-500">Stock, sales speed, reorders and supplier orders.</p>
          </div>
        </div>
        <Card className="p-5">
          <h2 className="mb-1 font-semibold">Sign in</h2>
          <p className="mb-4 text-sm text-slate-500">Demo accounts — no password needed. All data is fake.</p>
          <button
            onClick={() => { login({ role: 'staff', ...STAFF_USER }); window.location.hash = 'stock'; }}
            className="mb-4 w-full rounded-xl border-2 border-teal-700 bg-teal-50 p-4 text-left hover:bg-teal-100"
          >
            <div className="font-semibold text-teal-900">Operations staff</div>
            <div className="text-sm text-teal-800">{STAFF_USER.name} · sees and manages everything</div>
          </button>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Supplier logins</div>
          <div className="space-y-2">
            {db.suppliers.map((s) => (
              <button
                key={s.id}
                onClick={() => { login({ role: 'supplier', name: `${s.contact} (${s.name})`, email: s.email, supplierId: s.id }); window.location.hash = 'orders'; }}
                className="w-full rounded-xl border border-slate-200 p-3 text-left hover:bg-slate-50"
              >
                <div className="font-medium">{s.name}</div>
                <div className="break-all text-xs text-slate-500">{s.contact} · {s.email}</div>
              </button>
            ))}
          </div>
        </Card>
        <p className="mt-4 text-center text-xs text-slate-400">Data is stored in this browser. Emails go to a test outbox — nothing is delivered.</p>
      </div>
    </div>
  );
}
