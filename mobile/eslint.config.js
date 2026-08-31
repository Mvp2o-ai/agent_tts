const { defineConfig, globalIgnores } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  globalIgnores(["android/**", "ios/**", ".expo/**"]),
  {
    files: [
      "App.tsx",
      "src/providers/railway/plugin.tsx",
      "src/useVoiceSession.ts",
    ],
    rules: {
      // Existing session synchronization effects intentionally derive local
      // state from external connection and persistence state.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    files: [
      "src/ui/TalkButton.tsx",
      "src/ui/components.tsx",
      "src/useDeviceSettings.ts",
      "src/useVoiceSession.ts",
    ],
    rules: {
      // React Native Animated.Values and current session callbacks are
      // intentionally held in refs and consumed while building stable hooks.
      "react-hooks/refs": "off",
    },
  },
  {
    files: ["src/useVoiceSession.ts"],
    rules: {
      // A stable callback ref intentionally breaks the reconnect cycle.
      "react-hooks/immutability": "off",
    },
  },
]);
