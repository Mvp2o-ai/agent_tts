import { useEffect, useRef, useState } from "react";
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
} {
  const [settings, setSettings] = useState<DeviceSettings>(DEFAULT_DEVICE_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const persistAllowedRef = useRef(false);

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
  }, [store]);

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

  return { settings, hydrated, setSettings };
}
