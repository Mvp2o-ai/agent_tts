import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClaudeStreamMapper, claudeArgv } from "./claude-code.js";

function collect() {
  const chunks: string[] = [];
  const tools: string[] = [];
  return {
    chunks,
    tools,
    events: {
      onChunk: (t: string) => chunks.push(t),
      onToolEvent: (s: string) => tools.push(s),
    },
  };
}

describe("claudeArgv", () => {
  it("uses the full unattended print-mode contract", () => {
    assert.deepEqual(claudeArgv("hi"), [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--dangerously-skip-permissions",
      "--",
      "hi",
    ]);
  });

  it("inserts --resume before the prompt separator", () => {
    assert.deepEqual(claudeArgv("hi", "ses_1"), [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--dangerously-skip-permissions",
      "--resume",
      "ses_1",
      "--",
      "hi",
    ]);
  });
});

describe("ClaudeStreamMapper", () => {
  it("captures session id from system init", () => {
    const mapper = new ClaudeStreamMapper();
    const c = collect();
    mapper.feed(
      { type: "system", subtype: "init", session_id: "ses_1" },
      c.events,
    );
    assert.equal(mapper.sessionId, "ses_1");
  });

  it("streams text_delta chunks", () => {
    const mapper = new ClaudeStreamMapper();
    const c = collect();
    mapper.feed(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hel" },
        },
      },
      c.events,
    );
    mapper.feed(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "lo" },
        },
      },
      c.events,
    );
    assert.deepEqual(c.chunks, ["Hel", "lo"]);
  });

  it("does not duplicate assistant text after partials", () => {
    const mapper = new ClaudeStreamMapper();
    const c = collect();
    mapper.feed(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hi" },
        },
      },
      c.events,
    );
    mapper.feed(
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Hi" }] },
      },
      c.events,
    );
    assert.deepEqual(c.chunks, ["Hi"]);
  });

  it("emits tool_use summaries", () => {
    const mapper = new ClaudeStreamMapper();
    const c = collect();
    mapper.feed(
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash" }] },
      },
      c.events,
    );
    assert.deepEqual(c.tools, ["tool_use Bash"]);
  });

  it("falls back to result text when nothing streamed", () => {
    const mapper = new ClaudeStreamMapper();
    const c = collect();
    const status = mapper.feed(
      { type: "result", subtype: "success", result: "all done" },
      c.events,
    );
    assert.equal(status, "done");
    assert.deepEqual(c.chunks, ["all done"]);
  });

  it("throws on result errors", () => {
    const mapper = new ClaudeStreamMapper();
    const c = collect();
    assert.throws(
      () =>
        mapper.feed(
          { type: "result", is_error: true, result: "boom" },
          c.events,
        ),
      /boom/,
    );
  });
});
