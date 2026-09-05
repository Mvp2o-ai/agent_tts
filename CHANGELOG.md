# Changelog

Notable changes are recorded here. This project follows semantic versioning.

## Unreleased

## 0.1.0 - 2026-09-05

First tagged open-source release of the mobile voice remote and BYOC agent
runtime.

### Added

- Comprehensive fork-safe CI for runtime, mobile, and container validation.
- Open-source contribution, support, security, governance, and release guidance.
- Dependabot, CodeQL, secret scanning, protected-branch, and review enforcement.
- GitHub OAuth Device Flow on the phone; session-scoped `git` and `gh` identity
  on the box, with a reconnect prompt when access expires.
- Per-turn model and effort selection from the app.
- Multiple agent sessions stay connected across microphone and speaker focus
  changes.
- Runtime image lock: in-app launches pin a published GHCR digest. A mobile
  artifact cannot be built against a pending or stale lock.
- Gateway STT diagnostic logs (`src:stt`) record each transcript slice and the
  exact text committed to the harness.

### Changed

- New session is one refresh control on the agent: confirm, then recreate this
  container. The start/stop toggle is gone.
- Speaking is audible playback only. A silent in-flight turn is Thinking;
  a tool event is Working.
- Deepgram PTT/hands-free waits for the stream to finish and joins every final
  segment of one utterance. TTS verbalizes numbers while transcripts keep digits.
- Voice sockets and HTTP routes accept `Authorization: Bearer` only. Query-string
  `token=` is rejected so the secret is not logged in request URLs.
- Compose publishes the gateway on `127.0.0.1:4100` only. A phone reaches a
  laptop-hosted agent through Tailscale Serve, not a LAN or public bind.
- Runtime images publish only after all required checks pass and now include
  OCI provenance and an SBOM.
- Gateway and mobile code use deterministic ESLint checks.
- The next prompt waits until client playout of the previous turn has finished.
- Railway launches resume after provider reauth. Phone diagnostics can be
  posted to the paired gateway for host logs.
- Startup repository selections persist per agent.

### Fixed

- Keep the Deepgram utterance prefix that arrived before a later interim result.
