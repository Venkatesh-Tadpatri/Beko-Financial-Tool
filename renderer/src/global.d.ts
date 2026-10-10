export interface BridgeRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
}

export interface BridgeResponse {
  status: number;
  ok: boolean;
  data: unknown;
}

export interface FvtBridge {
  isDesktop: boolean;
  api: (req: BridgeRequest) => Promise<BridgeResponse>;
  chooseBackupFile: () => Promise<string | null>;
  chooseExcelFile: () => Promise<string | null>;
  chooseFolder: (title: string) => Promise<string | null>;
  relaunch: () => Promise<void>;
}

declare global {
  interface Window {
    /** Exposed by desktop/src/preload.ts. */
    fvt: FvtBridge;
  }
}
