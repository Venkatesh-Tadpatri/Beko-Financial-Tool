import { api } from './client';

export type Role = 'viewer' | 'editor' | 'approver' | 'admin' | 'super_admin';

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  is_active: boolean;
  is_founder: boolean;
  must_change_password: boolean;
  locked: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface TemporaryPassword {
  user: UserRow;
  temporary_password: string;
}

export const usersApi = {
  list: () => api<UserRow[]>('GET', '/api/users'),
  create: (username: string, display_name: string, role: Role) =>
    api<TemporaryPassword>('POST', '/api/users', { username, display_name, role }),
  update: (id: number, body: { display_name?: string; role?: Role }) => api<UserRow>('PATCH', `/api/users/${id}`, body),
  disable: (id: number) => api<UserRow>('POST', `/api/users/${id}/disable`),
  enable: (id: number) => api<UserRow>('POST', `/api/users/${id}/enable`),
  resetPassword: (id: number) => api<TemporaryPassword>('POST', `/api/users/${id}/reset-password`),
  unlock: (id: number) => api<UserRow>('POST', `/api/users/${id}/unlock`),
};

export interface AuditRow {
  id: number;
  ts: string;
  username: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
}

export interface AuditFilters {
  action?: string;
  username?: string;
  date_from?: string;
  date_to?: string;
}

export const auditApi = {
  list: (f: AuditFilters, limit: number, offset: number) => {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset), tz_offset_minutes: String(-new Date().getTimezoneOffset()) });
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
    return api<{ items: AuditRow[]; total: number }>('GET', `/api/audit?${q.toString()}`);
  },
  actions: () => api<string[]>('GET', '/api/audit/actions'),
  verify: () => api<{ ok: boolean; entries_checked: number; first_bad_id: number | null }>('GET', '/api/audit/verify-chain'),
};

export interface BackupRow {
  filename: string;
  reason: 'pre_migration' | 'pre_restore' | 'upload' | 'approval' | 'daily' | 'manual';
  created_at: string;
  size_bytes: number;
  schema_version: string | null;
  verified_at: string | null;
  verify_ok: boolean | null;
  secondary_copied: boolean;
  secondary_error: string | null;
}

export interface BackupUsage {
  backup_dir: string;
  secondary_backup_dir: string | null;
  count: number;
  used_bytes: number;
  max_total_bytes: number;
  disk_free_bytes: number;
  disk_total_bytes: number;
}

export interface BackupSettings {
  backup_dir: string;
  default_backup_dir?: string;
  secondary_backup_dir: string;
  max_total_backup_gb: number;
}

export interface RestoreResult {
  restored_from: string;
  pre_restore_backup?: string;
  damaged_copy?: string;
  restart_required: boolean;
}

export const backupsApi = {
  list: () => api<{ backups: BackupRow[]; usage: BackupUsage }>('GET', '/api/backups'),
  create: () => api<BackupRow>('POST', '/api/backups'),
  verify: (filename: string) => api<{ ok: boolean; problems: string[] }>('POST', `/api/backups/${filename}/verify`),
  restore: (filename: string, password: string) => api<RestoreResult>('POST', `/api/backups/${filename}/restore`, { password }),
  restoreFile: (path: string, password: string) => api<RestoreResult>('POST', '/api/backups/restore-file', { path, password }),
  getSettings: () => api<BackupSettings>('GET', '/api/backups/settings'),
  saveSettings: (s: BackupSettings) => api<BackupSettings>('PUT', '/api/backups/settings', s),
};

export const recoveryApi = {
  backups: () => api<BackupRow[]>('GET', '/api/recovery/backups'),
  restore: (body: { filename?: string; path?: string; username: string; password: string }) =>
    api<RestoreResult>('POST', '/api/recovery/restore', body),
};
