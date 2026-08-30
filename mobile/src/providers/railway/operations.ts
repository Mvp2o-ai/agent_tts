import {
  RailwayApiError,
  railwayGraphql,
  type RailwayGraphqlRequest,
} from "./graphql";

export interface RailwayWorkspace {
  id: string;
  name: string;
  plan: string;
  role: string;
}

export interface RailwayProject {
  id: string;
  name: string;
  workspaceId: string;
  primaryEnvironmentId: string;
}

export interface RailwayDeployment {
  id: string;
  status: string;
  createdAt?: string;
  url?: string;
  staticUrl?: string;
}

export const TERMINAL_DEPLOYMENT_FAILURES = new Set([
  "FAILED",
  "CRASHED",
  "REMOVED",
  "SKIPPED",
]);

export async function listRailwayWorkspaces(
  accessToken: string,
  request?: RailwayGraphqlRequest,
): Promise<RailwayWorkspace[]> {
  const data = await railwayGraphql<{
    me: {
      id: string;
      workspaces: Array<{
        id: string;
        name: string;
        plan: string;
        members: Array<{ id: string; role: string }>;
      }>;
    };
  }>(
    accessToken,
    `query AgentTtsWorkspaces {
      me {
        id
        workspaces {
          id
          name
          plan
          members { id role }
        }
      }
    }`,
    {},
    request,
  );
  return data.me.workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    plan: workspace.plan,
    role:
      workspace.members.find((member) => member.id === data.me.id)?.role ?? "",
  }));
}

export async function createRailwayProject(
  accessToken: string,
  input: {
    workspaceId: string;
    name: string;
  },
  request?: RailwayGraphqlRequest,
): Promise<RailwayProject> {
  const data = await railwayGraphql<{ projectCreate: RailwayProject }>(
    accessToken,
    `mutation AgentTtsProjectCreate($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        id
        name
        workspaceId
        primaryEnvironmentId
      }
    }`,
    {
      input: {
        workspaceId: input.workspaceId,
        name: input.name,
        defaultEnvironmentName: "production",
      },
    },
    request,
  );
  return data.projectCreate;
}

export async function deleteRailwayProject(
  accessToken: string,
  projectId: string,
  request?: RailwayGraphqlRequest,
): Promise<void> {
  let data: { projectDelete: boolean };
  try {
    data = await railwayGraphql<{ projectDelete: boolean }>(
      accessToken,
      `mutation AgentTtsProjectDelete($id: String!) {
        projectDelete(id: $id)
      }`,
      { id: projectId },
      request,
    );
  } catch (error) {
    if (
      error instanceof RailwayApiError &&
      error.message.toLowerCase().includes("project not found")
    ) {
      return;
    }
    throw error;
  }
  if (!data.projectDelete) {
    throw new Error("Railway did not delete the project");
  }
}

export async function createRailwayService(
  accessToken: string,
  input: {
    projectId: string;
    environmentId: string;
    name: string;
  },
  request?: RailwayGraphqlRequest,
): Promise<{ id: string; name: string }> {
  const data = await railwayGraphql<{
    serviceCreate: { id: string; name: string };
  }>(
    accessToken,
    `mutation AgentTtsServiceCreate($input: ServiceCreateInput!) {
      serviceCreate(input: $input) { id name }
    }`,
    { input },
    request,
  );
  return data.serviceCreate;
}

export async function createRailwayVolume(
  accessToken: string,
  input: {
    projectId: string;
    environmentId: string;
    serviceId: string;
    mountPath: string;
  },
  request?: RailwayGraphqlRequest,
): Promise<{ id: string; name: string }> {
  const data = await railwayGraphql<{
    volumeCreate: { id: string; name: string };
  }>(
    accessToken,
    `mutation AgentTtsVolumeCreate($input: VolumeCreateInput!) {
      volumeCreate(input: $input) { id name }
    }`,
    {
      input: {
        projectId: input.projectId,
        environmentId: input.environmentId,
        serviceId: input.serviceId,
        mountPath: input.mountPath,
      },
    },
    request,
  );
  return data.volumeCreate;
}

export async function configureRailwayService(
  accessToken: string,
  input: {
    serviceId: string;
    environmentId: string;
    healthcheckPath: string;
    replicas: number;
    restartOnCleanExit: boolean;
    sleepWhenIdle: boolean;
  },
  request?: RailwayGraphqlRequest,
): Promise<void> {
  await railwayGraphql<{ serviceInstanceUpdate: boolean }>(
    accessToken,
    `mutation AgentTtsServiceConfigure(
      $serviceId: String!
      $environmentId: String!
      $input: ServiceInstanceUpdateInput!
    ) {
      serviceInstanceUpdate(
        serviceId: $serviceId
        environmentId: $environmentId
        input: $input
      )
    }`,
    {
      serviceId: input.serviceId,
      environmentId: input.environmentId,
      input: {
        healthcheckPath: input.healthcheckPath,
        healthcheckTimeout: 300,
        restartPolicyType: input.restartOnCleanExit ? "ALWAYS" : "ON_FAILURE",
        numReplicas: input.replicas,
        sleepApplication: input.sleepWhenIdle,
      },
    },
    request,
  );
}

export async function getRailwayServiceImage(
  accessToken: string,
  input: {
    serviceId: string;
    environmentId: string;
  },
  request?: RailwayGraphqlRequest,
): Promise<string | undefined> {
  const data = await railwayGraphql<{
    serviceInstance: { source?: { image?: string } };
  }>(
    accessToken,
    `query AgentTtsServiceImage(
      $serviceId: String!
      $environmentId: String!
    ) {
      serviceInstance(
        serviceId: $serviceId
        environmentId: $environmentId
      ) {
        source { image }
      }
    }`,
    input,
    request,
  );
  return data.serviceInstance.source?.image;
}

export async function connectRailwayServiceImage(
  accessToken: string,
  input: {
    serviceId: string;
    image: string;
  },
  request?: RailwayGraphqlRequest,
): Promise<void> {
  await railwayGraphql<{ serviceConnect: { id: string } }>(
    accessToken,
    `mutation AgentTtsServiceConnect(
      $serviceId: String!
      $input: ServiceSourceInput!
    ) {
      serviceConnect(id: $serviceId, input: $input) { id }
    }`,
    {
      serviceId: input.serviceId,
      input: { image: input.image },
    },
    request,
  );
}

export async function upsertRailwayVariables(
  accessToken: string,
  input: {
    projectId: string;
    environmentId: string;
    serviceId: string;
    variables: Record<string, string>;
  },
  request?: RailwayGraphqlRequest,
): Promise<void> {
  await railwayGraphql<{ variableCollectionUpsert: boolean }>(
    accessToken,
    `mutation AgentTtsVariablesUpsert(
      $input: VariableCollectionUpsertInput!
    ) {
      variableCollectionUpsert(input: $input)
    }`,
    {
      input: {
        ...input,
        replace: false,
        skipDeploys: true,
      },
    },
    request,
  );
}

export async function createRailwayDomain(
  accessToken: string,
  input: {
    serviceId: string;
    environmentId: string;
  },
  request?: RailwayGraphqlRequest,
): Promise<{ id: string; domain: string }> {
  const data = await railwayGraphql<{
    serviceDomainCreate: { id: string; domain: string };
  }>(
    accessToken,
    `mutation AgentTtsDomainCreate($input: ServiceDomainCreateInput!) {
      serviceDomainCreate(input: $input) { id domain }
    }`,
    { input },
    request,
  );
  return data.serviceDomainCreate;
}

export async function deployRailwayService(
  accessToken: string,
  input: {
    serviceId: string;
    environmentId: string;
  },
  request?: RailwayGraphqlRequest,
): Promise<string> {
  const data = await railwayGraphql<{ serviceInstanceDeployV2: string }>(
    accessToken,
    `mutation AgentTtsServiceDeploy(
      $serviceId: String!
      $environmentId: String!
    ) {
      serviceInstanceDeployV2(
        serviceId: $serviceId
        environmentId: $environmentId
      )
    }`,
    input,
    request,
  );
  return data.serviceInstanceDeployV2;
}

export async function getLatestRailwayDeployment(
  accessToken: string,
  input: {
    projectId: string;
    serviceId: string;
    environmentId: string;
  },
  request?: RailwayGraphqlRequest,
): Promise<RailwayDeployment | undefined> {
  const data = await railwayGraphql<{
    deployments: {
      edges: Array<{ node: RailwayDeployment }>;
    };
  }>(
    accessToken,
    `query AgentTtsLatestDeployment($input: DeploymentListInput!) {
      deployments(input: $input, first: 1) {
        edges {
          node {
            id
            status
            createdAt
            url
            staticUrl
          }
        }
      }
    }`,
    { input },
    request,
  );
  return data.deployments.edges[0]?.node;
}

/**
 * Trigger a new deployment from the service's configured source.
 *
 * This is intentionally distinct from serviceInstanceRedeploy: after a
 * deployment has been stopped, serviceInstanceDeployV2 is the public
 * operation that creates the fresh deployment needed to start the service.
 */
export async function deployFreshRailwayService(
  accessToken: string,
  input: {
    serviceId: string;
    environmentId: string;
  },
  request?: RailwayGraphqlRequest,
): Promise<string> {
  return deployRailwayService(accessToken, input, request);
}

export async function getRailwayDeployment(
  accessToken: string,
  deploymentId: string,
  request?: RailwayGraphqlRequest,
): Promise<RailwayDeployment> {
  const data = await railwayGraphql<{ deployment: RailwayDeployment }>(
    accessToken,
    `query AgentTtsDeployment($id: String!) {
      deployment(id: $id) {
        id
        status
        createdAt
        url
        staticUrl
      }
    }`,
    { id: deploymentId },
    request,
  );
  return data.deployment;
}

export async function stopRailwayDeployment(
  accessToken: string,
  deploymentId: string,
  request?: RailwayGraphqlRequest,
): Promise<void> {
  await railwayGraphql<{ deploymentStop: boolean }>(
    accessToken,
    `mutation AgentTtsDeploymentStop($id: String!) {
      deploymentStop(id: $id)
    }`,
    { id: deploymentId },
    request,
  );
}

export async function restartRailwayDeployment(
  accessToken: string,
  deploymentId: string,
  request?: RailwayGraphqlRequest,
): Promise<void> {
  await railwayGraphql<{ deploymentRestart: boolean }>(
    accessToken,
    `mutation AgentTtsDeploymentRestart($id: String!) {
      deploymentRestart(id: $id)
    }`,
    { id: deploymentId },
    request,
  );
}

export async function redeployRailwayService(
  accessToken: string,
  input: {
    serviceId: string;
    environmentId: string;
  },
  request?: RailwayGraphqlRequest,
): Promise<void> {
  await railwayGraphql<{ serviceInstanceRedeploy: boolean }>(
    accessToken,
    `mutation AgentTtsServiceRedeploy(
      $serviceId: String!
      $environmentId: String!
    ) {
      serviceInstanceRedeploy(
        serviceId: $serviceId
        environmentId: $environmentId
      )
    }`,
    input,
    request,
  );
}
