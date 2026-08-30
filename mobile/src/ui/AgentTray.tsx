import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { color, font, radius, space } from "./theme";

export interface AgentTrayItem {
  id: string;
  name: string;
  detail: string;
  status:
    | "needs-setup"
    | "stopped"
    | "starting"
    | "running"
    | "unreachable"
    | "gone"
    | "error";
}

export function AgentTray({
  agents,
  activeAgentId,
  onSelect,
  onOpenMenu,
  onAdd,
}: {
  agents: AgentTrayItem[];
  activeAgentId: string;
  onSelect: (agentId: string) => void;
  onOpenMenu: (agentId: string) => void;
  onAdd: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>AGENTS</Text>
        <Text style={styles.count}>{agents.length}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {agents.map((agent) => {
          const selected = agent.id === activeAgentId;
          return (
            <Pressable
              key={agent.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${agent.name}`}
              accessibilityHint="Opens this agent's settings."
              accessibilityState={{ selected }}
              onPress={() => onSelect(agent.id)}
              style={({ pressed }) => [
                styles.agent,
                selected && styles.agentSelected,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.agentTop}>
                <View
                  style={[
                    styles.dot,
                    dotStyles[agent.status],
                    agent.status === "running" && styles.dotLive,
                  ]}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.name, selected && styles.nameSelected]}
                >
                  {agent.name}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`More actions for ${agent.name}`}
                  hitSlop={10}
                  onPress={(event) => {
                    event.stopPropagation();
                    onOpenMenu(agent.id);
                  }}
                  style={styles.more}
                >
                  <Text style={styles.moreText}>•••</Text>
                </Pressable>
              </View>
              <Text numberOfLines={1} style={styles.detail}>
                {agent.detail}
              </Text>
              <Text style={[styles.status, statusStyles[agent.status]]}>
                {statusLabel(agent.status)}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add agent"
          onPress={onAdd}
          style={({ pressed }) => [
            styles.add,
            agents.length === 0 && styles.addEmpty,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.plus}>
            <Text style={styles.plusText}>+</Text>
          </View>
          <Text style={styles.addText}>Add agent</Text>
          <Text style={styles.addDetail}>Set up an agent deployment</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function statusLabel(status: AgentTrayItem["status"]): string {
  if (status === "needs-setup") return "Needs setup";
  if (status === "stopped") return "Session ended";
  if (status === "starting") return "Starting session";
  if (status === "running") return "Session running";
  if (status === "unreachable") return "Session unreachable";
  if (status === "gone") return "Deployment removed";
  if (status === "error") return "Attention";
  return status;
}

const dotStyles = StyleSheet.create({
  "needs-setup": { backgroundColor: color.warn },
  stopped: { backgroundColor: color.textDim },
  starting: { backgroundColor: color.warn },
  running: { backgroundColor: color.live },
  unreachable: { backgroundColor: color.danger },
  gone: { backgroundColor: color.textDim },
  error: { backgroundColor: color.danger },
});

const statusStyles = StyleSheet.create({
  "needs-setup": { color: color.warn },
  stopped: { color: color.textDim },
  starting: { color: color.warn },
  running: { color: color.live },
  unreachable: { color: color.danger },
  gone: { color: color.textDim },
  error: { color: color.danger },
});

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
    marginHorizontal: -space.xl,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.xl,
  },
  heading: {
    color: color.textDim,
    fontSize: font.micro,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  count: {
    color: color.textDim,
    fontSize: font.micro,
    fontWeight: "700",
  },
  row: {
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingBottom: space.xs,
  },
  agent: {
    width: 146,
    minHeight: 102,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  agentSelected: {
    borderColor: color.accent,
    backgroundColor: color.accentTint,
  },
  agentTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
  },
  dotLive: {
    shadowColor: color.live,
    shadowOpacity: 0.8,
    shadowRadius: 5,
  },
  name: {
    flex: 1,
    color: color.textMuted,
    fontSize: font.label,
    fontWeight: "700",
  },
  nameSelected: {
    color: color.text,
  },
  more: {
    minWidth: 24,
    minHeight: 24,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -space.xs,
  },
  moreText: {
    color: color.textMuted,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
    lineHeight: 14,
  },
  detail: {
    color: color.textDim,
    fontSize: font.caption,
    marginTop: space.md,
  },
  status: {
    fontSize: font.micro,
    fontWeight: "700",
    marginTop: space.xs,
  },
  add: {
    width: 146,
    minHeight: 102,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.borderStrong,
    backgroundColor: color.bgElevated,
  },
  addEmpty: {
    width: 220,
    minHeight: 118,
  },
  plus: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: color.accentTint,
  },
  plusText: {
    color: color.accent,
    fontSize: 20,
    lineHeight: 22,
  },
  addText: {
    color: color.text,
    fontSize: font.label,
    fontWeight: "700",
    marginTop: space.sm,
  },
  addDetail: {
    color: color.textDim,
    fontSize: font.micro,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
});
