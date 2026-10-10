import { useState, type FormEvent } from 'react';
import { ApiError, authApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { passwordOk } from '../auth/passwordPolicy';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { Alert, Button, Field } from '../components/ui';
import { AuthLayout } from './AuthLayout';

export function ChangePasswordScreen() {
  const { user, passwordChanged, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const username = user?.username ?? '';
  const canSubmit = current.length > 0 && passwordOk(next, username) && next === confirm && next !== current;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword(current, next, confirm);
      await passwordChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Change your password"
      subtitle={`Your password was reset by an administrator. Choose a new one to continue, ${user?.display_name || username}.`}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        <Field label="Current (temporary) password" type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Field label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <PasswordChecklist password={next} confirm={confirm} username={username} />
        {next && next === current && <Alert kind="warning">The new password must be different from the current one.</Alert>}
        <div className="flex gap-3">
          <Button type="submit" className="flex-1" disabled={!canSubmit} busy={busy}>
            Change password
          </Button>
          <Button type="button" variant="secondary" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
