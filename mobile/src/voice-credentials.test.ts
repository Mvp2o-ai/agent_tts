import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CredentialEntry } from "./credential-vault";
import {
  findVoiceCredential,
  hasRequiredVoiceKeys,
  requireVoiceCredential,
  requireVoiceSecrets,
  resolveVoiceCredential,
  saveVoiceSecrets,
  saveVoiceKeys,
  type VoiceCredentialVault,
} from "./voice-credentials";

describe("app-level voice credentials", () => {
  it("selects the latest saved key for a vendor", () => {
    const entries: CredentialEntry[] = [
      {
        id: "deepgram-old",
        kind: "voice-key",
        providerId: "deepgram",
        label: "Deepgram voice key",
      },
      {
        id: "eleven-1",
        kind: "voice-key",
        providerId: "elevenlabs",
        label: "ElevenLabs voice key",
      },
      {
        id: "deepgram-new",
        kind: "voice-key",
        providerId: "deepgram",
        label: "Deepgram voice key",
      },
    ];
    assert.equal(findVoiceCredential(entries, "deepgram")?.id, "deepgram-new");
    assert.equal(hasRequiredVoiceKeys(entries), true);
    assert.equal(hasRequiredVoiceKeys(entries.slice(0, 1)), false);
  });

  it("reuses a selected secure credential without creating a duplicate", async () => {
    let saves = 0;
    const vault: VoiceCredentialVault = {
      list: async () => [
        {
          id: "deepgram-1",
          kind: "voice-key",
          providerId: "deepgram",
          label: "Deepgram voice key",
        },
      ],
      getSecret: async (id) => (id === "deepgram-1" ? "dg-secret" : null),
      save: async () => {
        saves += 1;
        throw new Error("must not save");
      },
    };

    assert.deepEqual(
      await resolveVoiceCredential(vault, {
        credentialId: "deepgram-1",
        providerId: "deepgram",
        keyEnv: "DEEPGRAM_API_KEY",
        label: "Deepgram voice key",
      }),
      { entryId: "deepgram-1", secret: "dg-secret" },
    );
    assert.equal(saves, 0);
  });

  it("stores a new key with provider metadata for later launches", async () => {
    let saved:
      | {
          id?: string;
          kind: "voice-key";
          label: string;
          keyEnv: string;
          providerId: string;
          secret: string;
        }
      | undefined;
    const vault: VoiceCredentialVault = {
      list: async () => [],
      getSecret: async () => null,
      save: async (input): Promise<CredentialEntry> => {
        saved = input;
        return { ...input, id: input.id ?? "eleven-1" };
      },
    };

    assert.deepEqual(
      await resolveVoiceCredential(vault, {
        secret: "  eleven-secret  ",
        providerId: "elevenlabs",
        keyEnv: "ELEVENLABS_API_KEY",
        label: "ElevenLabs voice key",
      }),
      { entryId: "eleven-1", secret: "eleven-secret" },
    );
    assert.deepEqual(saved, {
      id: undefined,
      kind: "voice-key",
      label: "ElevenLabs voice key",
      keyEnv: "ELEVENLABS_API_KEY",
      providerId: "elevenlabs",
      secret: "eleven-secret",
    });
  });

  it("replaces the existing app-level key instead of accumulating extras", async () => {
    let savedId: string | undefined;
    const vault: VoiceCredentialVault = {
      list: async () => [
        {
          id: "deepgram-1",
          kind: "voice-key",
          providerId: "deepgram",
          label: "Deepgram voice key",
        },
      ],
      getSecret: async () => "old",
      save: async (input): Promise<CredentialEntry> => {
        savedId = input.id;
        return { id: input.id ?? "new", ...input };
      },
    };

    await resolveVoiceCredential(vault, {
      secret: "rotated",
      providerId: "deepgram",
      keyEnv: "DEEPGRAM_API_KEY",
      label: "Deepgram voice key",
    });
    assert.equal(savedId, "deepgram-1");
  });

  it("saves only the missing voice prerequisite supplied in setup", async () => {
    const savedProviders: string[] = [];
    const vault: VoiceCredentialVault = {
      list: async () => [],
      getSecret: async () => null,
      save: async (input): Promise<CredentialEntry> => {
        savedProviders.push(input.providerId);
        return { ...input, id: input.providerId };
      },
    };

    await saveVoiceKeys(vault, {
      deepgram: "",
      elevenLabs: "eleven-secret",
    });
    assert.deepEqual(savedProviders, ["elevenlabs"]);
  });

  it("saves generic provider secrets and rejects an empty input", async () => {
    const savedProviders: string[] = [];
    const vault: VoiceCredentialVault = {
      list: async () => [],
      getSecret: async () => null,
      save: async (input): Promise<CredentialEntry> => {
        savedProviders.push(input.providerId);
        return { ...input, id: input.providerId };
      },
    };

    await saveVoiceSecrets(vault, [
      { providerId: "deepgram", secret: "  dg-secret  " },
      { providerId: "elevenlabs", secret: " " },
    ]);
    assert.deepEqual(savedProviders, ["deepgram"]);
    await assert.rejects(
      () => saveVoiceSecrets(vault, [{ providerId: "deepgram", secret: " " }]),
      /at least one/,
    );
  });

  it("requires a saved Settings key when launching", async () => {
    const empty: VoiceCredentialVault = {
      list: async () => [],
      getSecret: async () => null,
      save: async () => {
        throw new Error("must not save");
      },
    };
    await assert.rejects(
      () => requireVoiceCredential(empty, "deepgram"),
      /Settings first/,
    );

    const vault: VoiceCredentialVault = {
      list: async () => [
        {
          id: "deepgram-1",
          kind: "voice-key",
          providerId: "deepgram",
          label: "Deepgram voice key",
        },
      ],
      getSecret: async () => "dg-secret",
      save: async () => {
        throw new Error("must not save");
      },
    };
    assert.deepEqual(await requireVoiceCredential(vault, "deepgram"), {
      entryId: "deepgram-1",
      secret: "dg-secret",
    });
  });

  it("returns environment-keyed secrets and credential IDs for a provider pair", async () => {
    const vault: VoiceCredentialVault = {
      list: async () => [
        {
          id: "deepgram-1",
          kind: "voice-key",
          providerId: "deepgram",
          keyEnv: "DEEPGRAM_API_KEY",
          label: "Deepgram API key",
        },
        {
          id: "elevenlabs-1",
          kind: "voice-key",
          providerId: "elevenlabs",
          keyEnv: "ELEVENLABS_API_KEY",
          label: "ElevenLabs API key",
        },
      ],
      getSecret: async (id) =>
        id === "deepgram-1"
          ? "dg-secret"
          : id === "elevenlabs-1"
            ? "eleven-secret"
            : null,
      save: async () => {
        throw new Error("must not save");
      },
    };

    assert.deepEqual(
      await requireVoiceSecrets(vault, "deepgram", "elevenlabs"),
      {
        secrets: {
          DEEPGRAM_API_KEY: "dg-secret",
          ELEVENLABS_API_KEY: "eleven-secret",
        },
        credentialIds: {
          DEEPGRAM_API_KEY: "deepgram-1",
          ELEVENLABS_API_KEY: "elevenlabs-1",
        },
      },
    );
  });

  it("rejects a selected credential belonging to another provider", async () => {
    const vault: VoiceCredentialVault = {
      list: async () => [
        {
          id: "voice-1",
          kind: "voice-key",
          providerId: "elevenlabs",
          label: "ElevenLabs voice key",
        },
      ],
      getSecret: async () => "secret",
      save: async () => {
        throw new Error("must not save");
      },
    };

    await assert.rejects(
      () =>
        resolveVoiceCredential(vault, {
          credentialId: "voice-1",
          providerId: "deepgram",
          keyEnv: "DEEPGRAM_API_KEY",
          label: "Deepgram voice key",
        }),
      /unavailable/,
    );
  });
});
