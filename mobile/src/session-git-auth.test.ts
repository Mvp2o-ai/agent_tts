import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveDesiredGitCredential } from "./session-git-auth";

describe("session GitHub auth", () => {
  it("uses the fetched credential when no live update intervened", () => {
    assert.equal(
      resolveDesiredGitCredential("old", 2, 2, "fresh"),
      "fresh",
    );
  });

  it("keeps a disconnect that arrived while credential loading was in flight", () => {
    assert.equal(
      resolveDesiredGitCredential("", 2, 3, "stale-token"),
      "",
    );
  });
});
