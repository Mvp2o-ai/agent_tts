import { useRef } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from "react-native";
import type { SessionEvent } from "../useVoiceSession";
import { AlertIcon, WaveIcon } from "./icons";
import { color, font, monoFamily, radius, space } from "./theme";

type Lane = "user" | "agent" | "tool" | "error" | "meta";

function laneFor(kind: SessionEvent["kind"]): Lane {
  switch (kind) {
    case "transcript":
    case "partial":
      return "user";
    case "agent":
      return "agent";
    case "tool":
      return "tool";
    case "error":
      return "error";
    default:
      return "meta";
  }
}

export function Transcript({ events }: { events: SessionEvent[] }) {
  const listRef = useRef<FlatList<SessionEvent>>(null);

  const renderItem: ListRenderItem<SessionEvent> = ({ item }) => {
    const lane = laneFor(item.kind);

    if (lane === "meta") {
      return (
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>{item.kind.replace(/_/g, " ")}</Text>
          {item.text ? (
            <Text style={styles.metaDetail} numberOfLines={2}>
              {item.text}
            </Text>
          ) : null}
        </View>
      );
    }

    if (lane === "error") {
      return (
        <View style={styles.errorRow}>
          <AlertIcon size={15} color={color.danger} />
          <Text style={styles.errorText}>{item.text}</Text>
        </View>
      );
    }

    if (lane === "tool") {
      return (
        <View style={styles.toolRow}>
          <Text style={styles.toolText} numberOfLines={3}>
            {item.text}
          </Text>
        </View>
      );
    }

    const mine = lane === "user";
    const pending = item.kind === "partial";
    return (
      <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
        <View
          style={[
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleAgent,
            pending && styles.bubblePending,
          ]}
        >
          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
            {item.text}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      contentContainerStyle={
        events.length === 0 ? styles.emptyContent : styles.listContent
      }
      data={events}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      showsVerticalScrollIndicator={false}
      onContentSizeChange={() =>
        listRef.current?.scrollToEnd({ animated: true })
      }
      onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
      ListEmptyComponent={
        <View style={styles.empty}>
          <WaveIcon size={26} color={color.textDim} />
          <Text style={styles.emptyTitle}>Nothing said yet</Text>
          <Text style={styles.emptyBody}>
            Your words and the agent&apos;s replies land here.
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: space.md,
    gap: space.sm,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  empty: {
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.xl,
  },
  emptyTitle: {
    color: color.textMuted,
    fontSize: font.body,
    fontWeight: "600",
  },
  emptyBody: {
    color: color.textDim,
    fontSize: font.label,
    textAlign: "center",
    lineHeight: 20,
  },
  bubbleRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  bubbleRowMine: {
    justifyContent: "flex-end",
  },
  bubble: {
    maxWidth: "86%",
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  bubbleAgent: {
    backgroundColor: color.surface,
    borderColor: color.border,
    borderBottomLeftRadius: radius.sm,
  },
  bubbleMine: {
    backgroundColor: color.accentDeep,
    borderColor: color.accentDeep,
    borderBottomRightRadius: radius.sm,
  },
  bubblePending: {
    opacity: 0.6,
  },
  bubbleText: {
    color: color.text,
    fontSize: font.label + 1,
    lineHeight: 21,
  },
  bubbleTextMine: {
    color: color.text,
  },
  toolRow: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    backgroundColor: color.warnDeep,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  toolText: {
    color: color.warn,
    fontFamily: monoFamily,
    fontSize: font.caption,
    lineHeight: 17,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.sm,
    backgroundColor: color.dangerTint,
    borderWidth: 1,
    borderColor: color.dangerDeep,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  errorText: {
    flex: 1,
    color: color.danger,
    fontSize: font.label,
    lineHeight: 19,
  },
  metaRow: {
    alignItems: "center",
    paddingVertical: 2,
  },
  metaText: {
    color: color.textDim,
    fontSize: font.micro,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  metaDetail: {
    color: color.textDim,
    fontSize: font.caption,
    marginTop: 1,
    textAlign: "center",
  },
});
