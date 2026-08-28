import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { modelCatalogFor } from "./model-catalog.js";

describe("modelCatalogFor", () => {
  it("returns undefined for an unknown harness", () => {
    assert.equal(modelCatalogFor("nope"), undefined);
    assert.equal(modelCatalogFor(""), undefined);
  });

  it("lists claude-code models with documented efforts", () => {
    const catalog = modelCatalogFor("claude-code");
    assert.ok(catalog);
    assert.equal(catalog.harness, "claude-code");
    assert.deepEqual(
      catalog.models.map((m) => m.id),
      [
        "claude-sonnet-5",
        "claude-opus-5",
        "claude-fable-5",
        "claude-opus-4-8",
        "claude-sonnet-4-6",
        "claude-haiku-4-5-20251001",
      ],
    );
    assert.equal(catalog.models.find((m) => m.default)?.id, "claude-sonnet-5");
    assert.deepEqual(
      catalog.models.find((m) => m.id === "claude-sonnet-5")?.efforts,
      ["low", "medium", "high", "xhigh", "max"],
    );
    assert.deepEqual(
      catalog.models.find((m) => m.id === "claude-sonnet-4-6")?.efforts,
      ["low", "medium", "high", "max"],
    );
    assert.deepEqual(
      catalog.models.find((m) => m.id === "claude-haiku-4-5-20251001")?.efforts,
      [],
    );
  });

  it("encodes cursor and gemini effort in the slug (empty efforts)", () => {
    for (const harness of ["cursor-cli", "gemini-cli"] as const) {
      const catalog = modelCatalogFor(harness);
      assert.ok(catalog);
      assert.ok(catalog.models.every((m) => m.efforts.length === 0));
      assert.equal(catalog.models[0]?.id, "auto");
      assert.equal(catalog.models[0]?.default, true);
    }
  });

  it("lists codex models with low/medium/high/xhigh", () => {
    const catalog = modelCatalogFor("codex");
    assert.ok(catalog);
    assert.equal(catalog.models.find((m) => m.default)?.id, "gpt-5.6-terra");
    assert.ok(
      catalog.models.every((m) =>
        m.efforts.join(",") === "low,medium,high,xhigh",
      ),
    );
  });
});
