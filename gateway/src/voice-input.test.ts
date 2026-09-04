import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ClientEvent, VoiceSink } from "./agent-turn.js";
import {
  VoiceInput,
  joinContinuation,
  type TurnHandle,
  type VoiceInputOptions,
} from "./voice-input.js";

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

function setup(
  mode: "ptt" | "handsfree" = "handsfree",
  options: VoiceInputOptions = {},
) {
  const turn = new FakeTurn();
  const events: ClientEvent[] = [];
  const sink: VoiceSink = {
    sendJson: (e) => events.push(e),
    sendAudio: () => undefined,
  };
  const input = new VoiceInput(turn, mode, "hard stop", sink, options);
  return { turn, events, input };
}

/** Drives the continuation window without real time passing. */
function clocked(mode: "ptt" | "handsfree" = "handsfree", continuationMs = 2000) {
  let t = 0;
  const harness = setup(mode, { continuationMs, now: () => t });
  return { ...harness, advance: (ms: number) => { t += ms; } };
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
    input.onStt({ text: "", isFinal: true, utteranceEnd: true });
    assert.deepEqual(turn.aborts, ["stop_word"]);
    assert.deepEqual(turn.enqueued, ["list the files"]);
  });

  it("enqueues a later real prompt after a stop utterance", () => {
    const { turn, input } = setup();
    input.onStt({ text: "Hard stop.", isFinal: false });
    input.onStt({ text: "Hard stop.", isFinal: true });
    input.onStt({ text: "list the files", isFinal: true });
    input.onStt({ text: "", isFinal: true, utteranceEnd: true });
    assert.deepEqual(turn.enqueued, ["list the files"]);
    assert.equal(turn.aborts.length, 1);
  });

  it("commits a PTT utterance only after the STT flush ends", () => {
    const { turn, input } = setup("ptt");
    input.pttStart();
    input.onStt({ text: "hello repo", isFinal: true });
    assert.deepEqual(turn.enqueued, []);
    input.pttEnd();
    assert.deepEqual(turn.enqueued, []);
    input.sttEnd();
    assert.deepEqual(turn.enqueued, ["hello repo"]);
    input.onStt({ text: "hello repo", isFinal: true });
    input.sttEnd();
    assert.deepEqual(turn.enqueued, ["hello repo"]);
  });

  it("includes a late PTT final flushed after ptt_end", () => {
    const { turn, input } = setup("ptt");
    input.pttStart();
    input.pttEnd();
    input.onStt({ text: "late final", isFinal: true });
    input.sttEnd();
    assert.deepEqual(turn.enqueued, ["late final"]);
  });

  it("joins every finalized PTT segment from one button press", () => {
    const { turn, input } = setup("ptt");
    input.pttStart();
    input.onStt({ text: "one two three four five", isFinal: true });
    input.onStt({ text: "six seven eight nine ten", isFinal: true });
    input.pttEnd();
    input.sttEnd();
    assert.deepEqual(turn.enqueued, [
      "one two three four five six seven eight nine ten",
    ]);
  });

  it("waits for UtteranceEnd and joins hands-free final segments", () => {
    const { turn, input } = setup();
    input.onStt({ text: "test access", isFinal: true });
    input.onStt({ text: "to my Gmail", isFinal: true });
    assert.deepEqual(turn.enqueued, []);
    input.onStt({ text: "", isFinal: true, utteranceEnd: true });
    assert.deepEqual(turn.enqueued, ["test access to my Gmail"]);
  });

  it("enqueues the covering interim when finals are only the last slice", () => {
    const { turn, input } = setup();
    input.onStt({
      text: "check the logs when the containers start",
      isFinal: false,
    });
    input.onStt({ text: "when the containers start", isFinal: true });
    input.onStt({ text: "", isFinal: true, utteranceEnd: true });
    assert.deepEqual(turn.enqueued, [
      "check the logs when the containers start",
    ]);
  });

  it("barge-in from speech does not abort the turn", () => {
    const { turn, input } = setup();
    turn.speaking = true;
    input.onStt({ text: "", isFinal: false, speechStarted: true });
    input.onStt({ text: "and also", isFinal: false });
    input.onStt({ text: "and also queue this", isFinal: true });
    input.onStt({ text: "", isFinal: true, utteranceEnd: true });
    assert.equal(turn.aborts.length, 0);
    assert.ok(turn.barges >= 1);
    assert.deepEqual(turn.enqueued, ["and also queue this"]);
  });
});


describe("VoiceInput continuation window", () => {
  const FIRST = "messy at times. Some of the more complex,";
  const REST = "prompts are getting cut off.";

  it("merges speech resumed inside the window into one prompt", () => {
    const { turn, input, advance } = clocked();
    input.onStt({ text: "", isFinal: false, speechStarted: true });
    input.onStt({ text: FIRST, isFinal: true });
    input.onStt({ text: "", isFinal: true, utteranceEnd: true });
    assert.deepEqual(turn.enqueued, [FIRST]);

    advance(700);
    input.onStt({ text: "", isFinal: false, speechStarted: true });
    input.onStt({ text: REST, isFinal: true });
    input.onStt({ text: "", isFinal: true, utteranceEnd: true });

    assert.deepEqual(turn.enqueued, [FIRST, `${FIRST} ${REST}`]);
    assert.deepEqual(turn.aborts, ["user"]);
  });

  it("keeps a genuinely new prompt separate once the window lapses", () => {
    const { turn, input, advance } = clocked();
    input.onStt({ text: "", isFinal: false, speechStarted: true });
    input.onStt({ text: FIRST, isFinal: true });
    input.onStt({ text: "", isFinal: true, utteranceEnd: true });

    advance(9000);
    input.onStt({ text: "", isFinal: false, speechStarted: true });
    input.onStt({ text: "list the files", isFinal: true });
    input.onStt({ text: "", isFinal: true, utteranceEnd: true });

    assert.deepEqual(turn.enqueued, [FIRST, "list the files"]);
    assert.deepEqual(turn.aborts, []);
  });

  it("commits the next utterance even when SpeechStarted never arrives", () => {
    const { turn, input, advance } = clocked();
    input.onStt({ text: "", isFinal: false, speechStarted: true });
    input.onStt({ text: FIRST, isFinal: true });
    input.onStt({ text: "", isFinal: true, utteranceEnd: true });

    advance(9000); // lapsed window, so this is a new prompt, not a merge
    input.onStt({ text: "deploy the gateway", isFinal: true }); // no VAD event
    input.onStt({ text: "", isFinal: true, utteranceEnd: true });

    assert.deepEqual(turn.enqueued, [FIRST, "deploy the gateway"]);
  });

  it("does not merge a stop word into the aborted prompt", () => {
    const { turn, input, advance } = clocked();
    input.onStt({ text: "", isFinal: false, speechStarted: true });
    input.onStt({ text: FIRST, isFinal: true });
    input.onStt({ text: "", isFinal: true, utteranceEnd: true });

    advance(300);
    input.onStt({ text: "hard stop", isFinal: true });
    input.onStt({ text: "", isFinal: true, utteranceEnd: true });

    assert.deepEqual(turn.enqueued, [FIRST]);
    assert.ok(turn.aborts.includes("stop_word"));
  });

  it("leaves PTT untouched by the window", () => {
    const { turn, input, advance } = clocked("ptt");
    input.pttStart();
    input.onStt({ text: FIRST, isFinal: true });
    input.onStt({ text: "", isFinal: true, utteranceEnd: true });
    input.onStt({ text: REST, isFinal: true });
    input.pttEnd();
    advance(100);
    input.sttEnd();

    assert.deepEqual(turn.enqueued, [`${FIRST} ${REST}`]);
    assert.deepEqual(turn.aborts, []);
  });
});

describe("joinContinuation", () => {
  it("joins a fragment to its continuation", () => {
    assert.equal(joinContinuation("the first half", "and the rest"), "the first half and the rest");
  });

  it("does not duplicate when the continuation already covers the prefix", () => {
    assert.equal(joinContinuation("open the", "open the door"), "open the door");
  });

  it("tolerates an empty side", () => {
    assert.equal(joinContinuation("", "only this"), "only this");
    assert.equal(joinContinuation("only this", ""), "only this");
  });
});
