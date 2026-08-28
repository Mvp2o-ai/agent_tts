import type { Harness, HarnessEvents, HarnessRunOpts } from "../harness.js";
import { contentText, jsonlHarness, type StreamMapper } from "../cli.js";

/**
 * Cursor Agent CLI (`agent -p --output-format stream-json --stream-partial-output`).
 * Deltas are assistant events with timestamp_ms and without model_call_id.
 */
export class CursorStreamMapper implements StreamMapper {
  sessionId: string | undefined;
  private sawDelta = false;

  feed(event: unknown, events: HarnessEvents): "continue" | "done" {
    if (!event || typeof event !== "object") return "continue";
    const rec = event as Record<string, unknown>;
    const type = rec.type;

    if (type === "system" && rec.subtype === "init") {
      const id = rec.session_id ?? rec.sessionId ?? rec.chat_id;
      if (typeof id === "string") this.sessionId = id;
      return "continue";
    }

    if (type === "assistant") {
      const isDelta =
        Object.prototype.hasOwnProperty.call(rec, "timestamp_ms") &&
        !Object.prototype.hasOwnProperty.call(rec, "model_call_id");
      const text = contentText(rec.message);
      if (isDelta && text) {
        this.sawDelta = true;
        events.onChunk(text);
      } else if (!this.sawDelta && text && !rec.model_call_id) {
        events.onChunk(text);
      }
      return "continue";
    }

    if (type === "tool_call") {
      const subtype = rec.subtype;
      if (subtype === "started") {
        events.onToolEvent(summarizeCursorTool(rec.tool_call));
      }
      return "continue";
    }

    if (type === "result") {
      if (rec.is_error === true) {
        throw new Error(
          typeof rec.result === "string" ? rec.result : "cursor-cli result error",
        );
      }
      if (!this.sawDelta && typeof rec.result === "string" && rec.result) {
        events.onChunk(rec.result);
      }
      return "done";
    }

    return "continue";
  }
}

function summarizeCursorTool(toolCall: unknown): string {
  if (!toolCall || typeof toolCall !== "object") return "tool_call";
  const t = toolCall as Record<string, unknown>;
  const keys = Object.keys(t);
  const name = keys[0] ?? "tool";
  return `tool_use ${name.replace(/ToolCall$/, "")}`;
}

/**
 * Print mode only *proposes* edits unless `--force` (`--yolo`). `--trust`
 * skips the workspace prompt. Cursor's own OS sandbox denies network by
 * default and nests badly in Docker — disable it; the box is the sandbox.
 */
export function cursorArgv(
  prompt: string,
  sessionId?: string,
  opts?: HarnessRunOpts,
): string[] {
  const args = [
    "-p",
    "--force",
    "--trust",
    "--approve-mcps",
    "--sandbox",
    "disabled",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
  ];
  if (opts?.model) args.push("--model", opts.model);
  if (sessionId) args.push("--resume", sessionId);
  args.push("--", prompt);
  return args;
}

export function createCursorCliHarness(cwd: string): Harness {
  const mapper = new CursorStreamMapper();
  return jsonlHarness({
    bin: process.env.AGENT_TTS_CURSOR_BIN ?? "agent",
    cwd,
    mapper,
    argsFor: (prompt, sessionId, opts) => cursorArgv(prompt, sessionId, opts),
  });
}
