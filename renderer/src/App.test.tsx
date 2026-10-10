import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { IDLE_LIMIT_MS, WARNING_MS } from './auth/useIdleTimer';
import { FakeBackend } from './test/fakeBackend';

const GOOD = 'Str0ng!Passw0rd';
let backend: FakeBackend;

function renderApp() {
  return render(
    <AuthProvider>
      <App />
    </AuthProvider>,
  );
}

async function signIn(username: string, password = GOOD) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Username'), username);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  return user;
}

beforeEach(() => {
  backend = new FakeBackend();
  backend.install();
  window.location.hash = '';
});

describe('first run', () => {
  it('shows only the Create Super Admin screen', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Create Super Admin' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('keeps the button disabled until the password policy is met, then creates the account', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(await screen.findByLabelText('Username'), 'founder');
    const submit = screen.getByRole('button', { name: 'Create Super Admin' });

    await user.type(screen.getByLabelText('Password'), 'weakpass');
    await user.type(screen.getByLabelText('Confirm password'), 'weakpass');
    expect(submit).toBeDisabled();
    const checklist = screen.getByRole('list', { name: 'Password requirements' });
    expect(within(checklist).getByText(/At least 10 characters/)).toHaveTextContent('(not met)');

    await user.clear(screen.getByLabelText('Password'));
    await user.clear(screen.getByLabelText('Confirm password'));
    await user.type(screen.getByLabelText('Password'), GOOD);
    await user.type(screen.getByLabelText('Confirm password'), GOOD);
    expect(within(checklist).getByText(/Both passwords match/)).toHaveTextContent('(met)');
    await user.click(submit);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/Super admin "founder" created/)).toBeInTheDocument();
    expect(backend.users[0].user.role).toBe('super_admin');
  });

  it('flags a password that contains the username', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(await screen.findByLabelText('Username'), 'founder');
    await user.type(screen.getByLabelText('Password'), 'Founder!2026x');
    expect(screen.getByText(/Does not contain the username/)).toHaveTextContent('(not met)');
  });
});

describe('sign in', () => {
  beforeEach(() => backend.addUser('founder', GOOD, 'super_admin'));

  it('shows the login screen and nothing else once set up', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('shows a generic error for a wrong password and clears the field', async () => {
    renderApp();
    await signIn('founder', 'Wrong!Passw0rd');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('explains a locked account', async () => {
    backend.failures = 5;
    renderApp();
    await signIn('founder');
    expect(await screen.findByText(/Try again in 5 minutes/)).toBeInTheDocument();
  });

  it('opens the app with the full menu for a Super Admin', async () => {
    renderApp();
    await signIn('founder');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const item of ['Dashboard', 'Upload data', 'Approvals', 'Master data', 'Users', 'Backups', 'Audit log']) {
      expect(within(nav).getByRole('link', { name: item })).toBeInTheDocument();
    }
    expect(within(nav).getByText('Super Admin')).toBeInTheDocument();
  });

  it('hides upload, approval, backup and user management from a Viewer', async () => {
    backend.addUser('val', GOOD, 'viewer');
    renderApp();
    await signIn('val');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    for (const item of ['Upload data', 'Approvals', 'Master data', 'Users', 'Backups', 'Audit log']) {
      expect(within(nav).queryByRole('link', { name: item })).not.toBeInTheDocument();
    }
  });

  it('redirects a Viewer who types a forbidden address back to the dashboard', async () => {
    backend.addUser('val', GOOD, 'viewer');
    window.location.hash = '#/users';
    renderApp();
    await signIn('val');
    expect(await screen.findByText(/Welcome, val/)).toBeInTheDocument();
    expect(screen.queryByText(/user management phase/)).not.toBeInTheDocument();
  });

  it('signs out', async () => {
    renderApp();
    const user = await signIn('founder');
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('You have signed out.')).toBeInTheDocument();
    expect(backend.signedIn).toBeNull();
  });

  it('returns to login with a message when the server ends the session', async () => {
    renderApp();
    await signIn('founder');
    await screen.findByRole('navigation', { name: 'Main' });
    backend.signedIn = null;
    backend.nextResponse['POST /api/auth/heartbeat'] = {
      status: 401,
      ok: false,
      data: { detail: { code: 'session_expired', message: 'You were signed out after 15 minutes of inactivity.' } },
    };
    const { authApi } = await import('./api/client');
    await act(async () => {
      await authApi.heartbeat().catch(() => undefined);
    });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/15 minutes of inactivity/)).toBeInTheDocument();
  });
});

describe('forced password change', () => {
  it('blocks the app until the password is changed', async () => {
    backend.addUser('founder', GOOD, 'super_admin');
    backend.addUser('eddie', 'Temp!Pass1234', 'editor', true);
    renderApp();
    const user = await signIn('eddie', 'Temp!Pass1234');
    expect(await screen.findByRole('heading', { name: 'Change your password' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Current (temporary) password'), 'Temp!Pass1234');
    await user.type(screen.getByLabelText('New password'), 'Brand!New2026x');
    await user.type(screen.getByLabelText('Confirm new password'), 'Brand!New2026x');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByText('Your password has been changed.')).toBeInTheDocument();
  });
});

describe('inactivity', () => {
  it('warns one minute before, then signs out after 15 minutes', async () => {
    backend.addUser('founder', GOOD, 'super_admin');
    vi.useFakeTimers({ shouldAdvanceTime: true }); // before render, so the app's own timer is simulated
    try {
      renderApp();
      await signIn('founder');
      await screen.findByRole('navigation', { name: 'Main' });
      await act(async () => {
        vi.advanceTimersByTime(IDLE_LIMIT_MS - WARNING_MS + 1000);
      });
      expect(screen.getByRole('alertdialog')).toHaveTextContent(/signed out in \d+ seconds/);
      await act(async () => {
        vi.advanceTimersByTime(WARNING_MS);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(await screen.findByText('You were signed out after 15 minutes of inactivity.')).toBeInTheDocument();
    expect(backend.signedIn).toBeNull();
  });

  it('keeps the session when the user clicks "Stay signed in"', async () => {
    backend.addUser('founder', GOOD, 'super_admin');
    vi.useFakeTimers({ shouldAdvanceTime: true }); // before render, so the app's own timer is simulated
    try {
      renderApp();
      await signIn('founder');
      await screen.findByRole('navigation', { name: 'Main' });
      await act(async () => {
        vi.advanceTimersByTime(IDLE_LIMIT_MS - WARNING_MS + 1000);
      });
      act(() => screen.getByRole('button', { name: 'Stay signed in' }).click());
      await act(async () => {
        vi.advanceTimersByTime(WARNING_MS + 2000);
      });
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('recovery mode', () => {
  it('shows the recovery message and no login or data', async () => {
    backend.addUser('founder', GOOD, 'super_admin');
    backend.mode = 'recovery';
    renderApp();
    expect(await screen.findByRole('heading', { name: 'The database needs to be restored' })).toBeInTheDocument();
    expect(screen.getByText(/integrity check/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });
});
