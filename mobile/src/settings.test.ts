import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
      gatewayUrl: "http://10.0.0.8:4100",
      token: "gateway-token",
      gitPat: "ghp_example",
      modelKeys: { ANTHROPIC_API_KEY: "sk-ant-example" },
      harness: "gemini-cli" as const,
    };
    const parsed = parseDeviceSettings(serializeDeviceSettings(settings));
    assert.equal(parsed.token, "gateway-token");
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

  it("persists through a key-value store", async () => {
    const kv = memoryKeyValueStore();
    const store = createSettingsStore(kv);
    assert.equal(await store.load(), null);
    await store.save({
      ...DEFAULT_DEVICE_SETTINGS,
      userId: "ken",
      token: "t",
    });
    const loaded = await store.load();
    assert.equal(loaded?.userId, "ken");
    assert.equal(loaded?.token, "t");
  });
});
