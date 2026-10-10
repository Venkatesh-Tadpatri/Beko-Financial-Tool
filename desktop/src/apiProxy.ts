/**
 * The renderer never talks to the backend directly. It calls window.fvt.api(),
 * which arrives here over IPC. This process adds the per-launch app key and
 * the session token, so neither secret is ever visible to page JavaScript.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { Sidecar } from './sidecar.js';

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  ok: boolean;
  data: unknown;
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const PATH_RE = /^\/api\/[A-Za-z0-9/_\-.]*(\?[A-Za-z0-9_\-.=&%,+]*)?$/;
const BLOCKED = new Set(['/api/system/shutdown']);

export function isAllowedRequest(req: unknown): req is ApiRequest {
  if (typeof req !== 'object' || req === null) return false;
  const r = req as Record<string, unknown>;
  if (typeof r.method !== 'string' || !METHODS.has(r.method)) return false;
  if (typeof r.path !== 'string' || !PATH_RE.test(r.path) || r.path.includes('..')) return false;
  return !BLOCKED.has(r.path.split('?')[0]);
}

export class ApiProxy {
  private token: string | null = null;

  constructor(private readonly sidecar: Sidecar) {}

  async call(req: ApiRequest): Promise<ApiResponse> {
    let port: number;
    try {
      port = await this.sidecar.ready;
    } catch (err) {
      return { status: 503, ok: false, data: { detail: { code: 'backend_unavailable', message: String(err) } } };
    }

    const headers: Record<string, string> = { 'X-App-Key': this.sidecar.key };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let body: string | undefined;
    if (req.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.body);
    }

    let res: Response;
    try {
      res = await fetch(`http://127.0.0.1:${port}${req.path}`, { method: req.method, headers, body });
    } catch {
      return { status: 503, ok: false, data: { detail: { code: 'backend_unavailable' } } };
    }
    const type = res.headers.get('content-type') ?? '';
    let data: unknown = null;
    if (type.includes('application/json')) data = await res.json();
    else if (res.status !== 204) data = await res.text();

    const route = req.path.split('?')[0];
    if (route === '/api/auth/login' && res.ok && data && typeof data === 'object') {
      const { token: issued, ...rest } = data as { token: string };
      this.token = issued;
      data = rest; // the page never sees the token
    }
    if (route === '/api/auth/logout' || res.status === 401) this.token = null;
    return { status: res.status, ok: res.ok, data };
  }

  register(isTrustedSender: (e: IpcMainInvokeEvent) => boolean): void {
    ipcMain.handle('fvt:api', async (event, req: unknown): Promise<ApiResponse> => {
      if (!isTrustedSender(event)) throw new Error('untrusted sender');
      if (!isAllowedRequest(req)) return { status: 400, ok: false, data: { detail: { code: 'bad_request' } } };
      return this.call(req);
    });
  }
}
