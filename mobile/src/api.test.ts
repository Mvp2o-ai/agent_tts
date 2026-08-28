import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchModelCatalog } from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("model catalog", () => {
  it("fetches with bearer auth and parses catalog entries", async () => {
    let requested: { url: string; authorization: string | null } | undefined;
    globalThis.fetch = (async (url, init) => {
      const headers = new Headers(init?.headers);
      requested = {
        url: String(url),
        authorization: headers.get("authorization"),
      };
      return Response.json({
        harness: "claude-code",
        models: [
          {
            id: "sonnet",
            label: "Sonnet 5",
            efforts: ["low", "high"],
            default: true,
          },
          { id: "opus", label: "Opus", efforts: [] },
          { id: 12, label: "skip me" },
        ],
      });
    }) as typeof fetch;

    const catalog = await fetchModelCatalog(
      "https://gw.example/",
      "tok",
      "claude-code",
    );
    assert.deepEqual(requested, {
      url: "https://gw.example/v1/model-catalog?harness=claude-code",
      authorization: "Bearer tok",
    });
    assert.equal(catalog.harness, "claude-code");
    assert.deepEqual(catalog.models, [
      {
        id: "sonnet",
        label: "Sonnet 5",
        efforts: ["low", "high"],
        default: true,
      },
      { id: "opus", label: "Opus", efforts: [] },
    ]);
  });

  it("rejects an invalid catalog body", async () => {
    globalThis.fetch = (async () => Response.json({ models: [] })) as typeof fetch;
    await assert.rejects(
      fetchModelCatalog("https://gw.example", "tok", "codex"),
      /invalid/,
    );
  });
});
