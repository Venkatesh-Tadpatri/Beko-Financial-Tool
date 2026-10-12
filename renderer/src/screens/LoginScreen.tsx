import { useState, type FormEvent } from 'react';
import { ApiError, authApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { Alert, Button, Field, Spinner } from '../components/ui';
import { AuthLayout } from './AuthLayout';

export function LoginScreen() {
  const { login, notice, setNotice } = useAuth();
  const [mode, setMode] = useState<'sign-in' | 'change'>('sign-in');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState<{ kind: 'error' | 'warning'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setPassword('');
      if (err instanceof ApiError) setError({ kind: err.code === 'account_locked' ? 'warning' : 'error', text: err.message });
      else setError({ kind: 'error', text: 'Could not sign in. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'change') {
    return (
      <AuthLayout title="Change your password" subtitle="Enter your username and current password, then choose a new one.">
        <ChangePasswordForm
          askUsername
          onSubmit={async (c) => {
            await authApi.changePasswordAtLogin(c.username, c.current, c.next, c.confirm);
            setMode('sign-in');
            setUsername(c.username);
            setError(null);
            setNotice({ kind: 'success', text: 'Your password has been changed. Sign in with the new password.' });
          }}
          extraButtons={
            <Button type="button" variant="secondary" onClick={() => setMode('sign-in')}>
              Back to sign in
            </Button>
          }
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Welcome Back" subtitle="Sign in to your Financial Visualization Tool">
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error ? <Alert kind={error.kind}>{error.text}</Alert> : notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
        <Field
          label="Username"
          icon="user"
          large
          placeholder="Enter your username"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          icon="lock"
          large
          placeholder="Enter your password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="font-medium text-brand-600 hover:underline"
            onClick={() => {
              setNotice(null);
              setMode('change');
            }}
          >
            Change password
          </button>
          <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setForgot((f) => !f)} aria-expanded={forgot}>
            Forgot password?
          </button>
        </div>
        {forgot && <Alert kind="info">Ask your Super Admin to reset it. You will then choose a new password when you next sign in.</Alert>}
        <button
          type="submit"
          disabled={!username.trim() || !password || busy}
          className="flex h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0b3fd1] via-[#1766f5] to-[#2fc6ff] text-[17px] font-semibold text-white shadow-[0_10px_24px_-8px_rgba(23,102,245,0.7)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy && <Spinner small />}
          Sign in
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14m-6-6 6 6-6 6" />
          </svg>
        </button>
      </form>
    </AuthLayout>
  );
}
