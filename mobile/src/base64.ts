const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const LOOKUP = new Uint8Array(256);
LOOKUP.fill(255);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

function padBase64(b64: string): string {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const pad = (4 - (clean.length % 4)) % 4;
  return pad ? clean + "=".repeat(pad) : clean;
}

function decodedLength(padded: string): number {
  if (padded.length === 0) return 0;
  const padChars = padded.endsWith("==") ? 2 : padded.endsWith("=") ? 1 : 0;
  return (padded.length / 4) * 3 - padChars;
}

/** base64 -> ArrayBuffer (no Buffer/atob dependency in RN runtime). */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const padded = padBase64(b64);
  const len = decodedLength(padded);
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i + 3 < padded.length; i += 4) {
    const a = LOOKUP[padded.charCodeAt(i)] ?? 0;
    const b = LOOKUP[padded.charCodeAt(i + 1)] ?? 0;
    const c = LOOKUP[padded.charCodeAt(i + 2)] ?? 0;
    const d = LOOKUP[padded.charCodeAt(i + 3)] ?? 0;
    if (o < len) out[o++] = (a << 2) | (b >> 4);
    if (o < len) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (o < len) out[o++] = ((c & 3) << 6) | d;
  }
  return out.buffer;
}

/** ArrayBuffer -> base64. */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "=" : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "=" : ALPHABET[c & 63];
  }
  return out;
}
