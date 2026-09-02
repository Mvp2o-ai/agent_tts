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

  it("holds an incomplete amount across an 80-character flush", () => {
    const b = new SpeechBuffer();
    const prefix = `${"a".repeat(77)} `;
    assert.equal(`${prefix}$1`.length, 80);
    assert.deepEqual(b.push(`${prefix}$1`), [prefix.trim()]);
    assert.deepEqual(b.push(",247.50 all in. "), ["$1,247.50 all in."]);
  });

  it("holds a trailing phone fragment at the 80-character cap", () => {
    const b = new SpeechBuffer();
    const prefix = `${"a".repeat(75)} `;
    assert.equal(`${prefix}555-`.length, 80);
    assert.deepEqual(b.push(`${prefix}555-`), [prefix.trim()]);
    assert.deepEqual(b.push("123-4567 please. "), ["555-123-4567 please."]);
  });

  it("joins a split amount before a sentence flush", () => {
    const b = new SpeechBuffer();
    assert.deepEqual(b.push("The total is $1"), []);
    assert.deepEqual(b.push(",247.50 all in. "), ["The total is $1,247.50 all in."]);
  });
});
