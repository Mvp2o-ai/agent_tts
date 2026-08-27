import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  downmixToMono,
  float32ToInt16,
  pcm16ExactBytes,
  resamplePcm16Mono,
  toGatewayPcm16kMono,
} from "./pcm";

describe("pcm", () => {
  it("converts float32 -1..1 to int16", () => {
    const f = Float32Array.from([-1, 0, 1]);
    const s = float32ToInt16(f);
    assert.equal(s[0], -32768);
    assert.equal(s[1], 0);
    assert.equal(s[2], 32767);
  });

  it("downmixes stereo frames", () => {
    const stereo = Int16Array.from([100, 200, 300, 400]);
    const mono = downmixToMono(stereo, 2);
    assert.deepEqual([...mono], [150, 350]);
  });

  it("is a no-op resample when rates match", () => {
    const input = Int16Array.from([1, 2, 3]);
    assert.equal(resamplePcm16Mono(input, 16000, 16000), input);
  });

  it("resamples 8k to 16k by doubling length", () => {
    const input = Int16Array.from([0, 1000]);
    const out = resamplePcm16Mono(input, 8000, 16000);
    assert.equal(out.length, 4);
    assert.equal(out[0], 0);
  });

  it("drops a trailing odd byte so frames are exact s16le pairs", () => {
    const odd = Uint8Array.from([1, 2, 3]).buffer;
    const even = pcm16ExactBytes(odd);
    assert.equal(even.byteLength, 2);
    assert.equal(pcm16ExactBytes(Uint8Array.from([1, 2]).buffer).byteLength, 2);
  });

  it("emits little-endian PCM16 mono at 16 kHz", () => {
    const samples = Int16Array.from([1, -2, 3, -4]);
    const buf = toGatewayPcm16kMono({
      data: samples.buffer,
      encoding: "int16",
      sampleRate: 16000,
      channels: 1,
    });
    assert.equal(buf.byteLength, 8);
    const view = new DataView(buf);
    assert.equal(view.getInt16(0, true), 1);
    assert.equal(view.getInt16(2, true), -2);
  });
});
