/**
 * agentbox adapter — stdin/stdout JSON-lines box protocol.
 *
 * Env:
 *  AGENT_TTS_HARNESS          claude-code | cursor-cli | gemini-cli | codex
 *  AGENT_TTS_GIT_CREDENTIAL   PAT for git extraheader + GH_TOKEN
 *  AGENT_TTS_GIT_HOST         extraheader host (default github.com)
 *  AGENT_TTS_WORKSPACE        default /workspace (starts empty; agent clones)
 *
 * Model keys (ANTHROPIC_API_KEY, CURSOR_API_KEY, GEMINI_API_KEY,
 * OPENAI_API_KEY, …) are passed through from the gateway.
 * stdout is protocol only; logs go to stderr.
 */

import { createInterface } from "node:readline";
import { installHarnessGitAuth } from "./git.js";
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
  const credential = process.env.AGENT_TTS_GIT_CREDENTIAL ?? "";
  const host =
    process.env.AGENT_TTS_GIT_HOST || process.env.AGENT_TTS_REPO_URL || "";
  // Auth only. Do not clone: the harness owns remotes, branches, and PRs.
  installHarnessGitAuth(host, credential);
  delete process.env.AGENT_TTS_GIT_CREDENTIAL;

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
