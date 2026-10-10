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

declare global {
  interface Window {
    /** Exposed by desktop/src/preload.ts. */
    fvt: {
      isDesktop: boolean;
      api: (req: BridgeRequest) => Promise<BridgeResponse>;
    };
  }
}
