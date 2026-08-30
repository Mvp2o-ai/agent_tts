import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { AlertIcon, CheckIcon, EyeIcon, EyeOffIcon } from "./icons";
import { color, font, monoFamily, radius, shadow, space } from "./theme";

const FocusedFieldContext = createContext<{
  register: (node: View | null) => void;
  unregister: (node: View) => void;
} | null>(null);

/**
 * Form scroller that keeps the focused field above the keyboard. A plain
 * ScrollView cannot lift the last input: there is not enough content below it,
 * and nothing asks the scroller to move when the keyboard covers the field.
 */
export function KeyboardAwareScrollView({
  children,
  contentContainerStyle,
  style,
}: {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const focusedRef = useRef<View | null>(null);
  const offsetRef = useRef(0);
  const keyboardHeightRef = useRef(0);
  const pendingRevealTop = useRef<number | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const reveal = useCallback((keyboardTop: number) => {
    const field = focusedRef.current;
    const scroll = scrollRef.current;
    if (!field || !scroll) {
      return;
    }
    field.measureInWindow((_x, y, _w, h) => {
      const overlap = y + h + space.md - keyboardTop;
      if (overlap <= 0) {
        return;
      }
      scroll.scrollTo({
        y: Math.max(0, offsetRef.current + overlap),
        animated: true,
      });
    });
  }, []);

  useEffect(() => {
    const onShow = (event: {
      endCoordinates: { height: number; screenY: number };
    }) => {
      const nextHeight = event.endCoordinates.height;
      const keyboardTop = event.endCoordinates.screenY;
      if (nextHeight <= 0) {
        return;
      }
      if (nextHeight === keyboardHeightRef.current) {
        reveal(keyboardTop);
        return;
      }
      keyboardHeightRef.current = nextHeight;
      pendingRevealTop.current = keyboardTop;
      setKeyboardHeight(nextHeight);
    };
    const onHide = () => {
      keyboardHeightRef.current = 0;
      pendingRevealTop.current = null;
      setKeyboardHeight(0);
    };
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      onShow,
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      onHide,
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [reveal]);

  const register = useCallback(
    (node: View | null) => {
      focusedRef.current = node;
      if (!node) {
        return;
      }
      const metrics = Keyboard.metrics();
      if (metrics && metrics.height > 0) {
        requestAnimationFrame(() => reveal(metrics.screenY));
      }
    },
    [reveal],
  );

  const unregister = useCallback((node: View) => {
    if (focusedRef.current === node) {
      focusedRef.current = null;
    }
  }, []);

  const context = useMemo(
    () => ({ register, unregister }),
    [register, unregister],
  );

  return (
    <FocusedFieldContext.Provider value={context}>
      <ScrollView
        ref={scrollRef}
        style={style}
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onScroll={(event) => {
          offsetRef.current = event.nativeEvent.contentOffset.y;
        }}
        onContentSizeChange={() => {
          const keyboardTop = pendingRevealTop.current;
          if (keyboardTop == null) {
            return;
          }
          pendingRevealTop.current = null;
          reveal(keyboardTop);
        }}
        scrollEventThrottle={16}
      >
        {children}
        {keyboardHeight > 0 ? <View style={{ height: keyboardHeight }} /> : null}
      </ScrollView>
    </FocusedFieldContext.Provider>
  );
}

export type ButtonTone = "primary" | "neutral" | "danger" | "ghost";

export function Button({
  label,
  onPress,
  icon,
  tone = "neutral",
  disabled,
  busy,
  style,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  tone?: ButtonTone;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(inactive) }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        toneStyles[tone].container,
        pressed && !inactive && styles.buttonPressed,
        inactive && styles.buttonDisabled,
        style,
      ]}
    >
      {icon ? <View style={styles.buttonIcon}>{icon}</View> : null}
      <Text style={[styles.buttonLabel, toneStyles[tone].label]}>{label}</Text>
    </Pressable>
  );
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionLabel({
  children,
  icon,
}: {
  children: string;
  icon?: ReactNode;
}) {
  return (
    <View style={styles.sectionRow}>
      {icon ? <View style={styles.sectionIcon}>{icon}</View> : null}
      <Text style={styles.sectionLabel}>{children}</Text>
    </View>
  );
}

export function StatusPill({
  label,
  tone,
  pulsing,
}: {
  label: string;
  tone: "idle" | "busy" | "live" | "error";
  pulsing?: boolean;
}) {
  const dotColor =
    tone === "live"
      ? color.live
      : tone === "busy"
        ? color.warn
        : tone === "error"
          ? color.danger
          : color.textDim;
  const opacity = usePulse(Boolean(pulsing));

  return (
    <View style={[styles.pill, tone === "live" && styles.pillLive]}>
      <Animated.View
        style={[styles.pillDot, { backgroundColor: dotColor, opacity }]}
      />
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
  );
}

export function Toast({ message, ok }: { message: string; ok: boolean }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter, message]);

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[
        styles.toast,
        ok ? styles.toastOk : styles.toastErr,
        {
          opacity: enter,
          transform: [
            {
              translateY: enter.interpolate({
                inputRange: [0, 1],
                outputRange: [-12, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.toastIcon}>
        {ok ? (
          <CheckIcon size={14} color={color.live} />
        ) : (
          <AlertIcon size={14} color={color.danger} />
        )}
      </View>
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.segmented, disabled && styles.segmentedDisabled]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: Boolean(disabled) }}
            accessibilityLabel={option.label}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            {option.icon ? (
              <View style={styles.segmentIcon}>{option.icon}</View>
            ) : null}
            <Text
              style={[styles.segmentLabel, active && styles.segmentLabelActive]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({
  label,
  value,
  onChange,
  secure,
  mono,
  autoCapitalize,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
  mono?: boolean;
  autoCapitalize?: "none" | "sentences";
  placeholder?: string;
  hint?: string;
}) {
  const focusedField = useContext(FocusedFieldContext);
  const wrapRef = useRef<View>(null);
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const hidden = Boolean(secure) && !revealed;

  return (
    <View ref={wrapRef} style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputWrap, focused && styles.inputWrapFocused]}>
        <TextInput
          style={[styles.input, (mono || secure) && styles.inputMono]}
          value={value}
          onChangeText={onChange}
          onFocus={() => {
            setFocused(true);
            focusedField?.register(wrapRef.current);
          }}
          onBlur={() => {
            setFocused(false);
            if (wrapRef.current) {
              focusedField?.unregister(wrapRef.current);
            }
          }}
          secureTextEntry={hidden}
          autoCapitalize={autoCapitalize ?? "sentences"}
          autoCorrect={false}
          placeholder={placeholder}
          placeholderTextColor={color.textDim}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? `Hide ${label}` : `Show ${label}`}
            hitSlop={10}
            onPress={() => setRevealed((prev) => !prev)}
            style={styles.reveal}
          >
            {revealed ? (
              <EyeOffIcon size={18} color={color.textMuted} />
            ) : (
              <EyeIcon size={18} color={color.textMuted} />
            )}
          </Pressable>
        ) : null}
      </View>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

function usePulse(active: boolean) {
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) {
      value.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 0.25,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, value]);
  return value;
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    paddingVertical: 15,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  buttonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
  buttonDisabled: {
    opacity: 0.38,
  },
  buttonIcon: {
    marginTop: -1,
  },
  buttonLabel: {
    fontSize: font.body,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.lg,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginTop: space.xl,
    marginBottom: space.md,
  },
  sectionIcon: {
    opacity: 0.8,
  },
  sectionLabel: {
    color: color.textMuted,
    fontSize: font.micro,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
  },
  pillLive: {
    backgroundColor: color.liveTint,
    borderColor: color.liveDeep,
  },
  pillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  pillLabel: {
    color: color.textMuted,
    fontSize: font.caption,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  toast: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    ...shadow.card,
  },
  toastOk: {
    backgroundColor: color.liveTint,
    borderColor: color.liveDeep,
  },
  toastErr: {
    backgroundColor: color.dangerTint,
    borderColor: color.dangerDeep,
  },
  toastIcon: {
    marginTop: 2,
  },
  toastText: {
    flex: 1,
    color: color.text,
    fontSize: font.label,
    lineHeight: 19,
    fontWeight: "500",
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: color.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: 4,
    gap: 4,
  },
  segmentedDisabled: {
    opacity: 0.5,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  segmentActive: {
    backgroundColor: color.surfaceRaised,
  },
  segmentIcon: {
    marginTop: -1,
  },
  segmentLabel: {
    color: color.textMuted,
    fontSize: font.label,
    fontWeight: "600",
  },
  segmentLabelActive: {
    color: color.text,
  },
  field: {
    marginBottom: space.md,
  },
  fieldLabel: {
    color: color.textMuted,
    fontSize: font.caption,
    fontWeight: "600",
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: color.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
  },
  inputWrapFocused: {
    borderColor: color.accent,
    backgroundColor: color.accentTint,
  },
  input: {
    flex: 1,
    color: color.text,
    paddingHorizontal: space.md,
    paddingVertical: 13,
    fontSize: font.body,
  },
  inputMono: {
    fontFamily: monoFamily,
    fontSize: font.label,
  },
  reveal: {
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  fieldHint: {
    color: color.textDim,
    fontSize: font.caption,
    marginTop: 6,
    lineHeight: 17,
  },
});

const toneStyles: Record<
  ButtonTone,
  { container: ViewStyle; label: { color: string } }
> = {
  primary: {
    container: { backgroundColor: color.accent, borderColor: color.accent },
    label: { color: "#0A0B0F" },
  },
  neutral: {
    container: {
      backgroundColor: color.surfaceRaised,
      borderColor: color.borderStrong,
    },
    label: { color: color.text },
  },
  danger: {
    container: {
      backgroundColor: color.dangerTint,
      borderColor: color.dangerDeep,
    },
    label: { color: color.danger },
  },
  ghost: {
    container: { backgroundColor: "transparent", borderColor: color.border },
    label: { color: color.textMuted },
  },
};
