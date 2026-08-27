import AsyncStorage from "@react-native-async-storage/async-storage";
import { createSettingsStore } from "./settings";

/** Device-local settings. Secrets stay on the phone, never in source. */
export const settingsStore = createSettingsStore(AsyncStorage);
