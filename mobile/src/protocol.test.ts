import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyIncomingFrame,
  connectionError,
  gatewayAuthHeaders,
  healthUrl,
  httpToWs,
  killSessionUrl,
  modelCatalogUrl,
  nextReconnectDelay,
  probeGatewayHealth,
  validateReadyAudioFormat,
  voiceUrl,
  wsCloseMessage,
} from "./protocol";

describe("protocol", () => {
  it("maps http(s) gateway URLs onto ws(s) voice URLs", () => {
    assert.equal(httpToWs("https://gw.example:443/"), "wss://gw.example:443");
    const url = voiceUrl(
      {
        gatewayUrl: "http://10.0.0.12:8787/",
        token: "secret",
        userId: "ken",
      },
      "ptt",
    );
    assert.match(url, /^ws:\/\/10\.0\.0\.12:8787\/v1\/voice\?/);
    assert.match(url, /mode=ptt/);
    assert.match(url, /userId=ken/);
    assert.match(url, /focused=true/);
    assert.equal(url.includes("secret"), false);
    assert.doesNotMatch(url, /token=/);
    assert.deepEqual(gatewayAuthHeaders("secret"), {
      Authorization: "Bearer secret",
    });
    const backgroundUrl = voiceUrl(
      {
        gatewayUrl: "https://gw.example",
        token: "t",
        userId: "ken",
      },
      "handsfree",
      { focused: false, afterEventId: 23 },
    );
    assert.match(backgroundUrl, /focused=false/);
    assert.match(backgroundUrl, /afterEventId=23/);
    assert.equal(
      killSessionUrl({
        gatewayUrl: "https://gw.example",
        token: "t",
        userId: "ken",
      }),
      "https://gw.example/v1/session/kill?userId=ken",
    );
    assert.equal(
      modelCatalogUrl("https://gw.example/", "claude-code"),
      "https://gw.example/v1/model-catalog?harness=claude-code",
    );
  });

  it("rejects incomplete connection fields", () => {
    assert.ok(connectionError({ gatewayUrl: "http://", token: "t", userId: "u" }));
    assert.ok(
      connectionError({ gatewayUrl: "http://10.0.0.1:8787", token: "", userId: "u" }),
    );
    assert.equal(
      connectionError({
        gatewayUrl: "http://10.0.0.1:8787",
        token: "t",
        userId: "u",
      }),
      null,
    );
  });

  it("classifies a missing deployment before opening its voice socket", async () => {
    assert.equal(
      healthUrl("https://agent.example/"),
      "https://agent.example/health",
    );
    assert.deepEqual(
      await probeGatewayHealth(
        "https://agent.example",
        async () => new Response(null, { status: 404 }),
      ),
      {
        status: "missing",
        message: "Deployment no longer exists.",
      },
    );
    assert.deepEqual(
      await probeGatewayHealth(
        "https://agent.example",
        async () => new Response(null, { status: 503 }),
      ),
      {
        status: "unreachable",
        message: "Gateway unavailable (503).",
      },
    );
  });

  it("rejects missing or incompatible ready.audioFormat", () => {
    assert.match(validateReadyAudioFormat(undefined) ?? "", /missing audioFormat/);
    assert.match(
      validateReadyAudioFormat({ encoding: "mp3", sampleRate: 24000, channels: 1 }) ??
        "",
      /mp3/,
    );
    assert.match(
      validateReadyAudioFormat({
        encoding: "pcm_s16le",
        sampleRate: 16000,
        channels: 1,
      }) ?? "",
      /16000/,
    );
    assert.equal(
      validateReadyAudioFormat({
        encoding: "pcm_s16le",
        sampleRate: 24000,
        channels: 1,
      }),
      null,
    );
  });

  it("classifies JSON strings and binary PCM vs JSON-looking buffers", () => {
    const json = classifyIncomingFrame('{"type":"ready"}');
    assert.equal(json.kind, "json");
    if (json.kind === "json") assert.match(json.text, /ready/);

    const mp3 = classifyIncomingFrame(Uint8Array.from([0xff, 0xfb, 0x90, 0x00]));
    assert.equal(mp3.kind, "audio");

    const asBinaryJson = classifyIncomingFrame(
      new TextEncoder().encode('{"type":"barge_in"}').buffer,
    );
    assert.equal(asBinaryJson.kind, "json");
  });

  it("does not reconnect after a user close or fatal gateway close", () => {
    assert.equal(
      nextReconnectDelay({ userClosed: true, attempt: 0, closeCode: 1006 }),
      null,
    );
    assert.equal(
      nextReconnectDelay({ userClosed: false, attempt: 0, closeCode: 4401 }),
      null,
    );
    assert.equal(
      nextReconnectDelay({ userClosed: false, attempt: 0, closeCode: 1006 }),
      1000,
    );
    assert.equal(
      nextReconnectDelay({ userClosed: false, attempt: 8, closeCode: 1006 }),
      null,
    );
  });

  it("maps gateway close codes to operator-facing text without leaking tokens", () => {
    assert.match(wsCloseMessage(4401, ""), /unauthorized/);
    assert.match(wsCloseMessage(4400, ""), /bad request/);
    assert.equal(wsCloseMessage(1000, "bye"), "bye");
  });
});
