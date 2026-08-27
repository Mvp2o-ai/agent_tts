import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpeechBuffer } from "./speech-buffer.js";

describe("SpeechBuffer", () => {
  it("emits on sentence boundaries", () => {
    const b = new SpeechBuffer();
    assert.deepEqual(b.push("Hello world. "), ["Hello world."]);
    assert.deepEqual(b.push("More"), []);
    assert.deepEqual(b.end(), ["More"]);
  });

  it("flushes long runs without punctuation", () => {
    const b = new SpeechBuffer();
    const phrase = "x".repeat(80);
    assert.deepEqual(b.push(phrase), [phrase]);
  });
});
