# agent_tts

A **mobile-only** voice remote for a coding agent that runs in a container on a host you operate.

You speak into your phone. A harness (Claude Code, Cursor CLI, Gemini CLI, or Codex CLI) works in an empty Docker workspace; you tell it which git remotes to clone. Replies come back as speech. There is no web version. This repository is the self-hosted distribution — bring your own host, Docker engine, model keys, git PAT, Deepgram key, and ElevenLabs key.

> **Setting this up with a coding agent?** Give it this repository and tell it
> to follow [`AGENTS.md`](./AGENTS.md). That guide defines the clean-clone
> bootstrap, secrets boundary, verification gates, and architecture contracts.

## What you get

- **Walkie-talkie** (push-to-talk) and **hands-free** (open mic) — the only two modes; no text chat
- **Barge-in**: speaking while the agent is talking stops playback and queues your utterance
- **Prompt queue**: talk while the harness is mid-turn; it runs next
- **Stop word** (default `hard stop`): transcript match aborts the in-flight harness turn
- **One agentbox image** with all four CLIs; the adapter is selected per session
- **SQLite** persistence — a single file on a volume, no database server
- **Native Expo (React Native) app** — iOS + Android, TestFlight / signed-APK sideload, intentionally not the app stores

## Architecture

```
mobile (Expo RN, native audio)
   │  WebSocket: PCM 16 kHz up / PCM 24 kHz + JSON events down
   ▼
gateway (Node, headless API)
   │  Deepgram live STT · ElevenLabs streaming TTS
   │  prompt queue · stop-word · barge-in · SQLite config
   ▼
agentbox (Docker, one container per session)
   adapter JSON-lines on stdin/stdout
   harness cwd = /workspace (empty; agent clones)
```

## Run the gateway (any Linux/macOS host with Docker)

```bash
git clone <your fork>
cd agent_tts
cp .env.example .env   # GATEWAY_TOKEN, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY

npm install && npm test
npm run image:agentbox          # build the box image
docker compose up -d --build    # gateway + SQLite volume
```

The gateway listens on `:4100`. For phone access, expose it on your LAN or put TLS in front (Caddy/nginx) and use `https://`.

**Security note:** Compose mounts `/var/run/docker.sock` into the gateway so it can spawn agentbox containers. That is root-equivalent on the host. If you don't want that, run the gateway directly on the host (`node gateway/dist/index.js`) instead of in a container.

## Run the app

```bash
cd mobile
npm install
npx expo run:ios      # or run:android — dev client, not Expo Go
```

Everything is configured in-app (Settings tab): gateway URL + token, git PAT, optional git host, harness, that harness's API key, stop word, voice. Config is stored by the gateway in SQLite.

The agentbox image includes `git` and `gh`. The gateway injects a host-scoped PAT and **does not clone**. Tell the agent which remotes to clone (one or many). Public HTTPS clones work with an empty PAT. For private repos or `git push` / PRs, use a **fine-grained GitHub PAT** for those repos: Contents + Pull requests (read/write), short expiry, no admin/workflow scopes. There is no GitHub permission that is “PRs only” while still allowing a branch push. Do not use SSH remotes; there is no `ssh-agent` in the box.

Harness keys (BYO):

| Harness | Env key the box receives |
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

Starts an empty `/workspace`, runs the selected CLI in the box, streams NDJSON events back. The prompt is what clones. Use it to prove a harness works before touching audio.

## Repo layout

| Path | Role |
|---|---|
| `gateway/` | Headless API: STT/TTS relay, sessions, config, container lifecycle |
| `agentbox/` | Docker image + the four harness adapters |
| `mobile/` | Expo React Native app (the only client) |
| `docker-compose.yml` | Gateway + persistent volume on your host |

## Box protocol

Gateway → box: `{ "type": "prompt", "id", "text" }` · `{ "type": "abort", "reason": "stop_word"|"user" }`

Box → gateway: `chunk` · `tool_event` · `done` · `aborted` · `error` (JSON lines on stdio)

## License

GNU Affero General Public License v3.0 (AGPL-3.0). You can self-host,
modify, and redistribute the project under the license terms. Operators who
offer a modified version over a network must make that version's corresponding
source available to its users.

An official managed service may be offered separately. Hosting, billing,
provisioning, and operations around the open-source runtime can be commercial
without making this repository source-available-only.
