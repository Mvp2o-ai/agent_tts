import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runSessionPreflight } from "./session-preflight";

describe("session preflight", () => {
  it("saves configuration before resolving GitHub authorization", async () => {
    const calls: string[] = [];

    const credential = await runSessionPreflight({
      saveConfig: async () => {
        calls.push("config");
      },
      getGitCredential: async () => {
        calls.push("github");
        return "token";
      },
    });

    assert.equal(credential, "token");
    assert.deepEqual(calls, ["config", "github"]);
  });

  it("does not continue to GitHub authorization when configuration fails", async () => {
    let requestedCredential = false;

    await assert.rejects(
      runSessionPreflight({
        saveConfig: async () => {
          throw new Error("config unavailable");
        },
        getGitCredential: async () => {
          requestedCredential = true;
          return "token";
        },
      }),
      /config unavailable/,
    );

    assert.equal(requestedCredential, false);
  });
});
