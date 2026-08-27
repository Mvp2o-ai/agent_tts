/**
 * agentbox adapter — stdin/stdout JSON-lines box protocol.
 *
 * Env:
 *  AGENT_TTS_HARNESS          claude-code | cursor-cli | gemini-cli | codex
 *  AGENT_TTS_REPO_URL         git remote to clone/pull
 *  AGENT_TTS_GIT_CREDENTIAL   PAT injected into https remotes
 *  AGENT_TTS_GIT_BRANCH       optional default branch
 *  AGENT_TTS_WORKSPACE        default /workspace
 *
 * Model keys (ANTHROPIC_API_KEY, CURSOR_API_KEY, GEMINI_API_KEY,
 * OPENAI_API_KEY, …) are passed through from the gateway.
 * stdout is protocol only; logs go to stderr.
 */

import { createInterface } from "node:readline";
import { ensureRepo, installHarnessGitAuth, redact } from "./git.js";
import type { Harness } from "./harness.js";
import {
  encodeOutbound,
  parseInbound,
  type BoxOutbound,
  type HarnessId,
} from "./protocol.js";
import { selectHarness } from "./select-harness.js";

const workspace = process.env.AGENT_TTS_WORKSPACE ?? "/workspace";
const harnessId = (process.env.AGENT_TTS_HARNESS ?? "claude-code") as HarnessId;

function emit(msg: BoxOutbound): void {
  process.stdout.write(encodeOutbound(msg));
}

async function main(): Promise<void> {
  const url = process.env.AGENT_TTS_REPO_URL;
  if (!url) {
    emit({ type: "error", message: "AGENT_TTS_REPO_URL is required" });
    process.exit(1);
  }

  try {
    await ensureRepo({
      workspace,
      url,
      credential: process.env.AGENT_TTS_GIT_CREDENTIAL ?? "",
      branch: process.env.AGENT_TTS_GIT_BRANCH || undefined,
    });
    // Harness git (fetch/pull/push) inherits extraheader; never written to .git/config.
    installHarnessGitAuth(url, process.env.AGENT_TTS_GIT_CREDENTIAL ?? "");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message: `repo setup failed: ${redact(message)}` });
    process.exit(1);
  }

  let harness: Harness;
  try {
    harness = selectHarness(harnessId, workspace);
  } catch (err) {
    emit({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }

  process.stderr.write(`agentbox adapter ready harness=${harnessId}\n`);

  let inFlight: { id: string; abort: AbortController } | null = null;
  let stdinClosed = false;

  const maybeExit = () => {
    if (stdinClosed && !inFlight) process.exit(0);
  };

  const rl = createInterface({ input: process.stdin });
  rl.on("close", () => {
    stdinClosed = true;
    maybeExit();
  });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = parseInbound(line);
    } catch (err) {
      emit({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (msg.type === "abort") {
      inFlight?.abort.abort();
      return;
    }

    if (inFlight) {
      emit({
        type: "error",
        promptId: msg.id,
        message: "harness is busy; gateway should queue prompts",
      });
      return;
    }

    const abort = new AbortController();
    inFlight = { id: msg.id, abort };
    const promptId = msg.id;

    void harness
      .run(
        msg.text,
        {
          onChunk: (text) => emit({ type: "chunk", promptId, text }),
          onToolEvent: (summary) =>
            emit({ type: "tool_event", promptId, summary }),
        },
        abort.signal,
      )
      .then((status) => {
        emit(
          status === "aborted"
            ? { type: "aborted", promptId }
            : { type: "done", promptId },
        );
      })
      .catch((err: unknown) => {
        emit({
          type: "error",
          promptId,
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        if (inFlight?.id === promptId) inFlight = null;
        maybeExit();
      });
  });
}

main().catch((err: unknown) => {
  emit({
    type: "error",
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
