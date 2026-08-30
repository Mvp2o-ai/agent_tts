import { useMemo } from "react";
import { useRailwayProvider } from "./railway/plugin";
import {
  createProviderRegistry,
  type ProviderRegistry,
  type ProviderSetupContext,
} from "./types";

/**
 * Compile-time provider installation point.
 *
 * A new provider contributes one plugin module and one registration here.
 * Generic application screens and lifecycle code consume ProviderRegistry and
 * do not import or branch on provider IDs.
 */
export function useProviderRegistry(
  context: ProviderSetupContext,
): ProviderRegistry {
  const railway = useRailwayProvider(context);
  return useMemo(() => createProviderRegistry([railway]), [railway]);
}
