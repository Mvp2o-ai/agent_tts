import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeRecoveredAgentProfile } from "./agent-profile-recovery";

describe("agent profile recovery", () => {
  it("refreshes lifecycle fields without overwriting repository edits", () => {
    const repositories = [
      {
        id: 7,
        fullName: "acme/current",
        cloneUrl: "https://github.com/acme/current.git",
      },
    ];
    const current = {
      id: "agent-1",
      name: "Renamed agent",
      gatewayUrl: "https://old.example",
      token: "old-token",
      gitCredentialId: "github-current",
      repositories,
      runtime: { harness: "codex" as const },
    };
    const recovered = {
      id: "agent-1",
      name: "Launch name",
      gatewayUrl: "https://new.example",
      token: "new-token",
      gitCredentialId: "github-stale",
      repositories: [
        {
          id: 8,
          fullName: "acme/stale",
          cloneUrl: "https://github.com/acme/stale.git",
        },
      ],
      origin: { kind: "provider" as const, provisioningPhase: "ready" },
    };

    const merged = mergeRecoveredAgentProfile(current, recovered);

    assert.equal(merged.name, "Renamed agent");
    assert.equal(merged.gatewayUrl, "https://new.example");
    assert.equal(merged.token, "new-token");
    assert.equal(merged.gitCredentialId, "github-current");
    assert.strictEqual(merged.repositories, repositories);
    assert.deepEqual(merged.runtime, current.runtime);
    assert.deepEqual(merged.origin, recovered.origin);
  });
});
