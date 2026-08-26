# walkie — Plan

## What it is

A mobile voice remote for a coding agent running in a container. The user speaks; the harness (Claude Code / Gemini CLI / Codex CLI / Cursor CLI) works in their repo; responses come back as speech. Everything else — git, tools, editing — is the harness's job.

## Architecture

```
mobile (Expo RN)
   │  WebSocket: audio up / audio + events down
   ▼
gateway (Node/TS)
   │  STT (Deepgram streaming) ── transcripts, stop-word, barge-in
   │  TTS (ElevenLabs streaming) ── agent replies
   │  prompt queue + session state (MongoDB)
   ▼
agentbox (Docker, one per session)
   │  adapter speaks one JSON-lines protocol over stdin/stdout
   └─ harness: claude-code | gemini-cli | codex | cursor-cli, cwd = user's repo clone
```

## Core behaviors (the spec)

1. **Two modes only.** Walkie-talkie (push-to-talk) and hands-free (open mic with VAD). No text chat in v1.
2. **Barge-in is first-class.** User speech during TTS playback immediately ducks/stops playback, captures the utterance, and enqueues it. Must feel as smooth as the web platform.
3. **Prompt queue.** Utterances that arrive while the harness is mid-turn are queued and dispatched on the next iteration — same semantics as the platform's incoming-prompt queue.
4. **Stop word = hard stop.** A configurable keyword (default: "hard stop") detected in STT aborts the current harness turn exactly like pressing the web UI stop button. Detection is transcript-based (Deepgram interim results), not a separate wake-word model.
5. **Harness-agnostic box.** The container image includes all four harnesses (claude-code, gemini-cli, codex, cursor-cli); the adapter selects one per session. Adding a harness = adding an adapter, no mobile/gateway changes.
6. **Config lives in a database.** Per-user config (repo URL, git credentials/PAT, harness choice, model keys, stop word, voice) is stored in MongoDB and editable from the mobile app in real time. No baked-in config.
7. **Repo access.** Gateway injects git credentials into the container at session start; adapter clones/pulls the configured repo. Harness's own git abilities take it from there.

## Stack decisions

- **Mobile:** Expo (React Native) — one codebase, dev-client friendly, TestFlight + APK sideload.
- **Voice:** Deepgram streaming STT, ElevenLabs streaming TTS (same vendors as the current platform; known-good for barge-in latency).
- **Gateway:** Node 22 + TypeScript, `ws` WebSockets, MongoDB for config/sessions.
- **Agentbox:** Debian-slim Docker image with node + the four harness CLIs; JSON-lines adapter protocol (`prompt`, `chunk`, `tool_event`, `done`, `abort`).
- **Container runtime (v1):** gateway spawns containers via Docker socket on the same host (Hetzner-style VPS). Orchestration abstraction kept thin so a k8s/Fly backend can replace it later.

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
- `deploy-gateway.yml` — on main: build gateway, deploy to host (target TBD at M4; placeholder until then).
- Mobile builds via EAS at M6 (not in CI initially).

## Open questions to align on

1. Project/product name — "walkie" is a placeholder.
2. Where does the gateway live in v1 — new Hetzner VPS, or share existing infra?
3. Container-per-session vs. long-lived per-user container (affects cold-start vs. cost).
4. Who pays for model keys in open-source mode — BYO keys only? (Assumed yes: BYO everything.)
5. Stop word default and whether it must work while TTS is playing loudly (echo cancellation requirements).
