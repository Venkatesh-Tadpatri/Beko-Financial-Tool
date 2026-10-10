/**
 * Starts and stops the Python backend.
 *
 * The backend binds 127.0.0.1 on a port the OS picks and prints
 * "FVT_READY port=<n>". A random key generated here, per launch, must be
 * sent with every request, so other local programs cannot use the API.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const START_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 8_000;

export interface SidecarOptions {
  /** Project root in development; ignored when packaged. */
  appRoot: string;
  packaged: boolean;
  resourcesPath: string;
  dataDir?: string;
}

export class Sidecar {
  readonly key = randomBytes(32).toString('base64url');
  port: number | null = null;
  private proc: ChildProcess | null = null;
  private stderrTail: string[] = [];
  readonly ready: Promise<number>;
  private resolveReady!: (port: number) => void;
  private rejectReady!: (err: Error) => void;

  constructor(private readonly opts: SidecarOptions) {
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.ready.catch(() => undefined); // handled by whoever awaits it
  }

  private command(): { cmd: string; args: string[]; cwd: string } {
    if (this.opts.packaged) {
      const dir = path.join(this.opts.resourcesPath, 'backend');
      return { cmd: path.join(dir, 'fvt-backend.exe'), args: [], cwd: dir };
    }
    const backend = path.join(this.opts.appRoot, 'backend');
    const python = path.join(backend, '.venv', 'Scripts', 'python.exe');
    if (!existsSync(python)) {
      throw new Error(`Python environment not found at ${python}. See README "Build steps".`);
    }
    return { cmd: python, args: ['run.py'], cwd: backend };
  }

  start(): void {
    const { cmd, args, cwd } = this.command();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FVT_APP_KEY: this.key,
      FVT_PARENT_PID: String(process.pid),
      PYTHONUNBUFFERED: '1',
    };
    if (this.opts.dataDir) env.FVT_DATA_DIR = this.opts.dataDir;

    const proc = spawn(cmd, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    const timer = setTimeout(
      () => this.rejectReady(new Error('The data service did not start within 90 seconds.')),
      START_TIMEOUT_MS,
    );

    readline.createInterface({ input: proc.stdout! }).on('line', (line) => {
      const m = /^FVT_READY port=(\d+)$/.exec(line.trim());
      if (m) {
        clearTimeout(timer);
        this.port = Number(m[1]);
        this.resolveReady(this.port);
      }
    });
    readline.createInterface({ input: proc.stderr! }).on('line', (line) => {
      this.stderrTail.push(line);
      if (this.stderrTail.length > 40) this.stderrTail.shift();
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      this.rejectReady(err);
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      this.proc = null;
      if (this.port === null) {
        this.rejectReady(new Error(`The data service stopped during start-up (exit code ${code}).\n${this.errorTail()}`));
      }
    });
  }

  errorTail(): string {
    return this.stderrTail.slice(-15).join('\n');
  }

  get running(): boolean {
    return this.proc !== null;
  }

  /** Ask the backend to stop gracefully; force it after a timeout. */
  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
    if (this.port !== null) {
      try {
        await fetch(`http://127.0.0.1:${this.port}/api/system/shutdown`, {
          method: 'POST',
          headers: { 'X-App-Key': this.key },
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        /* fall through to kill */
      }
    }
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), STOP_TIMEOUT_MS));
    if ((await Promise.race([exited, timeout])) === 'timeout') {
      proc.kill();
      await exited;
    }
  }
}
