/** The only bridge between the page and Electron: a narrow, typed API. */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('fvt', {
  isDesktop: true,
  api: (req: { method: string; path: string; body?: unknown }) => ipcRenderer.invoke('fvt:api', req),
});
