import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { containsStopWord, StopLatch } from "./stop-word.js";

describe("containsStopWord", () => {
  it("matches the default phrase case-insensitively", () => {
    assert.equal(containsStopWord("Please Hard Stop now", "hard stop"), true);
  });

  it("ignores punctuation", () => {
    assert.equal(containsStopWord("hard-stop!", "hard stop"), true);
  });

  it("does not match partial words", () => {
    assert.equal(containsStopWord("hardly working", "hard stop"), false);
    assert.equal(containsStopWord("hard stopgap", "hard stop"), false);
  });
});

describe("StopLatch", () => {
  it("collapses interim and final of one utterance into a single abort", () => {
    const latch = new StopLatch();
    assert.equal(latch.observe("Hard stop.", false, "hard stop"), "abort");
    assert.equal(latch.observe("Hard stop.", true, "hard stop"), "ignore");
  });

  it("re-arms after a non-stop final so a later utterance can stop again", () => {
    const latch = new StopLatch();
    assert.equal(latch.observe("Hard stop.", true, "hard stop"), "abort");
    assert.equal(latch.observe("keep going", true, "hard stop"), "pass");
    assert.equal(latch.observe("hard stop", true, "hard stop"), "abort");
  });

  it("ignores a corrected final that no longer contains the stop word", () => {
    const latch = new StopLatch();
    assert.equal(latch.observe("Hard stop.", false, "hard stop"), "abort");
    assert.equal(latch.observe("Hard.", true, "hard stop"), "ignore");
    assert.equal(latch.observe("list the files", true, "hard stop"), "pass");
  });
});
