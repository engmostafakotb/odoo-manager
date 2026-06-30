/**
 * Minimal ambient type declaration for the optional `node-rfc` dependency
 * (the official SAP NetWeaver RFC SDK binding). It is not installed in this
 * repo - see src/lib/sap/rfc-client.ts for why - so this stub exists purely
 * to let `realRfcCall()` type-check. Replace with the real `@types`
 * shipped by `node-rfc` once the package is installed for a production
 * deployment.
 */
declare module "node-rfc" {
  export interface ConnectionParameters {
    ashost: string;
    sysnr: string;
    client: string;
    user: string;
    passwd: string;
    lang?: string;
  }

  export class Client {
    constructor(params: ConnectionParameters);
    open(): Promise<void>;
    close(): Promise<void>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call(rfcName: string, params: Record<string, unknown>): Promise<any>;
  }
}
