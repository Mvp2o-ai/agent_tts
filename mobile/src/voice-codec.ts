import { base64ToArrayBuffer } from "./base64";
import { pcm16ExactBytes } from "./pcm";

export type CapturePcmEvent = {
  generation: number;
  pcmBase64: string;
  byteLength: number;
};

/**
 * Capture uplink uses base64 in Module events (Expo `sendEvent` dictionaries).
 * A 100 ms 16 kHz s16le mono frame is 3200 bytes → 4268 base64 chars (~33%).
 * Downlink PCM uses the first-party `Data` / `ByteArray` ↔ `Uint8Array` bridge.
 */
export function decodeCapturePcm(event: CapturePcmEvent): ArrayBuffer {
  return pcm16ExactBytes(base64ToArrayBuffer(event.pcmBase64));
}
