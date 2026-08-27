import { Platform } from "react-native";

export const color = {
  bg: "#0A0B0F",
  bgElevated: "#101219",
  surface: "#14161D",
  surfaceRaised: "#1B1E28",
  surfacePressed: "#22262F",
  border: "#252A36",
  borderStrong: "#343B4C",

  text: "#F2F5FA",
  textMuted: "#98A1B5",
  textDim: "#69718A",

  accent: "#6C8CFF",
  accentDeep: "#1D2A5C",
  accentTint: "#141A33",

  live: "#34D399",
  liveDeep: "#0F3327",
  liveTint: "#0C2119",

  warn: "#F2B23E",
  warnDeep: "#3A2A0C",

  danger: "#F2635F",
  dangerDeep: "#3A1417",
  dangerTint: "#20090B",

  agent: "#8AB4FF",
  overlay: "rgba(6,7,11,0.72)",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const font = {
  display: 30,
  title: 20,
  body: 16,
  label: 14,
  caption: 12,
  micro: 11,
} as const;

/**
 * Monospace face for tokens, URLs, and secrets so operators can distinguish
 * visually ambiguous characters in credentials.
 */
export const monoFamily = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

export const shadow = {
  card: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOpacity: 0.4,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
    },
    android: { elevation: 6 },
    default: {},
  }),
  hero: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOpacity: 0.55,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 14 },
    },
    android: { elevation: 12 },
    default: {},
  }),
} as const;

/**
 * The app ships without react-native-safe-area-context, so insets are
 * approximated from platform conventions rather than measured.
 */
export const inset = {
  top: Platform.select({ ios: 62, android: 32, default: 24 }),
  bottom: Platform.select({ ios: 30, android: 16, default: 12 }),
} as const;
