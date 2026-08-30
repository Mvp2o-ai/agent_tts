import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deleteRailwayAgent,
  launchRailwayAgent,
  newRailwayProvisioningState,
  startRailwayAgent,
  stopRailwayAgent,
} from "./providers/railway/driver";
import { createAgentDeploymentSpec } from "./providers/types";

describe("Railway provisioning driver", () => {
  it("creates one configured service and checkpoints every resource ID", async () => {
    const operations: string[] = [];
    const checkpoints: string[] = [];
    const initial = newRailwayProvisioningState(
      { provisioningId: "agent-abc-123", workspaceId: "workspace-1" },
      () => 100,
    );

    const state = await launchRailwayAgent(
      "railway-access",
      {
        ...deploymentSpec({
          runtimeImage: "ghcr.io/example/agent@sha256:123",
          gatewayToken: "gateway-secret",
            voice: {
              sttProviderId: "fixture-stt",
              ttsProviderId: "fixture-tts",
              secrets: {
                FIXTURE_API_KEY: "fixture-secret",
              },
            },
        }),
        provisioningId: initial.provisioningId,
        workspaceId: initial.workspaceId,
        workspacePlan: "HOBBY",
      },
      initial,
      {
        now: () => 200,
        checkpoint: async (next) => {
          const serialized = JSON.stringify(next);
          assert.equal(serialized.includes("gateway-secret"), false);
          assert.equal(serialized.includes("fixture-secret"), false);
          checkpoints.push(next.phase);
        },
        graphqlRequest: async (_url, init) => {
          const payload = JSON.parse(String(init?.body)) as {
            query: string;
            variables: Record<string, unknown>;
          };
          const operation = /(?:query|mutation) (AgentTts\w+)/.exec(
            payload.query,
          )?.[1];
          assert.ok(operation);
          operations.push(operation);
          switch (operation) {
            case "AgentTtsProjectCreate":
              return Response.json({
                data: {
                  projectCreate: {
                    id: "project-1",
                    name: "agent-tts-agentabc123",
                    workspaceId: "workspace-1",
                    primaryEnvironmentId: "environment-1",
                  },
                },
              });
            case "AgentTtsServiceCreate":
              return Response.json({
                data: {
                  serviceCreate: { id: "service-1", name: "agent-runtime" },
                },
              });
            case "AgentTtsVolumeCreate":
              assert.deepEqual(payload.variables.input, {
                projectId: "project-1",
                environmentId: "environment-1",
                serviceId: "service-1",
                mountPath: "/data",
              });
              return Response.json({
                data: { volumeCreate: { id: "volume-1", name: "volume" } },
              });
            case "AgentTtsServiceConfigure":
              assert.deepEqual(payload.variables.input, {
                healthcheckPath: "/health",
                healthcheckTimeout: 300,
                restartPolicyType: "ALWAYS",
                numReplicas: 1,
                sleepApplication: false,
              });
              return Response.json({
                data: { serviceInstanceUpdate: true },
              });
            case "AgentTtsVariablesUpsert": {
              const input = payload.variables.input as {
                variables: Record<string, string>;
                skipDeploys: boolean;
              };
              assert.equal(input.variables.GATEWAY_TOKEN, "gateway-secret");
              assert.equal(input.variables.STT_PROVIDER, "fixture-stt");
              assert.equal(input.variables.TTS_PROVIDER, "fixture-tts");
              assert.equal(input.variables.FIXTURE_API_KEY, "fixture-secret");
              assert.equal(input.skipDeploys, true);
              return Response.json({
                data: { variableCollectionUpsert: true },
              });
            }
            case "AgentTtsDomainCreate":
              return Response.json({
                data: {
                  serviceDomainCreate: {
                    id: "domain-1",
                    domain: "agent-production.up.railway.app",
                  },
                },
              });
            case "AgentTtsServiceImage":
              return Response.json({
                data: { serviceInstance: { source: null } },
              });
            case "AgentTtsServiceConnect":
              assert.deepEqual(payload.variables, {
                serviceId: "service-1",
                input: {
                  image: "ghcr.io/example/agent@sha256:123",
                },
              });
              return Response.json({
                data: { serviceConnect: { id: "service-1" } },
              });
            case "AgentTtsLatestDeployment":
              return Response.json({
                data: {
                  deployments: {
                    edges: [
                      {
                        node: {
                          id: "deployment-1",
                          status: "DEPLOYING",
                        },
                      },
                    ],
                  },
                },
              });
            case "AgentTtsServiceDeploy":
              throw new Error("Source connection already created a deployment");
            case "AgentTtsDeployment":
              return Response.json({
                data: {
                  deployment: { id: "deployment-1", status: "SUCCESS" },
                },
              });
            default:
              throw new Error(`Unexpected operation ${operation}`);
          }
        },
        healthRequest: async (url) => {
          assert.equal(
            url,
            "https://agent-production.up.railway.app/health",
          );
          return Response.json({ ok: true });
        },
        sleep: async () => undefined,
      },
    );

    assert.equal(state.phase, "ready");
    assert.equal(state.projectId, "project-1");
    assert.equal(state.serviceId, "service-1");
    assert.equal(state.volumeId, "volume-1");
    assert.equal(state.domain, "agent-production.up.railway.app");
    assert.equal(state.deploymentId, "deployment-1");
    assert.deepEqual(operations, [
      "AgentTtsProjectCreate",
      "AgentTtsServiceCreate",
      "AgentTtsVolumeCreate",
      "AgentTtsServiceConfigure",
      "AgentTtsVariablesUpsert",
      "AgentTtsDomainCreate",
      "AgentTtsServiceImage",
      "AgentTtsServiceConnect",
      "AgentTtsLatestDeployment",
      "AgentTtsDeployment",
    ]);
    assert.ok(checkpoints.includes("creating_volume"));
    assert.equal(checkpoints.at(-1), "ready");
  });

  it("triggers one deployment when connecting the image did not create one", async () => {
    const operations: string[] = [];
    const initial = {
      ...newRailwayProvisioningState({
        provisioningId: "agent-1",
        workspaceId: "workspace-1",
      }),
      projectId: "project-1",
      environmentId: "environment-1",
      serviceId: "service-1",
      volumeId: "volume-1",
      domainId: "domain-1",
      domain: "agent-production.up.railway.app",
    };

    const ready = await launchRailwayAgent(
      "railway-access",
      {
        ...deploymentSpec(),
        provisioningId: initial.provisioningId,
        workspaceId: initial.workspaceId,
        workspacePlan: "HOBBY",
      },
      initial,
      {
        checkpoint: async () => undefined,
        graphqlRequest: async (_url, init) => {
          const payload = JSON.parse(String(init?.body)) as {
            query: string;
            variables: Record<string, unknown>;
          };
          const operation = /(?:query|mutation) (AgentTts\w+)/.exec(
            payload.query,
          )?.[1];
          assert.ok(operation);
          operations.push(operation);
          switch (operation) {
            case "AgentTtsServiceConfigure":
              return Response.json({
                data: { serviceInstanceUpdate: true },
              });
            case "AgentTtsVariablesUpsert":
              return Response.json({
                data: { variableCollectionUpsert: true },
              });
            case "AgentTtsServiceImage":
              return Response.json({
                data: {
                  serviceInstance: {
                    source: {
                      image: "ghcr.io/example/agent@sha256:123",
                    },
                  },
                },
              });
            case "AgentTtsLatestDeployment":
              return Response.json({
                data: { deployments: { edges: [] } },
              });
            case "AgentTtsServiceDeploy":
              return Response.json({
                data: { serviceInstanceDeployV2: "deployment-1" },
              });
            case "AgentTtsDeployment":
              return Response.json({
                data: {
                  deployment: { id: "deployment-1", status: "SUCCESS" },
                },
              });
            default:
              throw new Error(`Unexpected operation ${operation}`);
          }
        },
        healthRequest: async () => Response.json({ ok: true }),
        sleep: async () => undefined,
      },
    );

    assert.equal(ready.deploymentId, "deployment-1");
    assert.equal(
      operations.filter((operation) => operation === "AgentTtsServiceDeploy")
        .length,
      1,
    );
    assert.equal(operations.includes("AgentTtsServiceConnect"), false);
  });

  it("reconciles a failed checkpoint to one fresh deployment", async () => {
    const deploymentIds: Array<string | undefined> = [];
    const initial = {
      ...newRailwayProvisioningState({
        provisioningId: "agent-1",
        workspaceId: "workspace-1",
      }),
      phase: "failed" as const,
      projectId: "project-1",
      environmentId: "environment-1",
      serviceId: "service-1",
      volumeId: "volume-1",
      domainId: "domain-1",
      domain: "agent-production.up.railway.app",
      deploymentId: "deployment-failed",
    };

    const ready = await launchRailwayAgent(
      "railway-access",
      {
        ...deploymentSpec(),
        provisioningId: initial.provisioningId,
        workspaceId: initial.workspaceId,
        workspacePlan: "HOBBY",
      },
      initial,
      {
        checkpoint: async (state) => {
          deploymentIds.push(state.deploymentId);
        },
        graphqlRequest: async (_url, init) => {
          const payload = JSON.parse(String(init?.body)) as {
            query: string;
            variables: Record<string, unknown>;
          };
          const operation = /(?:query|mutation) (AgentTts\w+)/.exec(
            payload.query,
          )?.[1];
          switch (operation) {
            case "AgentTtsServiceConfigure":
              return Response.json({
                data: { serviceInstanceUpdate: true },
              });
            case "AgentTtsVariablesUpsert":
              return Response.json({
                data: { variableCollectionUpsert: true },
              });
            case "AgentTtsDeployment":
              return Response.json({
                data: {
                  deployment: {
                    id: payload.variables.id,
                    status:
                      payload.variables.id === "deployment-failed"
                        ? "FAILED"
                        : "SUCCESS",
                  },
                },
              });
            case "AgentTtsServiceImage":
              return Response.json({
                data: {
                  serviceInstance: {
                    source: {
                      image: "ghcr.io/example/agent@sha256:123",
                    },
                  },
                },
              });
            case "AgentTtsLatestDeployment":
              return Response.json({
                data: {
                  deployments: {
                    edges: [
                      {
                        node: {
                          id: "deployment-failed",
                          status: "FAILED",
                        },
                      },
                    ],
                  },
                },
              });
            case "AgentTtsServiceDeploy":
              return Response.json({
                data: { serviceInstanceDeployV2: "deployment-new" },
              });
            default:
              throw new Error(`Unexpected operation ${operation}`);
          }
        },
        healthRequest: async () => Response.json({ ok: true }),
        sleep: async () => undefined,
      },
    );

    assert.equal(ready.deploymentId, "deployment-new");
    assert.ok(deploymentIds.includes(undefined));
    assert.equal(deploymentIds.at(-1), "deployment-new");
  });

  it("stops the persisted deployment and starts a fresh deployment", async () => {
    const operations: Array<{
      name: string;
      variables: Record<string, unknown>;
    }> = [];
    const initial = {
      ...newRailwayProvisioningState({
        provisioningId: "agent-1",
        workspaceId: "workspace-1",
      }),
      phase: "ready" as const,
      deploymentState: "running" as const,
      projectId: "project-1",
      environmentId: "environment-1",
      serviceId: "service-1",
      volumeId: "volume-1",
      domainId: "domain-1",
      domain: "agent-production.up.railway.app",
      deploymentId: "deployment-old",
    };

    const graphqlRequest = async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      const name = /(?:query|mutation) (AgentTts\w+)/.exec(payload.query)?.[1];
      assert.ok(name);
      operations.push({ name, variables: payload.variables });
      switch (name) {
        case "AgentTtsDeploymentStop":
          assert.equal(payload.variables.id, "deployment-old");
          return Response.json({ data: { deploymentStop: true } });
        case "AgentTtsServiceDeploy":
          assert.deepEqual(payload.variables, {
            serviceId: "service-1",
            environmentId: "environment-1",
          });
          return Response.json({
            data: { serviceInstanceDeployV2: "deployment-new" },
          });
        case "AgentTtsDeployment":
          assert.equal(payload.variables.id, "deployment-new");
          return Response.json({
            data: {
              deployment: { id: "deployment-new", status: "SUCCESS" },
            },
          });
        default:
          throw new Error(`Unexpected operation ${name}`);
      }
    };

    const stopped = await stopRailwayAgent("railway-access", initial, {
      checkpoint: async () => undefined,
      graphqlRequest,
      now: () => 200,
    });
    assert.equal(stopped.deploymentState, "stopped");
    assert.equal(stopped.deploymentId, "deployment-old");

    const ready = await startRailwayAgent("railway-access", stopped, {
      checkpoint: async () => undefined,
      graphqlRequest,
      healthRequest: async (url) => {
        assert.equal(
          url,
          "https://agent-production.up.railway.app/health",
        );
        return Response.json({ ok: true });
      },
      sleep: async () => undefined,
      now: () => 300,
    });
    assert.equal(ready.deploymentState, "running");
    assert.equal(ready.deploymentId, "deployment-new");
    assert.deepEqual(
      operations.map(({ name }) => name),
      [
        "AgentTtsDeploymentStop",
        "AgentTtsServiceDeploy",
        "AgentTtsDeployment",
      ],
    );
  });

  it("deletes the Railway project that owns an agent deployment", async () => {
    const state = {
      ...newRailwayProvisioningState({
        provisioningId: "agent-1",
        workspaceId: "workspace-1",
      }),
      phase: "ready" as const,
      projectId: "project-1",
    };
    await deleteRailwayAgent("railway-access", state, {
      graphqlRequest: async (_url, init) => {
        const payload = JSON.parse(String(init?.body)) as {
          query: string;
          variables: Record<string, unknown>;
        };
        assert.match(payload.query, /mutation AgentTtsProjectDelete/);
        assert.deepEqual(payload.variables, { id: "project-1" });
        return Response.json({ data: { projectDelete: true } });
      },
    });
  });

  it("treats an already-removed Railway project as deleted", async () => {
    const state = {
      ...newRailwayProvisioningState({
        provisioningId: "agent-1",
        workspaceId: "workspace-1",
      }),
      projectId: "project-1",
    };
    await deleteRailwayAgent("railway-access", state, {
      graphqlRequest: async () =>
        Response.json({
          data: null,
          errors: [
            {
              message: "Project not found",
              extensions: { code: "INTERNAL_SERVER_ERROR" },
            },
          ],
        }),
    });
  });

  it("keeps deletion failed when Railway does not confirm project removal", async () => {
    const state = {
      ...newRailwayProvisioningState({
        provisioningId: "agent-1",
        workspaceId: "workspace-1",
      }),
      projectId: "project-1",
    };
    await assert.rejects(
      () =>
        deleteRailwayAgent("railway-access", state, {
          graphqlRequest: async () =>
            Response.json({ data: { projectDelete: false } }),
        }),
      /did not delete/,
    );
  });

  it("does not start a fresh deployment unless the service is stopped", async () => {
    const initial = {
      ...newRailwayProvisioningState({
        provisioningId: "agent-1",
        workspaceId: "workspace-1",
      }),
      phase: "ready" as const,
      deploymentState: "running" as const,
      serviceId: "service-1",
      environmentId: "environment-1",
      domain: "agent-production.up.railway.app",
    };
    await assert.rejects(
      () =>
        startRailwayAgent("railway-access", initial, {
          checkpoint: async () => undefined,
          graphqlRequest: async () => {
            throw new Error("must not call Railway");
          },
        }),
      /must be stopped/,
    );
  });

  it("rejects unsupported plans before creating resources", async () => {
    const initial = newRailwayProvisioningState({
      provisioningId: "agent-1",
      workspaceId: "workspace-1",
    });
    await assert.rejects(
      () =>
        launchRailwayAgent(
          "token",
          {
            ...deploymentSpec(),
            provisioningId: initial.provisioningId,
            workspaceId: initial.workspaceId,
            workspacePlan: "FREE",
          },
          initial,
          {
            checkpoint: async () => undefined,
            graphqlRequest: async () => {
              throw new Error("must not call Railway");
            },
          },
        ),
      /Hobby or Pro/,
    );
  });

  it("upserts and redacts arbitrary voice secrets generically", async () => {
    const checkpoints: RailwayProvisioningState[] = [];
    const initial = {
      ...newRailwayProvisioningState({
        provisioningId: "agent-1",
        workspaceId: "workspace-1",
      }),
      projectId: "project-1",
      environmentId: "environment-1",
      serviceId: "service-1",
      volumeId: "volume-1",
      domainId: "domain-1",
      domain: "agent-production.up.railway.app",
    };

    await assert.rejects(
      () =>
        launchRailwayAgent(
          "token",
          {
            ...deploymentSpec({
              gatewayToken: "gateway-secret",
              voice: {
                sttProviderId: "fixture-stt",
                ttsProviderId: "fixture-tts",
                secrets: { FIXTURE_API_KEY: "fixture-secret" },
              },
            }),
            provisioningId: initial.provisioningId,
            workspaceId: initial.workspaceId,
            workspacePlan: "PRO",
          },
          initial,
          {
            checkpoint: async (state) => checkpoints.push(state),
            graphqlRequest: async (_url, init) => {
              const payload = JSON.parse(String(init?.body)) as {
                query: string;
                variables: Record<string, unknown>;
              };
              const operation = /(?:query|mutation) (AgentTts\w+)/.exec(
                payload.query,
              )?.[1];
              if (operation === "AgentTtsServiceConfigure") {
                return Response.json({
                  data: { serviceInstanceUpdate: true },
                });
              }
              if (operation === "AgentTtsVariablesUpsert") {
                const input = payload.variables.input as {
                  variables: Record<string, string>;
                };
                assert.equal(input.variables.FIXTURE_API_KEY, "fixture-secret");
                throw new Error(
                  "Railway rejected gateway-secret and fixture-secret",
                );
              }
              throw new Error(`Unexpected operation ${operation}`);
            },
          },
        ),
    );

    const failure = checkpoints.at(-1)?.lastError ?? "";
    assert.equal(failure.includes("gateway-secret"), false);
    assert.equal(failure.includes("fixture-secret"), false);
    assert.match(failure, /\[redacted\]/);
  });

  it("does not replay a create mutation whose outcome is unknown", async () => {
    const initial = {
      ...newRailwayProvisioningState({
        provisioningId: "agent-1",
        workspaceId: "workspace-1",
      }),
      phase: "failed" as const,
      pendingMutation: "service" as const,
      projectId: "project-1",
      environmentId: "environment-1",
    };
    await assert.rejects(
      () =>
        launchRailwayAgent(
          "token",
          {
            ...deploymentSpec(),
            provisioningId: initial.provisioningId,
            workspaceId: initial.workspaceId,
            workspacePlan: "PRO",
          },
          initial,
          {
            checkpoint: async () => undefined,
            graphqlRequest: async () => {
              throw new Error("must not call Railway");
            },
          },
        ),
      /unknown outcome/,
    );
  });
});

function deploymentSpec(
  overrides: Partial<Parameters<typeof createAgentDeploymentSpec>[0]> = {},
) {
  return createAgentDeploymentSpec({
    agentName: "Test agent",
    runtimeImage: "ghcr.io/example/agent@sha256:123",
    gatewayToken: "g",
    voice: {
      sttProviderId: "deepgram",
      ttsProviderId: "elevenlabs",
      secrets: {
        DEEPGRAM_API_KEY: "d",
        ELEVENLABS_API_KEY: "e",
      },
    },
    ...overrides,
  });
}
