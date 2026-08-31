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
  "ghcr.io/mvp2o-ai/agent_tts@sha256:5a16b281ccf3b8a75b2c452295c5aff49bd192f52866941edc120a4fd1c612d7";

export const AGENT_RUNTIME_IMAGE = runtimeImageFromEnvironment(process.env);

export function runtimeImageFromEnvironment(env: {
  EXPO_PUBLIC_AGENT_RUNTIME_IMAGE?: string;
}): string {
  return (
    env.EXPO_PUBLIC_AGENT_RUNTIME_IMAGE?.trim() ||
    DEFAULT_AGENT_RUNTIME_IMAGE
  );
}
