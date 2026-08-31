import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RailwayProvisioningState } from "./providers/railway/driver";
import {
  railwayOriginFromState,
  railwayStateFromOrigin,
} from "./providers/railway/persistence";

describe("Railway provisioning persistence", () => {
  it("round-trips resumable state without credentials", () => {
    const state: RailwayProvisioningState = {
      providerId: "railway",
      provisioningId: "launch-1",
      phase: "ready",
      deploymentState: "stopped",
      workspaceId: "workspace-1",
      projectName: "agent-tts-launch-1",
      projectId: "project-1",
      environmentId: "environment-1",
      serviceId: "service-1",
      volumeId: "volume-1",
      pendingMutation: "domain",
      updatedAt: 42,
    };

    const origin = railwayOriginFromState(state);

    assert.deepEqual(railwayStateFromOrigin(origin), state);
    assert.equal(origin.provisioningDetails?.deploymentState, "stopped");
    assert.equal(JSON.stringify(origin).includes("gateway"), false);
    assert.equal(JSON.stringify(origin).includes("token"), false);
  });

  it("rejects incomplete or non-Railway origins", () => {
    assert.equal(
      railwayStateFromOrigin({
        kind: "manual",
        providerId: "railway",
        provisioningId: "launch-1",
        provisioningPhase: "draft",
      }),
      null,
    );
    assert.equal(
      railwayStateFromOrigin({
        kind: "provider",
        providerId: "railway",
        provisioningId: "launch-1",
        provisioningPhase: "unknown",
      }),
      null,
    );
  });
});
