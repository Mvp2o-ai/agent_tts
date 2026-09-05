# agent_tts mobile

Native voice remote for a self-hosted agent_tts gateway. Phone-only: walkie-talkie
(push-to-talk) and hands-free (open mic). There is no text chat and no web client.

This is an **engineer device** app. Distribution is iOS Simulator / Expo dev
client / TestFlight (or a signed device binary) and Android APK sideload. There
is no App Store public release and no Google Play configuration.

## Dev client required

Native PCM capture and PCM playback need a development client or an EAS binary.
**Expo Go is not supported.** The local `voice-audio` Expo module owns the
audio session.

```bash
cd mobile
npm ci
# Optional for a fork:
# export EXPO_PUBLIC_GITHUB_CLIENT_ID=<github-oauth-client-id>
# export EXPO_PUBLIC_AGENT_RUNTIME_IMAGE=ghcr.io/your-org/agent_tts@sha256:...
npx expo run:ios          # Simulator, generates ios/ locally (gitignored)
# or
npx expo run:android
```

Then, if Metro is not already attached:

```bash
npx expo start --dev-client
```

The iOS Simulator can launch the UI and WebSocket path; microphone capture on
Simulator is unreliable. Use a physical device for voice.

## Configuration and persistence

The upstream GitHub OAuth App enables Device Flow and requests `repo` plus
`offline_access`. The app securely stores access and refresh tokens and rotates
expiring tokens.

The upstream public OAuth client ID is committed in `src/product-config.ts`;
no client secret is used. Forks can override it with the optional
`EXPO_PUBLIC_GITHUB_CLIENT_ID` variable above. Non-secret settings live in
**device-local AsyncStorage** (`agent_tts.deviceSettings.v1`):

- Gateway URL, gateway-credential reference, user id
- GitHub credential references and per-agent selected repository metadata
- Harness, model-key references, stop word, ElevenLabs voice id

Gateway bearer tokens, GitHub user access tokens, model API keys, and
voice-provider API keys are stored separately in the native secure credential
library. They survive app restart on that phone but are never written to
AsyncStorage. Uninstalling the app clears them.

**Save** PUTs selected repository metadata / harness / keys / voice to the
gateway SQLite store. GitHub tokens remain in native secure storage and are
sent over the authenticated voice socket only when a session starts.
Voice-provider keys selected during a provider launch are copied directly into
that new deployment's host variables by its provider plugin.
**Load config** pulls the non-GitHub-secret gateway copy back into the form.
Connection fields (URL / token / user id) are device-only; the gateway never
stores them for you.

`localhost` on a phone is the phone itself, not your laptop. The iOS Simulator
on the same Mac can use `http://127.0.0.1:4100`. A physical phone should use
the Tailscale Serve URL from that Mac (`https://<machine>.<tailnet>.ts.net`),
not a LAN IP.

## Provider plugins

Installed hosting providers are registered in `src/providers/registry.tsx`.
Each provider owns its authorization, setup screen, provisioning state, and
remote lifecycle implementation. Generic app code consumes the registry and
does not branch on provider IDs. See
[`docs/deployment/provider-drivers.md`](../docs/deployment/provider-drivers.md)
before adding a provider.

## Engineer distribution (EAS)

Physical-device install is an EAS internal **build page URL**,
opened in Safari on the phone — not USB `expo run:ios --device`. The guided
bring-your-own-account flow creates a standalone app and runs from the
repository root:

```bash
npm run mobile:install
```

It creates gitignored `app-identity.local.json` and
`eas-project.local.json`, submits the selected platform without waiting, and
prints the install page. See
[`docs/mobile-distribution.md`](../docs/mobile-distribution.md) for prerequisites,
cost boundaries, public build variables, and repeat builds.

Every EAS build is gated by `runtime-image.lock.json`. The official wrappers
also verify its runtime-source fingerprint, publishing commit, public GHCR
digest, and OCI revision labels before submission. A pending runtime publish
cannot produce a phone artifact.

| Profile | Purpose |
|---|---|
| `development-simulator` | iOS Simulator `.app` with expo-dev-client |
| `development` | Device dev client (iOS internal + Android APK) |
| `preview` | Standalone internal iOS app / Android APK (guided installer default) |
| `apk` | Android release APK for sideload only |
| `production` | iOS store-signed build for **TestFlight**, not a public App Store listing |

```bash
npx eas-cli build --profile development-simulator --platform ios
npm run install:device -- ios
npm run install:device -- android
bash scripts/print-dev-link.sh
npx eas-cli build --profile apk --platform android
npx eas-cli build --profile production --platform ios
npx eas-cli submit --profile production --platform ios   # TestFlight only
```

Do not run a Play Store submit. The `production` profile has no Android Play
config on purpose.

### Values the operator must supply

Identifiers already in the repo are engineer placeholders, not store listings:

- iOS bundle id / Android package: `dev.agenttts.app` (register this in your
  Apple Developer account; change it if you already own a different id)
- Apple Developer **Team ID**
- A distribution certificate + provisioning profile (EAS can manage these
  after you sign in), or your own signing assets via `credentialsSource: local`
- An App Store Connect app record + **ASC App ID** if you use TestFlight
  submit (`eas.json` `submit.production.ios` is empty until you set that)
- An Expo account and EAS project (`npx eas-cli init` once; store
  `projectId` / optional `owner` in `eas-project.local.json`, not in git)
- A globally unique bundle identifier / Android package stored in
  `app-identity.local.json` (the guided installer creates it)

iOS Simulator builds do not need a team id. Physical iOS devices and TestFlight do.

## Protocol

WebSocket `ws(s)://<gateway>/v1/voice?userId&mode=ptt|handsfree` with
`Authorization: Bearer <GATEWAY_TOKEN>` on the upgrade request. The token is
never a query parameter.

- Up: PCM 16 kHz, 16-bit little-endian, mono
- Down: JSON text events (`ready`, `transcript`, `agent_text`, `tool_event`,
  `queued`, `prompt_start`, `tts_start`, `tts_end`, `barge_in`, `stopped`,
  `done`, `error`) and binary PCM s16le 24 kHz mono
- `ready.audioFormat` must be `{ encoding: "pcm_s16le", sampleRate: 24000, channels: 1 }`
  or the client fails closed
- `tts_end` arrives exactly once after the final PCM chunk
- Client JSON: `ptt_start`, `ptt_end`, `abort`

Unexpected drops reconnect at most three times. Cancel / Disconnect does not
reconnect. `barge_in`, `stopped`, disconnect, and reconnect flush playback
immediately.

## Native voice audio

The local Expo module `mobile/packages/voice-audio` owns full-duplex PCM.
Native sources live in `apple/` and `android-lib/` (Expo `podspecPath` /
`android.path`) so they are not swallowed by a repo-wide `ios/` `android/`
gitignore. Generated prebuild trees stay at `mobile/ios` and `mobile/android`.
`useAudioStream` / per-file `createAudioPlayer` / MPEG reassembly are gone.

### Lifecycle contract

1. **Connect** (activity foreground): request mic (+ Android 13 notification)
   permission, bump session generation, `prepare(generation, mode)`.
2. Android starts `VoiceAudioService` with
   `foregroundServiceType=microphone|mediaPlayback` and a persistent
   notification **before** `AudioRecord` / `AudioTrack` stay alive in
   background. API 31+ `ForegroundServiceStartNotAllowedException` **fails
   `prepare`**; the session does not go ready without FGS protection.
3. **Hands-free ready**: native starts capture and keeps the session up
   through lock/background (`UIBackgroundModes=audio` on iOS; FGS on Android).
4. **PTT**: `startCapture` / `stopCapture` only. Session and playback stay
   prepared. Leaving the Active app state ends a held PTT.
5. **Playback**: downlink PCM is scheduled in order on one
   `AVAudioPlayerNode` (iOS) or one streaming `AudioTrack` (Android).
   `tts_start` sets speaking; exact-once `tts_end` plus native
   `onPlaybackIdle` clears it.
6. **Playback queue:** byte budget is **8,640,000 bytes** (24 kHz s16le
   mono × 180 s, ~8.2 MB). Producers wait off the Expo module/UI thread
   until there is room (`Dispatchers.IO` / Swift concurrent
   `AsyncFunction`). Flush, release, and generation changes wake waiters
   and **discard only the invalidated chunk**. Overflow after 15 s of
   backpressure is an explicit stream failure, not a silent drop.
   `AudioTrack.write` loops until every byte is consumed, checking a
   stream epoch before each partial write so barge-in/release cancel
   in-flight remainders without a spurious write error. iOS also caps
   48 scheduled `AVAudioPlayerNode` buffers; extra PCM waits in the same
   byte budget. JS serializes `enqueuePlayback` so **at most one** bridge
   chunk waits outside that native byte budget (order preserved).
7. **`barge_in` / `stopped` / reconnect / disconnect**: flush queued
   playback immediately. A chunk already inside `AudioTrack.write` may
   emit its current partial; the remainder is discarded.
8. **Disconnect / unmount**: `userClosed=true`, generation bumps, capture
   stops, JS `release` **awaits** FGS stop (`ServiceGate` STOPPING→STOPPED),
   session deactivates. Native will **not** auto-resume. Module `OnDestroy`
   is a last-resort stop and should not be the reconnect path.
9. **Reconnect**: JS chains `release` then `prepare`. Android playback
   is a per-session run: release closes the queue and joins the worker;
   the next `prepare` allocates a **new** queue and worker. Stale chunks
   against the closed run are `INVALIDATED`. `ServiceGate` waits out a
   pending stop, then starts and confirms a **new** FGS before `prepare`
   returns. A stale `onDestroy` of the old service is ignored for a newer
   running generation and does **not** release the new engine.
10. Android `prepare` **fails** if the FGS cannot start (Android 12+
    background start restriction, Android 14 types). Hands-free capture
    start failure after `ready` fail-closes the session. An unexpected
    `AudioRecord.read` error emits one `onError` and clears `capturing`
    (intentional stop/release/generation change does not).

Capture events cross the Expo module bridge as base64 (`sendEvent`
dictionaries). 100 ms of 16 kHz s16le mono is 3200 bytes → 4268 chars
(~33% size). Downlink uses Expo Modules API 57 `Data` / `ByteArray` ↔
`Uint8Array`.

### iOS APIs

`AVAudioSession` `.playAndRecord` + `.voiceChat`, `.defaultToSpeaker` +
`.allowBluetooth`. `AVAudioEngine` input tap converts/downmixes to s16le
mono 16 kHz. `setVoiceProcessingEnabled(true)` when the platform allows it;
failure is reported and capture continues. Playback is
`AVAudioPlayerNode` scheduling 24 kHz int16 buffers (converted to float
for the mixer). Input taps are installed only when `tapInstalled` is
false; `removeTap` is a no-op otherwise (repeated stop/release/resume
must not assert). Interruptions clear capture immediately; they resume
hands-free capture only when `shouldResume` is set. Ending without
`shouldResume` emits `onError` and leaves the mic stopped — it must not
look healthy.

### Android APIs

`AudioRecord` + `MediaRecorder.AudioSource.VOICE_COMMUNICATION`, PCM16
mono 16 kHz, `AcousticEchoCanceler` when available. `AudioTrack`
`USAGE_VOICE_COMMUNICATION` at 24 kHz mono PCM16 with an 8.2 MB
byte-bounded **per-session** queue and write-all looping. The FGS owns
keep-alive for both record and track; `prepare` fails if it cannot start
or if a previous stop has not finished. `Service.onDestroy` does not
release the engine (engine lifetime is the Expo module / JS `release`).

### Unavoidable OS boundaries

These remain even with the native path. Simulator compilation does **not**
make the path production-ready.

- Force-quit, crash, or swipe-away cannot auto-restart
- Siri, phone calls, alarms, and other system interruptions win temporarily
- Physical-device lock, Bluetooth HFP, speakerphone AEC, and Android OEM
  battery limits still require device testing
- Device-only FGS handshake: swipe-away / `onTaskRemoved`, OEM background
  start denial after a stop, and confirming the notification is gone
  before a reconnect `prepare` returns (unit tests cover `ServiceGate`
  without starting a real service)
- RN WebSocket send still runs on JS; the FGS/audio session keep the
  process scheduled, they do not move the socket onto a native thread

## Other device-only risks

- **Echo cancellation** is OS/hardware dependent. Hands-free on speaker
  uses voice-chat / `VOICE_COMMUNICATION` + platform AEC when present.
  Unavailable AEC is reported; capture is not killed. Headset is still
  the reliable anti-echo path.
