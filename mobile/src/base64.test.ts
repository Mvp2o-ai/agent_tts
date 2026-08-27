import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./base64";

function bytes(...values: number[]): ArrayBuffer {
  return Uint8Array.from(values).buffer;
}

describe("base64", () => {
  it("round-trips 1, 2, and 3-byte inputs (padding)", () => {
    for (const input of [bytes(7), bytes(7, 8), bytes(7, 8, 9), bytes(1, 2, 3, 4)]) {
      const encoded = arrayBufferToBase64(input);
      const decoded = new Uint8Array(base64ToArrayBuffer(encoded));
      assert.deepEqual([...decoded], [...new Uint8Array(input)]);
    }
  });

  it("decodes unpadded and padded PCM-sized chunks", () => {
    const raw = new Uint8Array(4096);
    for (let i = 0; i < raw.length; i++) raw[i] = i & 0xff;
    const encoded = arrayBufferToBase64(raw.buffer);
    const stripped = encoded.replace(/=+$/, "");
    assert.deepEqual(
      [...new Uint8Array(base64ToArrayBuffer(stripped))],
      [...raw],
    );
  });
});
