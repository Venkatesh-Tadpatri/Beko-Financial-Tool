import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { FakeBackend, START_PASSWORD } from './test/fakeBackend';

const GOOD = 'Str0ng!Passw0rd';
let backend: FakeBackend;

async function openAs(page: string, role: 'super_admin' | 'viewer' = 'super_admin') {
  if (role !== 'super_admin') backend.addUser('val', GOOD, role);
  render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  );
  const user = userEvent.setup({ delay: null });
  await user.type(await screen.findByLabelText('Username'), role === 'super_admin' ? 'founder' : 'val');
  await user.type(screen.getByLabelText('Password'), GOOD);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  const nav = await screen.findByRole('navigation', { name: 'Main' });
  if (page !== 'Dashboard') await user.click(within(nav).getByRole('link', { name: page }));
  return user;
}

beforeEach(() => {
  backend = new FakeBackend();
  backend.install();
  backend.addUser('founder', GOOD, 'super_admin');
  window.location.hash = '';
});

describe('Users', () => {
  it('lists users with role and status, founder cannot be disabled', async () => {
    await openAs('Users');
    const row = (await screen.findByText('Original Super Admin')).closest('tr')!;
    expect(within(row).getByText('Super Admin')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Disable' })).toBeDisabled();
  });

  it('adds a user with a starting password the admin types', async () => {
    const user = await openAs('Users');
    await user.click(await screen.findByRole('button', { name: 'Add user' }));
    const dialog = screen.getByRole('dialog', { name: 'Add user' });
    const create = within(dialog).getByRole('button', { name: 'Create user' });
    await user.type(within(dialog).getByLabelText('Username'), 'priya@beko-technologies.com');
    await user.type(within(dialog).getByLabelText('Full name'), 'Priya Sharma');
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'editor');
    expect(within(dialog).getByText(/upload Excel files/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Starting password'), 'weak');
    expect(create).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('Starting password'));
    await user.type(within(dialog).getByLabelText('Starting password'), START_PASSWORD);
    await user.type(within(dialog).getByLabelText('Confirm starting password'), START_PASSWORD);
    expect(create).toBeEnabled();
    await user.click(create);
    expect(await screen.findByText(/has been created. Give them the starting password/)).toBeInTheDocument();
    expect(await screen.findByText('Priya Sharma')).toBeInTheDocument();
    const created = backend.users.find((u) => u.user.username === 'priya@beko-technologies.com')!;
    expect(created.password).toBe(START_PASSWORD);
    expect(created.user.must_change_password).toBe(true);
  });

  it('shows a clear error for a duplicate username', async () => {
    const user = await openAs('Users');
    await user.click(await screen.findByRole('button', { name: 'Add user' }));
    const dialog = screen.getByRole('dialog', { name: 'Add user' });
    await user.type(within(dialog).getByLabelText('Username'), 'FOUNDER');
    await user.type(within(dialog).getByLabelText('Starting password'), START_PASSWORD);
    await user.type(within(dialog).getByLabelText('Confirm starting password'), START_PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already in use');
  });

  it('resets a password to one the admin types', async () => {
    backend.addUser('ravi', GOOD, 'editor');
    const user = await openAs('Users');
    const row = (await screen.findByText('ravi', { selector: 'div.text-xs' })).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Reset password' }));
    const dialog = screen.getByRole('dialog', { name: 'Reset password' });
    expect(within(dialog).getByText(/will be signed out/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('New starting password'), START_PASSWORD);
    await user.type(within(dialog).getByLabelText('Confirm new starting password'), START_PASSWORD);
    await user.click(within(dialog).getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByText(/The password for ravi has been reset/)).toBeInTheDocument();
    expect(backend.users[1].password).toBe(START_PASSWORD);
    expect(backend.users[1].user.must_change_password).toBe(true);
  });

  it('disables and re-enables a user', async () => {
    backend.addUser('ravi', GOOD, 'editor');
    const user = await openAs('Users');
    const row = () => screen.getByText('ravi', { selector: 'div.text-xs' }).closest('tr')!;
    await screen.findByText('ravi', { selector: 'div.text-xs' });
    await user.click(within(row()).getByRole('button', { name: 'Disable' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Disable user' })).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(within(row()).getByText('Disabled')).toBeInTheDocument());
    await user.click(within(row()).getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(within(row()).getByText('Active')).toBeInTheDocument());
  });

  it('keeps the founder role fixed in the edit dialog', async () => {
    const user = await openAs('Users');
    const row = (await screen.findByText('Original Super Admin')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Edit' }));
    expect(within(screen.getByRole('dialog')).getByLabelText('Role')).toBeDisabled();
  });
});

describe('Audit log', () => {
  it('shows readable entries and verifies integrity', async () => {
    const user = await openAs('Audit log');
    const table = await screen.findByRole('table');
    expect(await within(table).findByText('Signed in')).toBeInTheDocument();
    expect(within(table).getByText('Super Admin created')).toBeInTheDocument();
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Verify integrity' }));
    expect(await screen.findByText(/All 2 entries verified/)).toBeInTheDocument();
  });

  it('reports tampering', async () => {
    backend.auditChainOk = false;
    const user = await openAs('Audit log');
    await user.click(await screen.findByRole('button', { name: 'Verify integrity' }));
    expect(await screen.findByText(/Entry #2 has been altered/)).toBeInTheDocument();
  });

  it('sends filters to the server', async () => {
    const user = await openAs('Audit log');
    await user.selectOptions(await screen.findByLabelText('Action'), 'login');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(backend.calls.some((c) => c.path.includes('action=login'))).toBe(true));
  });
});

describe('Backups', () => {
  it('shows space used, free disk space and the backup list', async () => {
    await openAs('Backups');
    expect(await screen.findByRole('progressbar', { name: 'Backup space used' })).toBeInTheDocument();
    expect(screen.getByText('Free disk space')).toBeInTheDocument();
    expect(screen.getByText('50 GB')).toBeInTheDocument();
    expect(screen.getAllByText('Daily')).toHaveLength(2);
  });

  it('creates a backup on demand', async () => {
    const user = await openAs('Backups');
    await user.click(await screen.findByRole('button', { name: 'Back up now' }));
    expect(await screen.findByText('Backup created and verified.')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });

  it('restores only after the password is re-entered, then restarts', async () => {
    const user = await openAs('Backups');
    const firstRow = (await screen.findAllByRole('button', { name: 'Restore' }))[0];
    await user.click(firstRow);
    const dialog = screen.getByRole('dialog', { name: 'Restore backup' });
    expect(within(dialog).getByText(/backed up first/)).toBeInTheDocument();
    const go = within(dialog).getByRole('button', { name: 'Restore and restart' });
    expect(go).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Your password'), 'Wrong!Pass123');
    await user.click(go);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('not correct');
    await user.clear(within(dialog).getByLabelText('Your password'));
    await user.type(within(dialog).getByLabelText('Your password'), GOOD);
    await user.click(go);
    expect(await screen.findByText(/application is restarting/)).toBeInTheDocument();
    await waitFor(() => expect(backend.relaunched).toBe(true), { timeout: 3000 });
  });

  it('restores from a chosen file', async () => {
    backend.chosenFile = 'E:\\usb\\copy.db';
    const user = await openAs('Backups');
    await user.click(await screen.findByRole('button', { name: 'Restore from file…' }));
    expect(screen.getByRole('dialog', { name: 'Restore backup' })).toHaveTextContent('E:\\usb\\copy.db');
  });

  it('saves a second backup location chosen with the folder picker', async () => {
    backend.chosenFolder = 'D:\\OneDrive\\FVT';
    const user = await openAs('Backups');
    const second = await screen.findByLabelText('Second backup location (optional)');
    await user.click(within(second.closest('.flex.items-end')! as HTMLElement).getByRole('button', { name: 'Choose…' }));
    await waitFor(() => expect(second).toHaveValue('D:\\OneDrive\\FVT'));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Backup settings saved.')).toBeInTheDocument();
    expect(backend.settings.secondary_backup_dir).toBe('D:\\OneDrive\\FVT');
  });
});

describe('Viewer', () => {
  it('cannot open admin pages by address', async () => {
    window.location.hash = '#/backups';
    await openAs('Dashboard', 'viewer');
    expect(await screen.findByText(/Welcome, val/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back up now' })).not.toBeInTheDocument();
    expect(backend.calls.some((c) => c.path.startsWith('/api/backups'))).toBe(false);
  });
});

describe('Recovery', () => {
  it('restores the newest good backup with credentials from the backup and restarts', async () => {
    backend.mode = 'recovery';
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );
    const user = userEvent.setup({ delay: null });
    const radios = await screen.findAllByRole('radio');
    await waitFor(() => expect(radios[0]).toBeChecked());
    await user.type(screen.getByLabelText('Super Admin username'), 'founder');
    await user.type(screen.getByLabelText('Password'), 'Wrong!Pass123');
    await user.click(screen.getByRole('button', { name: 'Restore and restart' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Super Admin in that backup');
    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), GOOD);
    await user.click(screen.getByRole('button', { name: 'Restore and restart' }));
    expect(await screen.findByText(/application is restarting/)).toBeInTheDocument();
    await waitFor(() => expect(backend.relaunched).toBe(true), { timeout: 3000 });
  });
});
