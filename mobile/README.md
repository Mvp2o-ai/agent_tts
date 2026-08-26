# walkie mobile

Expo React Native app. Two modes only:

- **Walkie-talkie** — push-to-talk button; release sends the utterance.
- **Hands-free** — open mic with VAD; barge-in over TTS playback must be seamless.

Also hosts the config UI (git repo + credential, harness choice, model keys,
stop word, voice) which writes to the gateway's Mongo-backed user config.

Scaffolded at M2 with `npx create-expo-app` — intentionally not generated yet
so we align on navigation/audio libs first (expo-av vs react-native-audio-api,
background audio requirements for hands-free mode).

Distribution: EAS → TestFlight, and signed APK for direct install. No app stores.
