# Railway

Railway is the first managed host with a dedicated guide: it builds the
Dockerfile, terminates TLS, keeps a volume, and can restart the container
when the gateway exits.

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
3. Values for `GATEWAY_TOKEN`, `DEEPGRAM_API_KEY`, and `ELEVENLABS_API_KEY`.
   Generate a long random `GATEWAY_TOKEN`; do not reuse a password.

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
railway variable set GATEWAY_TOKEN=… DEEPGRAM_API_KEY=… ELEVENLABS_API_KEY=… \
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
7. **Variables**: `GATEWAY_TOKEN`, `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`.
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
