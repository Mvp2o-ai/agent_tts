import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { MicIcon, MicOffIcon, WaveIcon } from "./icons";
import { color, font, shadow, space } from "./theme";

export type TalkState = "offline" | "idle" | "capturing" | "speaking";

export function TalkButton({
  mode,
  state,
  onPressIn,
  onPressOut,
}: {
  mode: "ptt" | "handsfree";
  state: TalkState;
  onPressIn: () => void;
  onPressOut: () => void;
}) {
  const { width } = useWindowDimensions();
  const diameter = Math.max(150, Math.min(232, width - 120));
  const active = state === "capturing";
  const live = state !== "offline";

  const press = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(press, {
      toValue: active ? 1 : 0,
      speed: 20,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  }, [active, press]);

  const ringA = useRipple(active || state === "speaking", 0);
  const ringB = useRipple(active || state === "speaking", 900);

  const ringColor = state === "speaking" ? color.agent : color.accent;
  const fill =
    state === "offline"
      ? color.surface
      : active
        ? color.accentDeep
        : color.surfaceRaised;
  const border =
    state === "offline"
      ? color.border
      : active
        ? color.accent
        : state === "speaking"
          ? color.agent
          : color.borderStrong;

  const glyphColor = state === "offline" ? color.textDim : color.text;
  const glyphSize = diameter * 0.3;

  const content = (
    <View style={styles.stack}>
      {[ringA, ringB].map((ring, index) => (
        <Animated.View
          key={index}
          pointerEvents="none"
          style={[
            styles.ring,
            {
              width: diameter,
              height: diameter,
              borderRadius: diameter / 2,
              borderColor: ringColor,
              opacity: ring.opacity,
              transform: [{ scale: ring.scale }],
            },
          ]}
        />
      ))}
      <Animated.View
        style={[
          styles.circle,
          shadow.hero,
          {
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            backgroundColor: fill,
            borderColor: border,
            transform: [
              {
                scale: press.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 0.94],
                }),
              },
            ],
          },
        ]}
      >
        {state === "offline" ? (
          <MicOffIcon size={glyphSize} color={glyphColor} />
        ) : state === "speaking" ? (
          <WaveIcon size={glyphSize} color={color.agent} />
        ) : (
          <MicIcon size={glyphSize} color={glyphColor} />
        )}
      </Animated.View>
    </View>
  );

  const caption = captionFor(mode, state);

  return (
    <View style={styles.wrap}>
      {mode === "ptt" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            active ? "Release to send" : "Hold to talk to the agent"
          }
          accessibilityState={{ disabled: !live, busy: active }}
          disabled={!live}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
        >
          {content}
        </Pressable>
      ) : (
        <View accessibilityRole="image" accessibilityLabel={caption.title}>
          {content}
        </View>
      )}

      <Text style={[styles.title, !live && styles.titleOffline]}>
        {caption.title}
      </Text>
      <Text style={styles.subtitle}>{caption.subtitle}</Text>
    </View>
  );
}

function captionFor(
  mode: "ptt" | "handsfree",
  state: TalkState,
): { title: string; subtitle: string } {
  if (state === "offline") {
    return {
      title: "Mic closed",
      subtitle: "Connect to open a session.",
    };
  }
  if (state === "speaking") {
    return {
      title: "Agent speaking",
      subtitle:
        mode === "ptt" ? "Hold to interrupt." : "Just talk to interrupt.",
    };
  }
  if (state === "capturing") {
    return { title: "Listening", subtitle: "Release to send." };
  }
  return mode === "ptt"
    ? { title: "Hold to talk", subtitle: "Press and hold, then release." }
    : { title: "Open mic", subtitle: "Speak any time." };
}

function useRipple(active: boolean, delay: number) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      progress.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(progress, {
          toValue: 1,
          duration: 1800,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, delay, progress]);

  return {
    scale: progress.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 1.32],
    }),
    opacity: progress.interpolate({
      inputRange: [0, 0.15, 1],
      outputRange: [0, 0.5, 0],
    }),
  };
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    paddingVertical: space.lg,
  },
  stack: {
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    borderWidth: 2,
  },
  circle: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  title: {
    marginTop: space.lg,
    color: color.text,
    fontSize: font.title,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  titleOffline: {
    color: color.textMuted,
  },
  subtitle: {
    marginTop: space.xs,
    color: color.textDim,
    fontSize: font.label,
  },
});
