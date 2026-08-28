import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeOutbound, parseInbound } from "./protocol.js";

describe("parseInbound", () => {
  it("parses initialize, prompt, and abort", () => {
    assert.deepEqual(parseInbound('{"type":"initialize"}'), {
      type: "initialize",
    });
    assert.deepEqual(
      parseInbound('{"type":"initialize","credential":"session-token"}'),
      { type: "initialize", credential: "session-token" },
    );
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

  it("accepts prompt model and effort", () => {
    assert.deepEqual(
      parseInbound(
        '{"type":"prompt","id":"1","text":"hi","model":"claude-opus-4-6","effort":"high"}',
      ),
      {
        type: "prompt",
        id: "1",
        text: "hi",
        model: "claude-opus-4-6",
        effort: "high",
      },
    );
    assert.deepEqual(
      parseInbound('{"type":"prompt","id":"1","text":"hi","model":"gpt-5.2"}'),
      { type: "prompt", id: "1", text: "hi", model: "gpt-5.2" },
    );
    assert.deepEqual(
      parseInbound('{"type":"prompt","id":"1","text":"hi","effort":"low"}'),
      { type: "prompt", id: "1", text: "hi", effort: "low" },
    );
  });

  it("strips empty model and effort strings", () => {
    assert.deepEqual(
      parseInbound(
        '{"type":"prompt","id":"1","text":"hi","model":"","effort":""}',
      ),
      { type: "prompt", id: "1", text: "hi" },
    );
  });

  it("rejects non-string model and effort", () => {
    assert.throws(
      () => parseInbound('{"type":"prompt","id":"1","text":"hi","model":1}'),
      /prompt model must be a non-empty string/,
    );
    assert.throws(
      () => parseInbound('{"type":"prompt","id":"1","text":"hi","effort":true}'),
      /prompt effort must be a non-empty string/,
    );
  });
});

describe("encodeOutbound", () => {
  it("writes a trailing newline", () => {
    const line = encodeOutbound({ type: "done", promptId: "1" });
    assert.equal(line, '{"type":"done","promptId":"1"}\n');
  });
});
