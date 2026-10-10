import { useEffect, useState, type FormEvent } from 'react';
import { backupsApi, type BackupRow, type BackupSettings } from '../api/admin';
import { Badge, Card, Dialog, errorText, formatBytes, formatDateTime, LinkButton, Table, Td, useAsync } from '../components/kit';
import { Alert, Button, Field } from '../components/ui';

export const REASON_LABELS: Record<BackupRow['reason'], string> = {
  daily: 'Daily',
  upload: 'After upload',
  approval: 'After approval',
  manual: 'Manual',
  pre_migration: 'Before update',
  pre_restore: 'Before restore',
};

type RestoreTarget = { kind: 'backup'; backup: BackupRow } | { kind: 'file'; path: string };

export function BackupsPage() {
  const list = useAsync(() => backupsApi.list());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null);

  async function backupNow() {
    setBusy(true);
    setNotice(null);
    try {
      const b = await backupsApi.create();
      setNotice(
        b.secondary_error
          ? { kind: 'warning', text: `Backup created, but the copy to the second location failed: ${b.secondary_error}` }
          : { kind: 'success', text: 'Backup created and verified.' },
      );
      await list.reload();
    } catch (e) {
      setNotice({ kind: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function verify(b: BackupRow) {
    try {
      const r = await backupsApi.verify(b.filename);
      setNotice(r.ok ? { kind: 'success', text: `Backup from ${formatDateTime(b.created_at)} is intact.` } : { kind: 'error', text: `Backup failed verification: ${r.problems.join('; ')}` });
      await list.reload();
    } catch (e) {
      setNotice({ kind: 'error', text: errorText(e) });
    }
  }

  async function chooseFile() {
    const path = await window.fvt.chooseBackupFile();
    if (path) setRestoreTarget({ kind: 'file', path });
  }

  const u = list.data?.usage;
  const pct = u ? Math.min(100, Math.round((u.used_bytes / u.max_total_bytes) * 100)) : 0;
  const lowDisk = u ? u.disk_free_bytes < 1024 ** 3 : false;

  return (
    <div className="space-y-4">
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      {list.error && <Alert kind="error">{list.error}</Alert>}

      <Card
        title="Backups"
        actions={
          <>
            <Button variant="secondary" onClick={() => void chooseFile()}>
              Restore from file…
            </Button>
            <Button onClick={() => void backupNow()} busy={busy}>
              Back up now
            </Button>
          </>
        }
      >
        {u && (
          <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-[2fr_1fr_1fr]">
            <div>
              <div className="flex justify-between text-sm">
                <span className="font-medium">Space used by backups</span>
                <span className="text-muted">
                  {formatBytes(u.used_bytes)} of {formatBytes(u.max_total_bytes)} limit
                </span>
              </div>
              <div
                className="mt-2 h-2.5 overflow-hidden rounded-full bg-canvas"
                role="progressbar"
                aria-label="Backup space used"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className={`h-full rounded-full ${pct > 90 ? 'bg-amber-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted">When the limit is reached the oldest backups are removed first. The newest good backup is always kept.</p>
            </div>
            <Stat label="Free disk space" value={formatBytes(u.disk_free_bytes)} warn={lowDisk} />
            <Stat label="Backups kept" value={String(u.count)} />
          </div>
        )}
        {lowDisk && <div className="mb-4"><Alert kind="warning">Less than 1 GB of disk space is free where backups are stored.</Alert></div>}

        <Table head={['Created', 'Type', 'Size', 'Verified', 'Second copy', '']}>
          {list.data?.backups.map((b) => (
            <tr key={b.filename}>
              <Td className="whitespace-nowrap">{formatDateTime(b.created_at)}</Td>
              <Td>
                <Badge tone={b.reason.startsWith('pre_') ? 'amber' : b.reason === 'manual' ? 'blue' : 'gray'}>{REASON_LABELS[b.reason]}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-muted">{formatBytes(b.size_bytes)}</Td>
              <Td>{b.verify_ok === true ? <Badge tone="green">OK</Badge> : b.verify_ok === false ? <Badge tone="red">Failed</Badge> : '—'}</Td>
              <Td>
                {b.secondary_copied ? (
                  <Badge tone="green">Copied</Badge>
                ) : b.secondary_error ? (
                  <span title={b.secondary_error}>
                    <Badge tone="red">Failed</Badge>
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Td>
              <Td className="whitespace-nowrap text-right">
                <LinkButton onClick={() => void verify(b)}>Verify</LinkButton>
                <LinkButton danger disabled={b.verify_ok === false} onClick={() => setRestoreTarget({ kind: 'backup', backup: b })}>
                  Restore
                </LinkButton>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <SettingsCard onSaved={() => void list.reload()} />

      {restoreTarget && <RestoreDialog target={restoreTarget} onClose={() => setRestoreTarget(null)} />}
    </div>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-sm text-muted">{label}</div>
      <div className={`mt-1 font-heading text-2xl font-semibold ${warn ? 'text-amber-600' : ''}`}>{value}</div>
    </div>
  );
}

function SettingsCard({ onSaved }: { onSaved: () => void }) {
  const loaded = useAsync(() => backupsApi.getSettings());
  const [form, setForm] = useState<BackupSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => {
    if (loaded.data) setForm(loaded.data);
  }, [loaded.data]);
  if (!form) return null;

  async function pick(field: 'backup_dir' | 'secondary_backup_dir', title: string) {
    const path = await window.fvt.chooseFolder(title);
    if (path) setForm((f) => (f ? { ...f, [field]: path } : f));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setResult(null);
    try {
      setForm(await backupsApi.saveSettings(form));
      setResult({ kind: 'success', text: 'Backup settings saved.' });
      onSaved();
    } catch (err) {
      setResult({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Backup settings">
      <form onSubmit={save} className="max-w-3xl space-y-4">
        {result && <Alert kind={result.kind}>{result.text}</Alert>}
        <FolderField label="Backup folder" value={form.backup_dir} onChange={(v) => setForm({ ...form, backup_dir: v })} onPick={() => void pick('backup_dir', 'Choose the backup folder')} hint="New backups are written here. Existing backups stay where they are." />
        <FolderField
          label="Second backup location (optional)"
          value={form.secondary_backup_dir}
          onChange={(v) => setForm({ ...form, secondary_backup_dir: v })}
          onPick={() => void pick('secondary_backup_dir', 'Choose a second backup location')}
          hint="For example a network drive or a OneDrive folder. Every backup is copied here too."
          clearable
        />
        <div className="max-w-xs">
          <Field
            label="Size limit for backups (GB)"
            type="number"
            min={0.1}
            step="any"
            value={form.max_total_backup_gb}
            onChange={(e) => setForm({ ...form, max_total_backup_gb: Number(e.target.value) })}
          />
        </div>
        <Button type="submit" busy={busy}>
          Save settings
        </Button>
      </form>
    </Card>
  );
}

function FolderField({ label, value, onChange, onPick, hint, clearable = false }: { label: string; value: string; onChange: (v: string) => void; onPick: () => void; hint: string; clearable?: boolean }) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <Field label={label} value={value} onChange={(e) => onChange(e.target.value)} hint={hint} placeholder={clearable ? 'Not set' : undefined} />
      </div>
      <div className="mb-[22px] flex gap-2">
        <Button type="button" variant="secondary" onClick={onPick}>
          Choose…
        </Button>
        {clearable && value && (
          <Button type="button" variant="ghost" onClick={() => onChange('')}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

function RestoreDialog({ target, onClose }: { target: RestoreTarget; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const label = target.kind === 'backup' ? `the ${REASON_LABELS[target.backup.reason].toLowerCase()} backup from ${formatDateTime(target.backup.created_at)}` : target.path;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (target.kind === 'backup') await backupsApi.restore(target.backup.filename, password);
      else await backupsApi.restoreFile(target.path, password);
      setDone(true);
      setTimeout(() => void window.fvt.relaunch(), 1500);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Dialog title="Restore complete" onClose={() => undefined}>
        <Alert kind="success">The data has been restored. The application is restarting…</Alert>
      </Dialog>
    );
  }
  return (
    <Dialog
      title="Restore backup"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="restore-form" variant="danger" busy={busy} disabled={!password}>
            Restore and restart
          </Button>
        </>
      }
    >
      <form id="restore-form" onSubmit={submit} className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <p className="text-sm">
          You are about to restore <strong className="break-all">{label}</strong>.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>The current data is backed up first (shown as “Before restore”), so nothing is lost.</li>
          <li>Anything entered after that backup was taken will no longer be shown.</li>
          <li>Everyone is signed out and the application restarts.</li>
        </ul>
        <Field label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </form>
    </Dialog>
  );
}
