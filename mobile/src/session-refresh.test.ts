import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldStopHostBeforeNewSession } from "./session-refresh";

describe("shouldStopHostBeforeNewSession", () => {
  it("stops a running host before recreating it", () => {
    assert.equal(shouldStopHostBeforeNewSession("running"), true);
    assert.equal(shouldStopHostBeforeNewSession(undefined), true);
  });

  it("starts a stopped host without another stop", () => {
    assert.equal(shouldStopHostBeforeNewSession("stopped"), false);
  });
});
