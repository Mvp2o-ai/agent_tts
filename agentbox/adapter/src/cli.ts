import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { Harness, HarnessEvents } from "./harness.js";

export interface StreamMapper {
  sessionId?: string;
  feed(event: unknown, events: HarnessEvents): "continue" | "done";
}

const SIGKILL_AFTER_MS = 2000;

/** SIGTERM the process group, then SIGKILL if it ignores SIGTERM. */
export function killChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  const fire = (signal: NodeJS.Signals) => {
    if (pid != null) {
      try {
        process.kill(-pid, signal);
        return;
      } catch {
        // Not a group leader (spawn wasn't detached) — fall back to the child.
      }
    }
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  };
  fire("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      fire("SIGKILL");
    }
  }, SIGKILL_AFTER_MS).unref();
}

export async function runJsonlCli(opts: {
  bin: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal: AbortSignal;
  onLine: (obj: unknown) => "continue" | "done";
}): Promise<"done" | "aborted"> {
  const child = spawn(opts.bin, opts.args, {
    cwd: opts.cwd,
    detached: true,
    env: {
      ...process.env,
      CI: "1",
      GIT_TERMINAL_PROMPT: "0",
      NO_UPDATE_NOTIFIER: "1",
      DISABLE_AUTOUPDATER: "1",
      NO_OPEN_BROWSER: "1",
      ...opts.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const abort = () => killChild(child);
  if (opts.signal.aborted) {
    abort();
  } else {
    opts.signal.addEventListener("abort", abort, { once: true });
  }

  try {
    return await readJsonl(child, opts.signal, opts.onLine);
  } finally {
    opts.signal.removeEventListener("abort", abort);
  }
}

function readJsonl(
  child: ChildProcess,
  signal: AbortSignal,
  onLine: (obj: unknown) => "continue" | "done",
): Promise<"done" | "aborted"> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";
    let gotDone = false;
    let buffer = "";

    const finish = (err?: Error, result?: "done" | "aborted") => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(result ?? "done");
    };

    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString();
      process.stderr.write(buf);
    });

    if (!child.stdout) {
      finish(new Error(`${child.spawnfile} has no stdout`));
      return;
    }

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (settled || gotDone) return;
      if (!line.trim() && !buffer) return;
      buffer += line;
      let parsed: unknown;
      try {
        parsed = JSON.parse(buffer);
        buffer = "";
      } catch {
        buffer += "\n";
        return;
      }
      try {
        if (onLine(parsed) === "done") {
          gotDone = true;
        }
      } catch (e) {
        killChild(child);
        finish(e instanceof Error ? e : new Error(String(e)));
      }
    });

    child.on("error", (err) => finish(err));
    child.on("close", (code) => {
      rl.close();
      if (settled) return;
      // Explicit user/stop-word abort wins even if the mapper already saw JSONL done.
      if (signal.aborted) {
        finish(undefined, "aborted");
        return;
      }
      if (gotDone) {
        finish(undefined, "done");
        return;
      }
      const extra = stderr.trim();
      finish(
        new Error(
          extra
            ? `${child.spawnfile} exited ${code}: ${extra}`
            : `${child.spawnfile} exited ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

export function jsonlHarness(opts: {
  bin: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  mapper: StreamMapper;
  argsFor: (prompt: string, sessionId?: string) => string[];
}): Harness {
  return {
    async run(prompt, events, signal) {
      const args = opts.argsFor(prompt, opts.mapper.sessionId);
      return runJsonlCli({
        bin: opts.bin,
        args,
        cwd: opts.cwd,
        env: opts.env,
        signal,
        onLine: (obj) => opts.mapper.feed(obj, events),
      });
    },
  };
}

export function contentText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string };
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("");
}
