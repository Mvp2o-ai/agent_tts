/**
 * agentbox adapter — stdin/stdout JSON-lines box protocol.
 *
 * Env:
 *  AGENT_TTS_HARNESS          claude-code | cursor-cli | gemini-cli | codex
 *  initialize.credential      session-only token for git extraheader + GH_TOKEN
 *  AGENT_TTS_GIT_HOST         extraheader host (default github.com)
 *  AGENT_TTS_REPOSITORIES     JSON array of repositories to provision
 *  AGENT_TTS_WORKSPACE        default /workspace
 *
 * Model keys (ANTHROPIC_API_KEY, CURSOR_API_KEY, GEMINI_API_KEY,
 * OPENAI_API_KEY, …) are passed through from the gateway.
 * stdout is protocol only; logs go to stderr.
 */

import { createInterface } from "node:readline";
import {
  clearHarnessGitAuth,
  DeferredGitCredential,
  installHarnessGitAuth,
  probeGithubCredential,
} from "./git.js";
import {
  GIT_AUTH_REQUIRED_CODE,
  gitAuthRequiredMessage,
  isGitAuthFailureMessage,
} from "./git-auth-error.js";
import type { Harness } from "./harness.js";
import {
  parseAttachedRepositories,
  provisionRepositories,
} from "./provision.js";
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
  const legacyCredential = process.env.AGENT_TTS_GIT_CREDENTIAL ?? "";
  const host =
    process.env.AGENT_TTS_GIT_HOST || process.env.AGENT_TTS_REPO_URL || "";
  const repositories = parseAttachedRepositories(
    process.env.AGENT_TTS_REPOSITORIES,
  );
  delete process.env.AGENT_TTS_GIT_CREDENTIAL;
  delete process.env.AGENT_TTS_REPOSITORIES;

  let harness: Harness | null = null;
  let initializing = false;
  let initialized = false;
  const deferredGitCredential = new DeferredGitCredential();
  let inFlight: { id: string; abort: AbortController } | null = null;
  let stdinClosed = false;
  let gitAuthSequence = Promise.resolve();
  let gitAuthGeneration = 0;
  let harnessIdle = Promise.resolve();
  let resolveHarnessIdle: (() => void) | undefined;

  const maybeExit = () => {
    if (stdinClosed && !initializing && !inFlight) process.exit(0);
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

    if (msg.type === "initialize") {
      if (initialized || initializing) return;
      initializing = true;
      const credential = msg.credential ?? legacyCredential;
      void (async () => {
        if (credential.trim()) {
          const probe = await probeGithubCredential(credential);
          if (!probe.ok) {
            clearHarnessGitAuth();
            emit({
              type: "git_auth",
              state: "required",
              message: probe.message,
            });
          } else {
            installHarnessGitAuth(host, credential);
            emit({
              type: "git_auth",
              state: "ready",
              ...(probe.login ? { login: probe.login } : {}),
            });
          }
        } else {
          clearHarnessGitAuth();
        }
        await provisionRepositories({
          workspace,
          repositories,
          onProgress: (progress) => emit({ type: "provisioning", ...progress }),
        });
        harness = selectHarness(harnessId, workspace);
        await deferredGitCredential.drain(async (pendingCredential) => {
          if (!pendingCredential.trim()) {
            clearHarnessGitAuth();
            emit({ type: "git_auth", state: "cleared" });
            return;
          }
          const pendingProbe = await probeGithubCredential(pendingCredential);
          if (!pendingProbe.ok) {
            emit({
              type: "git_auth",
              state: "required",
              message: pendingProbe.message,
            });
            return;
          }
          installHarnessGitAuth(host, pendingCredential);
          emit({
            type: "git_auth",
            state: "ready",
            ...(pendingProbe.login ? { login: pendingProbe.login } : {}),
          });
        });
        initialized = true;
        process.stderr.write(`agentbox adapter ready harness=${harnessId}\n`);
        emit({ type: "ready", repositories: repositories.length });
      })()
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          const authFailure = isGitAuthFailureMessage(message);
          if (authFailure) {
            clearHarnessGitAuth();
            emit({
              type: "git_auth",
              state: "required",
              message: gitAuthRequiredMessage(message),
            });
          }
          process.stdout.write(
            encodeOutbound({
              type: "error",
              message: authFailure ? gitAuthRequiredMessage(message) : message,
              ...(authFailure ? { code: GIT_AUTH_REQUIRED_CODE } : {}),
            }),
            () => process.exit(1),
          );
        })
        .finally(() => {
          initializing = false;
          maybeExit();
        });
      return;
    }

    if (msg.type === "git_auth") {
      if (!initialized) {
        // The phone can finish OAuth while startup provisioning is still in
        // flight. Keep only the newest identity and install it before ready.
        deferredGitCredential.replace(msg.credential);
        return;
      }
      const generation = ++gitAuthGeneration;
      const credential = msg.credential;
      const idleAtRequest = harnessIdle;
      gitAuthSequence = gitAuthSequence
        .then(() => idleAtRequest)
        .then(async () => {
          if (generation !== gitAuthGeneration) return;
          if (!credential.trim()) {
            clearHarnessGitAuth();
            emit({ type: "git_auth", state: "cleared" });
            return;
          }
          const probe = await probeGithubCredential(credential);
          if (generation !== gitAuthGeneration) return;
          if (!probe.ok) {
            emit({
              type: "git_auth",
              state: "required",
              message: probe.message,
            });
            return;
          }
          installHarnessGitAuth(host, credential);
          emit({
            type: "git_auth",
            state: "ready",
            ...(probe.login ? { login: probe.login } : {}),
          });
        })
        .catch((err: unknown) => {
          if (generation !== gitAuthGeneration) return;
          emit({
            type: "git_auth",
            state: "required",
            message:
              err instanceof Error
                ? err.message
                : "GitHub authorization failed",
          });
        });
      return;
    }

    if (!initialized || !harness) {
      emit({
        type: "error",
        promptId: msg.id,
        message: "agentbox is still provisioning",
      });
      return;
    }
    const currentHarness = harness;

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
    const authBeforePrompt = gitAuthSequence;
    harnessIdle = new Promise<void>((resolve) => {
      resolveHarnessIdle = resolve;
    });

    void (async () => {
      await authBeforePrompt;
      if (abort.signal.aborted) return "aborted" as const;
      return currentHarness.run(
        msg.text,
        {
          onChunk: (text) => emit({ type: "chunk", promptId, text }),
          onToolEvent: (summary) => {
            emit({ type: "tool_event", promptId, summary });
            if (isGitAuthFailureMessage(summary)) {
              clearHarnessGitAuth();
              emit({
                type: "git_auth",
                state: "required",
                message: gitAuthRequiredMessage(summary),
              });
            }
          },
        },
        abort.signal,
        { model: msg.model, effort: msg.effort },
      );
    })()
      .then((status) => {
        emit(
          status === "aborted"
            ? { type: "aborted", promptId }
            : { type: "done", promptId },
        );
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        const authFailure = isGitAuthFailureMessage(message);
        if (authFailure) {
          clearHarnessGitAuth();
          emit({
            type: "git_auth",
            state: "required",
            message: gitAuthRequiredMessage(message),
          });
        }
        emit({
          type: "error",
          promptId,
          message: authFailure ? gitAuthRequiredMessage(message) : message,
          ...(authFailure ? { code: GIT_AUTH_REQUIRED_CODE } : {}),
        });
      })
      .finally(() => {
        if (inFlight?.id === promptId) inFlight = null;
        resolveHarnessIdle?.();
        resolveHarnessIdle = undefined;
        harnessIdle = Promise.resolve();
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
