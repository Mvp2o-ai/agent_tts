import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CursorStreamMapper, cursorArgv } from "./cursor-cli.js";

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

describe("cursorArgv", () => {
  it("uses the full unattended print-mode contract", () => {
    assert.deepEqual(cursorArgv("hi"), [
      "-p",
      "--force",
      "--trust",
      "--approve-mcps",
      "--sandbox",
      "disabled",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--",
      "hi",
    ]);
  });

  it("inserts --resume before the prompt separator", () => {
    assert.deepEqual(cursorArgv("hi", "chat_1"), [
      "-p",
      "--force",
      "--trust",
      "--approve-mcps",
      "--sandbox",
      "disabled",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--resume",
      "chat_1",
      "--",
      "hi",
    ]);
  });
});

describe("CursorStreamMapper", () => {
  it("streams assistant deltas with timestamp_ms", () => {
    const mapper = new CursorStreamMapper();
    const c = collect();
    mapper.feed(
      {
        type: "assistant",
        timestamp_ms: 1,
        message: { content: [{ type: "text", text: "Hi" }] },
      },
      c.events,
    );
    mapper.feed(
      {
        type: "assistant",
        model_call_id: "m1",
        message: { content: [{ type: "text", text: "Hi there" }] },
      },
      c.events,
    );
    assert.deepEqual(c.chunks, ["Hi"]);
  });

  it("emits tool_call started summaries", () => {
    const mapper = new CursorStreamMapper();
    const c = collect();
    mapper.feed(
      {
        type: "tool_call",
        subtype: "started",
        tool_call: { readToolCall: { args: { path: "a.ts" } } },
      },
      c.events,
    );
    assert.equal(c.tools[0], "tool_use read");
  });

  it("completes on result", () => {
    const mapper = new CursorStreamMapper();
    const c = collect();
    assert.equal(
      mapper.feed({ type: "result", result: "bye" }, c.events),
      "done",
    );
    assert.deepEqual(c.chunks, ["bye"]);
  });
});
