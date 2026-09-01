/** Fake box that exposes auth updates received while initialization is delayed. */
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line) as {
    type?: string;
    credential?: string;
  };
  if (msg.type === "initialize") {
    process.stdout.write(
      `${JSON.stringify({
        type: "provisioning",
        stage: "preparing",
        total: 0,
      })}\n`,
    );
    setTimeout(() => {
      process.stdout.write(
        `${JSON.stringify({ type: "ready", repositories: 0 })}\n`,
      );
    }, 100);
    return;
  }
  if (msg.type === "git_auth") {
    process.stdout.write(
      `${JSON.stringify({
        type: "git_auth",
        state: msg.credential ? "ready" : "cleared",
        ...(msg.credential ? { login: "replacement-user" } : {}),
      })}\n`,
    );
  }
});
