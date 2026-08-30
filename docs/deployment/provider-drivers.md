# Provider drivers

Provider drivers are compile-time plugins in the mobile app. They translate a
provider-neutral agent deployment request into the API calls and setup screens
needed by one hosting provider. The gateway, adapter child process, runtime
image, voice protocol, and generic lifecycle UI must not import a provider SDK
or contain provider-specific behavior.

## Durable driver contract

Each registered driver supplies:

- stable `id` and display metadata;
- setup and authorization UI, including provider account or destination
  selection;
- launch of a new agent deployment;
- resume/reconcile of an interrupted provisioning transaction;
- deployment status and endpoint discovery;
- starting a fresh deployment/session on an existing agent deployment;
- stopping the deployment; and
- deleting the deployment and cleaning up every resource it created.

The exact provider API calls, OAuth flow, resource graph, naming rules, and
error translation stay inside the driver. The generic app deals only in these
concepts:

- an **agent deployment**;
- a provider **destination/account** selected by the user;
- an agent **endpoint** and gateway credential; and
- opaque provider **resource IDs** held by the driver.

For example, a provider's project, service, workspace, app, machine, or
cluster terminology must not leak into generic lifecycle types or screens.
Provider-specific setup screens are fine, but they are reached through the
registered driver rather than from provider-name conditionals.

The shared implementation points are:

- `mobile/src/providers/types.ts` — provider-neutral deployment and plugin
  contracts;
- `mobile/src/providers/registry.tsx` — the only compile-time installation
  point for provider plugins; and
- `mobile/src/providers/runtime-config.ts` — product-level runtime image
  selection shared by every provider.

## Deployment specification

The generic deployment specification is the contract every driver must
translate faithfully. It includes:

- an externally supplied runtime image reference;
- `GATEWAY_TOKEN`, selected `STT_PROVIDER` / `TTS_PROVIDER` IDs, and the secret
  environment map declared by those voice providers;
- a persistent volume mounted at `/data`;
- an ephemeral `/workspace`;
- exactly one replica;
- an unauthenticated `GET /health` check;
- the platform-injected `PORT`, with the process reachable on
  `0.0.0.0`;
- restart after a clean process exit; and
- sleeping disabled so long-lived voice WebSockets remain usable.

Voice provider selection and credentials are app-level Settings on the phone.
The generic app resolves the selected STT/TTS manifests from the credential
vault and includes provider IDs plus a generic secret map in the deployment
specification. Host setup screens authorize the host account and name the
deployment; they must not hard-code voice vendor names or key fields.

One agent deployment runs one container at a time. A fresh session recreates
the container while retaining the deployment endpoint and `/data`; it must not
turn `/workspace` into durable state.

The runtime image is product-level build configuration, not a provider-driver
constant or private operator setting. An official build may default to a
public upstream image, and a fork may configure its own published image.
Release builds must use an immutable digest or immutable version reference.
Never make a public provider path depend on private operator registry
credentials.

## Credentials and checkpoints

Provider OAuth and API tokens remain in the phone's native secure storage.
They may be used transiently for provider API requests, but must never be sent
to the gateway or written to AsyncStorage. Gateway, voice-provider, and other
deployment secrets must likewise stay out of provisioning checkpoints, logs,
and error text.

A checkpoint may contain only non-secret transaction data: the driver ID,
agent/provisioning ID, phase, desired state, opaque remote resource IDs,
endpoint metadata that is not a credential, pending mutation, timestamps, and
redacted error state. Store credential references rather than raw values when a
later resume needs to select them.

## Resumable provisioning

Provisioning is a transaction over APIs that may have side effects. It is not
a list of assumed-idempotent calls.

1. Validate the deployment specification and load the last checkpoint.
2. Before each remote mutation, checkpoint the phase and the mutation that is
   about to occur.
3. Perform one mutation.
4. Checkpoint every returned resource ID and the resulting state immediately.
5. Continue only from confirmed state, and mark the deployment ready only after
   the public endpoint passes the product health check.

Some APIs automatically deploy when configuration changes. The driver must
record that behavior, avoid issuing a second deployment blindly, and reconcile
the provider's observed state before continuing. If a request times out or
disconnects after it may have succeeded, mark its outcome unknown and reconcile
by stable identifiers or provider queries before retrying. Never create a
second project, service, volume, domain, or deployment merely because the
client did not receive the first response.

Resume must be safe after interruption at every mutation boundary. A failed
transaction should remain inspectable and retryable, with a clear distinction
between a known failure and an unknown remote outcome.

Stopping and deleting are also provider operations. Stop must be repeatable.
For a provider-created deployment, delete remote resources first and remove the
local profile/checkpoint only after cleanup is confirmed. Cleanup of a partial
launch must discover and remove all resources already created, while refusing
to guess about an unknown resource. Removing a manually paired host deletes
only the phone's local connection and never deletes that host.

## Generic UI and registry rules

The app discovers available drivers from a compiled registry. Generic screens
render driver metadata, invoke the driver's setup flow, and display generic
deployment lifecycle states. They must not branch on provider IDs to change
launch, status, stop, start, or delete behavior.

A driver may register custom setup or authorization screens and provider
specific account selectors. Those screens return the provider-neutral
destination and launch inputs expected by the lifecycle layer. Keep provider
labels, resource terminology, API clients, and credential handling in the
provider module.

## Tests and live validation

Before submitting a driver, add automated tests for:

- registry discovery and generic UI behavior without provider-ID branches;
- mapping the complete generic deployment specification, including image,
  `/data`, ephemeral `/workspace`, one replica, health check, injected port,
  restart policy, and disabled sleeping;
- setup and authorization success, cancellation, expiration, and reauth;
- every launch mutation and checkpoint, including resume from each phase;
- a timeout or lost response after a mutation, proving reconciliation does not
  duplicate remote resources;
- APIs that automatically deploy during configuration;
- status, health verification, stop, fresh deployment, and repeated calls;
- redaction and the absence of secrets from checkpoints, AsyncStorage, logs,
  and error messages; and
- partial-launch cleanup, including cleanup failure and a later retry.

Validate a driver against a disposable account and deployment:

1. Authorize, launch, and confirm the unauthenticated public `/health` check.
2. Confirm the image, injected `PORT`, one replica, `/data` persistence,
   ephemeral `/workspace`, clean-exit restart, and disabled sleeping settings.
3. Exercise a voice session, stop it, then start a fresh session and verify a
   new container is running with the same deployment endpoint and `/data`.
4. Inject or simulate failures after each remote mutation, resume, and verify
   that exactly one resource set exists and the endpoint becomes healthy.
5. Delete a successful deployment and a deliberately partial deployment, then
   verify that all provider resources are gone and local state is removed only
   after remote cleanup.

Do not describe a provider as validated until these checks have been run
against that provider. Keep provider-specific operational notes in
`docs/deployment/<provider>.md`.

## Adding a provider checklist

Create an isolated module with a small, testable surface:

```text
mobile/src/providers/<provider>/
  plugin.tsx             # metadata, setup registration, lifecycle entry points
  SetupScreen.tsx        # provider-specific authorization and destination UI
  driver.ts              # provisioning transaction and lifecycle behavior
  auth-session.ts        # OAuth/API authorization and secure credential use
  operations.ts          # provider API calls and response translation
  persistence.ts         # non-secret checkpoints and migration logic
  *.test.ts              # contract, recovery, and cleanup tests
docs/deployment/<provider>.md
```

Before opening a PR:

- define stable metadata and register the driver at compile time;
- keep provider vocabulary and SDK/API code inside the module;
- accept the runtime image and complete generic deployment specification as
  inputs rather than hardcoding private deployment state;
- checkpoint remote IDs after every mutation and implement reconciliation;
- keep all credentials out of checkpoints, AsyncStorage, logs, and the
  gateway;
- implement launch, resume/reconcile, status, fresh deployment, stop, and
  delete/cleanup semantics;
- add failure, unknown-outcome, recovery, and remote-cleanup tests; and
- add a provider guide only after live validation, without committing account
  credentials, resource IDs, hostnames, or operator configuration.
