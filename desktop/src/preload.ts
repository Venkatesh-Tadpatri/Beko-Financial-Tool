/** The only bridge between the page and Electron: a narrow, typed API. */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('fvt', {
  isDesktop: true,
  api: (req: { method: string; path: string; body?: unknown }) => ipcRenderer.invoke('fvt:api', req),
  chooseBackupFile: (): Promise<string | null> => ipcRenderer.invoke('fvt:choose-backup-file'),
  chooseFolder: (title: string): Promise<string | null> => ipcRenderer.invoke('fvt:choose-folder', title),
  relaunch: (): Promise<void> => ipcRenderer.invoke('fvt:relaunch'),
});
