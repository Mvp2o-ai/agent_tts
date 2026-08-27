import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { base64ToArrayBuffer } from "./base64";
import { pcm16ExactBytes } from "./pcm";
import {
  applySpeakingEvent,
  beginConnect,
  beginDisconnect,
  failPlaybackStream,
  nextStatusAfterClose,
  shouldAcceptNativeEvent,
  shouldResumeAfterInterruption,
} from "./session-lifecycle";
import { decodeCapturePcm } from "./voice-codec";

describe("session generation", () => {
  it("ignores stale native callbacks after reconnect or disconnect", () => {
    let state = { generation: 0, userClosed: true };
    state = beginConnect(state);
    assert.equal(state.generation, 1);
    assert.equal(state.userClosed, false);
    assert.equal(shouldAcceptNativeEvent(state, 1), true);
    assert.equal(shouldAcceptNativeEvent(state, 0), false);

    const reconnected = beginConnect(state);
    assert.equal(reconnected.generation, 2);
    assert.equal(shouldAcceptNativeEvent(reconnected, 1), false);
    assert.equal(shouldAcceptNativeEvent(reconnected, 2), true);

    const closed = beginDisconnect(reconnected);
    assert.equal(closed.userClosed, true);
    assert.equal(shouldAcceptNativeEvent(closed, closed.generation), false);
  });

  it("never resumes capture after an explicit disconnect", () => {
    assert.equal(
      shouldResumeAfterInterruption({
        userClosed: true,
        mode: "handsfree",
        wasCapturing: true,
      }),
      false,
    );
    assert.equal(
      shouldResumeAfterInterruption({
        userClosed: false,
        mode: "handsfree",
        wasCapturing: true,
      }),
      true,
    );
    assert.equal(
      shouldResumeAfterInterruption({
        userClosed: false,
        mode: "ptt",
        wasCapturing: true,
      }),
      false,
    );
  });

  it("keeps speaking true from tts_start until tts_end and playback idle", () => {
    let state = applySpeakingEvent(
      { ttsOpen: false, playing: false },
      "tts_start",
    );
    assert.equal(state.speaking, true);
    state = applySpeakingEvent(state, "playback_busy");
    assert.equal(state.speaking, true);
    state = applySpeakingEvent(state, "tts_end");
    assert.equal(state.speaking, true);
    state = applySpeakingEvent(state, "playback_idle");
    assert.equal(state.speaking, false);
    state = applySpeakingEvent(state, "flush");
    assert.equal(state.speaking, false);
  });

  it("flushes speaking on a playback-stream failure without implying disconnect", () => {
    const flushed = failPlaybackStream({ ttsOpen: true, playing: true });
    assert.equal(flushed.speaking, false);
    assert.equal(flushed.ttsOpen, false);
    assert.equal(flushed.playing, false);
  });

  it("marks the session disconnected when reconnect is exhausted", () => {
    assert.equal(
      nextStatusAfterClose({ userClosed: false, willReconnect: false }),
      "disconnected",
    );
    assert.equal(
      nextStatusAfterClose({ userClosed: false, willReconnect: true }),
      "connecting",
    );
  });
});

describe("capture base64 codec", () => {
  it("decodes native capture base64 to exact PCM bytes", () => {
    const pcm = Uint8Array.from([0x00, 0x10, 0xff, 0x7f]);
    const event = {
      generation: 3,
      pcmBase64: Buffer.from(pcm).toString("base64").replace(/=+$/, ""),
      byteLength: 4,
    };
    const decoded = new Uint8Array(decodeCapturePcm(event));
    assert.deepEqual([...decoded], [...pcm]);
    assert.equal(
      pcm16ExactBytes(base64ToArrayBuffer(event.pcmBase64)).byteLength,
      4,
    );
  });
});
