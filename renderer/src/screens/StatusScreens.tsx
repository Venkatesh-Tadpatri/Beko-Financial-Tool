import { useEffect, useState, type FormEvent } from 'react';
import { recoveryApi } from '../api/admin';
import { useAuth } from '../auth/AuthContext';
import { Badge, errorText, formatDateTime, useAsync } from '../components/kit';
import { Alert, Button, Field, Logo, Spinner } from '../components/ui';
import { REASON_LABELS } from '../pages/BackupsPage';
import { AuthLayout } from './AuthLayout';

export function StartingScreen() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 10_000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="grid h-full place-items-center">
      <div className="flex max-w-sm flex-col items-center gap-6 text-center text-brand-600">
        <Logo />
        <Spinner />
        <p className="text-sm text-muted">Starting and checking your data…</p>
        {slow && (
          <p className="text-xs text-muted">
            This is taking longer than usual, which can happen when the computer is busy. Your data is safe; please wait.
          </p>
        )}
      </div>
    </div>
  );
}

export function UnavailableScreen() {
  const { error, refresh } = useAuth();
  return (
    <AuthLayout title="The data service is not available" subtitle="The application could not reach its local data service.">
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <p className="text-sm text-muted">Your data has not been changed. Try again, or restart the application.</p>
        <Button onClick={() => void refresh()}>Try again</Button>
      </div>
    </AuthLayout>
  );
}

const RECOVERY_TITLES: Record<string, string> = {
  integrity_failed: 'The database needs to be restored',
  migration_failed: 'The update could not be applied',
  newer_database: 'This data needs a newer version',
};

export function RecoveryScreen() {
  const { status } = useAuth();
  const code = status?.recovery?.code ?? 'integrity_failed';
  const backups = useAsync(() => recoveryApi.backups());
  const [choice, setChoice] = useState<{ filename?: string; path?: string } | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const newestGood = backups.data?.find((b) => b.verify_ok);
    if (newestGood && !choice) setChoice({ filename: newestGood.filename });
  }, [backups.data, choice]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      await recoveryApi.restore({ ...choice, username, password });
      setDone(true);
      setTimeout(() => void window.fvt.relaunch(), 1500);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={RECOVERY_TITLES[code] ?? 'The application needs attention'}>
      <div className="space-y-4">
        <Alert kind="warning">{status?.recovery?.message}</Alert>
        {done ? (
          <Alert kind="success">The backup has been restored. The application is restarting…</Alert>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Choose a backup to restore</legend>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line bg-white p-2">
                {backups.data?.length === 0 && <p className="p-2 text-sm text-muted">No backups found in the backup folder.</p>}
                {backups.data?.map((b) => (
                  <label key={b.filename} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-canvas">
                    <input type="radio" name="backup" checked={choice?.filename === b.filename} onChange={() => setChoice({ filename: b.filename })} />
                    <span className="flex-1">{formatDateTime(b.created_at)}</span>
                    <span className="text-xs text-muted">{REASON_LABELS[b.reason]}</span>
                    {b.verify_ok ? <Badge tone="green">OK</Badge> : <Badge>Not verified</Badge>}
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="text-sm font-medium text-brand-600 hover:underline"
                onClick={async () => {
                  const path = await window.fvt.chooseBackupFile();
                  if (path) setChoice({ path });
                }}
              >
                Or choose a backup file…
              </button>
              {choice?.path && <p className="break-all text-xs text-muted">Selected: {choice.path}</p>}
            </fieldset>
            <p className="text-sm text-muted">Sign in with a Super Admin account <strong>as it was in that backup</strong>.</p>
            {error && <Alert kind="error">{error}</Alert>}
            <Field label="Super Admin username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button type="submit" className="w-full" busy={busy} disabled={!choice || !username || !password}>
              Restore and restart
            </Button>
            <p className="text-xs text-muted">The damaged database is kept in the backups folder for investigation. Nothing is deleted.</p>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
