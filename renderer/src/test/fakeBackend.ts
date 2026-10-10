import type { BackupRow } from '../api/admin';
import type { User } from '../api/client';
import type { BridgeRequest, BridgeResponse } from '../global';
import { FakeData } from './fakeData';

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
  is_active: boolean;
  is_founder: boolean;
  locked: boolean;
}

export const TEMP_PASSWORD = 'Temp!Pass2345x';

/** In-memory stand-in for the Electron bridge + backend, with just enough behaviour for UI tests. */
export class FakeBackend {
  mode: 'ready' | 'recovery' = 'ready';
  users: FakeUser[] = [];
  signedIn: FakeUser | null = null;
  calls: BridgeRequest[] = [];
  failures = 0;
  nextResponse: Partial<Record<string, BridgeResponse>> = {};
  relaunched = false;
  chosenFile: string | null = null;
  chosenFolder: string | null = null;
  chosenExcel: string | null = null;
  data = new FakeData();
  backups: BackupRow[] = [
    { filename: 'app-20261010-090000-000000-daily.db', reason: 'daily', created_at: '2026-10-10T09:00:00+00:00', size_bytes: 344064, schema_version: '0001', verified_at: '2026-10-10T09:00:00+00:00', verify_ok: true, secondary_copied: false, secondary_error: null },
    { filename: 'app-20261009-090000-000000-daily.db', reason: 'daily', created_at: '2026-10-09T09:00:00+00:00', size_bytes: 300000, schema_version: '0001', verified_at: '2026-10-09T09:00:00+00:00', verify_ok: true, secondary_copied: true, secondary_error: null },
  ];
  settings = { backup_dir: 'C:\\Users\\x\\AppData\\Roaming\\FinancialVisualizationTool\\backups', secondary_backup_dir: '', max_total_backup_gb: 5 };
  audit = [
    { id: 2, ts: '2026-10-10T09:05:00+00:00', username: 'founder', action: 'login', entity_type: 'session', entity_id: '1', details: {} },
    { id: 1, ts: '2026-10-10T09:00:00+00:00', username: 'founder', action: 'setup_super_admin', entity_type: 'user', entity_id: '1', details: {} },
  ];
  auditChainOk = true;

  addUser(username: string, password: string, role: User['role'], mustChange = false): FakeUser {
    const u: FakeUser = {
      password,
      is_active: true,
      is_founder: this.users.length === 0,
      locked: false,
      user: { id: this.users.length + 1, username, display_name: username, role, must_change_password: mustChange, permissions: [...ROLE_PERMS[role]] },
    };
    this.users.push(u);
    return u;
  }

  install(): void {
    window.fvt = {
      isDesktop: true,
      api: (req) => Promise.resolve(this.handle(req)),
      chooseBackupFile: () => Promise.resolve(this.chosenFile),
      chooseExcelFile: () => Promise.resolve(this.chosenExcel),
      chooseFolder: () => Promise.resolve(this.chosenFolder),
      relaunch: () => {
        this.relaunched = true;
        return Promise.resolve();
      },
    };
  }

  private err(status: number, code: string, message: string): BridgeResponse {
    return { status, ok: false, data: { detail: { code, message } } };
  }

  private ok(data: unknown, status = 200): BridgeResponse {
    return { status, ok: true, data };
  }

  private row(u: FakeUser) {
    return {
      id: u.user.id, username: u.user.username, display_name: u.user.display_name, role: u.user.role, is_active: u.is_active,
      is_founder: u.is_founder, must_change_password: u.user.must_change_password, locked: u.locked, last_login_at: null,
      created_at: '2026-10-10T09:00:00+00:00',
    };
  }

  handle(req: BridgeRequest): BridgeResponse {
    this.calls.push(req);
    const route = req.path.split('?')[0];
    const key = `${req.method} ${route}`;
    const forced = this.nextResponse[key];
    if (forced) {
      delete this.nextResponse[key];
      return forced;
    }
    const body = (req.body ?? {}) as Record<string, string>;
    const userMatch = /^\/api\/users\/(\d+)(?:\/([a-z-]+))?$/.exec(route);
    const backupMatch = /^\/api\/backups\/([^/]+)\/(verify|restore)$/.exec(route);

    const dataResponse = this.data.handle(req, route, this.signedIn);
    if (dataResponse) return dataResponse;
    if (userMatch) {
      const u = this.users.find((x) => x.user.id === Number(userMatch[1]));
      if (!u) return this.err(404, 'not_found', 'User not found.');
      switch (`${req.method} ${userMatch[2] ?? ''}`) {
        case 'PATCH ':
          if (body.role && u.is_founder && body.role !== u.user.role) return this.err(409, 'founder_protected', "The original Super Admin's role cannot be changed.");
          u.user = { ...u.user, display_name: body.display_name ?? u.user.display_name, role: (body.role as User['role']) ?? u.user.role };
          return this.ok(this.row(u));
        case 'POST disable':
          u.is_active = false;
          return this.ok(this.row(u));
        case 'POST enable':
          u.is_active = true;
          return this.ok(this.row(u));
        case 'POST unlock':
          u.locked = false;
          return this.ok(this.row(u));
        case 'POST reset-password':
          u.password = TEMP_PASSWORD;
          u.locked = false;
          u.user = { ...u.user, must_change_password: true };
          return this.ok({ user: this.row(u), temporary_password: TEMP_PASSWORD });
      }
    }
    if (backupMatch) {
      const b = this.backups.find((x) => x.filename === backupMatch[1]);
      if (!b) return this.err(404, 'not_found', 'Backup not found.');
      if (backupMatch[2] === 'verify') return this.ok({ ok: true, problems: [] });
      if (body.password !== this.signedIn?.password) return this.err(400, 'wrong_password', 'Your password is not correct.');
      return this.ok({ restored_from: b.filename, pre_restore_backup: 'app-x-pre_restore.db', restart_required: true });
    }

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
        if (!u || u.password !== body.password || !u.is_active) {
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

      case 'GET /api/users':
        return this.ok(this.users.map((u) => this.row(u)));
      case 'POST /api/users': {
        if (this.users.some((u) => u.user.username.toLowerCase() === body.username.toLowerCase()))
          return this.err(409, 'username_taken', `The username "${body.username}" is already in use.`);
        const u = this.addUser(body.username, TEMP_PASSWORD, body.role as User['role'], true);
        u.user.display_name = body.display_name || body.username;
        return this.ok({ user: this.row(u), temporary_password: TEMP_PASSWORD }, 201);
      }

      case 'GET /api/audit':
        return this.ok({ items: this.audit, total: this.audit.length });
      case 'GET /api/audit/actions':
        return this.ok([...new Set(this.audit.map((a) => a.action))].sort());
      case 'GET /api/audit/verify-chain':
        return this.ok({ ok: this.auditChainOk, entries_checked: this.audit.length, first_bad_id: this.auditChainOk ? null : 2 });

      case 'GET /api/backups':
        return this.ok({
          backups: this.backups,
          usage: { backup_dir: this.settings.backup_dir, secondary_backup_dir: null, count: this.backups.length, used_bytes: 644064, max_total_bytes: 5 * 1024 ** 3, disk_free_bytes: 50 * 1024 ** 3, disk_total_bytes: 200 * 1024 ** 3 },
        });
      case 'POST /api/backups': {
        const b: BackupRow = { ...this.backups[0], filename: 'app-20261010-100000-000000-manual.db', reason: 'manual', created_at: '2026-10-10T10:00:00+00:00' };
        this.backups = [b, ...this.backups];
        return this.ok(b, 201);
      }
      case 'GET /api/backups/settings':
        return this.ok(this.settings);
      case 'PUT /api/backups/settings':
        this.settings = req.body as typeof this.settings;
        return this.ok(this.settings);
      case 'POST /api/backups/restore-file':
        if (body.password !== this.signedIn?.password) return this.err(400, 'wrong_password', 'Your password is not correct.');
        return this.ok({ restored_from: 'copy.db', restart_required: true });

      case 'GET /api/recovery/backups':
        return this.ok(this.backups);
      case 'POST /api/recovery/restore': {
        const u = this.users.find((x) => x.user.username === body.username && x.user.role === 'super_admin');
        if (!u || u.password !== body.password) return this.err(401, 'invalid_credentials', 'Use the username and password of a Super Admin in that backup.');
        return this.ok({ restored_from: body.filename ?? 'file', damaged_copy: 'x', restart_required: true });
      }
      default:
        return this.err(404, 'not_found', 'Not found');
    }
  }
}
