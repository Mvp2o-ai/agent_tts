import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { preserveAccessibleRepositories } from "./repository-selection";

const repository = (id: number, fullName = `acme/repo-${id}`) => ({
  id,
  fullName,
  cloneUrl: `https://github.com/${fullName}.git`,
});

describe("repository selection", () => {
  it("preserves explicit startup selections without selecting newly accessible repositories", () => {
    assert.deepEqual(
      preserveAccessibleRepositories(
        [repository(2), repository(4)],
        [repository(1), repository(2), repository(3)],
      ),
      [repository(2)],
    );
  });
});
