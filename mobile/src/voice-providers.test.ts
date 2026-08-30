import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_STT_PROVIDER_ID,
  DEFAULT_TTS_PROVIDER_ID,
  getVoiceProvider,
  hydrateVoiceProviderId,
  requiredSecretFields,
  requiredSecretFieldsFrom,
  resolveVoiceProviderId,
  voiceProviderEnvNames,
  type VoiceProviderManifest,
} from "./voice-providers";

describe("voice provider registry", () => {
  it("uses Deepgram and ElevenLabs as the defaults", () => {
    assert.equal(resolveVoiceProviderId("stt"), DEFAULT_STT_PROVIDER_ID);
    assert.equal(resolveVoiceProviderId("tts", ""), DEFAULT_TTS_PROVIDER_ID);
    assert.equal(
      getVoiceProvider("stt", DEFAULT_STT_PROVIDER_ID).label,
      "Deepgram",
    );
  });

  it("returns the default pair's unique required secret fields", () => {
    assert.deepEqual(
      requiredSecretFields(DEFAULT_STT_PROVIDER_ID, DEFAULT_TTS_PROVIDER_ID).map(
        (field) => field.env,
      ),
      ["DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY"],
    );
    assert.deepEqual(
      voiceProviderEnvNames(
        DEFAULT_STT_PROVIDER_ID,
        DEFAULT_TTS_PROVIDER_ID,
      ),
      ["DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY"],
    );
  });

  it("supports fixture manifests without changing production provider lists", () => {
    const fixture: VoiceProviderManifest = {
      id: "fixture-tts",
      role: "tts",
      label: "Fixture TTS",
      credentialFields: [
        {
          id: "token",
          label: "Fixture token",
          secret: true,
          env: "FIXTURE_TTS_TOKEN",
        },
      ],
    };
    assert.deepEqual(
      requiredSecretFieldsFrom([fixture]).map((field) => field.env),
      ["FIXTURE_TTS_TOKEN"],
    );
  });

  it("hydrates missing, blank, and unknown IDs to defaults", () => {
    assert.equal(
      hydrateVoiceProviderId("stt"),
      DEFAULT_STT_PROVIDER_ID,
    );
    assert.equal(
      hydrateVoiceProviderId("tts", " "),
      DEFAULT_TTS_PROVIDER_ID,
    );
    assert.equal(
      hydrateVoiceProviderId("stt", "removed-provider"),
      DEFAULT_STT_PROVIDER_ID,
    );
    assert.throws(
      () => resolveVoiceProviderId("tts", "removed-provider"),
      /Unknown TTS voice provider/,
    );
    assert.throws(
      () => getVoiceProvider("stt", "removed-provider"),
      /Unknown STT voice provider/,
    );
  });
});
