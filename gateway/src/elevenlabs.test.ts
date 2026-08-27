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

  payload(i: number): { text?: string; try_trigger_generation?: boolean } {
    return JSON.parse(this.sent[i] ?? "{}") as {
      text?: string;
      try_trigger_generation?: boolean;
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
});
