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
npm install
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

Nothing is read from environment variables or committed secrets. Settings live
in **device-local AsyncStorage** (`agent_tts.deviceSettings.v1`):

- Gateway URL, gateway token, user id
- Git PAT, optional git host
- Harness, model API keys, stop word, ElevenLabs voice id

They survive app restart on that phone. They are **not encrypted at rest**
beyond whatever the OS does for app storage; this is acceptable for an engineer
tool. Uninstalling the app clears them. iOS backups may include them.

**Save** still PUTs repo / harness / keys / voice to the gateway SQLite store.
**Load config** pulls that gateway copy back into the form (and then onto the
device). Connection fields (URL / token / user id) are device-only; the gateway
never stores them for you.

`localhost` on a phone is the phone itself, not your laptop. Use a LAN IP
(`http://192.168.x.x:4100`) or an `https://` URL in front of the gateway.

## Engineer distribution (EAS)

Profiles in `eas.json` (run from `mobile/` after `npx eas-cli login` and
`npx eas-cli init` once per Expo account):

| Profile | Purpose |
|---|---|
| `development-simulator` | iOS Simulator `.app` with expo-dev-client |
| `development` | Device dev client (iOS internal + Android APK) |
| `apk` | Android release APK for sideload only |
| `production` | iOS store-signed build for **TestFlight**, not a public App Store listing |

```bash
npx eas-cli build --profile development-simulator --platform ios
npx eas-cli build --profile development --platform ios
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
- An Expo account and EAS project (`npx eas-cli init` writes `extra.eas.projectId`
  — do not commit secrets; the project id is not a credential)

iOS Simulator builds do not need a team id. Physical iOS devices and TestFlight do.

## Protocol

WebSocket `ws(s)://<gateway>/v1/voice?token&userId&mode=ptt|handsfree`.

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
