import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bindAgentGithubIdentity,
  connectAgentGithub,
  disconnectAgentGithub,
  toggleAgentRepository,
} from "./agent-github";
import type { AgentProfile, AttachedRepository } from "./settings";

const first: AttachedRepository = {
  id: 1,
  fullName: "acme/first",
  cloneUrl: "https://github.com/acme/first.git",
};
const second: AttachedRepository = {
  id: 2,
  fullName: "acme/second",
  cloneUrl: "https://github.com/acme/second.git",
};

function profile(): AgentProfile {
  return {
    id: "agent-1",
    name: "Agent 1",
    gatewayUrl: "https://agent.example.com",
    token: "gateway-token",
    gitCredentialId: "github-old",
    repositories: [first, second],
    runtime: { harness: "claude-code", repoUrl: "github.example.com" },
  };
}

describe("agent GitHub identity", () => {
  it("binds a same identity before repository discovery without dropping selections", () => {
    const source = profile();
    const bound = bindAgentGithubIdentity(source, source.gitCredentialId!);

    assert.deepEqual(bound.repositories, [first, second]);
    assert.equal(bound.runtime?.repoUrl, "github.com");
  });

  it("clears unverified selections immediately when switching identities", () => {
    const bound = bindAgentGithubIdentity(profile(), "github-new");

    assert.equal(bound.gitCredentialId, "github-new");
    assert.equal(bound.gitCredentialState, "connected");
    assert.deepEqual(bound.repositories, []);
    assert.equal(bound.runtime?.repoUrl, "github.com");
  });

  it("replaces the single identity and preserves only accessible repositories", () => {
    const connected = connectAgentGithub(profile(), "github-new", [second]);

    assert.equal(connected.gitCredentialId, "github-new");
    assert.deepEqual(connected.repositories, [second]);
    assert.equal(connected.runtime?.repoUrl, "github.com");
    assert.equal(connected.runtime?.harness, "claude-code");
  });

  it("disconnects only this profile and clears its startup clone set", () => {
    const disconnected = disconnectAgentGithub(profile());

    assert.equal("gitCredentialId" in disconnected, false);
    assert.equal(disconnected.gitCredentialState, "disconnected");
    assert.deepEqual(disconnected.repositories, []);
    assert.equal(disconnected.id, "agent-1");
  });

  it("does not mutate the source profile", () => {
    const source = profile();
    connectAgentGithub(source, "github-new", [first]);
    disconnectAgentGithub(source);

    assert.equal(source.gitCredentialId, "github-old");
    assert.deepEqual(source.repositories, [first, second]);
  });

  it("composes rapid repository toggles from the latest profile", () => {
    const source = { ...profile(), repositories: [] };
    const withFirst = toggleAgentRepository(source, first);
    const withBoth = toggleAgentRepository(withFirst, second);

    assert.deepEqual(withBoth.repositories, [first, second]);
  });
});
