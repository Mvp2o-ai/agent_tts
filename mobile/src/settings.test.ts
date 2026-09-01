import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeAgent,
  createSettingsStore,
  DEFAULT_DEVICE_SETTINGS,
  memoryKeyValueStore,
  parseDeviceSettings,
  resolveAgentRuntimeSettings,
  serializeDeviceSettings,
  updateAgentHarness,
  withHarness,
} from "./settings";

describe("device settings", () => {
  it("hydrates omitted voice provider IDs to the built-in defaults", () => {
    const parsed = parseDeviceSettings(
      JSON.stringify({
        agents: [
          {
            id: "agent-1",
            name: "Agent 1",
            gatewayUrl: "http://example",
            token: "token",
          },
        ],
      }),
    );
    assert.equal(parsed.sttProviderId, "deepgram");
    assert.equal(parsed.ttsProviderId, "elevenlabs");
  });

  it("persists selected voice provider IDs with device settings", () => {
    const settings = {
      ...DEFAULT_DEVICE_SETTINGS,
      sttProviderId: "deepgram",
      ttsProviderId: "elevenlabs",
    };
    const serialized = JSON.parse(
      serializeDeviceSettings(settings),
    ) as Record<string, unknown>;
    assert.equal(serialized.sttProviderId, "deepgram");
    assert.equal(serialized.ttsProviderId, "elevenlabs");
  });

  it("round-trips credential references without persisting raw secrets", () => {
    const settings = {
      ...DEFAULT_DEVICE_SETTINGS,
      agents: [
        {
          id: "agent-1",
          name: "Agent 1",
          gatewayUrl: "http://10.0.0.8:4100",
          token: "gateway-token",
          gatewayCredentialId: "gateway-1",
          gitCredentialId: "git-1",
          gitCredentialState: "connected",
          hostCredentialIds: {
            DEEPGRAM_API_KEY: "deepgram-1",
            ELEVENLABS_API_KEY: "elevenlabs-1",
          },
          repositories: [
            {
              id: 7,
              fullName: "acme/api",
              cloneUrl: "https://github.com/acme/api.git",
            },
          ],
          modelCredentialIds: { ANTHROPIC_API_KEY: "model-1" },
        },
      ],
      activeAgentId: "agent-1",
      gitPat: "ghp_example",
      modelKeys: { ANTHROPIC_API_KEY: "sk-ant-example" },
      harness: "gemini-cli" as const,
    };
    const parsed = parseDeviceSettings(serializeDeviceSettings(settings));
    assert.equal(activeAgent(parsed).token, "");
    assert.equal(activeAgent(parsed).gatewayUrl, "http://10.0.0.8:4100");
    assert.equal(parsed.gitPat, "");
    assert.equal(parsed.harness, "gemini-cli");
    assert.equal(parsed.model, "");
    assert.equal(parsed.effort, "");
    assert.equal(parsed.modelKeys.ANTHROPIC_API_KEY, undefined);
    assert.equal(activeAgent(parsed).gitCredentialId, "git-1");
    assert.equal(activeAgent(parsed).gitCredentialState, "connected");
    assert.equal(activeAgent(parsed).gatewayCredentialId, "gateway-1");
    assert.deepEqual(activeAgent(parsed).hostCredentialIds, {
      DEEPGRAM_API_KEY: "deepgram-1",
      ELEVENLABS_API_KEY: "elevenlabs-1",
    });
    assert.equal(activeAgent(parsed).repositories?.[0]?.fullName, "acme/api");
    assert.equal(
      activeAgent(parsed).modelCredentialIds?.ANTHROPIC_API_KEY,
      "model-1",
    );
  });

  it("persists desired lifecycle state and defaults legacy profiles to running", () => {
    const stopped = {
      ...DEFAULT_DEVICE_SETTINGS,
      agents: [
        {
          ...DEFAULT_DEVICE_SETTINGS.agents[0]!,
          desiredState: "stopped" as const,
        },
      ],
    };
    const serialized = JSON.parse(
      serializeDeviceSettings(stopped),
    ) as { agents: { desiredState?: string }[] };
    assert.equal(serialized.agents[0]?.desiredState, "stopped");
    assert.equal(
      activeAgent(parseDeviceSettings(serializeDeviceSettings(stopped))).desiredState,
      "stopped",
    );

    const legacy = parseDeviceSettings(
      JSON.stringify({
        agents: [
          {
            id: "legacy",
            name: "Legacy",
            gatewayUrl: "https://agent.example",
            token: "token",
          },
        ],
      }),
    );
    assert.equal(legacy.agents[0]?.desiredState, "running");
    assert.equal(
      parseDeviceSettings(
        JSON.stringify({
          agents: [
            {
              id: "invalid",
              name: "Invalid",
              gatewayUrl: "https://agent.example",
              token: "token",
              desiredState: "paused",
            },
          ],
        }),
      ).agents[0]?.desiredState,
      "running",
    );
  });

  it("falls back on corrupt JSON and unknown harnesses", () => {
    assert.equal(parseDeviceSettings("not-json").harness, "claude-code");
    assert.equal(parseDeviceSettings("not-json").model, "");
    assert.equal(parseDeviceSettings("not-json").effort, "");
    assert.equal(
      parseDeviceSettings(JSON.stringify({ harness: "nope" })).harness,
      "claude-code",
    );
    assert.equal(
      parseDeviceSettings(JSON.stringify({ model: 1, effort: null })).model,
      "",
    );
    assert.equal(
      parseDeviceSettings(JSON.stringify({ model: 1, effort: null })).effort,
      "",
    );
  });

  it("round-trips model and effort overrides", () => {
    const settings = {
      ...DEFAULT_DEVICE_SETTINGS,
      harness: "codex" as const,
      model: "gpt-5",
      effort: "high",
    };
    const parsed = parseDeviceSettings(serializeDeviceSettings(settings));
    assert.equal(parsed.harness, "codex");
    assert.equal(parsed.model, "gpt-5");
    assert.equal(parsed.effort, "high");
    const serialized = JSON.parse(serializeDeviceSettings(parsed)) as Record<
      string,
      unknown
    >;
    assert.equal(serialized.model, "gpt-5");
    assert.equal(serialized.effort, "high");
  });

  it("resolves independent profile overrides with legacy fallbacks", () => {
    const settings = {
      ...DEFAULT_DEVICE_SETTINGS,
      harness: "claude-code" as const,
      model: "legacy-model",
      effort: "legacy-effort",
      repoUrl: "https://legacy.example",
      defaultBranch: "main",
      stopWord: "legacy stop",
      voiceId: "legacy-voice",
      agents: [
        {
          ...DEFAULT_DEVICE_SETTINGS.agents[0]!,
          id: "a",
          runtime: {
            harness: "codex" as const,
            model: "profile-model",
            effort: "high",
            repoUrl: "https://profile.example",
            stopWord: "profile stop",
          },
        },
        {
          ...DEFAULT_DEVICE_SETTINGS.agents[0]!,
          id: "b",
        },
      ],
      activeAgentId: "a",
    };
    const profileSettings = resolveAgentRuntimeSettings(settings.agents[0]!, settings);
    const fallbackSettings = resolveAgentRuntimeSettings(settings, settings.agents[1]!);
    assert.deepEqual(profileSettings, {
      harness: "codex",
      model: "profile-model",
      effort: "high",
      repoUrl: "https://profile.example",
      defaultBranch: "main",
      stopWord: "profile stop",
      voiceId: "legacy-voice",
    });
    assert.deepEqual(fallbackSettings, {
      harness: "claude-code",
      model: "legacy-model",
      effort: "legacy-effort",
      repoUrl: "https://legacy.example",
      defaultBranch: "main",
      stopWord: "legacy stop",
      voiceId: "legacy-voice",
    });
  });

  it("updates one profile harness and resets only that profile selections", () => {
    const settings = {
      ...DEFAULT_DEVICE_SETTINGS,
      model: "legacy-model",
      effort: "legacy-effort",
      agents: [
        {
          ...DEFAULT_DEVICE_SETTINGS.agents[0]!,
          id: "a",
          runtime: {
            harness: "claude-code" as const,
            model: "sonnet",
            effort: "high",
          },
        },
        {
          ...DEFAULT_DEVICE_SETTINGS.agents[0]!,
          id: "b",
          runtime: {
            harness: "gemini-cli" as const,
            model: "gemini-pro",
            effort: "low",
          },
        },
      ],
    };
    const next = updateAgentHarness(settings, "a", "codex");
    assert.deepEqual(next.agents[0]?.runtime, {
      harness: "codex",
      model: "",
      effort: "",
    });
    assert.deepEqual(next.agents[1]?.runtime, settings.agents[1]?.runtime);
    assert.equal(next.model, "legacy-model");
    assert.equal(next.effort, "legacy-effort");
    assert.equal(updateAgentHarness(settings, "missing", "codex"), settings);
  });

  it("round-trips provider-neutral origin metadata and gateway credential references", () => {
    const settings = {
      ...DEFAULT_DEVICE_SETTINGS,
      agents: [
        {
          ...DEFAULT_DEVICE_SETTINGS.agents[0]!,
          gatewayCredentialId: "gateway-1",
          runtime: {
            harness: "cursor-cli" as const,
            model: "gpt-5",
            effort: "medium",
            repoUrl: "github.com",
            defaultBranch: "trunk",
            stopWord: "stop now",
            voiceId: "voice-1",
          },
          origin: {
            kind: "provider" as const,
            providerId: "example-provider",
            provisioningId: "local-provisioning-1",
            provisioningPhase: "ready",
            resourceIds: { project: "project-1", service: "service-1" },
            endpointHostname: "agent.example.com",
            lastError: "redacted provisioning error",
          },
        },
      ],
    };
    const parsed = parseDeviceSettings(serializeDeviceSettings(settings));
    assert.equal(activeAgent(parsed).gatewayCredentialId, "gateway-1");
    assert.deepEqual(activeAgent(parsed).runtime, settings.agents[0]?.runtime);
    assert.deepEqual(activeAgent(parsed).origin, settings.agents[0]?.origin);
  });

  it("drops corrupt optional profile metadata without dropping the profile", () => {
    const parsed = parseDeviceSettings(
      JSON.stringify({
        agents: [
          {
            id: "agent-1",
            name: "Agent 1",
            gatewayUrl: "http://example",
            token: "token",
            gatewayCredentialId: 42,
            runtime: {
              harness: "unknown",
              model: "valid-model",
              effort: null,
              voiceId: 3,
            },
            origin: {
              kind: "unknown",
              providerId: "valid-provider",
              provisioningId: 9,
              resourceIds: { project: "valid-project", service: false },
              endpointHostname: null,
              lastError: 12,
            },
          },
        ],
      }),
    );
    assert.equal(parsed.agents.length, 1);
    assert.equal(activeAgent(parsed).gatewayCredentialId, undefined);
    assert.deepEqual(activeAgent(parsed).runtime, { model: "valid-model" });
    assert.deepEqual(activeAgent(parsed).origin, {
      providerId: "valid-provider",
      resourceIds: { project: "valid-project" },
    });
  });

  it("resets model and effort when the harness changes", () => {
    const settings = {
      ...DEFAULT_DEVICE_SETTINGS,
      harness: "claude-code" as const,
      model: "sonnet",
      effort: "high",
    };
    const next = withHarness(settings, "codex");
    assert.equal(next.harness, "codex");
    assert.equal(next.model, "");
    assert.equal(next.effort, "");
    assert.equal(withHarness(settings, "claude-code"), settings);
    assert.equal(withHarness(settings, "claude-code").model, "sonnet");
  });

  it("migrates legacy v1 gatewayUrl/token into a single Agent 1 profile", () => {
    const parsed = parseDeviceSettings(
      JSON.stringify({
        gatewayUrl: "http://10.0.0.8:4100",
        token: "legacy-token",
        userId: "ken",
        harness: "codex",
        gitPat: "ghp_example",
      }),
    );
    assert.equal(parsed.agents.length, 1);
    assert.equal(parsed.agents[0]?.id, "agent-1");
    assert.equal(parsed.agents[0]?.name, "Agent 1");
    assert.equal(parsed.agents[0]?.gatewayUrl, "http://10.0.0.8:4100");
    assert.equal(parsed.agents[0]?.token, "legacy-token");
    assert.equal(parsed.activeAgentId, "agent-1");
    assert.equal(parsed.userId, "ken");
    assert.equal(parsed.harness, "codex");
    assert.equal(parsed.agents[0]?.desiredState, "running");
    assert.equal(parsed.model, "");
    assert.equal(parsed.effort, "");
    assert.equal(parsed.gitPat, "ghp_example");
    assert.equal(activeAgent(parsed).token, "legacy-token");

    const serialized = JSON.parse(serializeDeviceSettings(parsed)) as Record<
      string,
      unknown
    >;
    assert.equal("gatewayUrl" in serialized, false);
    assert.equal("token" in serialized, false);
    assert.equal("gitPat" in serialized, false);
    assert.equal("modelKeys" in serialized, false);
    assert.ok(Array.isArray(serialized.agents));
    assert.equal(
      (serialized.agents as { token?: string }[])[0]?.token,
      "legacy-token",
    );
    assert.equal(serialized.activeAgentId, "agent-1");
  });

  it("drops invalid agent entries and repairs activeAgentId", () => {
    const parsed = parseDeviceSettings(
      JSON.stringify({
        agents: [
          { id: 1, name: "bad", gatewayUrl: "http://x", token: "t" },
          {
            id: "ok",
            name: "Prod",
            gatewayUrl: "https://a.example",
            token: "t",
          },
          "nope",
          { id: "partial", name: "Nope" },
        ],
        activeAgentId: "missing",
      }),
    );
    assert.equal(parsed.agents.length, 1);
    assert.equal(parsed.agents[0]?.id, "ok");
    assert.equal(parsed.agents[0]?.name, "Prod");
    assert.equal(parsed.activeAgentId, "ok");
  });

  it("ensures at least one profile when agents is empty", () => {
    const parsed = parseDeviceSettings(JSON.stringify({ agents: [] }));
    assert.ok(parsed.agents.length >= 1);
    assert.equal(parsed.activeAgentId, parsed.agents[0]?.id);
    assert.equal(activeAgent(parsed).id, parsed.agents[0]?.id);
  });

  it("activeAgent returns the named profile and falls back to the first", () => {
    const settings = {
      ...DEFAULT_DEVICE_SETTINGS,
      agents: [
        {
          id: "a",
          name: "Alpha",
          gatewayUrl: "http://a",
          token: "ta",
        },
        {
          id: "b",
          name: "Beta",
          gatewayUrl: "http://b",
          token: "tb",
        },
      ],
      activeAgentId: "b",
    };
    assert.equal(activeAgent(settings).name, "Beta");
    assert.equal(activeAgent({ ...settings, activeAgentId: "gone" }).name, "Alpha");
  });

  it("persists through a key-value store", async () => {
    const kv = memoryKeyValueStore();
    const store = createSettingsStore(kv);
    assert.equal(await store.load(), null);
    await store.save({
      ...DEFAULT_DEVICE_SETTINGS,
      userId: "ken",
      agents: [
        {
          ...DEFAULT_DEVICE_SETTINGS.agents[0]!,
          token: "t",
          gatewayCredentialId: "gateway-1",
        },
      ],
    });
    const loaded = await store.load();
    assert.equal(loaded?.userId, "ken");
    assert.equal(activeAgent(loaded!).token, "");
  });

  it("refuses to load corrupt stored JSON as empty defaults", async () => {
    const kv = memoryKeyValueStore({
      "agent_tts.deviceSettings.v1": "not-json",
    });
    const store = createSettingsStore(kv);
    await assert.rejects(store.load(), /not valid JSON/);
    assert.equal(kv.data["agent_tts.deviceSettings.v1"], "not-json");
  });
});
