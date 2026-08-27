import type { Harness, HarnessEvents } from "../harness.js";
import { jsonlHarness, type StreamMapper } from "../cli.js";

export class ClaudeStreamMapper implements StreamMapper {
  private sawPartialText = false;
  sessionId: string | undefined;

  feed(event: unknown, events: HarnessEvents): "continue" | "done" {
    if (!event || typeof event !== "object") return "continue";
    const rec = event as Record<string, unknown>;
    const type = rec.type;

    if (type === "system" && rec.subtype === "init") {
      const id = rec.session_id ?? rec.sessionId;
      if (typeof id === "string") this.sessionId = id;
      return "continue";
    }

    if (type === "stream_event") {
      const inner = rec.event as Record<string, unknown> | undefined;
      const delta = inner?.delta as Record<string, unknown> | undefined;
      if (inner?.type === "content_block_delta" && delta?.type === "text_delta") {
        const text = delta.text;
        if (typeof text === "string" && text.length > 0) {
          this.sawPartialText = true;
          events.onChunk(text);
        }
      }
      return "continue";
    }

    if (type === "assistant") {
      const message = rec.message as Record<string, unknown> | undefined;
      const content = message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, unknown>;
          if (b.type === "tool_use") {
            const name = typeof b.name === "string" ? b.name : "tool";
            events.onToolEvent(`tool_use ${name}`);
          } else if (b.type === "text" && !this.sawPartialText) {
            const text = typeof b.text === "string" ? b.text : "";
            if (text) events.onChunk(text);
          }
        }
      }
      return "continue";
    }

    if (type === "result") {
      if (rec.is_error === true || rec.subtype === "error") {
        const msg =
          (typeof rec.result === "string" && rec.result) ||
          (typeof rec.error === "string" && rec.error) ||
          "claude-code result error";
        throw new Error(msg);
      }
      if (!this.sawPartialText && typeof rec.result === "string" && rec.result) {
        events.onChunk(rec.result);
      }
      return "done";
    }

    return "continue";
  }
}

/** Docker is the isolation boundary; Anthropic requires non-root + this flag. */
export function claudeArgv(prompt: string, sessionId?: string): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--dangerously-skip-permissions",
  ];
  if (sessionId) args.push("--resume", sessionId);
  args.push("--", prompt);
  return args;
}

export function createClaudeCodeHarness(cwd: string): Harness {
  const mapper = new ClaudeStreamMapper();
  return jsonlHarness({
    bin: process.env.AGENT_TTS_CLAUDE_BIN ?? "claude",
    cwd,
    mapper,
    argsFor: (prompt, sessionId) => claudeArgv(prompt, sessionId),
  });
}
