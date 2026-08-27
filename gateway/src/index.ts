/**
 * agent_tts gateway — headless API for the mobile voice remote.
 *
 * Operators run this on a host that can spawn Docker containers.
 * Persistence is a SQLite file (bring your own volume). No web UI.
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
  : undefined;

const { server } = createGateway({
  token,
  store,
  deepgramKey: process.env.DEEPGRAM_API_KEY,
  elevenKey: process.env.ELEVENLABS_API_KEY,
  dockerBin: process.env.DOCKER_BIN ?? "docker",
  agentboxImage: process.env.AGENTBOX_IMAGE ?? "agent_tts-agentbox:local",
  boxCommand,
});

server.listen(PORT, () => {
  process.stderr.write(`agent_tts gateway listening on :${PORT}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void store.close().finally(() => process.exit(0));
  });
}
