import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AgentTurn,
  type ClientEvent,
  type OpenTts,
  type VoiceSink,
} from "./agent-turn.js";
import type { BoxConnection } from "./box-client.js";
import type { BoxInbound, BoxOutbound } from "./box-protocol.js";
import { defaultConfig } from "./config-schema.js";
import type { TtsStream } from "./elevenlabs.js";

class MemoryBox implements BoxConnection {
  sent: BoxInbound[] = [];
  closed = false;
  private readonly handlers = new Set<(msg: BoxOutbound) => void>();

  send(msg: BoxInbound): void {
    this.sent.push(msg);
  }

  onMessage(handler: (msg: BoxOutbound) => void): void {
    this.handlers.add(handler);
  }

  emit(msg: BoxOutbound): void {
    for (const h of this.handlers) h(msg);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  prompts(): Extract<BoxInbound, { type: "prompt" }>[] {
    return this.sent.filter(
      (m): m is Extract<BoxInbound, { type: "prompt" }> => m.type === "prompt",
    );
  }
}

function recordingTts(): {
  factory: OpenTts;
  texts: string[];
  finished: boolean;
  closed: boolean;
} {
  const texts: string[] = [];
  const state = { finished: false, closed: false };
  const factory: OpenTts = (opts) => {
    const stream: TtsStream = {
      pushText(text) {
        if (state.closed) return;
        texts.push(text);
        opts.onAudio(Buffer.from(text));
      },
      finish() {
        state.finished = true;
        opts.onEnd?.();
      },
      close() {
        state.closed = true;
      },
    };
    return stream;
  };
  return {
    factory,
    texts,
    get finished() {
      return state.finished;
    },
    get closed() {
      return state.closed;
    },
  };
}

function setup(openTts?: OpenTts) {
  const box = new MemoryBox();
  const events: ClientEvent[] = [];
  const audio: Buffer[] = [];
  let idleCount = 0;
  const sink: VoiceSink = {
    sendJson: (e) => events.push(e),
    sendAudio: (b) => audio.push(b),
  };
  const turn = new AgentTurn(box, sink, defaultConfig("u"), openTts ? "test-key" : undefined, {
    openTts,
    onIdle: () => {
      idleCount += 1;
    },
  });
  return { box, events, audio, turn, idle: () => idleCount };
}

function types(events: ClientEvent[]): string[] {
  return events.map((e) => e.type);
}

describe("AgentTurn", () => {
  it("runs two queued prompts once each and in order", async () => {
    const { box, events, turn } = setup();
    turn.enqueue("one");
    turn.enqueue("two");
    const [a, b] = box.prompts();
    assert.equal(box.prompts().length, 1);
    assert.equal(a.text, "one");
    assert.deepEqual(
      events.filter((e) => e.type === "queued").map((e) => e.type),
      ["queued"],
    );

    box.emit({ type: "chunk", promptId: a.id, text: "first" });
    box.emit({ type: "done", promptId: a.id });
    assert.equal(box.prompts().length, 2);
    assert.equal(box.prompts()[1].text, "two");
    assert.equal(b, undefined);

    const id2 = box.prompts()[1].id;
    box.emit({ type: "done", promptId: id2 });

    const starts = events.filter((e) => e.type === "prompt_start");
    const dones = events.filter((e) => e.type === "done");
    assert.deepEqual(
      starts.map((e) => (e.type === "prompt_start" ? e.text : "")),
      ["one", "two"],
    );
    assert.deepEqual(
      dones.map((e) => (e.type === "done" ? e.promptId : "")),
      [a.id, id2],
    );
    await turn.close();
  });

  it("emits one stopped, drops post-abort text/audio, and does not emit done", async () => {
    const tts = recordingTts();
    const { box, events, audio, turn } = setup(tts.factory);
    turn.enqueue("count");
    const id = box.prompts()[0].id;
    box.emit({ type: "chunk", promptId: id, text: "One. " });
    assert.equal(audio.length, 1);

    turn.abort("stop_word");
    turn.abort("stop_word");
    box.emit({ type: "chunk", promptId: id, text: "Two. " });
    box.emit({ type: "tool_event", promptId: id, summary: "tool" });
    box.emit({ type: "done", promptId: id });

    assert.deepEqual(
      types(events).filter((t) => t === "stopped"),
      ["stopped"],
    );
    assert.equal(events.some((e) => e.type === "done"), false);
    assert.equal(
      events.filter((e) => e.type === "agent_text").map((e) =>
        e.type === "agent_text" ? e.text : "",
      ).join(""),
      "One. ",
    );
    assert.equal(audio.length, 1);
    assert.equal(tts.closed, true);
    assert.equal(
      box.sent.filter((m) => m.type === "abort").length,
      1,
    );
    assert.equal(events.some((e) => e.type === "tts_end"), false);
    await turn.close();
  });

  it("pumps the next queued prompt after an abort settles", async () => {
    const { box, events, turn } = setup();
    turn.enqueue("first");
    turn.enqueue("second");
    const id1 = box.prompts()[0].id;
    turn.abort("user");
    box.emit({ type: "chunk", promptId: id1, text: "stale" });
    box.emit({ type: "aborted", promptId: id1 });

    assert.equal(
      events.some((e) => e.type === "done" && e.promptId === id1),
      false,
    );
    assert.equal(events.filter((e) => e.type === "agent_text").length, 0);
    assert.equal(box.prompts().length, 2);
    assert.equal(box.prompts()[1].text, "second");

    const id2 = box.prompts()[1].id;
    box.emit({ type: "done", promptId: id1 }); // stale terminal
    box.emit({ type: "chunk", promptId: id2, text: "ok" });
    box.emit({ type: "done", promptId: id2 });

    const dones = events.filter((e) => e.type === "done");
    assert.equal(dones.length, 1);
    assert.ok(dones[0].type === "done" && dones[0].promptId === id2);
    assert.deepEqual(
      events.filter((e) => e.type === "agent_text").map((e) =>
        e.type === "agent_text" ? e.text : "",
      ),
      ["ok"],
    );
    await turn.close();
  });

  it("barge-in stops playback only and still completes the coding turn", async () => {
    const tts = recordingTts();
    const { box, events, audio, turn } = setup(tts.factory);
    turn.enqueue("work");
    const id = box.prompts()[0].id;
    box.emit({ type: "chunk", promptId: id, text: "Hello world. " });
    const audioBefore = audio.length;
    assert.ok(audioBefore > 0);

    turn.bargeIn();
    turn.bargeIn();
    box.emit({ type: "chunk", promptId: id, text: "More text. " });
    box.emit({ type: "done", promptId: id });

    assert.equal(box.sent.some((m) => m.type === "abort"), false);
    assert.deepEqual(
      types(events).filter((t) => t === "barge_in"),
      ["barge_in"],
    );
    assert.equal(events.some((e) => e.type === "stopped"), false);
    assert.equal(events.some((e) => e.type === "done"), true);
    assert.deepEqual(
      events.filter((e) => e.type === "agent_text").map((e) =>
        e.type === "agent_text" ? e.text : "",
      ),
      ["Hello world. ", "More text. "],
    );
    assert.equal(audio.length, audioBefore);
    assert.equal(events.some((e) => e.type === "tts_start"), true);
    assert.equal(events.some((e) => e.type === "tts_end"), false);
    await turn.close();
  });

  it("ignores box messages after teardown", async () => {
    const { box, events, turn } = setup();
    turn.enqueue("x");
    const id = box.prompts()[0].id;
    await turn.close();
    box.emit({ type: "chunk", promptId: id, text: "late" });
    box.emit({ type: "done", promptId: id });
    assert.equal(
      events.filter((e) => e.type === "agent_text" || e.type === "done").length,
      0,
    );
    assert.equal(box.closed, true);
  });

  it("does not treat idle abort as a client event", async () => {
    const { box, events, turn } = setup();
    turn.abort("user");
    assert.equal(events.length, 0);
    assert.equal(box.sent.length, 0);
    await turn.close();
  });

  it("does not reuse a finished TTS stream and waits for it before prompt 2", async () => {
    type StreamRec = {
      id: number;
      texts: string[];
      finished: boolean;
      closed: boolean;
      onAudio: (pcm: Buffer) => void;
      onEnd: () => void;
    };
    const streams: StreamRec[] = [];
    let nextId = 0;
    const factory: OpenTts = (opts) => {
      const rec: StreamRec = {
        id: ++nextId,
        texts: [],
        finished: false,
        closed: false,
        onAudio: opts.onAudio,
        onEnd: () => opts.onEnd?.(),
      };
      streams.push(rec);
      return {
        pushText(text) {
          rec.texts.push(text);
          opts.onAudio(Buffer.from(`s${rec.id}:${text}`));
        },
        finish() {
          rec.finished = true;
        },
        close() {
          rec.closed = true;
        },
      };
    };

    const { box, events, audio, turn } = setup(factory);
    turn.enqueue("one");
    turn.enqueue("two");
    const id1 = box.prompts()[0].id;
    box.emit({ type: "chunk", promptId: id1, text: "First reply. " });
    box.emit({ type: "done", promptId: id1 });

    assert.equal(streams.length, 1);
    assert.equal(streams[0].finished, true);
    assert.equal(box.prompts().length, 1);
    assert.equal(
      events.filter((e) => e.type === "prompt_start").length,
      1,
    );
    const audioAfterFirst = audio.map((b) => b.toString());

    streams[0].onAudio(Buffer.from("late-s1"));
    assert.deepEqual(
      audio.map((b) => b.toString()),
      [...audioAfterFirst, "late-s1"],
    );

    streams[0].onEnd();
    assert.equal(box.prompts().length, 2);
    assert.equal(box.prompts()[1].text, "two");
    assert.notEqual(streams[0], streams[1]);

    const id2 = box.prompts()[1].id;
    box.emit({ type: "chunk", promptId: id2, text: "Second reply. " });
    assert.equal(streams.length, 2);
    assert.notEqual(streams[0].id, streams[1].id);
    assert.equal(turn.speaking, true);

    const audioBeforeLeak = audio.length;
    streams[0].onAudio(Buffer.from("stale-s1"));
    streams[0].onEnd();
    assert.equal(audio.length, audioBeforeLeak);
    assert.equal(turn.speaking, true);
    assert.equal(box.prompts().length, 2);

    box.emit({ type: "done", promptId: id2 });
    assert.equal(streams[1].finished, true);
    streams[1].onEnd();

    const starts = events.filter((e) => e.type === "prompt_start");
    const dones = events.filter((e) => e.type === "done");
    assert.deepEqual(
      starts.map((e) => (e.type === "prompt_start" ? e.text : "")),
      ["one", "two"],
    );
    assert.deepEqual(
      dones.map((e) => (e.type === "done" ? e.promptId : "")),
      [id1, id2],
    );
    assert.deepEqual(
      events.filter((e) => e.type === "tts_start" || e.type === "tts_end").map((e) => e.type),
      ["tts_start", "tts_end", "tts_start", "tts_end"],
    );
    assert.ok(audio.some((b) => b.toString().includes("s1:")));
    assert.ok(audio.some((b) => b.toString().includes("s2:")));
    assert.equal(audio.some((b) => b.toString() === "stale-s1"), false);
    await turn.close();
  });

  it("abort during TTS drain unblocks the queue without a second done", async () => {
    type Rec = { finish: () => void; onEnd: () => void };
    const recs: Rec[] = [];
    const factory: OpenTts = (opts) => {
      recs.push({
        finish() {
          /* wait for abort, not onEnd */
        },
        onEnd: () => opts.onEnd?.(),
      });
      return {
        pushText(text) {
          opts.onAudio(Buffer.from(text));
        },
        finish() {
          recs[recs.length - 1].finish();
        },
        close() {},
      };
    };
    const { box, events, turn } = setup(factory);
    turn.enqueue("one");
    turn.enqueue("two");
    const id1 = box.prompts()[0].id;
    box.emit({ type: "chunk", promptId: id1, text: "Hello world. " });
    box.emit({ type: "done", promptId: id1 });
    assert.equal(box.prompts().length, 1);

    turn.abort("user");
    assert.equal(
      events.filter((e) => e.type === "stopped").length,
      1,
    );
    assert.equal(box.prompts().length, 2);
    assert.equal(
      events.filter((e) => e.type === "done").length,
      1,
    );
    recs[0].onEnd();
    assert.equal(box.prompts().length, 2);
    assert.equal(events.some((e) => e.type === "tts_end"), false);
    await turn.close();
  });

  it("emits error without tts_end and unblocks a draining queue", async () => {
    let fail: ((err: Error) => void) | undefined;
    const factory: OpenTts = (opts) => {
      fail = opts.onError;
      return {
        pushText(text) {
          opts.onAudio(Buffer.from(text));
        },
        finish() {},
        close() {},
      };
    };
    const { box, events, turn } = setup(factory);
    turn.enqueue("one");
    turn.enqueue("two");
    const id1 = box.prompts()[0].id;
    box.emit({ type: "chunk", promptId: id1, text: "Hello world. " });
    box.emit({ type: "done", promptId: id1 });
    assert.equal(box.prompts().length, 1);
    fail?.(new Error("vendor down"));
    assert.equal(events.filter((e) => e.type === "error").length, 1);
    assert.equal(events.some((e) => e.type === "tts_end"), false);
    assert.equal(box.prompts().length, 2);
    await turn.close();
  });
});
