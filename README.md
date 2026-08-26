# agent_tts

Voice-first mobile client for a coding agent in a box.

A mobile app with exactly two modes — **walkie-talkie** (push-to-talk) and **hands-free** — that talks to a containerized coding harness (Claude Code, Gemini CLI, Codex CLI, or Cursor CLI) over TTS/STT. The harness does the actual engineering work against the user's git repo; agent_tts is the voice transport, prompt queue, and container configurator.

For engineers. Distribution is TestFlight / direct install (sideload) — intentionally not the app stores.

## Structure

| Path | What it is |
|---|---|
| `mobile/` | Expo React Native app (iOS + Android). PTT + hands-free, audio streaming, config UI. |
| `gateway/` | Node/TypeScript server. Sessions, STT/TTS relay, prompt queue, barge-in, stop-word, container lifecycle, config DB. |
| `agentbox/` | Docker image + adapters that wrap a coding harness (claude-code, gemini-cli, codex, cursor-cli) behind one stdin/stdout protocol, with the user's repo mounted/cloned inside. |
| `.github/workflows/` | CI (lint/test/build) and image publish. |

## Status

Scaffold only. See [PLAN.md](./PLAN.md).
