import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSettingsStore,
  DEFAULT_DEVICE_SETTINGS,
  memoryKeyValueStore,
  readDeviceSettingsForHydration,
  SETTINGS_STORAGE_KEY,
} from "./settings";

describe("device settings hydration", () => {
  it("allows persist after a successful empty load", async () => {
    const store = createSettingsStore(memoryKeyValueStore());
    const result = await readDeviceSettingsForHydration(store);
    assert.equal(result.loaded, null);
    assert.equal(result.persist, true);
  });

  it("allows persist after a successful stored load", async () => {
    const kv = memoryKeyValueStore();
    const store = createSettingsStore(kv);
    await store.save({
      ...DEFAULT_DEVICE_SETTINGS,
      userId: "ken",
    });
    const result = await readDeviceSettingsForHydration(store);
    assert.equal(result.loaded?.userId, "ken");
    assert.equal(result.persist, true);
  });

  it("does not authorize persist when stored settings cannot be read", async () => {
    const kv = memoryKeyValueStore({
      [SETTINGS_STORAGE_KEY]: "not-json",
    });
    const store = createSettingsStore(kv);
    const result = await readDeviceSettingsForHydration(store);
    assert.equal(result.loaded, null);
    assert.equal(result.persist, false);
    assert.equal(kv.data[SETTINGS_STORAGE_KEY], "not-json");
  });

  it("does not authorize persist when the backing store rejects", async () => {
    const store = createSettingsStore({
      async getItem() {
        throw new Error("native storage unavailable");
      },
      async setItem() {
        throw new Error("should not write after a failed read");
      },
    });
    const result = await readDeviceSettingsForHydration(store);
    assert.equal(result.loaded, null);
    assert.equal(result.persist, false);
  });
});
