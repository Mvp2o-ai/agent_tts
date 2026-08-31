import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCredentialPaste,
  parseKeyValuePairs,
} from "./credential-paste";

describe("credential paste mapping", () => {
  it("does not trigger for a bare field value", () => {
    assert.deepEqual(
      applyCredentialPaste("sk-ordinary-value", {
        sttProviderId: "deepgram",
        ttsProviderId: "elevenlabs",
      }),
      { detected: false, assignments: [] },
    );
  });

  it("detects one KEY=value pair", () => {
    assert.deepEqual(parseKeyValuePairs("GEMINI_API_KEY=gem-secret"), [
      { name: "GEMINI_API_KEY", value: "gem-secret" },
    ]);
    const result = applyCredentialPaste("GEMINI_API_KEY=gem-secret", {
      sttProviderId: "deepgram",
      ttsProviderId: "elevenlabs",
    });
    assert.equal(result.detected, true);
    assert.deepEqual(result.assignments, [
      {
        kind: "model",
        keyEnv: "GEMINI_API_KEY",
        label: "Gemini CLI",
        secret: "gem-secret",
      },
    ]);
  });

  it("parses an env blob and routes conventional names", () => {
    const result = applyCredentialPaste(`
# comment
DEEPGRAM_API_KEY=dg-secret
export ELEVENLABS_API_KEY="el-secret"
ANTHROPIC_API_KEY='ant-secret'
CURSOR_API_KEY=cur-secret
GEMINI_API_KEY: gem-secret
OPENAI_API_KEY=oai-secret
`,
      { sttProviderId: "deepgram", ttsProviderId: "elevenlabs" },
    );

    const byLabel = Object.fromEntries(
      result.assignments.map((entry) => [entry.label, entry.secret]),
    );
    assert.equal(byLabel.Deepgram, "dg-secret");
    assert.equal(byLabel.ElevenLabs, "el-secret");
    assert.equal(byLabel["Claude Code"], "ant-secret");
    assert.equal(byLabel["Cursor CLI"], "cur-secret");
    assert.equal(byLabel["Gemini CLI"], "gem-secret");
    assert.equal(byLabel["Codex CLI"], "oai-secret");
  });

  it("maps obvious names from registry metadata", () => {
    const result = applyCredentialPaste(
      "claude_key=ant\nmy_gemini_token=gem\ncodex_secret=oai\neleven_labs=el",
      { sttProviderId: "deepgram", ttsProviderId: "elevenlabs" },
    );
    assert.deepEqual(
      Object.fromEntries(
        result.assignments.map((entry) => [entry.label, entry.secret]),
      ),
      {
        "Claude Code": "ant",
        "Gemini CLI": "gem",
        "Codex CLI": "oai",
        ElevenLabs: "el",
      },
    );
  });

  it("updates provider selections from provider pairs or keys", () => {
    const explicit = applyCredentialPaste(
      "STT_PROVIDER=deepgram\nTTS_PROVIDER=elevenlabs",
      { sttProviderId: "deepgram", ttsProviderId: "elevenlabs" },
    );
    assert.equal(explicit.sttProviderId, "deepgram");
    assert.equal(explicit.ttsProviderId, "elevenlabs");

    const inferred = applyCredentialPaste("DEEPGRAM_API_KEY=dg", {
      sttProviderId: "deepgram",
      ttsProviderId: "elevenlabs",
    });
    assert.equal(inferred.sttProviderId, "deepgram");
  });

  it("routes a .env paste flattened onto one line by a single-line input", () => {
    const result = applyCredentialPaste(
      "GATEWAY_TOKEN=tok AGENTBOX_IMAGE=img:local DEEPGRAM_API_KEY=dg ELEVENLABS_API_KEY=el ANTHROPIC_API_KEY=ant GEMINI_API_KEY=gem OPENAI_API_KEY=oai",
      { sttProviderId: "deepgram", ttsProviderId: "elevenlabs" },
    );
    assert.deepEqual(
      Object.fromEntries(
        result.assignments.map((entry) => [entry.label, entry.secret]),
      ),
      {
        Deepgram: "dg",
        ElevenLabs: "el",
        "Claude Code": "ant",
        "Gemini CLI": "gem",
        "Codex CLI": "oai",
      },
    );
  });

  it("silently leaves unmatched pairs without field assignments", () => {
    const result = applyCredentialPaste("SOMETHING_ELSE=value", {
      sttProviderId: "deepgram",
      ttsProviderId: "elevenlabs",
    });
    assert.equal(result.detected, true);
    assert.deepEqual(result.assignments, []);
  });
});
