import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { passwordOk } from '../auth/passwordPolicy';
import { PasswordChecklist } from './PasswordChecklist';
import { Alert, Button, Field } from './ui';

export interface PasswordChange {
  username: string;
  current: string;
  next: string;
  confirm: string;
}

/**
 * One form for every password change: on the sign-in screen (asks for the
 * username), the forced change after a reset, and the in-app option.
 */
export function ChangePasswordForm({
  askUsername = false,
  fixedUsername = '',
  submitLabel = 'Change password',
  onSubmit,
  extraButtons,
  id = 'change-password-form',
}: {
  askUsername?: boolean;
  fixedUsername?: string;
  submitLabel?: string;
  onSubmit: (c: PasswordChange) => Promise<void>;
  extraButtons?: ReactNode;
  id?: string;
}) {
  const [username, setUsername] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ kind: 'error' | 'warning'; text: string } | null>(null);
  const name = askUsername ? username.trim() : fixedUsername;
  const canSubmit = (!askUsername || name.length > 0) && current.length > 0 && passwordOk(next, name) && next === confirm && next !== current;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ username: name, current, next, confirm });
    } catch (err) {
      setCurrent('');
      if (err instanceof ApiError) setError({ kind: err.code === 'account_locked' ? 'warning' : 'error', text: err.message });
      else setError({ kind: 'error', text: 'Could not change the password.' });
      setBusy(false);
    }
  }

  return (
    <form id={id} onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert kind={error.kind}>{error.text}</Alert>}
      {askUsername && <Field label="Username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />}
      <Field label="Current password" type="password" autoComplete="current-password" autoFocus={!askUsername} value={current} onChange={(e) => setCurrent(e.target.value)} />
      <Field label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <PasswordChecklist password={next} confirm={confirm} username={name} />
      {next && next === current && <Alert kind="warning">The new password must be different from the current one.</Alert>}
      <div className="flex gap-3">
        <Button type="submit" className="flex-1" disabled={!canSubmit} busy={busy}>
          {submitLabel}
        </Button>
        {extraButtons}
      </div>
    </form>
  );
}
