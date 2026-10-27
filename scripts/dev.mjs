// Development runner: Vite dev server (hot reload) + compiled Electron main + Python backend.
// Usage: npm run dev
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Quoted because shell: true passes the command line through cmd.exe, which splits on spaces in the path.
const tsc = spawnSync(`"${path.join(root, 'node_modules', '.bin', 'tsc.cmd')}"`, ['-p', 'desktop/tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

const server = await createServer({ configFile: path.join(root, 'renderer', 'vite.config.mts') });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`Renderer dev server: ${url}`);

const electronPath = require('electron');
const env = { ...process.env, FVT_DEV_SERVER_URL: url };
// Terminals inside VS Code (itself an Electron app) can inherit this, which makes Electron run as plain Node.
delete env.ELECTRON_RUN_AS_NODE;
const electron = spawn(electronPath, ['.'], { cwd: root, stdio: 'inherit', env });
electron.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
