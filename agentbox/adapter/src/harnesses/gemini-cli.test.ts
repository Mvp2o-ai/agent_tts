import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GEMINI_YOLO_ENV, GeminiStreamMapper, geminiArgv } from "./gemini-cli.js";

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

describe("geminiArgv", () => {
  it("uses the full unattended headless contract", () => {
    assert.deepEqual(geminiArgv("hi"), [
      "-p",
      "hi",
      "--output-format",
      "stream-json",
      "--yolo",
      "--skip-trust",
    ]);
    assert.equal(GEMINI_YOLO_ENV.GEMINI_CLI_TRUST_WORKSPACE, "true");
  });

  it("appends --resume after yolo flags", () => {
    assert.deepEqual(geminiArgv("hi", "a1b2c3d4-e5f6-7890-abcd-ef1234567890"), [
      "-p",
      "hi",
      "--output-format",
      "stream-json",
      "--yolo",
      "--skip-trust",
      "--resume",
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    ]);
  });

  it("inserts --model and ignores effort", () => {
    const argv = geminiArgv("hi", undefined, {
      model: "gemini-3-pro",
      effort: "high",
    });
    assert.deepEqual(argv, [
      "-p",
      "hi",
      "--output-format",
      "stream-json",
      "--yolo",
      "--skip-trust",
      "--model",
      "gemini-3-pro",
    ]);
    assert.equal(argv.includes("--effort"), false);
    assert.equal(argv.includes("--model-thinking-level"), false);
  });

  it("does not emit thinking flags when only effort is passed", () => {
    assert.deepEqual(geminiArgv("hi", undefined, { effort: "high" }), geminiArgv("hi"));
  });

  it("inserts --model with --resume", () => {
    assert.deepEqual(
      geminiArgv("hi", "a1b2c3d4-e5f6-7890-abcd-ef1234567890", {
        model: "gemini-3-flash",
        effort: "max",
      }),
      [
        "-p",
        "hi",
        "--output-format",
        "stream-json",
        "--yolo",
        "--skip-trust",
        "--model",
        "gemini-3-flash",
        "--resume",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      ],
    );
  });
});

describe("GeminiStreamMapper", () => {
  it("streams assistant message deltas", () => {
    const mapper = new GeminiStreamMapper();
    const c = collect();
    mapper.feed(
      { type: "message", role: "assistant", content: "Hel", delta: true },
      c.events,
    );
    mapper.feed({ type: "message", role: "assistant", content: "lo" }, c.events);
    assert.deepEqual(c.chunks, ["Hel", "lo"]);
  });

  it("emits tool_use from tool_name", () => {
    const mapper = new GeminiStreamMapper();
    const c = collect();
    mapper.feed({ type: "tool_use", tool_name: "write_file" }, c.events);
    assert.deepEqual(c.tools, ["tool_use write_file"]);
  });

  it("emits tool_use from tool", () => {
    const mapper = new GeminiStreamMapper();
    const c = collect();
    mapper.feed({ type: "tool_use", tool: "read_file" }, c.events);
    assert.deepEqual(c.tools, ["tool_use read_file"]);
  });

  it("accepts non-streaming JSON response blobs", () => {
    const mapper = new GeminiStreamMapper();
    const c = collect();
    const status = mapper.feed(
      { response: "Paris", stats: { tools: { totalCalls: 0 } } },
      c.events,
    );
    assert.equal(status, "done");
    assert.deepEqual(c.chunks, ["Paris"]);
  });

  it("throws on result status error", () => {
    const mapper = new GeminiStreamMapper();
    const c = collect();
    assert.throws(
      () =>
        mapper.feed(
          {
            type: "result",
            status: "error",
            error: { type: "unknown", message: "API key not valid" },
          },
          c.events,
        ),
      /API key not valid/,
    );
  });
});
