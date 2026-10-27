import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: false, host: '127.0.0.1' },
  // Pre-bundle up front so the first dev launch doesn't reload the page mid-way.
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react-router-dom', 'echarts'] },
  build: { outDir: path.join(root, 'dist'), emptyOutDir: true, sourcemap: false },
  test: {
    root,
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    testTimeout: 20_000,
  },
});
