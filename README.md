# agent_tts

A **mobile-only** voice remote for a coding agent that runs in a container on a host you operate.

You speak into your phone. Connect GitHub, attach one or more repositories to an
agent container, and they are cloned before its harness (Claude Code, Cursor
CLI, Gemini CLI, or Codex CLI) starts. Replies come back as speech. There is no
web version. This repository is the self-hosted distribution — bring your own
host, container runtime, GitHub App, model keys, Deepgram key, and ElevenLabs
key.

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
- **GitHub repository picker**: sign in with Device Flow and attach any accessible repository subset to each agent
- **Device credential library**: save GitHub and model tokens in native secure storage, then select them for any agent
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
   │    STT (Deepgram streaming) ── transcripts, stop-word, barge-in
   │    TTS (ElevenLabs streaming) ── agent replies
   │    prompt queue + config (SQLite file on mounted volume)
   └─ adapter (child process, JSON-lines over stdin/stdout)
        ├─ provisioner: clones selected repositories into /workspace
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
cp .env.example .env   # GATEWAY_TOKEN, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY

npm install && npm test
docker compose up -d --build    # one agent container + SQLite volume
```

The gateway listens on `:4100`. For phone access, expose it on your LAN or put TLS in front (Caddy/nginx) and use `https://`. Deploy additional copies of the same image (each with its own URL, token, and SQLite volume) to run more than one agent.

Managed hosts are optional. The runtime does not call any cloud API. Any
container host that meets the contract in
[`docs/deployment/`](./docs/deployment/README.md) works (VPS, Railway, Fly,
Render, Kubernetes, and so on). Railway is the only managed-host guide so
far: [`docs/deployment/railway.md`](./docs/deployment/railway.md). More
guides belong there after someone has actually run this image on that host.

## Run the app

```bash
cd mobile
npm install
export EXPO_PUBLIC_GITHUB_CLIENT_ID=<your-github-app-client-id>
export EXPO_PUBLIC_GITHUB_APP_SLUG=<your-github-app-slug>
npx expo run:ios      # or run:android — dev client, not Expo Go
```

Create a GitHub App, enable Device Flow, and grant repository permissions for
Metadata (read), Contents (read/write), and Pull requests (read/write). No
client secret is embedded in the mobile app. Expiring access and refresh
tokens are rotated on-device before a session connects; repository access
remains bounded by the app installation and can be revoked at any time. Users
install the GitHub App on the repositories they permit,
authenticate from Settings, and multi-select the subset attached to each agent
container.
See the complete [`GitHub App setup guide`](./docs/github-app.md).

Everything else is configured in-app: one or more agents (project name,
gateway URL, token), harness, that harness's API key, stop word, and voice.
GitHub and model tokens are kept in the phone's native secure storage and can
be selected for multiple agents; raw values are not written to AsyncStorage.
Per-agent non-GitHub-secret config is stored by that agent’s gateway in SQLite.

The Talk screen's session switcher defaults to names such as `Claude · Project
1` and shows each agent's live state. Switching changes microphone/speaker
focus without disconnecting the other agents. Each profile has an independently
persisted transcript; the app appends across reconnects and clears only the
affected transcript when that container reports a new generation.

The image includes `git` and `gh`. During connection, the adapter clones every
selected repository to a stable `/workspace/owner--name` directory, reports
provisioning progress to the phone, and starts the harness only after all
clones succeed.
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

## License

GNU Affero General Public License v3.0 (AGPL-3.0). You can self-host,
modify, and redistribute the project under the license terms. Operators who
offer a modified version over a network must make that version's corresponding
source available to its users.

An official managed service may be offered separately. Hosting, billing,
provisioning, and operations around the open-source runtime can be commercial
without making this repository source-available-only.
