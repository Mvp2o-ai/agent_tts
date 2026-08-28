# Hosting the agent container

This repository is provider-agnostic: the runtime has no hosted-cloud SDK and
does not call any platform API. Operators bring a container host. Providers
still differ in the details that make the product contract work, so each
**tested** host gets its own guide.

## Universal contract

A host is compatible when it can do all of the following:

1. **Run our image.** Build `gateway/Dockerfile` from the repository root, or
   pull the GHCR image. Do not replace the process with a Railpack/Nixpacks
   Node build — the harness CLIs live in the image.
2. **One service = one agent.** Do not scale replicas. SQLite and the harness
   working tree are single-instance.
3. **Persist `/data`.** Mount a volume at `/data`. `CONFIG_DB` defaults to
   `/data/agent_tts.db`. That file is the only durable state.
4. **Leave `/workspace` ephemeral.** A new session is a new container
   filesystem. Do not persist `/workspace`.
5. **Recreate on process exit.** Session reset exits the process with code 0.
   `restart: always` (Compose), Kubernetes recreate, or the provider's
   **Always** restart policy must bring a fresh container back. A policy that
   only restarts on non-zero exit will leave the agent dead after a reset.
6. **TLS + WebSockets.** The mobile app speaks `wss://` to `/v1/voice`. The
   public URL must be HTTPS and must not idle-timeout long-lived WebSockets.
7. **Bind `PORT` on `0.0.0.0`.** The image already does this. Do not pin
   `PORT=4100` on hosts that inject `PORT`.
8. **Health check `GET /health`.** Unauthenticated, HTTP 200, JSON `{ ok: true }`.
9. **Run the gateway as non-root.** Host volumes are often root-owned. The
   image starts as root only to `chown /data`, then `exec`s as `agent`. Do
   **not** set the host to keep the main process as UID 0 to "fix" permissions
   (`RAILWAY_RUN_UID=0` or equivalent).
10. **Secrets.** `GATEWAY_TOKEN`, `DEEPGRAM_API_KEY`, and
    `ELEVENLABS_API_KEY` are host environment variables. Model keys are pushed
    from the phone into SQLite. GitHub user tokens remain in the phone's secure
    store and are delivered only over the authenticated session socket.

Local Compose remains the default development path: see the root
[`README.md`](../../README.md).

## Validated guides

Publish a named guide only after a live deploy of this image against that
host. Unverified notes belong in a PR description, not in this list.

| Host | Status | Guide |
|---|---|---|
| Docker Compose on a machine you operate | Validated (local/dev) | [README](../../README.md) |
| Railway | Only managed-host guide so far | [railway.md](./railway.md) |

## Submitting another provider

Anyone who gets this image running on another host (Hetzner, AWS, Fly,
Render, Kubernetes, …) should open a PR with:

1. `docs/deployment/<provider>.md` following [`_template.md`](./_template.md).
2. Only the extra steps that are actually nuanced on that host (volume
   ownership, restart-on-exit-0, WebSocket idle timeouts, TLS, `PORT`).
3. Evidence of a live check: `GET /health` over the public HTTPS URL, and a
   session reset that comes back as a new container with `/data` intact.

Do not add provider SDKs, webhooks, or special-case env vars to `gateway/`.
If a host cannot meet the contract without weakening it (root process, shared
replicas, no persistent volume, no restart on clean exit), say so in the
guide instead of changing the runtime.
