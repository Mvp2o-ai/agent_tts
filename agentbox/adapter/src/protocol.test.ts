import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeOutbound, parseInbound } from "./protocol.js";

describe("parseInbound", () => {
  it("parses prompt and abort", () => {
    assert.deepEqual(parseInbound('{"type":"prompt","id":"1","text":"hi"}'), {
      type: "prompt",
      id: "1",
      text: "hi",
    });
    assert.deepEqual(parseInbound('{"type":"abort","reason":"stop_word"}'), {
      type: "abort",
      reason: "stop_word",
    });
  });

  it("rejects unknown types", () => {
    assert.throws(() => parseInbound('{"type":"nope"}'), /unknown inbound/);
  });
});

describe("encodeOutbound", () => {
  it("writes a trailing newline", () => {
    const line = encodeOutbound({ type: "done", promptId: "1" });
    assert.equal(line, '{"type":"done","promptId":"1"}\n');
  });
});
