# agent_tts

A **mobile-only** voice remote for a coding agent that runs in a container on a host you operate.

You speak into your phone. A harness (Claude Code, Cursor CLI, Gemini CLI, or Codex CLI) works in your git repo inside a Docker container. Replies come back as speech. There is no web version and no hosted service — bring your own host, Docker engine, model keys, git PAT, Deepgram key, and ElevenLabs key.

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
   │  WebSocket: PCM 16 kHz up / MP3 + JSON events down
   ▼
gateway (Node, headless API)
   │  Deepgram live STT · ElevenLabs streaming TTS
   │  prompt queue · stop-word · barge-in · SQLite config
   ▼
agentbox (Docker, one container per session)
   adapter JSON-lines on stdin/stdout
   harness cwd = clone of your repo
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

Everything is configured in-app (Settings tab): gateway URL + token, repo URL, git PAT, harness, that harness's API key, stop word, voice. Config is stored by the gateway in SQLite.

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
  -d '{"text":"What is in this repo?"}' \
  http://localhost:4100/v1/debug/prompt
```

Clones the configured repo, runs the selected CLI in the box, streams NDJSON events back. Use it to prove a harness works before touching audio.

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

MIT
