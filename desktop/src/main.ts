import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ApiProxy } from './apiProxy.js';
import { Sidecar } from './sidecar.js';

const APP_ORIGIN = 'app://fvt';
const DEV_URL = process.env.FVT_DEV_SERVER_URL; // set by scripts/dev.mjs
const isDev = Boolean(DEV_URL);

// Production pages are served from app://fvt/ (not file://) so they get a real origin and a CSP.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // ECharts sets inline styles
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

let mainWindow: BrowserWindow | null = null;
let sidecar: Sidecar | null = null;
let quitting = false;

function rendererDir(): string {
  return path.join(app.getAppPath(), 'renderer', 'dist');
}

function registerAppProtocol(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const root = rendererDir();
    const file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: res.status, headers });
  });
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith(`${APP_ORIGIN}/`) || (isDev && !!DEV_URL && url.startsWith(DEV_URL));
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Financial Visualization Tool',
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());

  // The app never navigates anywhere or opens new windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = url.startsWith(`${APP_ORIGIN}/`) || (isDev && DEV_URL && url.startsWith(DEV_URL));
    if (!allowed) e.preventDefault();
  });

  const smokePage = isDev ? (process.env.FVT_SMOKE_PAGE ?? '') : ''; // e.g. "#/backups" (dev smoke only)
  void win.loadURL(isDev ? DEV_URL! + smokePage : `${APP_ORIGIN}/index.html`);

  // Development smoke check: FVT_SMOKE_SCREENSHOT=<file.png> saves the screen after a delay and quits.
  const shot = isDev ? process.env.FVT_SMOKE_SCREENSHOT : undefined;
  if (shot) {
    const loaded = new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()));
    void Promise.all([loaded, sidecar?.ready]).then(() => {
      setTimeout(async () => {
        const image = await win.webContents.capturePage();
        const { writeFileSync } = await import('node:fs');
        writeFileSync(shot, image.toPNG());
        app.quit();
      }, Number(process.env.FVT_SMOKE_DELAY_MS ?? 8000));
    });
  }
  return win;
}

/** Native dialogs and relaunch, for the backup and recovery screens. */
function registerShellHandlers(): void {
  const guard = (e: IpcMainInvokeEvent) => {
    if (!isTrustedSender(e)) throw new Error('untrusted sender');
  };
  ipcMain.handle('fvt:choose-backup-file', async (e) => {
    guard(e);
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose a backup to restore',
      filters: [{ name: 'Backup files', extensions: ['db'] }],
      properties: ['openFile'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('fvt:choose-folder', async (e, title: unknown) => {
    guard(e);
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: typeof title === 'string' ? title.slice(0, 100) : 'Choose a folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('fvt:relaunch', (e) => {
    guard(e);
    app.relaunch();
    app.quit(); // before-quit stops the data service gracefully first
  });
}

async function boot(): Promise<void> {
  if (!isDev) {
    Menu.setApplicationMenu(null);
    registerAppProtocol();
  }

  // Development keeps its data apart from a real installation unless told otherwise.
  const dataDir = process.env.FVT_DATA_DIR ?? (isDev ? path.join(app.getPath('appData'), 'FinancialVisualizationTool-dev') : undefined);
  sidecar = new Sidecar({ appRoot: app.getAppPath(), packaged: app.isPackaged, resourcesPath: process.resourcesPath, dataDir });
  const proxy = new ApiProxy(sidecar);
  proxy.register(isTrustedSender);
  registerShellHandlers();

  try {
    sidecar.start();
  } catch (err) {
    dialog.showErrorBox('Financial Visualization Tool', String(err));
    app.exit(1);
    return;
  }
  // Dev smoke only (never a default account): FVT_SMOKE_LOGIN="user:password" sets up if needed and signs in
  // before the window loads, so the screenshot shows the signed-in app.
  const creds = isDev ? process.env.FVT_SMOKE_LOGIN : undefined;
  if (creds) {
    const i = creds.indexOf(':');
    const [username, password] = [creds.slice(0, i), creds.slice(i + 1)];
    await proxy.call({ method: 'POST', path: '/api/setup/super-admin',
      body: { username, display_name: 'Smoke Test', password, confirm_password: password } });
    await proxy.call({ method: 'POST', path: '/api/auth/login', body: { username, password } });
  }
  mainWindow = createWindow();

  sidecar.ready.catch((err: Error) => {
    if (quitting) return;
    dialog.showErrorBox(
      'Financial Visualization Tool could not start',
      `${err.message}\n\nYour data has not been changed. Details are in the logs folder:\n` +
        `%APPDATA%\\FinancialVisualizationTool\\logs`,
    );
    app.exit(1);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(boot);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (e) => {
    if (quitting || !sidecar?.running) return;
    e.preventDefault();
    quitting = true;
    void sidecar.stop().finally(() => app.quit());
  });
}
