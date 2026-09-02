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
import type { TalkState } from "../talk-state";
import { MicIcon, MicOffIcon, WaveIcon } from "./icons";
import { color, font, shadow, space } from "./theme";

export type { TalkState };

export function TalkButton({
  mode,
  state,
  detail,
  onPressIn,
  onPressOut,
}: {
  mode: "ptt" | "handsfree";
  state: TalkState;
  detail?: string;
  onPressIn: () => void;
  onPressOut: () => void;
}) {
  const { width } = useWindowDimensions();
  const diameter = Math.max(150, Math.min(232, width - 120));
  const active = state === "capturing";
  const thinking = state === "thinking";
  const working = state === "working";
  const speaking = state === "speaking";
  const live =
    state === "idle" ||
    active ||
    thinking ||
    working ||
    speaking;
  const bright = thinking || speaking;

  const press = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(press, {
      toValue: active ? 1 : 0,
      speed: 20,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  }, [active, press]);

  const ringA = useRipple(active || thinking || working || speaking, 0);
  const ringB = useRipple(active || thinking || working || speaking, 900);

  const ringColor = bright ? color.agent : working ? color.live : color.accent;
  const fill =
    !live
      ? color.surface
      : active
        ? color.accentDeep
        : thinking
          ? color.accentDeep
          : color.surfaceRaised;
  const border =
    !live
      ? color.border
      : active
        ? color.accent
        : bright
          ? color.agent
          : working
            ? color.live
            : color.borderStrong;

  const glyphColor = !live
    ? color.textDim
    : bright
      ? color.agent
      : working
        ? color.live
        : color.text;
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
        {!live ? (
          <MicOffIcon size={glyphSize} color={glyphColor} />
        ) : speaking ? (
          <WaveIcon size={glyphSize} color={color.agent} />
        ) : (
          <MicIcon size={glyphSize} color={glyphColor} />
        )}
      </Animated.View>
    </View>
  );

  const caption = captionFor(mode, state, detail);

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
  detail?: string,
): { title: string; subtitle: string } {
  if (state === "needs-setup") {
    return {
      title: "Agent needs setup",
      subtitle: "Open agent settings to finish configuration.",
    };
  }
  if (state === "stopped") {
    return {
      title: "Session ended",
      subtitle: "This container is stopped.",
    };
  }
  if (state === "starting") {
    return {
      title: "Starting session",
      subtitle: detail || "Preparing runtime…",
    };
  }
  if (state === "unreachable") {
    return {
      title: "Session unreachable",
      subtitle: detail || "Check its host, network, or gateway token.",
    };
  }
  if (state === "gone") {
    return {
      title: "Deployment removed",
      subtitle: detail || "This agent no longer exists at its provider.",
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
  if (state === "thinking") {
    return {
      title: "Agent thinking",
      subtitle:
        mode === "ptt" ? "Hold to add another instruction." : "Speak any time.",
    };
  }
  if (state === "working") {
    return {
      title: "Agent working",
      subtitle:
        mode === "ptt" ? "Hold to add another instruction." : "Speak any time.",
    };
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
