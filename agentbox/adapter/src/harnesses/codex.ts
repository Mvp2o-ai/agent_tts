import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Harness, HarnessEvents, HarnessRunOpts } from "../harness.js";
import { jsonlHarness, type StreamMapper } from "../cli.js";

/**
 * OpenAI Codex CLI: `codex exec --json` (JSONL thread events).
 * Also accepts the older `{ msg: { type } }` envelope.
 */
export class CodexStreamMapper implements StreamMapper {
  sessionId: string | undefined;
  private streamed = false;

  feed(event: unknown, events: HarnessEvents): "continue" | "done" {
    if (!event || typeof event !== "object") return "continue";
    const rec = event as Record<string, unknown>;
    const wrapped = rec.msg && typeof rec.msg === "object" ? (rec.msg as Record<string, unknown>) : rec;
    const type = String(wrapped.type ?? rec.type ?? "");

    if (type === "thread.started") {
      const id = rec.thread_id ?? wrapped.thread_id;
      if (typeof id === "string") this.sessionId = id;
      return "continue";
    }

    if (type === "item.completed" || type === "item.started" || type === "item.updated") {
      const item = (wrapped.item ?? rec.item) as Record<string, unknown> | undefined;
      if (item) this.handleItem(item, events, type === "item.completed");
      return "continue";
    }

    if (type === "agent_message" || type === "text") {
      const text =
        (typeof wrapped.text === "string" && wrapped.text) ||
        (typeof wrapped.content === "string" && wrapped.content) ||
        "";
      if (text) {
        this.streamed = true;
        events.onChunk(text);
      }
      return "continue";
    }

    if (type === "turn.completed") return "done";

    if (type === "turn.failed") {
      const err = wrapped.error ?? rec.error;
      const msg =
        typeof err === "string"
          ? err
          : err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "codex turn failed";
      throw new Error(msg);
    }

    if (type === "error") {
      const message = String(wrapped.message ?? rec.message ?? "codex error");
      if (/^Reconnecting\.\.\./i.test(message)) return "continue";
      throw new Error(message);
    }

    return "continue";
  }

  private handleItem(
    item: Record<string, unknown>,
    events: HarnessEvents,
    completed: boolean,
  ): void {
    const itemType = String(item.type ?? "");
    if (itemType === "agent_message" && completed) {
      const text = typeof item.text === "string" ? item.text : "";
      if (text) {
        this.streamed = true;
        events.onChunk(text);
      }
    }
    if (itemType === "command_execution") {
      const cmd =
        (typeof item.command === "string" && item.command) ||
        (typeof item.cmd === "string" && item.cmd) ||
        "command";
      events.onToolEvent(`tool_use command_execution ${cmd}`);
    }
    if (itemType === "file_change") {
      events.onToolEvent("tool_use file_change");
    }
    if (itemType === "mcp_tool_call") {
      const name = typeof item.name === "string" ? item.name : "mcp";
      events.onToolEvent(`tool_use ${name}`);
    }
  }
}

function resolveCodexApiKey(): string | undefined {
  return process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY || undefined;
}

/** Codex exec authenticates via CODEX_API_KEY; operators pass OPENAI_API_KEY. */
export function codexHarnessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (!process.env.CODEX_API_KEY && process.env.OPENAI_API_KEY) {
    env.CODEX_API_KEY = process.env.OPENAI_API_KEY;
  }
  return env;
}

/** Codex also reads cached login from $CODEX_HOME/auth.json. */
export function ensureCodexAuth(home = process.env.CODEX_HOME ?? join(homedir(), ".codex")): string {
  const key = resolveCodexApiKey();
  mkdirSync(home, { recursive: true });
  const file = join(home, "auth.json");
  if (key && !existsSync(file)) {
    writeFileSync(file, JSON.stringify({ OPENAI_API_KEY: key }), {
      mode: 0o600,
    });
  }
  return home;
}

/**
 * OpenAI: inside Docker, disable the inner Linux sandbox, skip project
 * trust prompts, and keep credentials in a file (no OS keyring).
 * Per-prompt model/effort stay on the argv (`--model`, `-c
 * model_reasoning_effort=…`); writing them here would leak into other sessions.
 */
export function ensureCodexYoloConfig(
  cwd: string,
  home = process.env.CODEX_HOME ?? join(homedir(), ".codex"),
): string {
  mkdirSync(home, { recursive: true });
  const file = join(home, "config.toml");
  if (!existsSync(file)) {
    writeFileSync(
      file,
      [
        `approval_policy = "never"`,
        `sandbox_mode = "danger-full-access"`,
        `cli_auth_credentials_store = "file"`,
        ``,
        `[projects.${JSON.stringify(cwd)}]`,
        `trust_level = "trusted"`,
        ``,
      ].join("\n"),
      { mode: 0o600 },
    );
  }
  return file;
}

/** `codex exec [OPTIONS] [PROMPT]` / `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]` */
export function codexArgv(
  cwd: string,
  prompt: string,
  sessionId?: string,
  opts?: HarnessRunOpts,
): string[] {
  const flags = [
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--dangerously-bypass-hook-trust",
    "-c",
    `projects.${JSON.stringify(cwd)}.trust_level="trusted"`,
  ];
  if (opts?.model) flags.push("--model", opts.model);
  if (opts?.effort) flags.push("-c", `model_reasoning_effort="${opts.effort}"`);
  if (sessionId) {
    return ["exec", "resume", ...flags, sessionId, prompt];
  }
  return ["exec", ...flags, prompt];
}

export function createCodexHarness(cwd: string): Harness {
  ensureCodexAuth();
  ensureCodexYoloConfig(cwd);
  const mapper = new CodexStreamMapper();
  return jsonlHarness({
    bin: process.env.AGENT_TTS_CODEX_BIN ?? "codex",
    cwd,
    env: codexHarnessEnv(),
    mapper,
    argsFor: (prompt, sessionId, opts) => codexArgv(cwd, prompt, sessionId, opts),
  });
}
