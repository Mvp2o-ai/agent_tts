import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ClientEvent, VoiceSink } from "./agent-turn.js";
import { VoiceInput, type TurnHandle } from "./voice-input.js";

class FakeTurn implements TurnHandle {
  speaking = false;
  enqueued: string[] = [];
  aborts: Array<"stop_word" | "user"> = [];
  barges = 0;

  enqueue(text: string): void {
    this.enqueued.push(text);
  }

  abort(reason: "stop_word" | "user"): void {
    this.aborts.push(reason);
    this.speaking = false;
  }

  bargeIn(): void {
    this.barges += 1;
    this.speaking = false;
  }
}

function setup(mode: "ptt" | "handsfree" = "handsfree") {
  const turn = new FakeTurn();
  const events: ClientEvent[] = [];
  const sink: VoiceSink = {
    sendJson: (e) => events.push(e),
    sendAudio: () => undefined,
  };
  const input = new VoiceInput(turn, mode, "hard stop", sink);
  return { turn, events, input };
}

describe("VoiceInput", () => {
  it("fires one stop action for duplicate interim/final stop transcripts", () => {
    const { turn, input } = setup();
    turn.speaking = true;
    input.onStt({ text: "Hard stop.", isFinal: false });
    input.onStt({ text: "Hard stop.", isFinal: true });
    assert.deepEqual(turn.aborts, ["stop_word"]);
    assert.deepEqual(turn.enqueued, []);
  });

  it("does not enqueue the stop utterance after abort", () => {
    const { turn, input } = setup();
    input.onStt({ text: "Hard stop.", isFinal: true });
    assert.deepEqual(turn.aborts, ["stop_word"]);
    assert.deepEqual(turn.enqueued, []);
  });

  it("does not enqueue a corrected final after a stop interim", () => {
    const { turn, input } = setup();
    input.onStt({ text: "Hard stop.", isFinal: false });
    input.onStt({ text: "Hard.", isFinal: true });
    input.onStt({ text: "list the files", isFinal: true });
    assert.deepEqual(turn.aborts, ["stop_word"]);
    assert.deepEqual(turn.enqueued, ["list the files"]);
  });

  it("enqueues a later real prompt after a stop utterance", () => {
    const { turn, input } = setup();
    input.onStt({ text: "Hard stop.", isFinal: false });
    input.onStt({ text: "Hard stop.", isFinal: true });
    input.onStt({ text: "list the files", isFinal: true });
    assert.deepEqual(turn.enqueued, ["list the files"]);
    assert.equal(turn.aborts.length, 1);
  });

  it("commits a PTT utterance once despite a late final", () => {
    const { turn, input } = setup("ptt");
    input.pttStart();
    input.onStt({ text: "hello repo", isFinal: true });
    assert.deepEqual(turn.enqueued, []);
    input.pttEnd();
    assert.deepEqual(turn.enqueued, ["hello repo"]);
    input.onStt({ text: "hello repo", isFinal: true });
    assert.deepEqual(turn.enqueued, ["hello repo"]);
  });

  it("enqueues a late PTT final if none was ready at ptt_end", () => {
    const { turn, input } = setup("ptt");
    input.pttStart();
    input.pttEnd();
    input.onStt({ text: "late final", isFinal: true });
    assert.deepEqual(turn.enqueued, ["late final"]);
  });

  it("does not double-commit hands-free finals via utteranceEnd", () => {
    const { turn, input } = setup();
    input.onStt({ text: "hello", isFinal: true });
    input.onStt({ text: "", isFinal: true, utteranceEnd: true });
    assert.deepEqual(turn.enqueued, ["hello"]);
  });

  it("barge-in from speech does not abort the turn", () => {
    const { turn, input } = setup();
    turn.speaking = true;
    input.onStt({ text: "", isFinal: false, speechStarted: true });
    input.onStt({ text: "and also", isFinal: false });
    input.onStt({ text: "and also queue this", isFinal: true });
    assert.equal(turn.aborts.length, 0);
    assert.ok(turn.barges >= 1);
    assert.deepEqual(turn.enqueued, ["and also queue this"]);
  });
});
