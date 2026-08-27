# Agent setup and contribution guide

This file is the operating contract for coding agents working in this
repository. Complete setup and verification autonomously when the host has the
required tools and credentials. Do not replace unavailable integrations with
stubs and do not claim live validation when only mocks ran.

## Product contract

`agent_tts` is an open-source, mobile-only voice remote for coding agents:

```
React Native mobile app
  → gateway (Deepgram STT, ElevenLabs TTS, SQLite config)
  → ephemeral Docker agentbox
  → Claude Code, Cursor CLI, Gemini CLI, or Codex CLI
```

Preserve these decisions:

- There is no web or desktop client.
- Operators bring their own host, Docker engine, persistence volume, vendor
  keys, and git credentials. The harness clones remotes; the adapter does not.
- SQLite is the only configuration persistence dependency.
- One non-root container is created per voice session. Work not committed or
  pushed before a container exits is intentionally not durable.
- Harnesses run fully unattended because the container has no TTY.
- The mobile app stays React Native/Expo. Swift and Kotlin are limited to the
  native full-duplex audio module.
- Capture is PCM S16LE, 16 kHz, mono. Playback is PCM S16LE, 24 kHz, mono.
- Wired, USB, Bluetooth, and car audio routes take precedence over the device
  speaker. The native layer owns route changes, echo cancellation, background
  capture, and streamed playback.
- Git credentials must remain in host-scoped environment headers (`git`) and
  `GH_TOKEN` (`gh`). Never write a PAT into `.git/config` or a clone URL.
  The box ships `git` and `gh` so the agent can clone multiple remotes and
  run a normal checkout → review → open-PR flow.

## Clean-clone bootstrap

Required host tools:

- Node.js 22 and npm
- Docker with permission to build and run containers
- For iOS: macOS, Xcode, and CocoaPods
- For Android: Android Studio/SDK and JDK 17

From the repository root:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run image:agentbox
```

Set up the mobile workspace separately:

```bash
cd mobile
npm ci
npm run typecheck
npm test
```

The app contains a local Expo native module and does not work in Expo Go.
Build a development client:

```bash
npx expo run:ios
# or
npx expo run:android
```

Builds and test suites that take more than a few seconds should run in the
background. Keep responding to the operator while they run, then report their
actual result.

## Secrets and local gateway

Create `.env` from the template:

```bash
cp .env.example .env
```

Required gateway values:

- `GATEWAY_TOKEN`
- `DEEPGRAM_API_KEY`
- `ELEVENLABS_API_KEY`

Harness model keys and repository credentials are normally entered in the
mobile Settings screen and persisted by the gateway:

- `ANTHROPIC_API_KEY`
- `CURSOR_API_KEY`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- HTTPS git PAT, optional for public clones. Prefer a fine-grained GitHub
  token covering the repos you will name by voice, with Contents and Pull
  requests (read/write), short expiry, and no admin or workflow scopes.
  GitHub has no “PRs only” token that can also push a branch; Contents write
  is required for `git push`. Classic `repo` tokens are broader than this
  product needs. The box has `git` and `gh`. Auth is a host-scoped
  `http.extraheader` plus `GH_TOKEN`; the adapter never clones. SSH remotes
  are not authenticated.

Never commit `.env`, SQLite files, API keys, PATs, signing credentials, or
generated native build output. Do not search unrelated projects for secrets.
If a required credential is unavailable, finish every non-secret-dependent
step and report only the exact missing variable and blocked live check.

Start the complete self-hosted topology:

```bash
docker compose up -d --build
curl --fail http://127.0.0.1:4100/health
```

The gateway listens on port `4100`. An iOS Simulator on the same Mac can use
`http://127.0.0.1:4100`; a physical phone must use the host's LAN address or a
TLS endpoint. The token entered in the app must equal `GATEWAY_TOKEN`.

### Expose a laptop-hosted gateway

The app accepts an HTTPS hostname directly and converts it to `wss://` for the
voice socket. An IP address is never required.

For a quick public tunnel with ngrok:

```bash
ngrok http 4100
```

For an existing `ngrok start --all` setup, add a named tunnel to ngrok's
configuration:

```yaml
tunnels:
  agent-tts:
    proto: http
    addr: 4100
```

Then start all configured tunnels:

```bash
ngrok start --all
```

Put the resulting `https://…ngrok…` URL directly into the app's **Gateway
URL** field. Unreserved ngrok URLs can change when ngrok restarts. For regular
private use, a stable Tailscale hostname is preferable; for an always-on
deployment, use a VPS with TLS. Expose only gateway port `4100`, require a
strong `GATEWAY_TOKEN`, and never expose the Docker socket or Docker API.

## Verification gates

Before calling a change complete, run checks proportional to the files touched:

```bash
# Gateway and adapter
npm run typecheck
npm test
npm run build

# Mobile TypeScript and protocol behavior
cd mobile
npm run typecheck
npm test
```

For agentbox or harness changes:

1. Rebuild `agent_tts-agentbox:local`.
2. Verify the container runs as the non-root `agent` user.
3. Inspect the installed CLI's current `--help`; do not rely on remembered
   flags.
4. Have the harness clone a remote, inspect it, write a file, stream output,
   continue, and abort.
5. Confirm the `--rm` container and temporary environment file are removed.

For voice-path changes:

1. Confirm the `ready` event advertises `pcm_s16le`, 24 kHz, mono.
2. Test STT → harness → TTS with `scripts/voice-e2e.mjs`.
3. Verify non-empty playback PCM, stop-word abort, prompt queue, and barge-in.
4. Rebuild the native app after Swift, Kotlin, plugin, or native dependency
   changes. A Metro reload cannot install native code.
5. Treat simulator success as UI/protocol validation only. Headphones,
   microphone routing, echo cancellation, background behavior, and barge-in
   feel require a physical device.

## Implementation rules

- Fix violated contracts at their source; do not hide failures with retries,
  hardcoded content, or success messages.
- Keep gateway and box protocols harness-agnostic.
- Maintain explicit `ready.audioFormat` negotiation. Never interpret arbitrary
  binary frames as a different codec without changing and testing the
  protocol.
- Preserve prompt ordering and abort precedence. A stopped turn must not emit
  trailing speech or win a completion race.
- Use bounded playback queues with backpressure. Never silently drop PCM.
- Keep configuration editable in the mobile app and durable through the
  operator-mounted SQLite volume.
- Do not add hosted-provider assumptions to the open-source runtime.

## Distribution and licensing

The repository is licensed under AGPL-3.0. The open-source runtime remains
self-hostable. A separate official managed service may provide commercial
hosting, provisioning, billing, upgrades, and support around this runtime.

Mobile distribution targets development clients, TestFlight/signed iOS builds,
and sideloaded Android APKs. There is intentionally no public app-store or
Google Play workflow in v1.
