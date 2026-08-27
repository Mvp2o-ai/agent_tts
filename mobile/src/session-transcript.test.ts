import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSessionTranscriptStore,
  parseSessionTranscript,
  transcriptStorageKey,
  type TranscriptKeyValueStore,
} from "./session-transcript";

function memoryStore(): TranscriptKeyValueStore & {
  data: Record<string, string>;
} {
  const data: Record<string, string> = {};
  return {
    data,
    async getItem(key) {
      return data[key] ?? null;
    },
    async setItem(key, value) {
      data[key] = value;
    },
    async removeItem(key) {
      delete data[key];
    },
  };
}

describe("session transcripts", () => {
  it("persists each profile independently with generation and replay cursor", async () => {
    const kv = memoryStore();
    const store = createSessionTranscriptStore(kv);
    await store.save("agent-a", {
      generationId: "gen-a",
      lastEventId: 42,
      events: [{ id: 1, kind: "agent", text: "A reply" }],
    });
    await store.save("agent-b", {
      generationId: "gen-b",
      lastEventId: 7,
      events: [{ id: 1, kind: "agent", text: "B reply" }],
    });

    assert.equal((await store.load("agent-a")).events[0]?.text, "A reply");
    assert.equal((await store.load("agent-b")).events[0]?.text, "B reply");
    assert.notEqual(
      transcriptStorageKey("agent-a"),
      transcriptStorageKey("agent-b"),
    );
  });

  it("drops corrupt transcript rows without rejecting the whole buffer", () => {
    const parsed = parseSessionTranscript(
      JSON.stringify({
        generationId: "gen",
        lastEventId: 3,
        events: [
          { id: 1, kind: "agent", text: "valid" },
          { id: "bad", kind: "agent", text: "invalid" },
        ],
      }),
    );
    assert.deepEqual(parsed.events, [{ id: 1, kind: "agent", text: "valid" }]);
  });
});
