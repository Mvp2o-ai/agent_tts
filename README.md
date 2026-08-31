# agent_tts

A **mobile-only** voice remote for a coding agent that runs in a container on a host you operate.

You speak into your phone. Connect GitHub, optionally choose a startup set of
repositories for an agent container, and they are cloned before its harness
(Claude Code, Cursor CLI, Gemini CLI, or Codex CLI) starts. Replies come back as
speech. There is no web version. This repository is the self-hosted
distribution — bring your own provider account or existing container host, plus
your model and voice-provider keys.

Users can launch a new agent through a supported provider driver (Railway
first), or connect an already-running local/VPS agent by URL and gateway token.
A QR pairing code imports that same existing-agent connection without requiring
the URL and token to be typed.

> **Setting this up with a coding agent?** Give it this repository and tell it
> to follow [`AGENTS.md`](./AGENTS.md). That guide defines the clean-clone
> bootstrap, secrets boundary, verification gates, and architecture contracts.

## What you get

- **Walkie-talkie** (push-to-talk) and **hands-free** (open mic) — the only two modes; no text chat
- **Barge-in**: speaking while the agent is talking stops playback and queues your utterance
- **Prompt queue**: talk while the harness is mid-turn; it runs next
- **Stop word** (default `hard stop`): transcript match aborts the in-flight harness turn
- **One image, one agent per deployed container**: gateway + adapter + harness CLIs in the same image; the adapter runs as a non-root child process
- **Multiple live agents in the app**: keep several container endpoints connected, switch focus without stopping background work, and retain a transcript per agent
- **GitHub repository picker**: sign in with Device Flow and choose an optional startup repository subset for each agent
- **Device credential library**: save GitHub, model, and voice-provider tokens in native secure storage. Voice keys are app-level; GitHub and model keys are selected per agent
- **SQLite** persistence — a single file on a volume, no database server
- **Native Expo (React Native) app** — iOS + Android, TestFlight / signed-APK sideload, intentionally not the app stores

## Architecture

One deployed container = one agent. The gateway and its single harness live in
the same image; no Docker socket, no nested containers.

```
mobile (Expo RN, native audio — the ONLY client; there is no web UI)
   │  WebSocket: PCM 16 kHz up / PCM 24 kHz + JSON events down
   ▼
agent container (one per agent identity; operator deploys it anywhere)
   ├─ gateway (Node/TS, headless API)
   │    STT adapter (default: Deepgram) ── transcripts, stop-word, barge-in
   │    TTS adapter (default: ElevenLabs) ── agent replies
   │    prompt queue + config (SQLite file on mounted volume)
   └─ adapter (child process, JSON-lines over stdin/stdout)
        ├─ provisioner: clones the optional startup set into /workspace
        └─ harness: claude-code | cursor-cli | gemini-cli | codex, cwd = /workspace
```

The mobile app stores multiple agent endpoints (URL + token) and can keep their
voice sockets live concurrently. Only the focused agent owns the microphone and
speaker; background agents continue as text-only, avoiding unused TTS charges.
A dropped socket does not abort the harness turn: reconnect reattaches to the
same adapter and replays missed text events. Two agents = two deployments, even
if both run Claude.

### Container lifecycle

- **Immutable image, disposable container.** A new session means the gateway process exits and the operator’s platform recreates the container from the image. Fresh disk, fresh memory, fresh `git clone`. There is no in-place cleanup path.
- Only the mounted config volume (SQLite) survives. Work not pushed before exit is intentionally not durable.
- Managed hosts and Kubernetes recreate on exit. Plain `docker restart` does **not** — operators on raw Docker need recreate semantics, e.g. `docker run --rm` under a supervisor or Compose force-recreate.

## Run the agent (any Linux/macOS host with Docker)

```bash
git clone <your fork>
cd agent_tts
cp .env.example .env   # GATEWAY_TOKEN, optional STT_PROVIDER/TTS_PROVIDER, voice keys

npm ci && npm test
docker compose up -d --build    # one agent container + SQLite volume
```

The gateway listens on `:4100`. For phone access, expose it on your LAN or put TLS in front (Caddy/nginx) and use `https://`. Deploy additional copies of the same image (each with its own URL, token, and SQLite volume) to run more than one agent.

### Who sets `GATEWAY_TOKEN`

There are two connection paths, and they own the token differently:

| Path | Who creates `GATEWAY_TOKEN` | What you do on the phone |
|---|---|---|
| **Host you start yourself** (Compose, VPS, Kubernetes, Railway CLI/dashboard) | You — put a long random value in that host’s environment (`.env` for Compose) | Pair with that same value: paste URL + token, or scan the setup QR |
| **In-app provider launch** (e.g. **Launch on Railway**) | The app — it generates a token and injects it into the new container | Nothing for the token; the profile is added after health check |

Do **not** copy `GATEWAY_TOKEN` from a local `.env` into an in-app launch, and
do not expect App Settings to ask for it. App Settings holds voice and model
keys used when the phone launches a container; gateway auth is either your
host’s env (manual pair) or generated at launch time (provider driver).

Provider launch is optional. The gateway runtime never calls a cloud API;
isolated mobile provider drivers provision resources in the user's own account.
Users can always connect a manually launched agent instead. Any container host
that meets the contract in
[`docs/deployment/`](./docs/deployment/README.md) works (VPS, Railway, Fly,
Render, Kubernetes, and so on). Railway is the first provider-launch target:
[`docs/deployment/railway.md`](./docs/deployment/railway.md). More providers
belong here after an implementation has passed the runtime contract. Provider
contributors use the dedicated
[`provider plugin pattern`](./docs/deployment/provider-drivers.md), so adding a
host does not add provider branches to the generic app or runtime.

## Run the app

The easiest physical-device path is a standalone EAS internal build in your
own Expo account:

```bash
npm run mobile:install
```

The guided command handles project setup, signing prompts, build submission,
and prints the Expo install page to open on the phone. iPhone builds require a
paid Apple Developer membership; Android APK builds do not require Google Play.
See the complete
[`mobile distribution guide`](./docs/mobile-distribution.md).

For a local native build instead:

```bash
cd mobile
npm ci
# Optional for a fork with its own GitHub OAuth App:
# export EXPO_PUBLIC_GITHUB_CLIENT_ID=<your-github-oauth-client-id>
npx expo run:ios      # or run:android — dev client, not Expo Go
```

The app ships an upstream public GitHub OAuth client ID and uses Device Flow;
forks require no GitHub setup. No client secret is embedded. Users connect
GitHub once, then select an optional startup repository subset for each agent
container. Selecting none is valid. The OAuth `repo` grant permits access to
the user's available private repositories; the in-app selection controls which
repositories are sent to a container. See the complete
[`GitHub OAuth guide`](./docs/github-oauth.md).

Everything else is configured in-app: one or more agents (agent name,
gateway URL, token), harness, that harness's API key, stop word, and voice.
GitHub, model, and voice-provider tokens are kept in the phone's native secure
storage and can be selected for multiple agents; raw values are not written to
AsyncStorage.
Per-agent non-GitHub-secret config is stored by that agent’s gateway in SQLite.

The Talk screen's session switcher defaults to names such as `Claude · Project
1` and shows each agent's live state. Switching changes microphone/speaker
focus without disconnecting the other agents. Each profile has an independently
persisted transcript; the app appends across reconnects and clears only the
affected transcript when that container reports a new generation.

The image includes `git` and `gh`. During each new container session, the
adapter clones every selected startup repository to a stable
`/workspace/owner--name` directory, reports provisioning progress to the phone,
and starts the harness only after all clones succeed. The startup set is not a
live workspace inventory; the harness owns any additional in-session clones.
The GitHub user access token is injected as a host-scoped `http.extraheader`
and `GH_TOKEN`; it is never placed in a clone URL or `.git/config`. The harness
can still clone additional HTTPS remotes. SSH remotes are not authenticated.

Harness keys (BYO):

| Harness | Env key the container receives |
|---|---|
| Claude Code | `ANTHROPIC_API_KEY` |
| Cursor CLI | `CURSOR_API_KEY` |
| Gemini CLI | `GEMINI_API_KEY` |
| Codex CLI | `OPENAI_API_KEY` |

## Operator harness check (no phone needed)

```bash
curl -sS -H "Authorization: Bearer $GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Clone https://github.com/octocat/Hello-World.git and list the files."}' \
  http://localhost:4100/v1/debug/prompt
```

Provisions the configured `/workspace`, starts the selected CLI, and streams
NDJSON events back. Use it to prove a harness works before touching audio.

## Repo layout

| Path | Role |
|---|---|
| `gateway/` | Headless API: STT/TTS relay, sessions, config; Dockerfile for the single-agent image |
| `mobile/` | Expo React Native app (the only client) |
| `docker-compose.yml` | One agent container + persistent SQLite volume on your host |
| `docs/deployment/` | Hosting contract and per-provider wiring (Railway first) |

## Adapter protocol

Gateway → adapter: `{ "type": "prompt", "id", "text" }` · `{ "type": "abort", "reason": "stop_word"|"user" }`

Adapter → gateway: `chunk` · `tool_event` · `done` · `aborted` · `error` (JSON lines on stdio)

## Contributing

Open a pull request against `main`. External contributors fork first; people
with write access can use a branch in this repo. CI must stay green. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md), [`SECURITY.md`](./SECURITY.md), and the
[`Code of Conduct`](./CODE_OF_CONDUCT.md). Support, maintainership, and release
policy are documented in [`SUPPORT.md`](./SUPPORT.md),
[`MAINTAINERS.md`](./MAINTAINERS.md), and [`RELEASING.md`](./RELEASING.md).

## License

GNU Affero General Public License v3.0 (AGPL-3.0). You can self-host,
modify, and redistribute the project under the license terms. Operators who
offer a modified version over a network must make that version's corresponding
source available to its users.

An official managed service may be offered separately. Hosting, billing,
provisioning, and operations around the open-source runtime can be commercial
without making this repository source-available-only.
