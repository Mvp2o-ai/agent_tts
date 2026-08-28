# agent_tts — Plan

## What it is

A mobile voice remote for a coding agent running in a container. The user
connects GitHub and attaches repositories to a container; the adapter clones
them before the harness starts. The user then speaks and the harness works in
that workspace. Additional clones, git operations, PRs, tools, and editing are
the harness's job.

## Architecture

One deployed container = one agent. The gateway and its single harness live in
the same image; no Docker socket, no nested containers, no provider API.

```
mobile (Expo RN, native audio — the ONLY client; there is no web UI)
   │  WebSocket: PCM 16 kHz up / MP3 + events down
   ▼
agent container (one per agent identity; operator deploys it anywhere)
   ├─ gateway (Node/TS, headless API)
   │    STT (Deepgram streaming) ── transcripts, stop-word, barge-in
   │    TTS (ElevenLabs streaming) ── agent replies
   │    prompt queue + config (SQLite file on mounted volume)
   └─ adapter (child process, JSON-lines over stdin/stdout)
        ├─ provisioner: selected repositories → /workspace siblings
        └─ harness: claude-code | cursor-cli | gemini-cli | codex, cwd = /workspace
```

The mobile app stores multiple agent endpoints (URL + token), keeps active
sessions connected concurrently, and switches microphone/speaker focus between
them. Unfocused sessions continue text-only. A reconnect reattaches to the same
harness turn and replays missed events. Two agents = two deployments, even if
both run Claude.

## Container lifecycle

- **Immutable image, disposable container.** New session = the gateway exits;
  the operator's platform recreates the container from the image. Fresh disk,
  fresh memory, fresh `git clone`. There is no in-place cleanup path.
- Only the mounted config volume (SQLite) survives. Work not pushed before
  exit is intentionally not durable.
- Operator contract: the platform must recreate the container from the image
  on exit (managed hosts and k8s do; plain `docker restart` does not — use
  recreate semantics, e.g. `docker run --rm` under a supervisor).
- This mirrors Cursor cloud agents / Claude Code web / Copilot / Jules:
  one task per isolation unit, prepared base image, durability via git only.

## Core behaviors (the spec)

1. **Two modes only.** Walkie-talkie (push-to-talk) and hands-free (open mic with VAD). No text chat in v1.
2. **Barge-in is first-class.** User speech during TTS playback immediately ducks/stops playback, captures the utterance, and enqueues it. Must feel as smooth as the web platform.
3. **Prompt queue.** Utterances that arrive while the harness is mid-turn are queued and dispatched on the next iteration — same semantics as the platform's incoming-prompt queue.
4. **Stop word = hard stop.** A configurable keyword (default: "hard stop") detected in STT aborts the current harness turn exactly like pressing the web UI stop button. Detection is transcript-based (Deepgram interim results), not a separate wake-word model.
5. **One agent per container.** The image ships all four harness CLIs, but container config binds exactly one agent identity and one harness. Never two agent processes in one container. Adding a harness = adding an adapter, no mobile/gateway changes.
6. **Config lives in SQLite.** Per-user config (attached repositories, harness
   choice, model keys, stop word, voice) is stored in a SQLite file and
   editable from the mobile app. GitHub tokens stay in the phone's secure
   store and are delivered only for a live session. Bring your own persistence
   volume.
7. **Repo provisioning.** A GitHub App Device Flow token lists repositories in
   the mobile app. Each agent stores its selected subset. The adapter clones
   all selections to stable `/workspace/owner--name` directories and emits
   provisioning progress before `ready`; the harness can clone more, check out
   PRs, and open PRs.
8. **Device-side session identity.** Each agent has a renameable local project
   name, transcript keyed by profile and container generation, and selectable
   GitHub/model-token references backed by native secure storage.

## Stack decisions

- **Mobile:** Expo (React Native) with native audio modules (dev client / EAS, not Expo Go) — one codebase, TestFlight + APK sideload. Mobile is the only client.
- **Voice:** Deepgram streaming STT, ElevenLabs streaming TTS (known-good for barge-in latency). BYO keys.
- **Gateway:** Node + TypeScript, `ws` WebSockets, SQLite (`node:sqlite`) for config. Headless — no web UI.
- **Image:** Debian-slim, node + the four harness CLIs + gateway; JSON-lines
  adapter protocol (`initialize`, `provisioning`, `ready`, `prompt`, `chunk`,
  `tool_event`, `done`, `abort`). Adapter runs as a non-root child process of
  the gateway.
- **Runtime:** single-agent appliance. Operator deploys the image to any container host (Hostinger, Fly, Railway, a VPS, k8s) and gets a URL/IP. This repo never creates containers, never touches a Docker socket, and ships no managed/hosted anything. Provider-specific volume, TLS, and restart wiring lives in `docs/deployment/`.

## Milestones

1. **M0 — Scaffold + CI** (this commit): repo layout, workspaces, lint/test/build CI, agentbox image build workflow.
2. **M1 — Box protocol:** agentbox image, claude-code adapter, gateway can run a text prompt end-to-end (no audio).
3. **M2 — Voice loop:** mobile PTT → Deepgram → prompt → harness → ElevenLabs → playback.
4. **M3 — Interaction semantics:** barge-in, prompt queue, stop word, hands-free VAD.
5. **M4 — Config + auth:** GitHub Device Flow, per-agent repository picker,
   harness/keys, SQLite config, and session security.
6. **M5 — Harness parity:** gemini-cli, codex, and cursor-cli adapters; harness switching from the app.
7. **M6 — Distribution:** EAS build profiles, TestFlight lane, signed APK artifact from CI.

## CI/CD (GitHub Actions)

- `ci.yml` — on PR/push: install, lint, typecheck, test across workspaces.
- `agentbox.yml` — on `agentbox/**` change to main: build + push image to GHCR.
- `deploy-gateway.yml` — on main: build the gateway so the artifact is proven. Deploy is the operator's job (this is not a hosted product).
- Mobile builds via EAS at M6 (not in CI initially).

## Open questions to align on

1. ~~Where does the gateway live?~~ **BYO host.** Operator deploys the single-agent container anywhere. No first-party hosting.
3. ~~Container-per-session vs. long-lived?~~ **Disposable:** container exits on new session; platform recreates from image. Cold-start = restart + clone; if it hurts, bake deps into the image (never preserve state).
4. ~~Who pays for model keys?~~ **BYO everything** (GitHub App, keys, host, Docker image).
5. Stop word default and whether it must work while TTS is playing loudly (echo cancellation requirements). Browser capture uses `echoCancellation: true`; still verify on speakerphone hardware.
