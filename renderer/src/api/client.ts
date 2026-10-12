import type { BridgeRequest } from '../global';

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: 'viewer' | 'editor' | 'approver' | 'admin' | 'super_admin';
  must_change_password: boolean;
  permissions: string[];
}

export interface SystemStatus {
  mode: 'starting' | 'ready' | 'recovery' | 'restarting';
  needs_setup: boolean;
  version: string;
  recovery: { code: string; message: string } | null;
  password_policy: string;
}

export interface LoginResult {
  user: User;
  idle_timeout_seconds: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type UnauthorizedHandler = (code: string, message: string) => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** Called when any request (other than login) finds the session gone. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

const FALLBACK_MESSAGES: Record<number, string> = {
  403: 'You do not have permission for this.',
  503: 'The data service is not available.',
};

export async function api<T>(method: BridgeRequest['method'], path: string, body?: unknown): Promise<T> {
  const res = await window.fvt.api({ method, path, body });
  if (res.ok) return res.data as T;

  const detail = (res.data as { detail?: unknown } | null)?.detail;
  let code = 'error';
  let message = FALLBACK_MESSAGES[res.status] ?? 'Something went wrong. Please try again.';
  if (detail && typeof detail === 'object') {
    const d = detail as { code?: string; message?: string };
    code = d.code ?? code;
    message = d.message ?? message;
  } else if (Array.isArray(detail) || res.status === 422) {
    code = 'invalid_input';
    message = 'Please check the highlighted fields.';
  }
  // A 401 from sign-in or recovery is a wrong password, not an ended session.
  if (res.status === 401 && path !== '/api/auth/login' && !path.startsWith('/api/recovery/')) onUnauthorized?.(code, message);
  throw new ApiError(res.status, code, message);
}

export const authApi = {
  status: () => api<SystemStatus>('GET', '/api/system/status'),
  setup: (body: { username: string; display_name: string; password: string; confirm_password: string }) =>
    api<User>('POST', '/api/setup/super-admin', body),
  login: (username: string, password: string) => api<LoginResult>('POST', '/api/auth/login', { username, password }),
  logout: () => api<null>('POST', '/api/auth/logout'),
  me: () => api<User>('GET', '/api/auth/me'),
  heartbeat: () => api<null>('POST', '/api/auth/heartbeat'),
  changePasswordAtLogin: (username: string, current_password: string, new_password: string, confirm_password: string) =>
    api<null>('POST', '/api/auth/change-password-at-login', { username, current_password, new_password, confirm_password }),
  changePassword: (current_password: string, new_password: string, confirm_password: string) =>
    api<null>('POST', '/api/auth/change-password', { current_password, new_password, confirm_password }),
};
