import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSettingsStore,
  DEFAULT_DEVICE_SETTINGS,
  readDeviceSettingsForHydration,
  type DeviceSettings,
} from "./settings";
import { settingsStore } from "./settings-store";

const SAVE_DEBOUNCE_MS = 400;

export function useDeviceSettings(
  store: ReturnType<typeof createSettingsStore> = settingsStore,
): {
  settings: DeviceSettings;
  hydrated: boolean;
  setSettings: (
    next: DeviceSettings | ((prev: DeviceSettings) => DeviceSettings),
  ) => void;
  getSettings: () => DeviceSettings;
} {
  const [settings, setSettingsState] = useState<DeviceSettings>(
    DEFAULT_DEVICE_SETTINGS,
  );
  const [hydrated, setHydrated] = useState(false);
  const settingsRef = useRef(settings);
  const persistAllowedRef = useRef(false);
  const setSettings = useCallback(
    (
      next:
        | DeviceSettings
        | ((previous: DeviceSettings) => DeviceSettings),
    ) => {
      const resolved =
        typeof next === "function" ? next(settingsRef.current) : next;
      settingsRef.current = resolved;
      setSettingsState(resolved);
    },
    [],
  );
  const getSettings = useCallback(() => settingsRef.current, []);

  useEffect(() => {
    let cancelled = false;
    void readDeviceSettingsForHydration(store).then(({ loaded, persist }) => {
      if (cancelled) return;
      persistAllowedRef.current = persist;
      if (loaded) setSettings(loaded);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [setSettings, store]);

  useEffect(() => {
    if (!hydrated || !persistAllowedRef.current) return;
    const timer = setTimeout(() => {
      void store.save(settingsRef.current);
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [hydrated, settings, store]);

  const hydratedRef = useRef(false);
  hydratedRef.current = hydrated;

  useEffect(() => {
    return () => {
      if (hydratedRef.current && persistAllowedRef.current) {
        void store.save(settingsRef.current);
      }
    };
  }, [store]);

  return { settings, hydrated, setSettings, getSettings };
}
