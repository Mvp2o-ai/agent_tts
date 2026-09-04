import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_HOST_CONTRACT,
  createAgentDeploymentSpec,
  createProviderRegistry,
  type ProviderPlugin,
} from "./providers/types";
import { runtimeImageFromEnvironment } from "./providers/runtime-config";

describe("provider registry", () => {
  it("discovers installed providers and resolves managed profiles", () => {
    const railway = provider("railway");
    const aws = provider("aws");
    const registry = createProviderRegistry([railway, aws]);

    assert.deepEqual(
      registry.providers.map((entry) => entry.definition.id),
      ["railway", "aws"],
    );
    assert.equal(registry.get("aws"), aws);
    assert.equal(
      registry.forProfile({
        id: "agent-1",
        name: "Agent",
        gatewayUrl: "",
        token: "",
        origin: { kind: "provider", providerId: "railway" },
      }),
      railway,
    );
    assert.equal(
      registry.forProfile({
        id: "agent-2",
        name: "Manual",
        gatewayUrl: "https://example.com",
        token: "token",
        origin: { kind: "manual" },
      }),
      undefined,
    );
  });

  it("rejects missing and duplicate provider IDs", () => {
    assert.throws(() => createProviderRegistry([provider("")]));
    assert.throws(
      () => createProviderRegistry([provider("aws"), provider("aws")]),
      /Duplicate provider ID: aws/,
    );
  });

  it("builds the same host contract for every provider", () => {
    const spec = createAgentDeploymentSpec({
      agentName: "Backend",
      runtimeImage: "registry.example/agent@sha256:123",
      gatewayToken: "gateway",
      voice: {
        sttProviderId: "deepgram",
        ttsProviderId: "elevenlabs",
        secrets: {
          DEEPGRAM_API_KEY: "deepgram",
          ELEVENLABS_API_KEY: "elevenlabs",
        },
      },
    });

    assert.equal(spec.runtimeImage, "registry.example/agent@sha256:123");
    assert.equal(spec.host, AGENT_HOST_CONTRACT);
    assert.deepEqual(spec.host, {
      configMountPath: "/data",
      workspacePersistence: "ephemeral",
      healthPath: "/health",
      replicas: 1,
      restartOnCleanExit: true,
      sleepWhenIdle: false,
      portSource: "provider",
    });
  });

  it("allows forks to override the product runtime image", () => {
    assert.equal(
      runtimeImageFromEnvironment({
        EXPO_PUBLIC_AGENT_RUNTIME_IMAGE:
          "  registry.example/fork@sha256:456  ",
      }),
      "registry.example/fork@sha256:456",
    );
    assert.match(runtimeImageFromEnvironment({}), /^ghcr\.io\/mvp2o-ai\//);
  });
});

function provider(id: string): ProviderPlugin {
  return {
    definition: {
      id,
      label: id,
      description: id,
      actionLabel: id,
    },
    prepareSetup() {},
    renderSetup() {
      return null;
    },
    hostLabel() {
      return id;
    },
    accountConnection() {
      return {
        status: "connected",
        reconnect() {},
      };
    },
    async startAgent() {},
    async stopAgent() {},
    async deleteAgent() {},
    deleteConfirmation() {
      return { title: id, message: id, actionLabel: id };
    },
  };
}
