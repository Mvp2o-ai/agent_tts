import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSttAdapter,
  DEFAULT_STT_PROVIDER_ID,
  DEFAULT_TTS_PROVIDER_ID,
  registerSttAdapter,
  resolveVoiceProviderId,
  type SttAdapter,
} from "./voice-providers.js";

describe("voice provider registry", () => {
  it("resolves the built-in defaults", () => {
    assert.equal(resolveVoiceProviderId("stt"), DEFAULT_STT_PROVIDER_ID);
    assert.equal(resolveVoiceProviderId("tts"), DEFAULT_TTS_PROVIDER_ID);
    assert.equal(resolveVoiceProviderId("stt", ""), DEFAULT_STT_PROVIDER_ID);
    assert.equal(resolveVoiceProviderId("tts", "  "), DEFAULT_TTS_PROVIDER_ID);
  });

  it("throws for an unknown provider ID", () => {
    assert.throws(
      () => resolveVoiceProviderId("stt", "missing"),
      /Unknown stt voice provider: missing/,
    );
  });

  it("names a missing secret without exposing a secret value", () => {
    let error: unknown;
    try {
      createSttAdapter("deepgram", { DEEPGRAM_API_KEY: "" });
    } catch (err) {
      error = err;
    }
    assert.match(String(error), /DEEPGRAM_API_KEY/);
    assert.doesNotMatch(String(error), /secret-value/);
  });

  it("selects a registered fixture adapter", () => {
    const fixture: SttAdapter = {
      id: "fixture",
      open: () => ({
        sendPcm() {},
        finish() {},
        close() {},
      }),
    };
    const unregister = registerSttAdapter(
      "fixture",
      "Fixture",
      (secrets) => {
        assert.equal(secrets.FIXTURE_KEY, "x");
        return fixture;
      },
    );
    try {
      assert.equal(
        createSttAdapter("fixture", { FIXTURE_KEY: "x" }),
        fixture,
      );
    } finally {
      unregister();
    }
    assert.throws(() => createSttAdapter("fixture", {}), /Unknown stt/);
  });
});
