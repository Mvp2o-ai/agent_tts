import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  gitAuthRequiredMessage,
  isGitAuthFailureMessage,
} from "./git-auth-error.js";

describe("isGitAuthFailureMessage", () => {
  it("detects common git and gh auth failures", () => {
    assert.equal(
      isGitAuthFailureMessage("fatal: Authentication failed for 'https://github.com/acme/api.git/'"),
      true,
    );
    assert.equal(
      isGitAuthFailureMessage("remote: Write access to repository not granted.\nfatal: unable to access"),
      true,
    );
    assert.equal(
      isGitAuthFailureMessage("gh: To get started with GitHub CLI, please run: gh auth login"),
      true,
    );
    assert.equal(
      isGitAuthFailureMessage("HTTP 401 Unauthorized"),
      true,
    );
  });

  it("ignores ordinary build and test failures", () => {
    assert.equal(isGitAuthFailureMessage("npm test failed"), false);
    assert.equal(isGitAuthFailureMessage("TypeError: cannot read property"), false);
  });
});

describe("gitAuthRequiredMessage", () => {
  it("keeps an existing reconnect instruction", () => {
    assert.equal(
      gitAuthRequiredMessage("GitHub authorization expired; connect GitHub again"),
      "GitHub authorization expired; connect GitHub again",
    );
  });

  it("normalizes other auth failures to the reconnect instruction", () => {
    assert.match(gitAuthRequiredMessage("HTTP 401"), /connect GitHub again/i);
  });
});
