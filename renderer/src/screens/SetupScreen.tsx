import { useState, type FormEvent } from 'react';
import { ApiError, authApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { passwordOk } from '../auth/passwordPolicy';
import { PasswordChecklist } from '../components/PasswordChecklist';
import { Alert, Button, Field } from '../components/ui';
import { AuthLayout } from './AuthLayout';

export function SetupScreen() {
  const { setupComplete } = useAuth();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usernameValid = /^[A-Za-z0-9._-]{3,64}$/.test(username.trim());
  const canSubmit = usernameValid && passwordOk(password, username) && password === confirm;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.setup({ username: username.trim(), display_name: displayName.trim(), password, confirm_password: confirm });
      setupComplete(username.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create Super Admin"
      subtitle="This is the first time the application has been started. Create the account that will manage users, backups and settings."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        <Field
          label="Username"
          autoComplete="off"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          hint="3–64 characters: letters, digits, dot, underscore or hyphen."
          error={username && !usernameValid ? 'Use 3–64 letters, digits, dot, underscore or hyphen.' : null}
        />
        <Field label="Full name (optional)" autoComplete="off" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <Field label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Field label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <PasswordChecklist password={password} confirm={confirm} username={username} />
        <Button type="submit" className="w-full" disabled={!canSubmit} busy={busy}>
          Create Super Admin
        </Button>
        <p className="text-xs leading-relaxed text-muted">
          There is no default password and no way to recover this account if both the password and all backups are lost. Store the
          password safely.
        </p>
      </form>
    </AuthLayout>
  );
}
