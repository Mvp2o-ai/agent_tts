import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import {
  encodeInbound,
  parseOutbound,
  type BoxInbound,
  type BoxOutbound,
} from "./box-protocol.js";

export interface BoxConnection {
  send(msg: BoxInbound): void;
  onMessage(handler: (msg: BoxOutbound) => void): void;
  close(): Promise<void>;
}

export function attachProcess(child: ChildProcess): BoxConnection {
  const handlers = new Set<(msg: BoxOutbound) => void>();
  if (!child.stdout) throw new Error("box process has no stdout");
  if (!child.stdin) throw new Error("box process has no stdin");

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const msg = parseOutbound(line);
      for (const h of handlers) h(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const h of handlers) h({ type: "error", message });
    }
  });
  child.stderr?.on("data", (buf: Buffer) => {
    process.stderr.write(`[agentbox] ${buf.toString()}`);
  });

  return {
    send(msg) {
      child.stdin!.write(encodeInbound(msg));
    },
    onMessage(handler) {
      handlers.add(handler);
    },
    async close() {
      rl.close();
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 3000);
          child.once("exit", () => {
            clearTimeout(t);
            resolve();
          });
        });
      }
    },
  };
}

export function spawnCommandBox(argv: string[], env: NodeJS.ProcessEnv): BoxConnection {
  const [bin, ...args] = argv;
  if (!bin) throw new Error("AGENTBOX_COMMAND is empty");
  const child = spawn(bin, args, {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.on("error", (err) => {
    process.stderr.write(`agentbox spawn error: ${err.message}\n`);
  });
  return attachProcess(child);
}
