import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runJsonlCli } from "./cli.js";

const node = process.execPath;

function onDone(obj: unknown): "continue" | "done" {
  return obj && typeof obj === "object" && (obj as { type?: string }).type === "result"
    ? "done"
    : "continue";
}

describe("runJsonlCli", () => {
  it("parses one JSON object per line and waits for process exit", async () => {
    const started = Date.now();
    const status = await runJsonlCli({
      bin: node,
      args: [
        "-e",
        `process.stdout.write(JSON.stringify({type:"result"})+"\\n");
         setTimeout(() => process.exit(0), 150);`,
      ],
      cwd: process.cwd(),
      signal: AbortSignal.timeout(5000),
      onLine: onDone,
    });
    assert.equal(status, "done");
    assert.ok(Date.now() - started >= 140);
  });

  it("reassembles pretty-printed JSON across lines", async () => {
    const seen: unknown[] = [];
    const status = await runJsonlCli({
      bin: node,
      args: [
        "-e",
        `process.stdout.write("{\\n  \\"type\\": \\"result\\"\\n}\\n");`,
      ],
      cwd: process.cwd(),
      signal: AbortSignal.timeout(5000),
      onLine: (obj) => {
        seen.push(obj);
        return onDone(obj);
      },
    });
    assert.equal(status, "done");
    assert.deepEqual(seen, [{ type: "result" }]);
  });

  it("returns aborted and does not wait for a hanging CLI", { timeout: 8000 }, async () => {
    const abort = new AbortController();
    const started = Date.now();
    setTimeout(() => abort.abort(), 80);
    const status = await runJsonlCli({
      bin: node,
      args: [
        "-e",
        `setInterval(() => process.stdout.write(JSON.stringify({type:"tick"})+"\\n"), 20);`,
      ],
      cwd: process.cwd(),
      signal: abort.signal,
      onLine: () => "continue",
    });
    assert.equal(status, "aborted");
    assert.ok(Date.now() - started < 1500);
  });

  it("SIGKILLs a child that ignores SIGTERM", { timeout: 8000 }, async () => {
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 50);
    const status = await runJsonlCli({
      bin: node,
      args: [
        "-e",
        `process.on("SIGTERM", () => {});
         setInterval(() => {}, 1000);`,
      ],
      cwd: process.cwd(),
      signal: abort.signal,
      onLine: () => "continue",
    });
    assert.equal(status, "aborted");
  });

  it("reports aborted when stop arrives after JSONL done but before exit", async () => {
    const abort = new AbortController();
    const status = await runJsonlCli({
      bin: node,
      args: [
        "-e",
        `process.stdout.write(JSON.stringify({type:"result"})+"\\n");
         setTimeout(() => process.exit(0), 200);`,
      ],
      cwd: process.cwd(),
      signal: abort.signal,
      onLine: (obj) => {
        const status = onDone(obj);
        if (status === "done") setImmediate(() => abort.abort());
        return status;
      },
    });
    assert.equal(status, "aborted");
  });

  it("rejects mapper errors after killing the child", { timeout: 8000 }, async () => {
    await assert.rejects(
      () =>
        runJsonlCli({
          bin: node,
          args: [
            "-e",
            `process.stdout.write(JSON.stringify({type:"error",message:"boom"})+"\\n");
             setInterval(() => {}, 1000);`,
          ],
          cwd: process.cwd(),
          signal: AbortSignal.timeout(5000),
          onLine: (obj) => {
            const rec = obj as { type?: string; message?: string };
            if (rec.type === "error") throw new Error(rec.message ?? "err");
            return "continue";
          },
        }),
      /boom/,
    );
  });
});
