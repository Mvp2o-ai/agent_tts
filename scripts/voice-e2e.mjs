/**
 * Voice-loop E2E without a phone: synthesize speech with macOS `say`,
 * stream real 16 kHz PCM over the gateway's /v1/voice WebSocket exactly
 * like the mobile app, and assert STT → harness → TTS routing.
 *
 * Usage:
 *   node scripts/voice-e2e.mjs basic     "What is in this repository?"
 *   node scripts/voice-e2e.mjs stopword
 *   node scripts/voice-e2e.mjs queue
 *
 * Env: GATEWAY_URL (default http://127.0.0.1:4100), GATEWAY_TOKEN.
 * Never logs tokens, URLs with query strings, or .env contents.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const GATEWAY = process.env.GATEWAY_URL ?? "http://127.0.0.1:4100";
const TOKEN = process.env.GATEWAY_TOKEN ?? "local-e2e-token";
const scenario = process.argv[2] ?? "basic";
const promptText =
  process.argv[3] ?? "In one short sentence, what is in this repository?";

const SILENCE = Buffer.alloc(16000 * 2 * 2); // 2s of 16k mono s16le silence

function redact(value) {
  return String(value)
    .replace(/token=[^&\s"']+/gi, "token=REDACTED")
    .replace(/Bearer\s+\S+/gi, "Bearer REDACTED")
    .replace(/xi_api_key":\s*"[^"]*"/gi, 'xi_api_key":"REDACTED"');
}

function synth(text) {
  const dir = mkdtempSync(join(tmpdir(), "agent-tts-voice-"));
  const aiff = join(dir, "utt.aiff");
  const raw = join(dir, "utt.raw");
  execFileSync("say", ["-o", aiff, text]);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-i", aiff,
    "-ar", "16000", "-ac", "1", "-f", "s16le", raw,
  ]);
  return Buffer.concat([readFileSync(raw), SILENCE]);
}

function connect(mode) {
  const url = new URL("/v1/voice", GATEWAY.replace(/^http/, "ws"));
  url.searchParams.set("userId", "default");
  url.searchParams.set("mode", mode);
  const ws = new WebSocket(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  ws.binaryType = "arraybuffer";
  return ws;
}

async function streamPcm(ws, pcm) {
  const CHUNK = 8000;
  for (let off = 0; off < pcm.length; off += CHUNK) {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(pcm.subarray(off, off + CHUNK));
    await sleep(240);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function asBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  return Buffer.from(String(data));
}

function summarize(events) {
  return events
    .map((e) => {
      const extra =
        e.type === "prompt_start" ? e.promptId
        : e.type === "done" ? e.promptId
        : e.type === "stopped" ? e.reason
        : e.type === "transcript" ? (e.isFinal ? "final" : "interim")
        : "";
      return extra ? `${e.type}:${extra}` : e.type;
    })
    .join(",");
}

function run(mode, driver, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const events = [];
    let audioBytes = 0;
    const ws = connect(mode);
    const t0 = Date.now();
    let settled = false;

    const timer = setTimeout(() => {
      finish(new Error(`timeout; events: ${summarize(events)}`));
    }, timeoutMs);

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      if (err) reject(new Error(redact(err.message ?? err)));
      else resolve({ events, audioBytes });
    };

    const ctx = {
      ws,
      finish,
      events,
      audioBytes: () => audioBytes,
    };

    function assertReady(msg) {
      const fmt = msg.audioFormat;
      if (
        !fmt ||
        fmt.encoding !== "pcm_s16le" ||
        fmt.sampleRate !== 24000 ||
        fmt.channels !== 1
      ) {
        finish(new Error(`unexpected audioFormat ${JSON.stringify(fmt)}`));
      }
    }

    ws.on("message", (data, isBinary) => {
      const buf = asBuffer(data);
      if (isBinary) {
        audioBytes += buf.length;
        return;
      }
      const text = buf.toString("utf8");
      if (!text.startsWith("{")) {
        audioBytes += buf.length;
        return;
      }
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        audioBytes += buf.length;
        return;
      }
      const t = ((Date.now() - t0) / 1000).toFixed(1);
      events.push({ t, ...msg });
      console.log(`[${t}s]`, redact(JSON.stringify(msg)).slice(0, 220));
      if (msg.type === "ready") assertReady(msg);
      driver.onEvent?.(msg, ctx);
    });
    ws.on("open", () => driver.onOpen?.(ctx));
    ws.on("error", (err) => finish(err));
  });
}

function afterIndex(events, pred) {
  const i = events.findIndex(pred);
  return i < 0 ? [] : events.slice(i + 1);
}

const scenarios = {
  async basic() {
    const pcm = synth(promptText);
    const result = await run("handsfree", {
      onOpen: ({ ws }) => void streamPcm(ws, pcm),
      onEvent: (msg, { finish, audioBytes }) => {
        if (msg.type === "error") finish(new Error(msg.message));
        if (msg.type !== "tts_end") return;
        const n = audioBytes();
        if (n === 0) finish(new Error("tts_end with no PCM"));
        else if (n % 2 !== 0) finish(new Error(`odd PCM byte length ${n}`));
        else finish();
      },
    });
    const finals = result.events.filter((e) => e.type === "transcript" && e.isFinal);
    const agent = result.events.filter((e) => e.type === "agent_text");
    const ready = result.events.find((e) => e.type === "ready");
    const tts = result.events.filter((e) => e.type === "tts_start" || e.type === "tts_end");
    console.log("\n== BASIC RESULT ==");
    console.log("heard:", finals.map((e) => e.text).join(" | "));
    console.log("agent said:", agent.map((e) => e.text).join(""));
    console.log("audioFormat:", JSON.stringify(ready?.audioFormat));
    console.log("tts pcm bytes:", result.audioBytes, "even:", result.audioBytes % 2 === 0);
    console.log("tts events:", tts.map((e) => e.type).join(","));
    if (!finals.length) throw new Error("no final transcript");
    if (!agent.length) throw new Error("no agent text");
    if (result.audioBytes === 0 || result.audioBytes % 2 !== 0) {
      throw new Error(`expected even PCM bytes, got ${result.audioBytes}`);
    }
    if (tts.length < 2 || tts[0].type !== "tts_start" || tts[tts.length - 1].type !== "tts_end") {
      throw new Error(`expected tts_start before tts_end, got ${tts.map((e) => e.type)}`);
    }
  },

  async stopword() {
    const task = synth(
      "Please count slowly from one to thirty, saying each number in a separate sentence.",
    );
    const stop = synth("hard stop");
    let stopSent = false;
    let observing = false;
    const result = await run("handsfree", {
      onOpen: ({ ws }) => void streamPcm(ws, task),
      onEvent: (msg, { ws, finish, events, audioBytes }) => {
        if (msg.type === "error") finish(new Error(msg.message));
        const turnLive =
          msg.type === "agent_text" ||
          msg.type === "tool_event" ||
          msg.type === "tts_start";
        if (turnLive && !stopSent) {
          stopSent = true;
          void streamPcm(ws, stop);
        }
        if (msg.type === "stopped" && !observing) {
          if (msg.reason !== "stop_word") {
            finish(new Error(`stopped with reason ${msg.reason}`));
            return;
          }
          observing = true;
          // Wait long enough that a racing second `stopped` or `done` from
          // the aborted turn would have arrived. Silence is the assertion.
          const snapshot = events.length;
          const audioAtStop = audioBytes();
          const started = Date.now();
          const poll = () => {
            const extra = events.slice(snapshot);
            const leak = extra.find(
              (e) =>
                e.type === "stopped" ||
                e.type === "done" ||
                e.type === "agent_text" ||
                e.type === "tts_start" ||
                e.type === "tts_end" ||
                e.type === "prompt_start",
            );
            if (leak) {
              finish(
                new Error(
                  `post-stop leak ${leak.type}; after=${summarize(extra)}`,
                ),
              );
              return;
            }
            if (Date.now() - started > 8000) {
              const grown = audioBytes() - audioAtStop;
              if (grown > 8192) {
                finish(new Error(`TTS kept streaming after stop (${grown} bytes)`));
                return;
              }
              finish();
            } else setTimeout(poll, 150);
          };
          setTimeout(poll, 150);
        }
      },
    });
    console.log("\n== STOPWORD RESULT ==");
    const stopped = result.events.filter((e) => e.type === "stopped");
    console.log("stopped count:", stopped.length, "reason:", stopped[0]?.reason);
    if (stopped.length !== 1) {
      throw new Error(`expected 1 stopped, got ${stopped.length}`);
    }
    const firstStopAt = result.events.findIndex((e) => e.type === "stopped");
    const aborted = [...result.events]
      .slice(0, firstStopAt)
      .reverse()
      .find((e) => e.type === "prompt_start");
    const after = afterIndex(result.events, (e) => e.type === "stopped");
    if (after.some((e) => e.type === "stopped")) {
      throw new Error("duplicate stopped");
    }
    if (
      aborted &&
      after.some((e) => e.type === "done" && e.promptId === aborted.promptId)
    ) {
      throw new Error("done emitted for aborted turn");
    }
    if (after.some((e) => e.type === "agent_text")) {
      throw new Error("agent_text after stopped");
    }
    if (after.some((e) => e.type === "tts_end")) {
      throw new Error("stale tts_end after stopped");
    }
  },

  async queue() {
    const a = synth("How many files are in this repository?");
    const b = synth("What is the name of the default branch?");
    let sentSecond = false;
    let finishing = false;
    const result = await run("handsfree", {
      onOpen: ({ ws }) => void streamPcm(ws, a),
      onEvent: (msg, { ws, finish, events }) => {
        if (msg.type === "error") finish(new Error(msg.message));
        if (msg.type === "prompt_start" && !sentSecond) {
          sentSecond = true;
          void streamPcm(ws, b);
        }
        const starts = events.filter((e) => e.type === "prompt_start");
        const dones = events.filter((e) => e.type === "done");
        const ends = events.filter((e) => e.type === "tts_end");
        const ids = new Set(starts.map((e) => e.promptId));
        if (ids.size === 2 && dones.length >= 2 && ends.length >= 2) {
          const doneIds = dones.map((e) => e.promptId);
          if (
            !finishing &&
            doneIds[0] === starts[0].promptId &&
            doneIds[1] === starts[1].promptId
          ) {
            finishing = true;
            finish();
          }
        }
      },
    });
    console.log("\n== QUEUE RESULT ==");
    const queued = result.events.filter((e) => e.type === "queued");
    const prompts = result.events.filter((e) => e.type === "prompt_start");
    const dones = result.events.filter((e) => e.type === "done");
    console.log(
      "queued events:",
      queued.length,
      "prompts run:",
      prompts.length,
      "dones:",
      dones.length,
    );
    if (prompts.length !== 2) throw new Error(`expected 2 prompt_start, got ${prompts.length}`);
    if (new Set(prompts.map((e) => e.promptId)).size !== 2) {
      throw new Error("prompt_start ids were not unique");
    }
    if (dones.length < 2) throw new Error("expected 2 done events");
    if (
      dones[0].promptId !== prompts[0].promptId ||
      dones[1].promptId !== prompts[1].promptId
    ) {
      throw new Error("prompts did not complete in enqueue order");
    }
    if (queued.length < 1) throw new Error("expected a queued event for the second utterance");
    const ttsKinds = result.events
      .filter((e) => e.type === "tts_start" || e.type === "tts_end")
      .map((e) => e.type);
    const startIdx = result.events
      .map((e, i) => (e.type === "prompt_start" ? i : -1))
      .filter((i) => i >= 0);
    const windowKinds = (from, to) =>
      result.events.slice(from, to).filter((e) => e.type === "tts_start" || e.type === "tts_end").map((e) => e.type);
    const w1 = windowKinds(startIdx[0], startIdx[1]);
    const w2 = windowKinds(startIdx[1], result.events.length);
    console.log(
      "tts events:",
      ttsKinds.join(","),
      "windows:",
      w1.join(">"),
      w2.join(">"),
      "pcm bytes:",
      result.audioBytes,
    );
    if (result.audioBytes === 0 || result.audioBytes % 2 !== 0) {
      throw new Error(`expected even PCM bytes, got ${result.audioBytes}`);
    }
    if (w1[0] !== "tts_start" || !w1.includes("tts_end") || w2[0] !== "tts_start" || !w2.includes("tts_end")) {
      throw new Error(`expected tts_start then tts_end in each prompt window (w1=${w1} w2=${w2})`);
    }
  },
};

const fn = scenarios[scenario];
if (!fn) {
  console.error(`unknown scenario: ${scenario}`);
  process.exit(1);
}
fn().then(
  () => {
    console.log(`\nPASS ${scenario}`);
    process.exit(0);
  },
  (err) => {
    console.error(`\nFAIL ${scenario}:`, redact(err.message));
    process.exit(1);
  },
);
