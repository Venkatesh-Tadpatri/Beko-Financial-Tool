import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Field } from '../components/ui';
import { AuthLayout } from './AuthLayout';

export function LoginScreen() {
  const { login, notice } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ kind: 'error' | 'warning'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
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

  return (
    <AuthLayout title="Sign in" subtitle="Use the account your administrator created for you.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error ? <Alert kind={error.kind}>{error.text}</Alert> : notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
        <Field label="Username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" className="w-full" busy={busy} disabled={!username.trim() || !password}>
          Sign in
        </Button>
        <p className="text-xs text-muted">Forgotten your password? Ask your Super Admin to reset it.</p>
      </form>
    </AuthLayout>
  );
}
