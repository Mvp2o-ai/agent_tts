/**
 * Fake agentbox for gateway tests. Speaks the JSON-lines protocol on stdio.
 * Echoes the prompt as two chunks then done. Abort -> aborted.
 */
import { createInterface } from "node:readline";

let current: string | undefined;

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line) as {
    type: string;
    id?: string;
    text?: string;
    reason?: string;
  };
  if (msg.type === "abort") {
    if (current) {
      process.stdout.write(
        `${JSON.stringify({ type: "aborted", promptId: current })}\n`,
      );
      current = undefined;
    }
    return;
  }
  if (msg.type === "prompt" && msg.id && msg.text) {
    current = msg.id;
    process.stdout.write(
      `${JSON.stringify({ type: "chunk", promptId: msg.id, text: "echo:" })}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ type: "chunk", promptId: msg.id, text: msg.text })}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ type: "done", promptId: msg.id })}\n`,
    );
    current = undefined;
  }
});
