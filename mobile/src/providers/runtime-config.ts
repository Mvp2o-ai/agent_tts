import runtimeImageLock from "../../runtime-image.lock.json";

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
  runtimeImageLock.image;

export const AGENT_RUNTIME_IMAGE = runtimeImageFromEnvironment(process.env);

export function runtimeImageFromEnvironment(env: {
  EXPO_PUBLIC_AGENT_RUNTIME_IMAGE?: string;
}): string {
  return (
    env.EXPO_PUBLIC_AGENT_RUNTIME_IMAGE?.trim() ||
    DEFAULT_AGENT_RUNTIME_IMAGE
  );
}
