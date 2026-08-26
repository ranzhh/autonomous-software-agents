import type { PickedParcel } from "../src/sdk.js";

declare module "@unitn-asa/deliveroo-js-sdk" {
  interface DjsClientSocket {
    emitPickup(): Promise<PickedParcel[]>;
    emitPutdown(selected?: string[]): Promise<PickedParcel[]>;
  }
}
