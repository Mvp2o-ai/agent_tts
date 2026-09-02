# Changelog

Notable changes are recorded here. This project follows semantic versioning.

## Unreleased

### Added

- Comprehensive fork-safe CI for runtime, mobile, and container validation.
- Open-source contribution, support, security, governance, and release guidance.
- Dependabot, CodeQL, secret scanning, protected-branch, and review enforcement.

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
