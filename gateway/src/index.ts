/**
 * agent_tts gateway — entry point.
 *
 * Responsibilities (see /PLAN.md):
 *  - WebSocket sessions with the mobile app (audio up, audio + events down)
 *  - Deepgram streaming STT (transcripts, stop-word detection, barge-in signal)
 *  - ElevenLabs streaming TTS for harness replies
 *  - Prompt queue: utterances arriving mid-turn dispatch on the next iteration
 *  - Agentbox lifecycle: spawn container, inject git creds, speak the box protocol
 *  - Per-user config from MongoDB (repo, harness, keys, stop word, voice)
 */

const PORT = Number(process.env.PORT ?? 4100);

console.log(`agent_tts gateway scaffold — would listen on :${PORT} (M1 not started)`);
