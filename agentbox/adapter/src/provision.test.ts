import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseAttachedRepositories,
  provisionRepositories,
  repositoryDestinations,
} from "./provision.js";

describe("attached repository parsing", () => {
  it("accepts credential-free GitHub HTTPS clone metadata", () => {
    assert.deepEqual(
      parseAttachedRepositories(
        JSON.stringify([
          {
            id: 42,
            fullName: "acme/api",
            cloneUrl: "https://github.com/acme/api.git",
            defaultBranch: "main",
          },
        ]),
      ),
      [
        {
          id: 42,
          fullName: "acme/api",
          cloneUrl: "https://github.com/acme/api.git",
          defaultBranch: "main",
        },
      ],
    );
  });

  it("rejects clone URLs containing credentials and duplicate repositories", () => {
    assert.throws(
      () =>
        parseAttachedRepositories(
          JSON.stringify([
            {
              id: 1,
              fullName: "acme/..",
              cloneUrl: "https://github.com/acme/escape.git",
            },
          ]),
        ),
      /unsafe full name/,
    );
    assert.throws(
      () =>
        parseAttachedRepositories(
          JSON.stringify([
            {
              id: 1,
              fullName: "acme/api",
              cloneUrl: "https://token@github.com/acme/api.git",
            },
          ]),
        ),
      /credential-free HTTPS/,
    );
    assert.throws(
      () =>
        parseAttachedRepositories(
          JSON.stringify([
            {
              id: 1,
              fullName: "acme/api",
              cloneUrl: "https://github.com/other/repo.git",
            },
          ]),
        ),
      /does not match/,
    );
    assert.throws(
      () =>
        parseAttachedRepositories(
          JSON.stringify([
            { id: 1, fullName: "acme/api", cloneUrl: "https://github.com/acme/api.git" },
            { id: 2, fullName: "ACME/API", cloneUrl: "https://github.com/acme/api.git" },
          ]),
        ),
      /duplicated/,
    );
  });
});

describe("repository destinations", () => {
  it("always uses stable owner-qualified names", () => {
    const repos = [
      { id: 1, fullName: "acme/mobile", cloneUrl: "https://github.com/acme/mobile.git" },
      { id: 2, fullName: "acme/api", cloneUrl: "https://github.com/acme/api.git" },
      { id: 3, fullName: "other/api", cloneUrl: "https://github.com/other/api.git" },
    ];
    const names = repositoryDestinations(repos);
    assert.equal(names.get("acme/mobile"), "acme--mobile");
    assert.equal(names.get("acme/api"), "acme--api");
    assert.equal(names.get("other/api"), "other--api");
  });
});

describe("repository provisioning", () => {
  it("clones the optional startup set as workspace siblings in order", async () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const events: string[] = [];
    await provisionRepositories({
      workspace: "/tmp/nonexistent-agent-tts-test-workspace",
      repositories: [
        {
          id: 1,
          fullName: "acme/one",
          cloneUrl: "https://github.com/acme/one.git",
          defaultBranch: "trunk",
        },
        { id: 2, fullName: "acme/two", cloneUrl: "https://github.com/acme/two.git" },
      ],
      onProgress: (event) =>
        events.push(`${event.stage}:${event.repository ?? ""}:${event.index ?? ""}`),
      runGit: async (args, cwd) => {
        calls.push({ args, cwd });
      },
    });
    assert.deepEqual(calls, [
      {
        args: ["clone", "--", "https://github.com/acme/one.git", "acme--one"],
        cwd: "/tmp/nonexistent-agent-tts-test-workspace",
      },
      {
        args: ["clone", "--", "https://github.com/acme/two.git", "acme--two"],
        cwd: "/tmp/nonexistent-agent-tts-test-workspace",
      },
    ]);
    assert.deepEqual(events, [
      "preparing::",
      "cloning:acme/one:1",
      "cloning:acme/two:2",
      "starting_harness::",
    ]);
  });
});
