import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentConfigurationIssue,
  deriveAgentLifecycle,
  hasProviderProvisioningFailure,
  providerAllowsSessionConnection,
} from "./agent-lifecycle";
import type { AgentProfile } from "./settings";

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "agent-1",
    name: "Agent 1",
    gatewayUrl: "https://agent.example",
    token: "gateway-token",
    ...overrides,
  };
}

describe("agent lifecycle", () => {
  it("distinguishes setup gaps from invalid profile configuration", () => {
    assert.equal(
      agentConfigurationIssue(profile({ gatewayUrl: "http://" })),
      "missing-endpoint",
    );
    assert.equal(
      deriveAgentLifecycle({
        profile: profile({ gatewayUrl: "http://" }),
        sessionStatus: "ready",
      }),
      "needs-setup",
    );
    assert.equal(
      deriveAgentLifecycle({
        profile: profile({ token: "", gatewayCredentialId: undefined }),
      }),
      "needs-setup",
    );
    assert.equal(
      agentConfigurationIssue(profile({ gatewayUrl: "agent.example" })),
      "invalid-endpoint",
    );
    assert.equal(
      deriveAgentLifecycle({
        profile: profile({ gatewayUrl: "agent.example" }),
      }),
      "error",
    );
  });

  it("uses desired stopped state unless configuration or provisioning failed", () => {
    const stopped = profile({ desiredState: "stopped" });
    assert.equal(
      deriveAgentLifecycle({ profile: stopped, sessionStatus: "ready" }),
      "stopped",
    );
    assert.equal(
      deriveAgentLifecycle({
        profile: {
          ...stopped,
          origin: {
            kind: "provider",
            provisioningPhase: "failed",
            lastError: "deployment failed",
          },
        },
      }),
      "error",
    );
  });

  it("reports provider provisioning and voice connection startup", () => {
    assert.equal(
      providerAllowsSessionConnection(
        profile({
          origin: {
            kind: "provider",
            provisioningPhase: "deploying",
          },
        }),
      ),
      false,
    );
    assert.equal(
      providerAllowsSessionConnection(
        profile({
          origin: {
            kind: "provider",
            provisioningPhase: "ready",
          },
        }),
      ),
      true,
    );
    assert.equal(
      deriveAgentLifecycle({
        profile: profile({
          gatewayUrl: "",
          origin: {
            kind: "provider",
            provisioningPhase: "deploying",
          },
        }),
      }),
      "starting",
    );
    assert.equal(
      deriveAgentLifecycle({
        profile: profile({
          gatewayUrl: "",
          desiredState: "stopped",
          origin: {
            kind: "provider",
            provisioningPhase: "deploying",
          },
        }),
      }),
      "stopped",
    );
    assert.equal(
      deriveAgentLifecycle({
        profile: profile(),
        sessionStatus: "connecting",
      }),
      "starting",
    );
    assert.equal(
      deriveAgentLifecycle({
        profile: profile(),
        sessionStatus: "provisioning",
      }),
      "starting",
    );
  });

  it("reports running and unreachable states from session or reachability", () => {
    assert.equal(
      deriveAgentLifecycle({
        profile: profile(),
        sessionStatus: "ready",
      }),
      "running",
    );
    assert.equal(
      deriveAgentLifecycle({
        profile: profile(),
        reachability: "reachable",
      }),
      "running",
    );
    assert.equal(
      deriveAgentLifecycle({
        profile: profile(),
        sessionStatus: "ready",
        reachability: "unreachable",
      }),
      "unreachable",
    );
    assert.equal(
      deriveAgentLifecycle({
        profile: profile(),
        reachability: "unknown",
      }),
      "running",
    );
    assert.equal(
      deriveAgentLifecycle({
        profile: profile({
          origin: {
            kind: "provider",
            providerId: "railway",
            provisioningPhase: "failed",
            lastError: "stale deployment failure",
          },
        }),
        reachability: "gone",
      }),
      "gone",
    );
  });

  it("recognizes provider failure metadata", () => {
    assert.equal(
      hasProviderProvisioningFailure(
        profile({
          origin: {
            kind: "provider",
            provisioningPhase: "failed",
          },
        }),
      ),
      true,
    );
    assert.equal(
      hasProviderProvisioningFailure(
        profile({
          origin: {
            kind: "provider",
            provisioningPhase: "ready",
            lastError: "stale error",
          },
        }),
      ),
      false,
    );
    assert.equal(
      deriveAgentLifecycle({
        profile: profile({
          origin: {
            kind: "provider",
            provisioningPhase: "failed",
          },
        }),
        sessionStatus: "ready",
      }),
      "error",
    );
  });
});
