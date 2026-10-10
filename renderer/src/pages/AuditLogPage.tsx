import { useState } from 'react';
import { auditApi, type AuditFilters } from '../api/admin';
import { Badge, Card, errorText, formatDateTime, Select, Table, Td, useAsync } from '../components/kit';
import { Alert, Button, Field } from '../components/ui';

const PAGE = 50;

export const ACTION_LABELS: Record<string, string> = {
  setup_super_admin: 'Super Admin created',
  login: 'Signed in',
  logout: 'Signed out',
  login_failed: 'Sign-in failed',
  login_blocked: 'Sign-in blocked (locked)',
  account_locked: 'Account locked',
  password_changed: 'Password changed',
  password_reset: 'Password reset',
  user_created: 'User created',
  user_updated: 'User changed',
  user_disabled: 'User disabled',
  user_enabled: 'User enabled',
  user_unlocked: 'User unlocked',
  backup_created: 'Backup created',
  backup_verified: 'Backup verified',
  backup_settings_changed: 'Backup settings changed',
  restore_requested: 'Restore started',
  restore: 'Database restored',
};

const TONE: Record<string, 'red' | 'amber' | 'green' | 'blue' | 'gray'> = {
  login_failed: 'amber',
  login_blocked: 'red',
  account_locked: 'red',
  restore: 'red',
  restore_requested: 'red',
  user_disabled: 'amber',
  password_reset: 'amber',
  login: 'green',
};

function detailsText(d: Record<string, unknown>): string {
  return Object.entries(d)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(' → ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

export function AuditLogPage() {
  const [draft, setDraft] = useState<AuditFilters>({});
  const [filters, setFilters] = useState<AuditFilters>({});
  const [offset, setOffset] = useState(0);
  const page = useAsync(() => auditApi.list(filters, PAGE, offset), [filters, offset]);
  const actions = useAsync(() => auditApi.actions());
  const [verify, setVerify] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const apply = () => {
    setOffset(0);
    setFilters({ ...draft });
  };

  async function runVerify() {
    try {
      const r = await auditApi.verify();
      setVerify(
        r.ok
          ? { kind: 'success', text: `All ${r.entries_checked} entries verified. Nothing has been changed since it was written.` }
          : { kind: 'error', text: `Entry #${r.first_bad_id} has been altered outside the application. Entries before it are intact.` },
      );
    } catch (e) {
      setVerify({ kind: 'error', text: errorText(e) });
    }
  }

  const total = page.data?.total ?? 0;
  return (
    <div className="space-y-4">
      <Card
        title="Audit log"
        actions={
          <Button variant="secondary" onClick={() => void runVerify()}>
            Verify integrity
          </Button>
        }
      >
        <div className="space-y-4">
          {verify && <Alert kind={verify.kind}>{verify.text}</Alert>}
          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-5">
            <Select label="Action" value={draft.action ?? ''} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
              <option value="">All actions</option>
              {actions.data?.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABELS[a] ?? a}
                </option>
              ))}
            </Select>
            <Field label="User" value={draft.username ?? ''} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
            <Field label="From" type="date" value={draft.date_from ?? ''} onChange={(e) => setDraft({ ...draft, date_from: e.target.value })} />
            <Field label="To" type="date" value={draft.date_to ?? ''} onChange={(e) => setDraft({ ...draft, date_to: e.target.value })} />
            <div className="flex gap-2">
              <Button onClick={apply}>Apply</Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft({});
                  setOffset(0);
                  setFilters({});
                }}
              >
                Clear
              </Button>
            </div>
          </div>
          {page.error && <Alert kind="error">{page.error}</Alert>}
          <Table head={['Time', 'User', 'Action', 'Item', 'Details']}>
            {page.data?.items.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(r.ts)}</Td>
                <Td className="whitespace-nowrap">{r.username ?? '—'}</Td>
                <Td className="whitespace-nowrap">
                  <Badge tone={TONE[r.action] ?? 'gray'}>{ACTION_LABELS[r.action] ?? r.action}</Badge>
                </Td>
                <Td className="whitespace-nowrap text-muted">{r.entity_type ? `${r.entity_type} ${r.entity_id ?? ''}` : '—'}</Td>
                <Td className="max-w-[420px] truncate text-muted" >
                  <span title={detailsText(r.details)}>{detailsText(r.details) || '—'}</span>
                </Td>
              </tr>
            ))}
          </Table>
          <div className="flex items-center justify-between text-sm text-muted">
            <span>{total === 0 ? 'No entries' : `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}`}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                Newer
              </Button>
              <Button variant="secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
                Older
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted">The audit log is read-only. Entries cannot be edited or deleted from the application.</p>
        </div>
      </Card>
    </div>
  );
}
