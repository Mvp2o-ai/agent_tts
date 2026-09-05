import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
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
  flushSettings: () => Promise<void>;
} {
  const [settings, setSettingsState] = useState<DeviceSettings>(
    DEFAULT_DEVICE_SETTINGS,
  );
  const [hydrated, setHydrated] = useState(false);
  const settingsRef = useRef(settings);
  const persistAllowedRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const flushSettings = useCallback(async () => {
    if (!persistAllowedRef.current) return;
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    await store.save(settingsRef.current);
  }, [store]);

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
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      void store.save(settingsRef.current);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [hydrated, settings, store]);

  const hydratedRef = useRef(false);
  hydratedRef.current = hydrated;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") {
        void flushSettings();
      }
    });
    return () => subscription.remove();
  }, [flushSettings]);

  useEffect(() => {
    return () => {
      if (hydratedRef.current && persistAllowedRef.current) {
        void store.save(settingsRef.current);
      }
    };
  }, [store]);

  return { settings, hydrated, setSettings, getSettings, flushSettings };
}
