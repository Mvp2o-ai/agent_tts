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
import { gatewayBindHost } from "./gateway-bind.js";
import { requireGatewayToken } from "./gateway-token.js";

const PORT = Number(process.env.PORT ?? 4100);
const bindHost = gatewayBindHost(process.env.GATEWAY_BIND);
const token = requireGatewayToken(process.env.GATEWAY_TOKEN);

const dbPath = process.env.CONFIG_DB ?? "./data/agent_tts.db";
const store =
  dbPath === "memory" ? new MemoryConfigStore() : new SqliteConfigStore(dbPath);

const boxCommand = process.env.AGENTBOX_COMMAND?.trim()
  ? process.env.AGENTBOX_COMMAND.split(" ").filter(Boolean)
  : ["node", "/app/agentbox/adapter/dist/index.js"];

const voiceSecrets: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value) voiceSecrets[key] = value;
}

const { server } = createGateway({
  token,
  store,
  sttProviderId: process.env.STT_PROVIDER,
  ttsProviderId: process.env.TTS_PROVIDER,
  voiceSecrets,
  boxCommand,
  workspaceDir: process.env.WORKSPACE_DIR ?? "/workspace",
  onReset: () => {
    process.stderr.write("session reset: exiting for container recreate\n");
    server.close();
    void store.close().finally(() => process.exit(0));
  },
});

server.listen(PORT, bindHost, () => {
  process.stderr.write(`agent_tts gateway listening on ${bindHost}:${PORT}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void store.close().finally(() => process.exit(0));
  });
}
