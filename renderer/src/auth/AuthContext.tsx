import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, authApi, setUnauthorizedHandler, type SystemStatus, type User } from '../api/client';

/**
 * Which top-level screen is allowed. Nothing inside the app shell is rendered
 * unless phase === 'app', so no data, menus or charts exist before login.
 */
export type Phase = 'starting' | 'unavailable' | 'recovery' | 'setup' | 'login' | 'change-password' | 'app';

export interface Notice {
  kind: 'info' | 'success' | 'warning';
  text: string;
}

interface AuthValue {
  phase: Phase;
  status: SystemStatus | null;
  user: User | null;
  notice: Notice | null;
  error: string | null;
  setNotice: (n: Notice | null) => void;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: (reason?: 'user' | 'idle') => Promise<void>;
  setupComplete: (username: string) => void;
  passwordChanged: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('starting');
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enterWith = useCallback((u: User) => {
    setUser(u);
    setPhase(u.must_change_password ? 'change-password' : 'app');
  }, []);

  const refresh = useCallback(async () => {
    setPhase('starting');
    try {
      const s = await authApi.status();
      setStatus(s);
      if (s.mode === 'recovery') return setPhase('recovery');
      if (s.mode !== 'ready') return setPhase('starting');
      if (s.needs_setup) return setPhase('setup');
      try {
        enterWith(await authApi.me()); // e.g. a page reload while signed in
      } catch {
        setUser(null);
        setPhase('login');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setPhase('unavailable');
    }
  }, [enterWith]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler((code, message) => {
      setUser(null);
      setPhase('login');
      setNotice(code === 'session_expired' ? { kind: 'warning', text: message } : null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await authApi.login(username, password);
      setNotice(null);
      enterWith(res.user);
    },
    [enterWith],
  );

  const logout = useCallback(async (reason: 'user' | 'idle' = 'user') => {
    try {
      await authApi.logout();
    } catch {
      /* already signed out on the server */
    }
    setUser(null);
    setPhase('login');
    setNotice(
      reason === 'idle'
        ? { kind: 'warning', text: 'You were signed out after 15 minutes of inactivity.' }
        : { kind: 'info', text: 'You have signed out.' },
    );
  }, []);

  const setupComplete = useCallback((username: string) => {
    setStatus((s) => (s ? { ...s, needs_setup: false } : s));
    setPhase('login');
    setNotice({ kind: 'success', text: `Super admin "${username}" created. Sign in to continue.` });
  }, []);

  const passwordChanged = useCallback(async () => {
    enterWith(await authApi.me());
    setNotice({ kind: 'success', text: 'Your password has been changed.' });
  }, [enterWith]);

  const value = useMemo<AuthValue>(
    () => ({ phase, status, user, notice, error, setNotice, refresh, login, logout, setupComplete, passwordChanged }),
    [phase, status, user, notice, error, refresh, login, logout, setupComplete, passwordChanged],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function useCan(permission: string): boolean {
  return useAuth().user?.permissions.includes(permission) ?? false;
}
