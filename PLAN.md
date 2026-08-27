# agent_tts — Plan

## What it is

A mobile voice remote for a coding agent running in a container. The user speaks; the harness (Claude Code / Gemini CLI / Codex CLI / Cursor CLI) clones remotes and works in them; responses come back as speech. Everything else — git, PRs, tools, editing — is the harness's job.

## Architecture

```
mobile (Expo RN, native audio — the ONLY client; there is no web UI)
   │  WebSocket: PCM 16 kHz up / MP3 + events down
   ▼
gateway (Node/TS, headless API)
   │  STT (Deepgram streaming) ── transcripts, stop-word, barge-in
   │  TTS (ElevenLabs streaming) ── agent replies
   │  prompt queue + per-user config (SQLite file, BYO volume)
   ▼
agentbox (Docker, one per session)
   │  adapter speaks one JSON-lines protocol over stdin/stdout
   └─ harness: claude-code | cursor-cli | gemini-cli | codex, cwd = /workspace (empty; agent clones)
```

## Core behaviors (the spec)

1. **Two modes only.** Walkie-talkie (push-to-talk) and hands-free (open mic with VAD). No text chat in v1.
2. **Barge-in is first-class.** User speech during TTS playback immediately ducks/stops playback, captures the utterance, and enqueues it. Must feel as smooth as the web platform.
3. **Prompt queue.** Utterances that arrive while the harness is mid-turn are queued and dispatched on the next iteration — same semantics as the platform's incoming-prompt queue.
4. **Stop word = hard stop.** A configurable keyword (default: "hard stop") detected in STT aborts the current harness turn exactly like pressing the web UI stop button. Detection is transcript-based (Deepgram interim results), not a separate wake-word model.
5. **Harness-agnostic box.** The container image includes all four harnesses (claude-code, gemini-cli, codex, cursor-cli); the adapter selects one per session. Adding a harness = adding an adapter, no mobile/gateway changes.
6. **Config lives in SQLite.** Per-user config (git PAT, optional git host, harness choice, model keys, stop word, voice) is stored in a SQLite file (Node's built-in driver, no server) and editable from the mobile app in real time. Bring your own persistence volume. No baked-in config.
7. **Repo access.** Gateway injects git/gh credentials into the container at session start. The adapter does not clone. The harness clones, checks out PRs, and opens PRs.

## Stack decisions

- **Mobile:** Expo (React Native) with native audio modules (dev client / EAS, not Expo Go) — one codebase, TestFlight + APK sideload. Mobile is the only client.
- **Voice:** Deepgram streaming STT, ElevenLabs streaming TTS (known-good for barge-in latency). BYO keys.
- **Gateway:** Node + TypeScript, `ws` WebSockets, SQLite (`node:sqlite`) for config. Headless — no web UI.
- **Agentbox:** Debian-slim Docker image with node + the four harness CLIs; JSON-lines adapter protocol (`prompt`, `chunk`, `tool_event`, `done`, `abort`).
- **Container runtime (v1):** the operator brings the host. The gateway spawns one container per session via the Docker API/socket on that host (`DOCKER_HOST` honored). This repo does not ship a hosted service or a vendor-specific VPS story. Orchestration stays thin so a k8s/Fly backend can replace Docker later.

## Milestones

1. **M0 — Scaffold + CI** (this commit): repo layout, workspaces, lint/test/build CI, agentbox image build workflow.
2. **M1 — Box protocol:** agentbox image, claude-code adapter, gateway can run a text prompt end-to-end (no audio).
3. **M2 — Voice loop:** mobile PTT → Deepgram → prompt → harness → ElevenLabs → playback.
4. **M3 — Interaction semantics:** barge-in, prompt queue, stop word, hands-free VAD.
5. **M4 — Config + auth:** mobile onboarding (git PAT, repo, harness, keys), Mongo-backed config, session security.
6. **M5 — Harness parity:** gemini-cli, codex, and cursor-cli adapters; harness switching from the app.
7. **M6 — Distribution:** EAS build profiles, TestFlight lane, signed APK artifact from CI.

## CI/CD (GitHub Actions)

- `ci.yml` — on PR/push: install, lint, typecheck, test across workspaces.
- `agentbox.yml` — on `agentbox/**` change to main: build + push image to GHCR.
- `deploy-gateway.yml` — on main: build the gateway so the artifact is proven. Deploy is the operator's job (this is not a hosted product).
- Mobile builds via EAS at M6 (not in CI initially).

## Open questions to align on

1. ~~Where does the gateway live?~~ **BYO host.** Operators run gateway + a container runtime. No first-party hosting.
3. Container-per-session vs. long-lived per-user container (affects cold-start vs. cost). v1 is container-per-session.
4. ~~Who pays for model keys?~~ **BYO everything** (keys, git PAT, host, Docker image).
5. Stop word default and whether it must work while TTS is playing loudly (echo cancellation requirements). Browser capture uses `echoCancellation: true`; still verify on speakerphone hardware.
