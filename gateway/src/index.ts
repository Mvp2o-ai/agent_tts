/**
 * agent_tts gateway — headless API for the mobile voice remote.
 *
 * Single-agent appliance: this process, the adapter, and one harness share
 * one disposable container. New session = process exit; the platform
 * recreates the container from the immutable image. Only the SQLite config
 * volume survives. No Docker socket, no nested containers.
 */

import { createGateway } from "./http.js";
import { SqliteConfigStore, MemoryConfigStore } from "./config-store.js";

const PORT = Number(process.env.PORT ?? 4100);
const token = process.env.GATEWAY_TOKEN;
if (!token) {
  throw new Error("GATEWAY_TOKEN is required");
}

const dbPath = process.env.CONFIG_DB ?? "./data/agent_tts.db";
const store =
  dbPath === "memory" ? new MemoryConfigStore() : new SqliteConfigStore(dbPath);

const boxCommand = process.env.AGENTBOX_COMMAND?.trim()
  ? process.env.AGENTBOX_COMMAND.split(" ").filter(Boolean)
  : ["node", "/opt/adapter/dist/index.js"];

const { server } = createGateway({
  token,
  store,
  deepgramKey: process.env.DEEPGRAM_API_KEY,
  elevenKey: process.env.ELEVENLABS_API_KEY,
  boxCommand,
  workspaceDir: process.env.WORKSPACE_DIR ?? "/workspace",
  onReset: () => {
    process.stderr.write("session reset: exiting for container recreate\n");
    server.close();
    void store.close().finally(() => process.exit(0));
  },
});

// Bind all interfaces. Container hosts (Railway, Compose, k8s) inject PORT
// and reject the process if it only listens on localhost.
server.listen(PORT, "0.0.0.0", () => {
  process.stderr.write(`agent_tts gateway listening on 0.0.0.0:${PORT}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void store.close().finally(() => process.exit(0));
  });
}
