import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import {
  attachStreamingTts,
  elevenLabsStreamUrl,
  TTS_OUTPUT_FORMAT,
  VOICE_AUDIO_FORMAT,
  type TtsTransport,
} from "./elevenlabs.js";

class MockTtsSocket extends EventEmitter implements TtsTransport {
  readyState = WebSocket.CONNECTING;
  sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
  }

  openNow(): void {
    this.readyState = WebSocket.OPEN;
    this.emit("open");
  }

  payload(i: number): {
    text?: string;
    try_trigger_generation?: boolean;
    flush?: boolean;
  } {
    return JSON.parse(this.sent[i] ?? "{}") as {
      text?: string;
      try_trigger_generation?: boolean;
      flush?: boolean;
    };
  }
}

describe("ElevenLabs output format", () => {
  it("requests pcm_24000 and advertises s16le 24 kHz mono", () => {
    assert.equal(TTS_OUTPUT_FORMAT, "pcm_24000");
    assert.deepEqual(VOICE_AUDIO_FORMAT, {
      encoding: "pcm_s16le",
      sampleRate: 24000,
      channels: 1,
    });
    assert.match(elevenLabsStreamUrl("21m00Tcm4TlvDq8ikWAM"), /output_format=pcm_24000/);
    assert.match(elevenLabsStreamUrl("21m00Tcm4TlvDq8ikWAM"), /model_id=eleven_flash_v2_5/);
    assert.match(
      elevenLabsStreamUrl("21m00Tcm4TlvDq8ikWAM"),
      /inactivity_timeout=180/,
    );
  });
});

describe("attachStreamingTts", () => {
  it("flushes text queued before open, then finish, in that order", () => {
    const ws = new MockTtsSocket();
    const stream = attachStreamingTts(ws, {
      apiKey: "test-key",
      onAudio: () => undefined,
      onError: () => undefined,
    });
    stream.pushText("Hello world.");
    stream.finish();
    assert.equal(ws.sent.length, 0);

    ws.openNow();
    assert.equal(ws.sent.length, 3);
    assert.equal(ws.payload(0).text, " ");
    assert.equal(ws.payload(1).text, "Hello world. ");
    assert.equal(ws.payload(1).try_trigger_generation, true);
    assert.equal(ws.payload(2).text, "");
  });

  it("discards pre-open text when closed before the socket opens", () => {
    const ws = new MockTtsSocket();
    const stream = attachStreamingTts(ws, {
      apiKey: "test-key",
      onAudio: () => undefined,
      onError: () => undefined,
    });
    stream.pushText("should not send");
    stream.finish();
    stream.close();
    ws.openNow();
    assert.equal(ws.sent.length, 0);
  });

  it("flush force-generates buffered text without sending EOS", () => {
    const ws = new MockTtsSocket();
    const stream = attachStreamingTts(ws, {
      apiKey: "test-key",
      onAudio: () => undefined,
      onError: () => undefined,
      keepaliveMs: 60_000,
    });
    ws.openNow();
    stream.pushText("I will look that up.");
    stream.flush();
    assert.equal(
      ws.sent.some((line) => line === JSON.stringify({ text: " ", flush: true })),
      true,
    );
    assert.equal(
      ws.sent.some((line) => {
        const msg = JSON.parse(line) as { text?: string };
        return msg.text === "";
      }),
      false,
    );
    stream.close();
  });

  it("does not end the stream on isFinal after flush", () => {
    const ends: number[] = [];
    const ws = new MockTtsSocket();
    const stream = attachStreamingTts(ws, {
      apiKey: "test-key",
      onAudio: () => undefined,
      onError: () => undefined,
      onEnd: () => ends.push(1),
      keepaliveMs: 60_000,
    });
    ws.openNow();
    stream.pushText("I will look that up.");
    stream.flush();
    ws.emit("message", { toString: () => JSON.stringify({ isFinal: true }) });
    const afterFlush = ws.sent.length;
    stream.pushText("Found it.");
    assert.deepEqual(ends, []);
    assert.equal(ws.sent.length, afterFlush + 1);
    stream.finish();
    ws.emit("message", { toString: () => JSON.stringify({ isFinal: true }) });
    assert.deepEqual(ends, [1]);
    stream.close();
  });

  it("treats input_timeout_exceeded as a dead stream so later text is not pushed", () => {
    const errors: string[] = [];
    const ws = new MockTtsSocket();
    const stream = attachStreamingTts(ws, {
      apiKey: "test-key",
      onAudio: () => undefined,
      onError: (err) => errors.push(err.message),
      keepaliveMs: 60_000,
    });
    ws.openNow();
    const afterOpen = ws.sent.length;
    ws.emit("message", { toString: () => JSON.stringify({ error: "input_timeout_exceeded" }) });
    stream.pushText("after timeout");
    stream.close();
    assert.deepEqual(errors, ["input_timeout_exceeded"]);
    assert.equal(ws.sent.length, afterOpen);
  });
});
