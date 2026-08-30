import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCredentialVault,
  type SecureCredentialStore,
} from "./credential-vault";

function memorySecureStore(): SecureCredentialStore & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    async getItemAsync(key) {
      return data.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      data.set(key, value);
    },
    async deleteItemAsync(key) {
      data.delete(key);
    },
  };
}

describe("credential vault", () => {
  it("stores labels in its index and secrets under separate secure keys", async () => {
    const secure = memorySecureStore();
    const vault = createCredentialVault(secure);
    const saved = await vault.save({
      kind: "git-pat",
      label: "github.com — ken",
      secret: "github_pat_secret",
    });

    assert.deepEqual(await vault.list(), [
      {
        id: saved.id,
        kind: "git-pat",
        label: "github.com — ken",
      },
    ]);
    assert.equal(await vault.getSecret(saved.id), "github_pat_secret");
    const serialized = [...secure.data.values()].join("\n");
    assert.match(serialized, /github\.com — ken/);
    assert.equal(
      JSON.parse(secure.data.get("agent_tts_credential_index_v1") ?? "[]")[0]
        .secret,
      undefined,
    );
  });

  it("stores provider, gateway, and voice credentials with metadata-only indexes", async () => {
    const secure = memorySecureStore();
    const vault = createCredentialVault(secure);
    const providerOAuth = await vault.save({
      kind: "provider-oauth",
      providerId: "railway",
      label: "",
      secret: "provider_oauth_secret",
    });
    const gatewayToken = await vault.save({
      kind: "gateway-token",
      label: "Personal gateway",
      secret: "gateway_token_secret",
    });
    const voiceKey = await vault.save({
      kind: "voice-key",
      providerId: "elevenlabs",
      keyEnv: "ELEVENLABS_API_KEY",
      label: "Voice production",
      secret: "voice_key_secret",
    });

    assert.deepEqual(await vault.list(), [
      {
        id: providerOAuth.id,
        kind: "provider-oauth",
        label: "railway OAuth",
        providerId: "railway",
      },
      {
        id: gatewayToken.id,
        kind: "gateway-token",
        label: "Personal gateway",
      },
      {
        id: voiceKey.id,
        kind: "voice-key",
        label: "Voice production",
        keyEnv: "ELEVENLABS_API_KEY",
        providerId: "elevenlabs",
      },
    ]);
    assert.equal(await vault.getSecret(providerOAuth.id), "provider_oauth_secret");
    assert.equal(await vault.getSecret(gatewayToken.id), "gateway_token_secret");
    assert.equal(await vault.getSecret(voiceKey.id), "voice_key_secret");

    const index = secure.data.get("agent_tts_credential_index_v1") ?? "";
    assert.equal(index.includes("provider_oauth_secret"), false);
    assert.equal(index.includes("gateway_token_secret"), false);
    assert.equal(index.includes("voice_key_secret"), false);
    assert.deepEqual(
      JSON.parse(index),
      await vault.list(),
    );
    assert.equal(
      secure.data.get(`agent_tts_credential_${providerOAuth.id}`),
      "provider_oauth_secret",
    );
    assert.equal(
      secure.data.get(`agent_tts_credential_${gatewayToken.id}`),
      "gateway_token_secret",
    );
    assert.equal(
      secure.data.get(`agent_tts_credential_${voiceKey.id}`),
      "voice_key_secret",
    );
  });

  it("keeps valid legacy entries and rejects malformed metadata", async () => {
    const secure = memorySecureStore();
    secure.data.set(
      "agent_tts_credential_index_v1",
      JSON.stringify([
        {
          id: "legacy-model",
          kind: "model-key",
          label: "Legacy model",
          keyEnv: "ANTHROPIC_API_KEY",
        },
        {
          id: "legacy-github",
          kind: "github-token",
          label: "Legacy GitHub",
        },
        { id: "missing-label", kind: "gateway-token" },
        {
          id: "bad-provider",
          kind: "provider-oauth",
          label: "Bad provider",
          providerId: 42,
        },
        {
          id: "bad-kind",
          kind: "unknown",
          label: "Bad kind",
        },
      ]),
    );

    const vault = createCredentialVault(secure);
    assert.deepEqual(await vault.list(), [
      {
        id: "legacy-model",
        kind: "model-key",
        label: "Legacy model",
        keyEnv: "ANTHROPIC_API_KEY",
      },
      {
        id: "legacy-github",
        kind: "github-token",
        label: "Legacy GitHub",
      },
    ]);
  });

  it("removes both metadata and secret material", async () => {
    const vault = createCredentialVault(memorySecureStore());
    const saved = await vault.save({
      kind: "model-key",
      keyEnv: "ANTHROPIC_API_KEY",
      label: "Claude personal",
      secret: "sk-ant-secret",
    });
    await vault.remove(saved.id);
    assert.deepEqual(await vault.list(), []);
    assert.equal(await vault.getSecret(saved.id), null);
  });

  it("keeps concurrent credential saves in the shared index", async () => {
    const vault = createCredentialVault(memorySecureStore());
    const saved = await Promise.all(
      ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"].map(
        (keyEnv) =>
          vault.save({
            kind: "model-key",
            keyEnv,
            label: keyEnv,
            secret: `${keyEnv}-secret`,
          }),
      ),
    );

    assert.deepEqual(
      (await vault.list()).map((entry) => entry.keyEnv),
      ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"],
    );
    for (const entry of saved) {
      assert.equal(
        await vault.getSecret(entry.id),
        `${entry.keyEnv}-secret`,
      );
    }
  });
});
