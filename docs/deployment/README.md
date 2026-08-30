# Hosting the agent container

The gateway runtime is provider-agnostic: it has no hosted-cloud SDK and never
calls a platform API. Users may connect an agent they launched manually or use
an isolated mobile provider driver to create one in their own account.
Providers still differ in the details that make the product contract work, so
each **tested** target gets its own implementation and guide.

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
10. **Secrets.** `GATEWAY_TOKEN`, optional `STT_PROVIDER` / `TTS_PROVIDER`, and
    the secret environment variables required by those voice adapters are host
    environment variables. Defaults are Deepgram and ElevenLabs
    (`DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`). Model keys are pushed
    from the phone into SQLite. GitHub user tokens remain in the phone's secure
    store and are delivered only over the authenticated session socket.

The agent profile and its host deployment persist until the operator removes
them. A session is the disposable container run on that deployment; ending and
starting a session replaces the container while retaining the host identity,
public endpoint, and `/data` configuration volume.

Local Compose remains the default development path: see the root
[`README.md`](../../README.md).

## Pair an existing agent

The app accepts the gateway URL and token manually, or scans a versioned setup
link encoded as a QR code:

```text
agenttts://pair?v=1&url=<percent-encoded-http-or-https-url>&token=<percent-encoded-token>&name=<optional-name>
```

Scanning only fills the confirmation form; it does not connect automatically.
The QR code is a bearer secret because it contains `GATEWAY_TOKEN`. Render it
locally, show it only to the intended phone, and discard it after pairing.
Never send the setup link to an online QR-generation service, logs, analytics,
or issue trackers.

## Validated guides

Publish a named guide only after a live deploy of this image against that
host. Unverified notes belong in a PR description, not in this list.

| Host | Status | Guide |
|---|---|---|
| Docker Compose on a machine you operate | Validated (local/dev) | [README](../../README.md) |
| Railway | First provider-launch target | [railway.md](./railway.md) |

## Submitting another provider

Anyone who implements another target (Hetzner, AWS, Fly, Render, Kubernetes,
…) should open a PR with:

1. An isolated provider driver when in-app launch is supported, plus
   `docs/deployment/<provider>.md` following [`_template.md`](./_template.md).
2. Only the extra steps that are actually nuanced on that host (volume
   ownership, restart-on-exit-0, WebSocket idle timeouts, TLS, `PORT`).
3. Evidence of a live check: `GET /health` over the public HTTPS URL, and a
   session reset that comes back as a new container with `/data` intact.

Do not add provider SDKs, webhooks, or special-case env vars to `gateway/`.
Provider credentials and live resource IDs remain device-local and must never
enter the runtime container or repository.
If a host cannot meet the contract without weakening it (root process, shared
replicas, no persistent volume, no restart on clean exit), say so in the
guide instead of changing the runtime.

Use the compile-time plugin pattern and validation checklist in
[`provider-drivers.md`](./provider-drivers.md). Adding a provider should require
one isolated provider module and one registry entry; generic app screens and
lifecycle code must not branch on the new provider ID.
