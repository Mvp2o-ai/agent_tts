import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PCM_BYTES_PER_SECOND,
  PLAYOUT_DRAIN_MARGIN_MS,
  PlayoutClock,
} from "./playout-clock.js";

describe("PlayoutClock", () => {
  it("extends the estimated end time as bytes are noted", () => {
    const clock = new PlayoutClock(0);
    assert.equal(clock.isActive(), false);
    clock.noteBytes(PCM_BYTES_PER_SECOND);
    assert.equal(clock.isActive(), true);
  });

  it("resets when client playback is flushed", () => {
    const clock = new PlayoutClock(0);
    clock.noteBytes(PCM_BYTES_PER_SECOND);
    clock.reset();
    assert.equal(clock.isActive(), false);
  });

  it("waits through the drain margin", async () => {
    const clock = new PlayoutClock(PLAYOUT_DRAIN_MARGIN_MS);
    clock.noteBytes(PCM_BYTES_PER_SECOND);
    const started = Date.now();
    await clock.drain();
    assert.ok(Date.now() - started >= PLAYOUT_DRAIN_MARGIN_MS - 25);
  });

  it("can be disabled for synchronous unit tests", async () => {
    const clock = new PlayoutClock(PLAYOUT_DRAIN_MARGIN_MS, true);
    clock.noteBytes(PCM_BYTES_PER_SECOND);
    assert.equal(clock.isActive(), false);
    await clock.drain();
  });
});
