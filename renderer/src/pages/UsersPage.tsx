import { useState, type FormEvent, type ReactNode } from 'react';
import { usersApi, type Role, type TemporaryPassword, type UserRow } from '../api/admin';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, Dialog, errorText, formatDateTime, LinkButton, Select, Table, Td, useAsync } from '../components/kit';
import { Alert, Button, Field } from '../components/ui';
import { ROLE_LABELS } from '../shell/nav';

const ROLE_HELP: Record<Role, string> = {
  viewer: 'View dashboards and reports, export reports.',
  editor: 'Viewer, plus upload Excel files and save drafts.',
  approver: 'Editor, plus approve or reject submitted data.',
  admin: 'Approver, plus manage master data and SAP code mappings.',
  super_admin: 'Everything, plus users, backups and the audit log.',
};
const ROLES: Role[] = ['viewer', 'editor', 'approver', 'admin', 'super_admin'];
const ROLE_TONE: Record<Role, 'gray' | 'blue' | 'teal' | 'amber' | 'red'> = {
  viewer: 'gray',
  editor: 'blue',
  approver: 'teal',
  admin: 'amber',
  super_admin: 'red',
};

type Pending =
  | { kind: 'add' }
  | { kind: 'edit'; user: UserRow }
  | { kind: 'reset' | 'disable'; user: UserRow }
  | { kind: 'temp'; result: TemporaryPassword; reason: 'created' | 'reset' };

export function UsersPage() {
  const { user: me } = useAuth();
  const users = useAsync(() => usersApi.list());
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const close = () => setPending(null);

  async function quick(action: () => Promise<unknown>, done: string) {
    setRowError(null);
    try {
      await action();
      setMessage(done);
      await users.reload();
    } catch (e) {
      setRowError(errorText(e));
    }
  }

  return (
    <div className="space-y-4">
      {message && <Alert kind="success">{message}</Alert>}
      {(rowError || users.error) && <Alert kind="error">{rowError || users.error}</Alert>}
      <Card
        title={`Users${users.data ? ` (${users.data.length})` : ''}`}
        actions={<Button onClick={() => setPending({ kind: 'add' })}>Add user</Button>}
      >
        <Table head={['User', 'Role', 'Status', 'Last sign-in', '']}>
          {users.data?.map((u) => (
            <tr key={u.id}>
              <Td>
                <div className="font-medium">{u.display_name}</div>
                <div className="text-xs text-muted">{u.username}</div>
              </Td>
              <Td>
                <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABELS[u.role]}</Badge>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1.5">
                  {u.is_active ? <Badge tone="green">Active</Badge> : <Badge>Disabled</Badge>}
                  {u.locked && <Badge tone="red">Locked</Badge>}
                  {u.must_change_password && <Badge tone="amber">Must change password</Badge>}
                  {u.is_founder && <Badge tone="blue">Original Super Admin</Badge>}
                </div>
              </Td>
              <Td className="whitespace-nowrap text-muted">{formatDateTime(u.last_login_at)}</Td>
              <Td className="whitespace-nowrap text-right">
                <LinkButton onClick={() => setPending({ kind: 'edit', user: u })}>Edit</LinkButton>
                <LinkButton onClick={() => setPending({ kind: 'reset', user: u })}>Reset password</LinkButton>
                {u.locked && <LinkButton onClick={() => void quick(() => usersApi.unlock(u.id), `${u.username} has been unlocked.`)}>Unlock</LinkButton>}
                {u.is_active ? (
                  <LinkButton danger disabled={u.is_founder || u.id === me?.id} onClick={() => setPending({ kind: 'disable', user: u })}>
                    Disable
                  </LinkButton>
                ) : (
                  <LinkButton onClick={() => void quick(() => usersApi.enable(u.id), `${u.username} can sign in again.`)}>Enable</LinkButton>
                )}
              </Td>
            </tr>
          ))}
        </Table>
        <p className="mt-4 text-xs text-muted">Users are never deleted, so their history stays in the audit log. Disable an account to stop access.</p>
      </Card>

      {pending?.kind === 'add' && (
        <UserDialog
          onClose={close}
          onSaved={(r) => {
            setPending({ kind: 'temp', result: r as TemporaryPassword, reason: 'created' });
            void users.reload();
          }}
        />
      )}
      {pending?.kind === 'edit' && (
        <UserDialog
          user={pending.user}
          onClose={close}
          onSaved={() => {
            close();
            setMessage(`${pending.user.username} has been updated.`);
            void users.reload();
          }}
        />
      )}
      {pending?.kind === 'reset' && (
        <ConfirmDialog
          title="Reset password"
          confirm="Reset password"
          onClose={close}
          onConfirm={async () => {
            const r = await usersApi.resetPassword(pending.user.id);
            setPending({ kind: 'temp', result: r, reason: 'reset' });
            void users.reload();
          }}
        >
          <p className="text-sm">
            <strong>{pending.user.display_name}</strong> will be signed out and given a new temporary password. They must choose their own password
            when they next sign in.
          </p>
        </ConfirmDialog>
      )}
      {pending?.kind === 'disable' && (
        <ConfirmDialog
          title="Disable user"
          confirm="Disable"
          danger
          onClose={close}
          onConfirm={async () => {
            await usersApi.disable(pending.user.id);
            close();
            setMessage(`${pending.user.username} has been disabled.`);
            void users.reload();
          }}
        >
          <p className="text-sm">
            <strong>{pending.user.display_name}</strong> will be signed out immediately and cannot sign in until the account is enabled again.
          </p>
        </ConfirmDialog>
      )}
      {pending?.kind === 'temp' && <TempPasswordDialog result={pending.result} reason={pending.reason} onClose={close} />}
    </div>
  );
}

function UserDialog({ user, onClose, onSaved }: { user?: UserRow; onClose: () => void; onSaved: (r: TemporaryPassword | UserRow) => void }) {
  const [username, setUsername] = useState(user?.username ?? '');
  const [name, setName] = useState(user?.display_name ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(user ? await usersApi.update(user.id, { display_name: name, role }) : await usersApi.create(username.trim(), name.trim(), role));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={user ? `Edit ${user.username}` : 'Add user'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" busy={busy} disabled={!user && !username.trim()}>
            {user ? 'Save' : 'Create user'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        {!user && <Field label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" hint="An email address, or letters, digits, dot, underscore or hyphen." />}
        <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={user?.is_founder}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted">{user?.is_founder ? 'The original Super Admin always keeps the Super Admin role.' : ROLE_HELP[role]}</p>
        {!user && <p className="text-xs text-muted">A temporary password is created for the user. They must change it when they first sign in.</p>}
      </form>
    </Dialog>
  );
}

function ConfirmDialog({
  title,
  confirm,
  danger = false,
  onClose,
  onConfirm,
  children,
}: {
  title: string;
  confirm: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
              } catch (e) {
                setError(errorText(e));
                setBusy(false);
              }
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      {children}
    </Dialog>
  );
}

function TempPasswordDialog({ result, reason, onClose }: { result: TemporaryPassword; reason: 'created' | 'reset'; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title={reason === 'created' ? 'User created' : 'Password reset'} onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <p className="text-sm">
        Temporary password for <strong>{result.user.username}</strong>:
      </p>
      <div className="flex items-center gap-3 rounded-lg border border-line bg-canvas px-4 py-3">
        <code aria-label="Temporary password" className="flex-1 select-all font-mono text-lg tracking-wider">
          {result.temporary_password}
        </code>
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard?.writeText(result.temporary_password);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <Alert kind="warning">
        This password is shown only once and is not stored anywhere readable. Give it to the user in person or by phone. They must change it when they
        first sign in.
      </Alert>
    </Dialog>
  );
}
