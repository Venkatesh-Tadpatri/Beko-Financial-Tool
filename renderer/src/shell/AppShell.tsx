import { useCallback } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { authApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useIdleTimer } from '../auth/useIdleTimer';
import { Alert, Button, Logo } from '../components/ui';
import { DashboardPage } from '../pages/DashboardPage';
import { NotBuiltYetPage } from '../pages/NotBuiltYetPage';
import { NAV, ROLE_LABELS, type NavItem } from './nav';

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
  const allowed = (item: NavItem) => user?.permissions.includes(item.permission) ?? false;
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter((g) => g.items.length > 0);
  const current = NAV.flatMap((g) => g.items).find((i) => i.to === location.pathname);

  const onIdle = useCallback(() => void logout('idle'), [logout]);
  const onHeartbeat = useCallback(() => void authApi.heartbeat().catch(() => undefined), []);
  const { secondsLeft, stayActive } = useIdleTimer({ onIdle, onHeartbeat, enabled: true });

  return (
    <div className="flex h-full">
      <nav aria-label="Main" className="flex w-64 shrink-0 flex-col bg-navy-900 px-3 py-5">
        <div className="px-2 pb-6">
          <Logo light />
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-navy-300/70">{g.label}</div>
              <ul className="space-y-0.5">
                {g.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
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
        <div className="mt-4 rounded-lg bg-navy-800 px-3 py-3">
          <div className="truncate text-sm font-medium text-white">{user?.display_name || user?.username}</div>
          <div className="text-xs text-navy-300">{ROLE_LABELS[user?.role ?? 'viewer']}</div>
          <button onClick={() => void logout()} className="mt-2 text-xs font-medium text-accent-400 hover:text-white">
            Sign out
          </button>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-line bg-white px-8">
          <h1 className="text-lg font-semibold">{current?.label ?? 'Dashboard'}</h1>
        </header>
        <main className="flex-1 overflow-y-auto px-8 py-6">
          {notice && (
            <div className="mb-4" onClick={() => setNotice(null)}>
              <Alert kind={notice.kind}>{notice.text}</Alert>
            </div>
          )}
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            {NAV.flatMap((g) => g.items)
              .filter((i) => i.phase)
              .map((i) => (
                <Route key={i.to} path={i.to} element={allowed(i) ? <NotBuiltYetPage title={i.label} what={i.phase!} /> : <Navigate to="/" replace />} />
              ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

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
