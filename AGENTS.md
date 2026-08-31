# Agent setup and contribution guide

This file is the operating contract for coding agents working in this
repository. Complete setup and verification autonomously when the host has the
required tools and credentials. Do not replace unavailable integrations with
stubs and do not claim live validation when only mocks ran.
Keep this document timeless: record current principles, patterns, invariants,
and non-obvious project constraints, never incident history, failed attempts,
deployment logs, or a narrative of how the project reached its current state.

## Product contract

`agent_tts` is an open-source, mobile-only voice remote for coding agents:

```
React Native mobile app
  → agent container (gateway + adapter child process + one harness)
  → Claude Code, Cursor CLI, Gemini CLI, or Codex CLI
```

Preserve these decisions:

- There is no web or desktop client.
- Operators can either launch an agent through a supported public provider
 driver using their own provider account, or pair an already-running local/VPS
 agent by URL and gateway token (manually or by QR). In both paths the operator
 owns the host, persistence volume, and vendor keys. The adapter provisions an
 optional startup repository set before starting the harness; the harness may
 clone more.
- This is not a Railway product. Hosting is configuration- and adapter-driven:
  the mobile app discovers supported provider drivers from a small registry,
  passes each one a provider-neutral deployment specification, and keeps
  provider names, API calls, credentials, and resource state behind that
  driver. Railway is only the first implementation and reference test case.
  A provider added later must not require changes to the gateway, adapter,
  image, voice protocol, or generic agent lifecycle UI.
- SQLite is the only configuration persistence dependency.
- One deployed container = one agent. Gateway and harness live in the same
  image; the adapter runs as a non-root child process. No Docker socket, no
  nested containers. A new session means the gateway process exits and the
  operator’s platform recreates the container from the immutable image
  (managed hosts and Kubernetes do this; plain `docker restart` does not —
  use recreate semantics such as `docker run --rm` under a supervisor or
  Compose force-recreate). Only the SQLite config volume survives. Work not
  committed or pushed before a container exits is intentionally not durable.
- The mobile app stores multiple agent endpoints (URL + token), keeps multiple
  sessions connected, and switches microphone/speaker focus without aborting
  background work. Two agents = two deployments. Transcripts are device-side,
  keyed by profile and container generation.
- Harnesses run fully unattended because the container has no TTY.
- The mobile app stays React Native/Expo. Swift and Kotlin are limited to the
  native full-duplex audio module.
- Capture is PCM S16LE, 16 kHz, mono. Playback is PCM S16LE, 24 kHz, mono.
- Wired, USB, Bluetooth, and car audio routes take precedence over the device
  speaker. The native layer owns route changes, echo cancellation, background
  capture, and streamed playback.
- GitHub user access tokens must remain in host-scoped environment headers
  (`git`) and `GH_TOKEN` (`gh`). Never write a token into `.git/config` or a
  clone URL.
  The box ships `git` and `gh` so the agent can clone multiple remotes and
  run a normal checkout → review → open-PR flow.
- GitHub connection is a single user flow: tap **Connect GitHub**, complete
  GitHub OAuth Device Flow, then select the optional startup repositories for
  each agent. The open-source mobile app ships the upstream public OAuth client ID,
  and fork builds inherit it. A fork can set
  `EXPO_PUBLIC_GITHUB_CLIENT_ID` to use a different OAuth application identity.

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
docker build -t agent_tts:local -f gateway/Dockerfile .
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
- Optional `STT_PROVIDER` / `TTS_PROVIDER` (default `deepgram` / `elevenlabs`)
- Voice-provider secrets required by the selected adapters (defaults:
  `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`)

STT and TTS vendors are independent app-level registries. Deepgram and
ElevenLabs are the built-in defaults: choose them once in the mobile Settings
screen. Keys are stored in the phone's native secure credential library and
copied into each in-app-launched container. They are not part of per-agent
setup. A manually paired host already has its selected providers and keys in
its own environment. A new voice vendor is a registry entry (mobile manifest +
gateway adapter + contract tests), not a Railway, protocol, or Settings-screen
rewrite.

Harness model keys and GitHub credentials are also selected in the mobile
Settings / agent screens and saved in the phone's native secure credential
library. Raw GitHub tokens/model keys must not be written to AsyncStorage.
Model keys are also persisted by that agent's gateway:

- Provider OAuth access/refresh tokens and gateway bearer tokens must also
  remain in native secure storage. Never send provider credentials to an agent
  gateway. A QR pairing payload containing a gateway URL/token is bearer-secret
  material: do not log, persist in AsyncStorage, or include it in analytics.

- `ANTHROPIC_API_KEY`
- `CURSOR_API_KEY`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- GitHub OAuth Device Flow requests `repo` and `offline_access`. The mobile app
  lists the user's repositories through `/user/repos`, stores access and refresh
  tokens in native secure storage, rotates expiring tokens, and sends the
  current access token over the authenticated voice socket for a container
  session. Users select an optional startup repository subset for each agent.
  The gateway treats the token as session-ephemeral, and the adapter provides
  it to `git` through a host-scoped `http.extraheader` and to `gh` through
  `GH_TOKEN`. On each new container session, the selected startup repositories
  are cloned as stable `owner--name` siblings under `/workspace` before the
  harness starts. This set is separate from repositories the harness discovers
  or clones during a session.

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
voice socket. A manually launched agent may instead use a reachable LAN IP and
port over HTTP; internet-facing agents should use HTTPS/WSS.

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

Put the resulting `https://…ngrok…` URL directly into the active agent's
**Gateway URL** field in the app. Unreserved ngrok URLs can change when ngrok
restarts. For regular private use, a stable Tailscale hostname is preferable;
for an always-on deployment, use a VPS with TLS or a managed host from
[`docs/deployment/`](./docs/deployment/README.md). Expose only the gateway
HTTP/WebSocket port, require a strong `GATEWAY_TOKEN`, and never expose the
Docker socket or Docker API.

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

For image or harness changes:

1. Rebuild `agent_tts:local` from `gateway/Dockerfile`.
2. Verify the container runs as a non-root user. The entrypoint may start as
   root to chown a host-mounted `/data` volume, then it must `exec` as
   `agent`. Do not leave the gateway running as UID 0 (`RAILWAY_RUN_UID=0`
   or equivalent).
3. Verify the adapter spawns as a child process of the gateway.
4. Inspect the installed CLI's current `--help`; do not rely on remembered
   flags.
5. Provision selected remotes before `ready`, then have the harness inspect
   them, clone an additional remote, write a file, stream output, continue,
   and abort.
6. Confirm a new session is a fresh container from the image (not an in-place
   `docker restart`) and that only the SQLite volume survives.

For voice-path changes:

1. Confirm the `ready` event advertises `pcm_s16le`, 24 kHz, mono.
2. Test STT → harness → TTS with `scripts/voice-e2e.mjs`.
3. Verify non-empty playback PCM, stop-word abort, prompt queue, and barge-in.
4. Rebuild the native app after Swift, Kotlin, plugin, or native dependency
   changes. A Metro reload cannot install native code.
5. Treat simulator success as UI/protocol validation only. Headphones,
   microphone routing, echo cancellation, background behavior, and barge-in
   feel require a physical device.

When debugging a reported mobile UI symptom:

1. Read the Metro terminal log before forming any hypothesis. A runtime
   `SyntaxError` or `ReferenceError` there means the app is running stale or
   half-refreshed JS; every observation against it is invalid. Cold-relaunch
   (`xcrun simctl terminate booted <bundle-id>` then `launch`) and retest
   before changing code.
2. Fast Refresh is unreliable when a module's imports or hook usage change
   shape. After any structural refactor, force a cold relaunch instead of
   trusting the hot reload.
3. The iOS Simulator pasteboard is separate from the macOS clipboard. When
   testing paste, seed it explicitly
   (`printf 'X=y' | xcrun simctl pbcopy booted`) so "paste is broken" is a
   testable claim rather than an empty clipboard.
4. Apply one suspect change at a time; if it does not visibly fix the
   symptom, revert it before trying the next hypothesis.

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
- Keep the gateway, adapter, image, and voice protocol provider-neutral.
  Public provider-specific launch implementations live in isolated mobile
  provider modules and `docs/deployment/<provider>.md`; they must not introduce
  provider credentials, project IDs, hostnames, or deployment state into the
  core runtime. Register providers through configuration rather than branching
  generic UI or lifecycle code on provider names. Railway is the first provider
  implementation. Do not add deprecated `railway.json` / `railway.toml`.
- Voice STT and TTS vendors are independent compile-time registries. Core
  session code, the mobile protocol, and host drivers consume provider IDs plus
  a generic secret map. Canonical audio stays PCM S16LE (16 kHz capture, 24 kHz
  playback). A contribution adds a mobile manifest, a gateway adapter, a
  registry entry, and contract tests — not App Settings, Railway, or protocol
  edits. Deepgram and ElevenLabs remain the built-in defaults.
- Runtime image selection is product-level deployment configuration, not a
 provider-driver constant and not private operator state. The upstream default
 may reference an official public image; forks may select their own published
 image. Before a provider launch is supported, the exact configured image
 reference must exist and be pullable by a new user account without borrowing
 registry credentials from an operator instance. Release deployments should
 use an immutable digest or immutable version reference; mutable branch tags
 are development conveniences only.
- Operator repositories and live provider projects are consumers of this
 public product. They may pin an image and hold instance IDs, domains, secrets,
 and deployment scripts, but they are never a dependency, credential source,
 or control plane for public provider launches.
- Provider provisioning is a resumable transaction, not a sequence of assumed
  side-effect-free API calls. Checkpoint every remote resource identity,
  account for providers that auto-deploy when source configuration changes,
  avoid duplicate deployments, and report ready only after the configured
  endpoint passes the product health check.
- Treat an app profile as an agent deployment, not a work item. Sessions are
 disposable container runs on that deployment. Deleting a provider-created
 agent must delete its remote resources before removing its local profile;
 removing a manually paired host must never delete that host.

## Distribution and licensing

The repository is licensed under AGPL-3.0. The open-source runtime remains
self-hostable. A separate official managed service may provide commercial
hosting, provisioning, billing, upgrades, and support around this runtime.

Mobile distribution targets development clients, TestFlight/signed iOS builds,
and sideloaded Android APKs. There is intentionally no public app-store or
Google Play workflow in v1. `npm run mobile:install` is the public
bring-your-own-Expo device path; keep each operator's app identity, EAS project
ID, and signing credentials out of git.
