const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const voiceAudioRoot = path.resolve(projectRoot, "packages/voice-audio");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...(config.watchFolders ?? []), voiceAudioRoot];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  "voice-audio": voiceAudioRoot,
};

module.exports = config;
