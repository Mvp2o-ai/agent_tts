import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line) as { type?: string };
  if (message.type !== "initialize") return;
  process.stdout.write(
    `${JSON.stringify({
      type: "provisioning",
      stage: "cloning",
      repository: "acme/missing",
      index: 1,
      total: 1,
    })}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ type: "error", message: "clone denied" })}\n`,
  );
});
