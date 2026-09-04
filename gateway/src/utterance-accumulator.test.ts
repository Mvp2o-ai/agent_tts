import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UtteranceAccumulator,
  preferCovering,
} from "./utterance-accumulator.js";

describe("UtteranceAccumulator", () => {
  it("appends every is_final slice (one-mcp counting utterance)", () => {
    const acc = new UtteranceAccumulator();
    acc.onTranscript("I know it says", false);
    acc.onTranscript("I know it says you're connected,", true);
    acc.onTranscript("but I'm asking", false);
    acc.onTranscript("but I'm asking you to prove it.", true);
    assert.equal(
      acc.take(),
      "I know it says you're connected, but I'm asking you to prove it.",
    );
  });

  it("does not let a later slice replace earlier finals", () => {
    const acc = new UtteranceAccumulator();
    acc.onTranscript("I'm asking you to actively go and access my email", true);
    acc.onTranscript("my Gmail, and let me know if you can see any emails.", true);
    const text = acc.take();
    assert.ok(text.startsWith("I'm asking you to actively go"));
    assert.ok(text.endsWith("any emails."));
  });

  it("uses the covering interim when finals are only the last slice", () => {
    const acc = new UtteranceAccumulator();
    acc.onTranscript("check the logs when the containers start", false);
    acc.onTranscript("when the containers start", true);
    assert.equal(acc.take(), "check the logs when the containers start");
  });

  it("replaces with a cumulative final instead of duplicating", () => {
    const acc = new UtteranceAccumulator();
    acc.onTranscript("check the logs", true);
    acc.onTranscript("check the logs when the containers start", true);
    assert.equal(acc.take(), "check the logs when the containers start");
  });

  it("falls back to the last interim when nothing finalized", () => {
    const acc = new UtteranceAccumulator();
    acc.onTranscript("test access", false);
    acc.onTranscript("test access to my Gmail", false);
    assert.equal(acc.take(), "test access to my Gmail");
  });

  it("dedupes a re-sent identical final", () => {
    const acc = new UtteranceAccumulator();
    acc.onTranscript("Come on. Step it up.", true);
    acc.onTranscript("Come on. Step it up.", true);
    assert.equal(acc.take(), "Come on. Step it up.");
  });
});

describe("preferCovering", () => {
  it("prefers the longer interim that already contains the joined slices", () => {
    assert.equal(
      preferCovering("when the containers", "check the logs when the containers"),
      "check the logs when the containers",
    );
  });
});
