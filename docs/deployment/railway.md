# Railway

Railway is the first public provider-launch target. Users can launch it from
the mobile app through Railway OAuth, or follow this guide to deploy and pair
an existing agent manually. Railway runs the image, terminates TLS, keeps a
volume, and can restart the container when the gateway exits.

The app ships with the public agent_tts Railway OAuth client ID, so users and
ordinary forks do not configure OAuth credentials. A rebranded fork with a
different callback scheme can override it at build time with
`EXPO_PUBLIC_RAILWAY_CLIENT_ID`. Native OAuth uses PKCE and no client secret.

Every Railway project, service, volume, domain, and credential created through
either path belongs to the user. This public implementation contains no
`agent_tts-ops` project identity or operator credentials.

## Launch from the app

**Launch on Railway** is the primary path for users who want Railway hosting.
The app authorizes Railway with OAuth, creates one isolated agent deployment
(project, service, volume, domain, and gateway token), and waits for its health
check before adding it to the agent list.

Railway receives the provider-neutral runtime image selected when the mobile
app was built. Official builds use the public upstream image; a fork can set
`EXPO_PUBLIC_AGENT_RUNTIME_IMAGE` to its own anonymously pullable,
digest-pinned artifact. Registry credentials from another operator or
deployment are never reused.

Voice provider keys are app-level credentials, not Railway account credentials
and not per-agent setup. Choose STT and TTS providers once in Settings
(defaults: Deepgram and ElevenLabs). The app copies those saved values into
the new service's Railway variables; it does not compile them into the app,
store them in AsyncStorage, or obtain them from another Railway project.

Ending an agent's session stops its deployment. Starting a new session creates
a fresh container on the same service while retaining the domain and SQLite
configuration volume. Deleting an app-provisioned Railway agent deletes its
Railway project and all resources inside it after confirmation. Removing a
manually connected host removes only the phone's saved connection.

**Connect an existing host** remains the path for a Railway service deployed
through IaC/dashboard/CLI, as well as local Docker, VPS, or Kubernetes hosts.
An existing Railway service already receives its voice keys from its own
environment, so pairing it requires only the gateway URL and token.

This file tracks Railway's **current** APIs as of 2026-08-27:

- [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code) —
  `.railway/railway.ts` is the supported project config. `railway.json` /
  `railway.toml` Config as Code is deprecated and stops being read on
  **2026-12-01**. New services cannot opt into it.
- [Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Volumes](https://docs.railway.com/volumes)
- [Restart policy](https://docs.railway.com/deployments/restart-policy)
- [Healthchecks](https://docs.railway.com/deployments/healthchecks)
- [Public networking](https://docs.railway.com/networking/public-networking)
- [CLI](https://docs.railway.com/cli)

If Railway's dashboard labels have moved, trust those docs over this page and
send a PR.

## Nuances

| Topic | What to do | What not to do |
|---|---|---|
| Runtime image | Use the product-configured public image, pinned by digest for releases | Hardcode a Railway-only image or depend on private registry credentials |
| Dockerfile path | Build `gateway/Dockerfile` from the repo root (`build.dockerfilePath` in IaC, or `RAILWAY_DOCKERFILE_PATH`) | Let Railpack/Nixpacks build the Node app from `package.json` |
| Volume | Mount at `/data` | Persist `/workspace`; skip the volume and lose config on every reset |
| Volume ownership | Let the image entrypoint `chown /data` then drop to `agent` | Set `RAILWAY_RUN_UID=0` so the gateway stays root. Railway documents that knob because volumes are mounted as root; it violates this project's security contract |
| Restart | **Always** (Hobby or Pro) | Free-plan **On Failure** — session reset exits 0, so the service stays down. Free also caps On Failure at 10 restarts |
| Replicas | 1 | Horizontal scale. One volume, one SQLite file, one harness |
| Sleep | Off (`sleepApplication: false`) | App sleeping. A voice WebSocket cannot wake the box |
| `PORT` | Use the value Railway injects | Force `PORT=4100` |
| Networking | Generate a Railway domain (`*.up.railway.app`). WebSockets are exempt from HTTP idle timeouts | Enable CDN in front of `/v1/voice` |
| Healthcheck | `/health`, ~120s timeout on first boot | Auth on `/health` |

Hobby is required for **Always** restart. That policy is what makes
`POST /v1/session/reset` (clean exit 0) come back as a new container.

## You need

1. A Railway account on **Hobby or Pro**.
2. This repository (GitHub connected to Railway, or the Railway CLI on the
   machine that will run `railway up`).
3. Values for `GATEWAY_TOKEN` and the selected voice providers (defaults:
   `DEEPGRAM_API_KEY` and `ELEVENLABS_API_KEY`; optional `STT_PROVIDER` /
   `TTS_PROVIDER`). Generate a long random `GATEWAY_TOKEN`; do not reuse a
   password.

Put secrets in Railway service variables, not in git. `preserve()` in IaC
means “do not delete whatever is already set in Railway.”

Example `.railway/railway.ts`. `railway config plan` / `apply` evaluate it
with Node, so run `npm install railway` next to the file. `railway up` uploads
this source repository so Railway can build `gateway/Dockerfile`.

```ts
import { defineRailway, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const data = volume("agent-tts-data", { sizeMB: 1024 });
  const agent = service("agent", {
    build: { builder: "DOCKERFILE", dockerfilePath: "gateway/Dockerfile" },
    healthcheck: "/health",
    healthcheckTimeout: 120,
    deploy: { restartPolicyType: "ALWAYS", sleepApplication: false },
    volumeMounts: { "/data": data },
    env: {
      CONFIG_DB: "/data/agent_tts.db",
      GATEWAY_TOKEN: preserve(),
      STT_PROVIDER: preserve(),
      TTS_PROVIDER: preserve(),
      DEEPGRAM_API_KEY: preserve(),
      ELEVENLABS_API_KEY: preserve(),
    },
  });
  return project("agent-tts", { resources: [agent, data] });
});
```

## CLI (preferred)

Install the CLI from [Railway's install docs](https://docs.railway.com/cli)
(`brew install railway`, `npm i -g @railway/cli`, or their install script).
IaC authoring needs **CLI 5.42.1 or newer**.

```bash
railway login
railway init          # new project, empty, in this workspace — not an existing one
railway add           # one empty service named `agent`, or let IaC create it
```

Set secrets **before** the first `config apply` so `preserve()` has values:

```bash
railway variable set GATEWAY_TOKEN=… STT_PROVIDER=deepgram TTS_PROVIDER=elevenlabs \
  DEEPGRAM_API_KEY=… ELEVENLABS_API_KEY=… \
  --service agent
```

Apply the repo config, attach the public domain, and deploy:

```bash
railway config plan
railway config apply
railway volume add --help   # IaC already declares volume `agent-tts-data` at /data
railway domain              # generates https://….up.railway.app
railway up --ci             # uploads this directory; Railway builds the Dockerfile
```

`railway config apply` is the current replacement for editing service settings
by hand. Preview with `plan` first. Omit `--yes` unless you have just reviewed
that plan; destructive applies also need `--confirm-destructive`.

Put the resulting `https://….up.railway.app` URL and the same `GATEWAY_TOKEN`
into the mobile app's Gateway URL / token fields.

## Dashboard equivalent

If you prefer the canvas over the CLI:

1. New project. Empty. Not a template, not an existing workspace project.
2. Add a GitHub service from this repo (or deploy with `railway up`).
3. **Settings → Build**: Dockerfile path `gateway/Dockerfile`.
4. **Settings → Networking**: Generate Domain. Target port = Railway `PORT`
   (leave empty if the service listens on the injected `PORT`).
5. **Settings → Deploy**: healthcheck `/health`, restart policy **Always**,
   replicas 1, app sleeping off.
6. **Settings → Volumes**: add a volume, mount path `/data`.
7. **Variables**: `GATEWAY_TOKEN`, optional `STT_PROVIDER` / `TTS_PROVIDER`,
   and the selected voice-provider secrets (defaults `DEEPGRAM_API_KEY`,
   `ELEVENLABS_API_KEY`).
   Do not set `RAILWAY_RUN_UID=0`.
8. Deploy. Confirm build logs contain `Using detected Dockerfile!`.

## Verify

```bash
curl --fail https://<your-service>.up.railway.app/health
```

Then either speak a turn from the app or:

```bash
curl --fail -X POST \
  -H "Authorization: Bearer $GATEWAY_TOKEN" \
  https://<your-service>.up.railway.app/v1/session/reset
```

Watch the deployment: Railway must start a new container (Always restart),
`/health` must return, and the SQLite file on `/data` must still be there
(`railway volume browse /` or a second Settings save from the app).

`railway ssh` + `id` should show user `agent`, not `root`.

## Two agents

Two Railway services (or two projects), each with its own volume, token, and
domain. The phone stores both endpoints. Do not run two harnesses in one
service.
