declare const process: {
  env: {
    EXPO_PUBLIC_AGENT_RUNTIME_IMAGE?: string;
  };
};

/**
 * Official builds pin a known runtime artifact. Forks can override this at
 * mobile build time without changing any provider driver.
 */
export const DEFAULT_AGENT_RUNTIME_IMAGE =
  "ghcr.io/mvp2o-ai/agent_tts@sha256:1652d50f5641031a833df18d8695d5b08d80ba57f3234954d061deb837b2720d";

export const AGENT_RUNTIME_IMAGE = runtimeImageFromEnvironment(process.env);

export function runtimeImageFromEnvironment(env: {
  EXPO_PUBLIC_AGENT_RUNTIME_IMAGE?: string;
}): string {
  return (
    env.EXPO_PUBLIC_AGENT_RUNTIME_IMAGE?.trim() ||
    DEFAULT_AGENT_RUNTIME_IMAGE
  );
}
