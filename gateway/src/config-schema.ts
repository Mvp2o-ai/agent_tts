import type { HarnessId } from "./box-protocol.js";

/**
 * Per-user configuration, stored in MongoDB and edited live from the mobile
 * app. Nothing here is baked into the image or env — the app is the UI for
 * all of it.
 */
export interface UserConfig {
  userId: string;
  repo: {
    url: string;
    /** e.g. GitHub PAT; injected into the container at session start. */
    credential: string;
    defaultBranch?: string;
  };
  harness: HarnessId;
  /** BYO model/provider keys passed through to the harness. */
  modelKeys: Record<string, string>;
  voice: {
    /** Hard-stop keyword; aborting mid-turn like the web stop button. */
    stopWord: string;
    ttsVoiceId?: string;
  };
}
