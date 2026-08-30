import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createRailwayProvisioningStore,
  type ProvisioningKeyValueStore,
  type RailwayProvisioningRecord,
} from "./providers/railway/provisioning-store";

describe("Railway durable provisioning checkpoints", () => {
  it("persists and restores a record without runtime secrets", async () => {
    const storage = memoryStorage();
    const store = createRailwayProvisioningStore(storage);
    const record: RailwayProvisioningRecord = {
      agentId: "agent-1",
      agentName: "Walking agent",
      providerCredentialId: "provider-1",
      gatewayCredentialId: "gateway-1",
      sttProviderId: "fixture-stt",
      ttsProviderId: "fixture-tts",
      voiceCredentialIds: {
        FIXTURE_API_KEY: "fixture-1",
      },
      state: {
        providerId: "railway",
        provisioningId: "launch-1",
        phase: "ready",
        deploymentState: "stopped",
        workspaceId: "workspace-1",
        projectName: "agent-tts-launch-1",
        projectId: "project-1",
        pendingMutation: "service",
        updatedAt: 42,
      },
    };

    await store.save(record);

    assert.deepEqual(await store.list(), [record]);
    const serialized = Object.values(storage.data).join("");
    assert.match(serialized, /FIXTURE_API_KEY/);
    assert.equal(serialized.includes("fixture-secret"), false);
    assert.equal(serialized.includes("gateway-token"), false);
    assert.equal(serialized.includes("deepgramCredentialId"), false);
  });

  it("migrates v1 named credential IDs on read", async () => {
    const storage = memoryStorage({
      "agent_tts.railwayProvisioning.v1.legacy": JSON.stringify({
        agentId: "agent-legacy",
        agentName: "Legacy agent",
        providerCredentialId: "provider-1",
        gatewayCredentialId: "gateway-1",
        deepgramCredentialId: "deepgram-1",
        elevenLabsCredentialId: "elevenlabs-1",
        state: {
          providerId: "railway",
          provisioningId: "launch-legacy",
          phase: "ready",
          workspaceId: "workspace-1",
          projectName: "agent-tts-launch-legacy",
          updatedAt: 42,
        },
      }),
    });
    const store = createRailwayProvisioningStore(storage);

    assert.deepEqual(await store.list(), [
      {
        agentId: "agent-legacy",
        agentName: "Legacy agent",
        providerCredentialId: "provider-1",
        gatewayCredentialId: "gateway-1",
        sttProviderId: "deepgram",
        ttsProviderId: "elevenlabs",
        voiceCredentialIds: {
          DEEPGRAM_API_KEY: "deepgram-1",
          ELEVENLABS_API_KEY: "elevenlabs-1",
        },
        state: {
          providerId: "railway",
          provisioningId: "launch-legacy",
          phase: "ready",
          workspaceId: "workspace-1",
          projectName: "agent-tts-launch-legacy",
          updatedAt: 42,
        },
      },
    ]);
  });

  it("rejects records without new or legacy credential references", async () => {
    const storage = memoryStorage({
      "agent_tts.railwayProvisioning.v1.bad": JSON.stringify({
        agentId: "agent-1",
        agentName: "Agent",
        providerCredentialId: "provider-1",
        gatewayCredentialId: "gateway-1",
        state: {
          providerId: "railway",
          provisioningId: "launch-1",
          phase: "ready",
          workspaceId: "workspace-1",
          projectName: "agent-tts-launch-1",
          updatedAt: 42,
        },
      }),
    });
    const store = createRailwayProvisioningStore(storage);

    assert.deepEqual(await store.list(), []);
  });

  it("ignores corrupt records and removes named checkpoints", async () => {
    const storage = memoryStorage({
      "agent_tts.railwayProvisioning.v1.bad": "{}",
    });
    const store = createRailwayProvisioningStore(storage);

    assert.deepEqual(await store.list(), []);
    await store.remove("bad");
    assert.deepEqual(storage.data, {});
  });
});

function memoryStorage(
  seed: Record<string, string> = {},
): ProvisioningKeyValueStore & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    async getAllKeys() {
      return Object.keys(data);
    },
    async multiGet(keys) {
      return keys.map((key) => [key, data[key] ?? null] as const);
    },
    async setItem(key, value) {
      data[key] = value;
    },
    async removeItem(key) {
      delete data[key];
    },
  };
}
