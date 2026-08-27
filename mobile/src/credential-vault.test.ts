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
});
