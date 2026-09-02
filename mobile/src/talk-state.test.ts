import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveTalkState,
  talkBusyKindAfter,
} from "./talk-state";

describe("talkBusyKindAfter", () => {
  it("treats a fresh turn and model text as thinking", () => {
    assert.equal(talkBusyKindAfter("prompt_start"), "thinking");
    assert.equal(talkBusyKindAfter("agent_text"), "thinking");
    assert.equal(talkBusyKindAfter("reset"), "thinking");
  });

  it("treats a tool event as working", () => {
    assert.equal(talkBusyKindAfter("tool_event"), "working");
  });
});

describe("resolveTalkState", () => {
  it("shows capturing while the PTT button is held", () => {
    assert.equal(
      resolveTalkState("running", true, true, true, true, "thinking"),
      "capturing",
    );
  });

  it("shows speaking only when playback is actually busy", () => {
    assert.equal(
      resolveTalkState("running", true, true, true, false, "thinking"),
      "speaking",
    );
  });

  it("shows thinking while a turn is in progress without tools or speech", () => {
    assert.equal(
      resolveTalkState("running", false, true, false, false, "thinking"),
      "thinking",
    );
  });

  it("keeps thinking bright while TTS is open but silent", () => {
    assert.equal(
      resolveTalkState("running", false, false, true, false, "thinking"),
      "thinking",
    );
  });

  it("shows working after a tool event until speech starts", () => {
    assert.equal(
      resolveTalkState("running", false, true, false, false, "working"),
      "working",
    );
  });

  it("returns idle when the session is live but the turn is not busy", () => {
    assert.equal(
      resolveTalkState("running", false, false, false, false, "thinking"),
      "idle",
    );
  });
});
