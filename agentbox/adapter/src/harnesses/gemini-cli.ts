import type { Harness, HarnessEvents } from "../harness.js";
import { jsonlHarness, type StreamMapper } from "../cli.js";

/**
 * Gemini CLI headless: `gemini -p --output-format stream-json --yolo`.
 * Also accepts a single JSON object `{ response }` from `--output-format json`.
 */
export class GeminiStreamMapper implements StreamMapper {
  sessionId: string | undefined;
  private streamed = false;

  feed(event: unknown, events: HarnessEvents): "continue" | "done" {
    if (!event || typeof event !== "object") return "continue";
    const rec = event as Record<string, unknown>;
    const type = rec.type;

    if (type === "init" || (type === "system" && rec.subtype === "init")) {
      const id = rec.session_id ?? rec.sessionId;
      if (typeof id === "string") this.sessionId = id;
      return "continue";
    }

    if (type === "message") {
      const role = rec.role ?? rec.sender;
      const content =
        (typeof rec.content === "string" && rec.content) ||
        (typeof rec.delta === "string" && rec.delta) ||
        (typeof rec.text === "string" && rec.text) ||
        "";
      if ((role === "assistant" || role === "model" || rec.delta === true) && content) {
        this.streamed = true;
        events.onChunk(content);
      }
      return "continue";
    }

    if (type === "tool_use" || type === "tool_call") {
      const name =
        (typeof rec.tool_name === "string" && rec.tool_name) ||
        (typeof rec.tool === "string" && rec.tool) ||
        (typeof rec.name === "string" && rec.name) ||
        "tool";
      events.onToolEvent(`tool_use ${name}`);
      return "continue";
    }

    if (type === "error") {
      const msg =
        (typeof rec.message === "string" && rec.message) ||
        (typeof rec.error === "string" && rec.error) ||
        "gemini-cli error";
      throw new Error(msg);
    }

    if (type === "result") {
      if (rec.status === "error" || rec.error) {
        const err = rec.error;
        const msg =
          typeof err === "string"
            ? err
            : typeof err === "object" &&
                err &&
                "message" in err &&
                typeof (err as { message: unknown }).message === "string"
              ? (err as { message: string }).message
              : "gemini-cli result error";
        throw new Error(msg);
      }
      const response =
        (typeof rec.response === "string" && rec.response) ||
        (typeof rec.result === "string" && rec.result) ||
        "";
      if (!this.streamed && response) events.onChunk(response);
      return "done";
    }

    // Non-streaming JSON blob from --output-format json
    if (typeof rec.response === "string" && !type) {
      events.onChunk(rec.response);
      return "done";
    }
    if (typeof rec.response === "string" && rec.stats) {
      if (!this.streamed) events.onChunk(rec.response);
      return "done";
    }

    return "continue";
  }
}

/**
 * `--yolo` auto-approves tools. Headless still requires a trusted workspace
 * (`--skip-trust` + GEMINI_CLI_TRUST_WORKSPACE=true).
 */
export const GEMINI_YOLO_ENV = { GEMINI_CLI_TRUST_WORKSPACE: "true" };

export function geminiArgv(prompt: string, sessionId?: string): string[] {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--yolo",
    "--skip-trust",
  ];
  if (sessionId) args.push("--resume", sessionId);
  return args;
}

export function createGeminiCliHarness(cwd: string): Harness {
  const mapper = new GeminiStreamMapper();
  return jsonlHarness({
    bin: process.env.AGENT_TTS_GEMINI_BIN ?? "gemini",
    cwd,
    env: GEMINI_YOLO_ENV,
    mapper,
    argsFor: (prompt, sessionId) => geminiArgv(prompt, sessionId),
  });
}
