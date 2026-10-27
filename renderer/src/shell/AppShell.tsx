import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { authApi, warmReportCache } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useIdleTimer } from '../auth/useIdleTimer';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { Dialog } from '../components/kit';
import { Alert, Button, Logo } from '../components/ui';
import { AuditLogPage } from '../pages/AuditLogPage';
import { BackupsPage } from '../pages/BackupsPage';
import { BatchPage } from '../pages/BatchPage';
import { DashboardPage } from '../pages/DashboardPage';
import { MasterDataPage } from '../pages/MasterDataPage';
import { NotBuiltYetPage } from '../pages/NotBuiltYetPage';
import { TurnoverPage } from '../pages/TurnoverPage';
import { RevenuePage } from '../pages/RevenuePage';
import { ProductMixPage } from '../pages/ProductMixPage';
import { RegionPage } from '../pages/RegionPage';
import { ForecastPage } from '../pages/ForecastPage';
import { ExpensesPage } from '../pages/ExpensesPage';
import { MarginsPage } from '../pages/MarginsPage';
import { PnlSummaryPage } from '../pages/PnlSummaryPage';
import { BalanceSheetPage } from '../pages/BalanceSheetPage';
import { ReportsPage } from '../pages/ReportsPage';
import { UploadPage } from '../pages/UploadPage';
import { UsersPage } from '../pages/UsersPage';
import { NAV, ROLE_LABELS, type NavItem } from './nav';

/** Pages that open with their own designed header, so the shell adds no title above them. */
const REPORT_PAGES = new Set(['/', '/turnover', '/revenue', '/forecast', '/expenses', '/margins', '/pnl-summary', '/balance-sheet', '/product-mix', '/global-presence', '/reports']);

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function AppShell() {
  const { user, logout, notice, setNotice } = useAuth();
  const location = useLocation();
  const [changingPassword, setChangingPassword] = useState(false);
  const allowed = (item: NavItem) => user?.permissions.includes(item.permission) ?? false;
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter((g) => g.items.length > 0);
  const current = NAV.flatMap((g) => g.items).find((i) => i.to === location.pathname || (i.to !== '/' && location.pathname.startsWith(`${i.to}/`)));

  const onIdle = useCallback(() => void logout('idle'), [logout]);
  const onHeartbeat = useCallback(() => void authApi.heartbeat().catch(() => undefined), []);
  const { secondsLeft, stayActive } = useIdleTimer({ onIdle, onHeartbeat, enabled: true });

  useEffect(() => {
    if (!user?.permissions.includes('view_reports')) return;
    const timer = window.setTimeout(warmReportCache, 600);
    return () => window.clearTimeout(timer);
  }, [user?.id, user?.permissions]);

  return (
    <div className="flex h-full">
      <nav aria-label="Main" className="flex w-56 shrink-0 flex-col bg-navy-900 px-2 py-3">
        <div className="px-2 pb-4">
          <Logo light />
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-navy-300/70">{g.label}</div>
              <ul className="space-y-0.5">
                {g.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors ${
                          isActive ? 'bg-white/10 font-medium text-white' : 'text-navy-300 hover:bg-white/5 hover:text-white'
                        }`
                      }
                    >
                      <Icon d={item.icon} />
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-navy-800 px-2.5 py-2.5">
          <div className="truncate text-sm font-medium text-white">{user?.display_name || user?.username}</div>
          <div className="text-xs text-navy-300">{ROLE_LABELS[user?.role ?? 'viewer']}</div>
          <div className="mt-2 flex gap-4">
            <button onClick={() => setChangingPassword(true)} className="text-xs font-medium text-navy-300 hover:text-white">
              Change password
            </button>
            <button onClick={() => void logout()} className="text-xs font-medium text-accent-400 hover:text-white">
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* No separate title bar: report pages open with their own header; other pages get a plain heading. */}
        <main className="relative isolate flex-1 overflow-y-auto bg-[#edf7ff] px-3 py-3 sm:px-4 sm:py-3">
          <AppPageBackground />
          <div className="relative z-10 min-h-full">
          {current && !REPORT_PAGES.has(current.to) && (
            <h1 className="mb-3 font-heading text-xl font-bold text-navy-900">{current.label}</h1>
          )}
          {notice && (
            <div className="mb-4" onClick={() => setNotice(null)}>
              <Alert kind={notice.kind}>{notice.text}</Alert>
            </div>
          )}
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            {[
              { to: '/turnover', perm: 'view_reports', el: <TurnoverPage /> },
              { to: '/revenue', perm: 'view_reports', el: <RevenuePage /> },
              { to: '/forecast', perm: 'view_reports', el: <ForecastPage /> },
              { to: '/expenses', perm: 'view_reports', el: <ExpensesPage /> },
              { to: '/margins', perm: 'view_reports', el: <MarginsPage /> },
              { to: '/pnl-summary', perm: 'view_reports', el: <PnlSummaryPage /> },
              { to: '/balance-sheet', perm: 'view_reports', el: <BalanceSheetPage /> },
              { to: '/product-mix', perm: 'view_reports', el: <ProductMixPage /> },
              { to: '/global-presence', perm: 'view_reports', el: <RegionPage /> },
              { to: '/reports', perm: 'view_reports', el: <ReportsPage /> },
              { to: '/users', perm: 'manage_users', el: <UsersPage /> },
              { to: '/upload', perm: 'upload_data', el: <UploadPage /> },
              { to: '/upload/:id', perm: 'view_reports', el: <BatchPage /> },
              { to: '/master-data', perm: 'manage_master_data', el: <MasterDataPage /> },
              { to: '/backups', perm: 'manage_backups', el: <BackupsPage /> },
              { to: '/audit-log', perm: 'view_audit_log', el: <AuditLogPage /> },
            ].map((r) => (
              <Route key={r.to} path={r.to} element={user?.permissions.includes(r.perm) ? r.el : <Navigate to="/" replace />} />
            ))}
            {NAV.flatMap((g) => g.items)
              .filter((i) => i.phase)
              .map((i) => (
                <Route key={i.to} path={i.to} element={allowed(i) ? <NotBuiltYetPage title={i.label} what={i.phase!} /> : <Navigate to="/" replace />} />
              ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </div>
        </main>
      </div>

      {changingPassword && (
        <Dialog title="Change password" onClose={() => setChangingPassword(false)}>
          <ChangePasswordForm
            fixedUsername={user?.username ?? ''}
            onSubmit={async (c) => {
              await authApi.changePassword(c.current, c.next, c.confirm);
              setChangingPassword(false);
              setNotice({ kind: 'success', text: 'Your password has been changed. Any other signed-in sessions were signed out.' });
            }}
          />
        </Dialog>
      )}

      {secondsLeft !== null && (
        <div role="alertdialog" aria-labelledby="idle-title" className="fixed inset-0 z-50 grid place-items-center bg-navy-950/50">
          <div className="w-[380px] rounded-xl bg-white p-6 shadow-xl">
            <h2 id="idle-title" className="text-lg font-semibold">Are you still there?</h2>
            <p className="mt-2 text-sm text-muted">
              For security you will be signed out in <strong className="text-ink">{secondsLeft} seconds</strong>.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => void logout()}>
                Sign out
              </Button>
              <Button onClick={stayActive}>Stay signed in</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AppPageBackground() {
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
    <svg className="absolute inset-x-0 top-0 h-64 w-full" viewBox="0 0 1600 260" preserveAspectRatio="none">
      <path d="M0 170C220 80 360 230 590 140S940 40 1170 140s240 65 430-30V0H0Z" fill="#bae6fd" opacity=".42" />
      <path d="M0 115c220 90 420-80 660-15s300 120 530-20 270-40 410 50V0H0Z" fill="#dbeafe" opacity=".58" />
      <path d="M0 205c250-60 440 45 690-30s390-95 630-10 180 10 280-20" fill="none" stroke="#7dd3fc" strokeWidth="2" opacity=".38" />
    </svg>
    <div className="absolute -right-20 top-24 h-56 w-56 rounded-full bg-sky-200/30 blur-3xl" />
    <div className="absolute -left-20 top-48 h-48 w-48 rounded-full bg-blue-100/50 blur-3xl" />
  </div>;
}
