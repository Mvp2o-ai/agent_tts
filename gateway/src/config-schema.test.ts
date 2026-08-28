import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultConfig, mergeConfig } from "./config-schema.js";

describe("mergeConfig model/effort", () => {
  it("keeps model and effort undefined on defaults", () => {
    const cfg = defaultConfig("u1");
    assert.equal(cfg.model, undefined);
    assert.equal(cfg.effort, undefined);
  });

  it("lets a patch value win and keeps the other field", () => {
    const base = mergeConfig(defaultConfig("u1"), {
      model: "claude-sonnet-5",
      effort: "low",
    });
    const next = mergeConfig(base, { model: "claude-opus-5" });
    assert.equal(next.model, "claude-opus-5");
    assert.equal(next.effort, "low");
  });

  it("clears model and effort back to undefined on explicit empty string", () => {
    const base = mergeConfig(defaultConfig("u1"), {
      model: "claude-sonnet-5",
      effort: "high",
    });
    const next = mergeConfig(base, { model: "", effort: "" });
    assert.equal(next.model, undefined);
    assert.equal(next.effort, undefined);
  });

  it("keeps base when the patch omits the key", () => {
    const base = mergeConfig(defaultConfig("u1"), {
      model: "gpt-5.6-terra",
      effort: "xhigh",
    });
    const next = mergeConfig(base, { harness: "codex" });
    assert.equal(next.model, "gpt-5.6-terra");
    assert.equal(next.effort, "xhigh");
    assert.equal(next.harness, "codex");
  });
});
