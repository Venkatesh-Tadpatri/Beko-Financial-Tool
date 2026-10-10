import type { BridgeRequest, BridgeResponse } from '../global';
import type { User } from '../api/client';

const ROLE_PERMS: Record<User['role'], string[]> = {
  viewer: ['export_reports', 'view_reports'],
  editor: ['export_reports', 'save_drafts', 'upload_data', 'view_reports'],
  approver: ['approve_data', 'export_reports', 'override_data', 'save_drafts', 'upload_data', 'view_reports'],
  admin: ['approve_data', 'configure_approvals', 'export_reports', 'manage_mappings', 'manage_master_data', 'override_data', 'save_drafts', 'upload_data', 'view_reports'],
  super_admin: ['admin_data', 'approve_data', 'configure_approvals', 'export_reports', 'manage_backups', 'manage_mappings', 'manage_master_data', 'manage_users', 'override_data', 'save_drafts', 'upload_data', 'view_audit_log', 'view_reports'],
};

interface FakeUser {
  user: User;
  password: string;
}

/** In-memory stand-in for the Electron bridge + backend, with just enough behaviour for UI tests. */
export class FakeBackend {
  mode: 'ready' | 'recovery' = 'ready';
  users: FakeUser[] = [];
  signedIn: FakeUser | null = null;
  calls: BridgeRequest[] = [];
  failures = 0;
  nextResponse: Partial<Record<string, BridgeResponse>> = {};

  addUser(username: string, password: string, role: User['role'], mustChange = false): void {
    this.users.push({
      password,
      user: { id: this.users.length + 1, username, display_name: username, role, must_change_password: mustChange, permissions: ROLE_PERMS[role] },
    });
  }

  install(): void {
    window.fvt = { isDesktop: true, api: (req) => Promise.resolve(this.handle(req)) };
  }

  private err(status: number, code: string, message: string): BridgeResponse {
    return { status, ok: false, data: { detail: { code, message } } };
  }

  private ok(data: unknown, status = 200): BridgeResponse {
    return { status, ok: true, data };
  }

  handle(req: BridgeRequest): BridgeResponse {
    this.calls.push(req);
    const key = `${req.method} ${req.path}`;
    const forced = this.nextResponse[key];
    if (forced) {
      delete this.nextResponse[key];
      return forced;
    }
    const body = (req.body ?? {}) as Record<string, string>;
    switch (key) {
      case 'GET /api/system/status':
        return this.ok({
          mode: this.mode,
          needs_setup: this.users.length === 0,
          version: '1.0.0',
          recovery: this.mode === 'recovery' ? { code: 'integrity_failed', message: 'The database failed its integrity check.' } : null,
          password_policy: '',
        });
      case 'POST /api/setup/super-admin':
        if (this.users.length) return this.err(409, 'already_set_up', 'The super admin already exists.');
        this.addUser(body.username, body.password, 'super_admin');
        return this.ok(this.users[0].user, 201);
      case 'POST /api/auth/login': {
        const u = this.users.find((x) => x.user.username.toLowerCase() === body.username.toLowerCase());
        if (this.failures >= 5) return this.err(423, 'account_locked', 'Too many failed attempts. Try again in 5 minutes.');
        if (!u || u.password !== body.password) {
          this.failures += 1;
          return this.err(401, 'invalid_credentials', 'Invalid username or password.');
        }
        this.signedIn = u;
        return this.ok({ user: u.user, idle_timeout_seconds: 900 });
      }
      case 'GET /api/auth/me':
        return this.signedIn ? this.ok(this.signedIn.user) : this.err(401, 'not_authenticated', 'Please sign in.');
      case 'POST /api/auth/logout':
        this.signedIn = null;
        return this.ok(null, 204);
      case 'POST /api/auth/heartbeat':
        return this.signedIn ? this.ok(null, 204) : this.err(401, 'not_authenticated', 'Please sign in.');
      case 'POST /api/auth/change-password':
        if (!this.signedIn) return this.err(401, 'not_authenticated', 'Please sign in.');
        if (body.current_password !== this.signedIn.password) return this.err(400, 'wrong_password', 'Your current password is not correct.');
        this.signedIn.password = body.new_password;
        this.signedIn.user = { ...this.signedIn.user, must_change_password: false };
        return this.ok(null, 204);
      default:
        return this.err(404, 'not_found', 'Not found');
    }
  }
}
