import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeAgent,
  createSettingsStore,
  DEFAULT_DEVICE_SETTINGS,
  memoryKeyValueStore,
  parseDeviceSettings,
  serializeDeviceSettings,
} from "./settings";

describe("device settings", () => {
  it("round-trips fields including secrets without dropping keys", () => {
    const settings = {
      ...DEFAULT_DEVICE_SETTINGS,
      agents: [
        {
          id: "agent-1",
          name: "Agent 1",
          gatewayUrl: "http://10.0.0.8:4100",
          token: "gateway-token",
        },
      ],
      activeAgentId: "agent-1",
      gitPat: "ghp_example",
      modelKeys: { ANTHROPIC_API_KEY: "sk-ant-example" },
      harness: "gemini-cli" as const,
    };
    const parsed = parseDeviceSettings(serializeDeviceSettings(settings));
    assert.equal(activeAgent(parsed).token, "gateway-token");
    assert.equal(activeAgent(parsed).gatewayUrl, "http://10.0.0.8:4100");
    assert.equal(parsed.gitPat, "ghp_example");
    assert.equal(parsed.harness, "gemini-cli");
    assert.equal(parsed.modelKeys.ANTHROPIC_API_KEY, "sk-ant-example");
  });

  it("falls back on corrupt JSON and unknown harnesses", () => {
    assert.equal(parseDeviceSettings("not-json").harness, "claude-code");
    assert.equal(
      parseDeviceSettings(JSON.stringify({ harness: "nope" })).harness,
      "claude-code",
    );
  });

  it("migrates legacy v1 gatewayUrl/token into a single Agent 1 profile", () => {
    const parsed = parseDeviceSettings(
      JSON.stringify({
        gatewayUrl: "http://10.0.0.8:4100",
        token: "legacy-token",
        userId: "ken",
        harness: "codex",
        gitPat: "ghp_example",
      }),
    );
    assert.equal(parsed.agents.length, 1);
    assert.equal(parsed.agents[0]?.id, "agent-1");
    assert.equal(parsed.agents[0]?.name, "Agent 1");
    assert.equal(parsed.agents[0]?.gatewayUrl, "http://10.0.0.8:4100");
    assert.equal(parsed.agents[0]?.token, "legacy-token");
    assert.equal(parsed.activeAgentId, "agent-1");
    assert.equal(parsed.userId, "ken");
    assert.equal(parsed.harness, "codex");
    assert.equal(parsed.gitPat, "ghp_example");
    assert.equal(activeAgent(parsed).token, "legacy-token");

    const serialized = JSON.parse(serializeDeviceSettings(parsed)) as Record<
      string,
      unknown
    >;
    assert.equal("gatewayUrl" in serialized, false);
    assert.equal("token" in serialized, false);
    assert.ok(Array.isArray(serialized.agents));
    assert.equal(serialized.activeAgentId, "agent-1");
  });

  it("drops invalid agent entries and repairs activeAgentId", () => {
    const parsed = parseDeviceSettings(
      JSON.stringify({
        agents: [
          { id: 1, name: "bad", gatewayUrl: "http://x", token: "t" },
          {
            id: "ok",
            name: "Prod",
            gatewayUrl: "https://a.example",
            token: "t",
          },
          "nope",
          { id: "partial", name: "Nope" },
        ],
        activeAgentId: "missing",
      }),
    );
    assert.equal(parsed.agents.length, 1);
    assert.equal(parsed.agents[0]?.id, "ok");
    assert.equal(parsed.agents[0]?.name, "Prod");
    assert.equal(parsed.activeAgentId, "ok");
  });

  it("ensures at least one profile when agents is empty", () => {
    const parsed = parseDeviceSettings(JSON.stringify({ agents: [] }));
    assert.ok(parsed.agents.length >= 1);
    assert.equal(parsed.activeAgentId, parsed.agents[0]?.id);
    assert.equal(activeAgent(parsed).id, parsed.agents[0]?.id);
  });

  it("activeAgent returns the named profile and falls back to the first", () => {
    const settings = {
      ...DEFAULT_DEVICE_SETTINGS,
      agents: [
        {
          id: "a",
          name: "Alpha",
          gatewayUrl: "http://a",
          token: "ta",
        },
        {
          id: "b",
          name: "Beta",
          gatewayUrl: "http://b",
          token: "tb",
        },
      ],
      activeAgentId: "b",
    };
    assert.equal(activeAgent(settings).name, "Beta");
    assert.equal(activeAgent({ ...settings, activeAgentId: "gone" }).name, "Alpha");
  });

  it("persists through a key-value store", async () => {
    const kv = memoryKeyValueStore();
    const store = createSettingsStore(kv);
    assert.equal(await store.load(), null);
    await store.save({
      ...DEFAULT_DEVICE_SETTINGS,
      userId: "ken",
      agents: [
        {
          ...DEFAULT_DEVICE_SETTINGS.agents[0]!,
          token: "t",
        },
      ],
    });
    const loaded = await store.load();
    assert.equal(loaded?.userId, "ken");
    assert.equal(activeAgent(loaded!).token, "t");
  });
});
