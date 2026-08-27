import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import {
  attachStreamingStt,
  STT_PREOPEN_BYTES,
  type SttTransport,
} from "./deepgram.js";

class MockSttSocket extends EventEmitter implements SttTransport {
  readyState = WebSocket.CONNECTING;
  sent: Array<Buffer | string> = [];

  send(data: Buffer | string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
  }

  openNow(): void {
    this.readyState = WebSocket.OPEN;
    this.emit("open");
  }
}

function attach(ws: MockSttSocket) {
  return attachStreamingStt(ws, {
    onEvent: () => undefined,
    onError: () => undefined,
  });
}

describe("attachStreamingStt", () => {
  it("flushes pre-open PCM in order on open", () => {
    const ws = new MockSttSocket();
    const stt = attach(ws);
    const a = Buffer.from([1, 2]);
    const b = Buffer.from([3, 4]);
    const c = Buffer.from([5, 6]);
    stt.sendPcm(a);
    stt.sendPcm(b);
    stt.sendPcm(c);
    assert.equal(ws.sent.length, 0);

    ws.openNow();
    assert.deepEqual(ws.sent, [a, b, c]);
  });

  it("drops oldest bytes first when the pre-open ring is full", () => {
    const ws = new MockSttSocket();
    const stt = attach(ws);
    const first = Buffer.alloc(STT_PREOPEN_BYTES, 0x11);
    const extra = Buffer.alloc(1000, 0x22);
    stt.sendPcm(first);
    stt.sendPcm(extra);
    ws.openNow();

    const flushed = Buffer.concat(ws.sent.filter(Buffer.isBuffer));
    assert.equal(flushed.length, STT_PREOPEN_BYTES);
    assert.equal(flushed.subarray(0, 16).every((b) => b === 0x11), true);
    assert.deepEqual(flushed.subarray(flushed.length - 1000), extra);
  });

  it("discards pre-open PCM when closed before the socket opens", () => {
    const ws = new MockSttSocket();
    const stt = attach(ws);
    stt.sendPcm(Buffer.from([9, 9]));
    stt.close();
    ws.openNow();
    assert.equal(ws.sent.length, 0);
  });

  it("does not flush after close even if finish was requested first", () => {
    const ws = new MockSttSocket();
    const stt = attach(ws);
    stt.sendPcm(Buffer.from([1]));
    stt.finish();
    stt.close();
    ws.openNow();
    assert.equal(ws.sent.length, 0);
  });

  it("on finish-before-open, flushes PCM then CloseStream", () => {
    const ws = new MockSttSocket();
    const stt = attach(ws);
    const pcm = Buffer.from([7, 8]);
    stt.sendPcm(pcm);
    stt.finish();
    assert.equal(ws.sent.length, 0);

    ws.openNow();
    assert.equal(ws.sent.length, 2);
    assert.deepEqual(ws.sent[0], pcm);
    assert.equal(ws.sent[1], JSON.stringify({ type: "CloseStream" }));
  });
});
