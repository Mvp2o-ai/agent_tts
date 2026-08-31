const {
  AndroidConfig,
  IOSConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withInfoPlist,
} = require("expo/config-plugins");

const SERVICE_NAME = "dev.agenttts.voiceaudio.VoiceAudioService";
const MIC_USAGE =
  "agent_tts streams your voice to your self-hosted gateway.";

/**
 * @param {import('expo/config-plugins').ExpoConfig} config
 * @param {{ microphonePermission?: string }} [props]
 */
function withVoiceAudio(config, props = {}) {
  const microphonePermission = props.microphonePermission ?? MIC_USAGE;

  config = IOSConfig.Permissions.createPermissionsPlugin({
    NSMicrophoneUsageDescription: MIC_USAGE,
  })(config, {
    NSMicrophoneUsageDescription: microphonePermission,
  });

  config = withInfoPlist(config, (mod) => {
    const modes = Array.isArray(mod.modResults.UIBackgroundModes)
      ? mod.modResults.UIBackgroundModes
      : [];
    if (!modes.includes("audio")) modes.push("audio");
    mod.modResults.UIBackgroundModes = modes;
    return mod;
  });

  config = AndroidConfig.Permissions.withPermissions(config, [
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.BLUETOOTH",
    "android.permission.BLUETOOTH_CONNECT",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_MICROPHONE",
    "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
  ]);

  config = withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      mod.modResults,
    );
    if (!application.service) application.service = [];
    const exists = application.service.some(
      (service) => service.$?.["android:name"] === SERVICE_NAME,
    );
    if (!exists) {
      application.service.push({
        $: {
          "android:name": SERVICE_NAME,
          "android:exported": "false",
          "android:foregroundServiceType": "microphone|mediaPlayback",
          "android:stopWithTask": "true",
        },
      });
    }
    return mod;
  });

  return config;
}

module.exports = createRunOncePlugin(withVoiceAudio, "voice-audio", "0.1.0");
