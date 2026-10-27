/** The only bridge between the page and Electron: a narrow, typed API. */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('fvt', {
  isDesktop: true,
  api: (req: { method: string; path: string; body?: unknown }) => ipcRenderer.invoke('fvt:api', req),
  chooseBackupFile: (): Promise<string | null> => ipcRenderer.invoke('fvt:choose-backup-file'),
  chooseExcelFile: (): Promise<string | null> => ipcRenderer.invoke('fvt:choose-excel-file'),
  chooseFolder: (title: string): Promise<string | null> => ipcRenderer.invoke('fvt:choose-folder', title),
  relaunch: (): Promise<void> => ipcRenderer.invoke('fvt:relaunch'),
  exportPdf: (html: string, name: string, header?: string, footer?: string): Promise<string | null> => ipcRenderer.invoke('fvt:export-pdf', html, name, header, footer),
  saveFile: (name: string, kind: 'png' | 'csv', base64: string): Promise<string | null> => ipcRenderer.invoke('fvt:save-file', name, kind, base64),
  showInFolder: (file: string): Promise<void> => ipcRenderer.invoke('fvt:show-in-folder', file),
});
