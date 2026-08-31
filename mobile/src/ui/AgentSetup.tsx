import type { ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ProviderDefinition } from "../providers/types";
import { Button, Card, Field, KeyboardAwareScrollView } from "./components";
import { BrandIcon } from "./icons";
import { color, font, inset, radius, space } from "./theme";

export function AddAgentScreen({
  onBack,
  providers,
  onProvider,
  onManual,
}: {
  onBack: () => void;
  providers: readonly ProviderDefinition[];
  onProvider: (providerId: string) => void;
  onManual: () => void;
}) {
  return (
    <SetupShell
      eyebrow="ADD AGENT"
      title="Where should this agent run?"
      subtitle="Each agent deployment runs one disposable session at a time. Launch one in your cloud account or connect a host you already run."
      onBack={onBack}
    >
      {providers.map((provider) => (
        <ChoiceCard
          key={provider.id}
          badge={provider.badge}
          title={`Launch on ${provider.label}`}
          description={provider.description}
          action={provider.actionLabel}
          onPress={() => onProvider(provider.id)}
        />
      ))}
      <ChoiceCard
        title="Connect an existing host"
        description="For local Docker, a VPS, Kubernetes, or any compatible gateway."
        action="Enter URL and token"
        onPress={onManual}
      />
      <Text style={styles.ownership}>
        Infrastructure, usage, and credentials remain in accounts you control.
      </Text>
    </SetupShell>
  );
}

export function ManualAgentScreen({
  name,
  gatewayUrl,
  token,
  busy,
  onNameChange,
  onGatewayUrlChange,
  onTokenChange,
  onScan,
  onSave,
  onBack,
}: {
  name: string;
  gatewayUrl: string;
  token: string;
  busy?: boolean;
  onNameChange: (value: string) => void;
  onGatewayUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onScan: () => void;
  onSave: () => void;
  onBack: () => void;
}) {
  return (
    <SetupShell
      eyebrow="EXISTING HOST"
      title="Connect a gateway"
      subtitle="Use the HTTPS hostname and access token from your deployment. Local network addresses are supported."
      onBack={onBack}
    >
      <Button label="Scan setup QR" onPress={onScan} />
      <Card style={styles.formCard}>
        <Field
          label="Agent name"
          value={name}
          onChange={onNameChange}
          placeholder="Fix offline status on agent cards"
          hint="Use a recognizable name for this agent host."
        />
        <Field
          label="Gateway URL"
          value={gatewayUrl}
          onChange={onGatewayUrlChange}
          placeholder="https://agent.example.com"
          autoCapitalize="none"
          mono
        />
        <Field
          label="Gateway token"
          value={token}
          onChange={onTokenChange}
          placeholder="Paste access token"
          autoCapitalize="none"
          secure
          mono
          hint="Saved in the device credential vault."
        />
      </Card>
      <Button
        label="Add agent"
        tone="primary"
        busy={busy}
        disabled={!name.trim() || !gatewayUrl.trim() || !token.trim()}
        onPress={onSave}
      />
    </SetupShell>
  );
}

export function SetupShell({
  eyebrow,
  title,
  subtitle,
  onBack,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <KeyboardAwareScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={10}
          onPress={onBack}
          style={styles.back}
        >
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
        <BrandIcon size={34} />
        <View style={styles.backSpacer} />
      </View>
      <View>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      {children}
    </KeyboardAwareScrollView>
  );
}

function ChoiceCard({
  badge,
  title,
  description,
  action,
  onPress,
}: {
  badge?: string;
  title: string;
  description: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        pressed && styles.choicePressed,
      ]}
    >
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      <Text style={styles.choiceTitle}>{title}</Text>
      <Text style={styles.choiceDescription}>{description}</Text>
      <Text style={styles.choiceAction}>{action} →</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.bg,
  },
  content: {
    paddingTop: space.sm,
    paddingHorizontal: space.xl,
    paddingBottom: inset.bottom + space.xxxl,
    gap: space.lg,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.sm,
  },
  back: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: color.surface,
  },
  backGlyph: {
    color: color.text,
    fontSize: 30,
    lineHeight: 31,
    marginLeft: -2,
  },
  backSpacer: {
    width: 36,
  },
  eyebrow: {
    color: color.accent,
    fontSize: font.micro,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  title: {
    color: color.text,
    fontSize: font.display,
    fontWeight: "800",
    letterSpacing: -0.7,
    marginTop: space.sm,
  },
  subtitle: {
    color: color.textMuted,
    fontSize: font.body,
    lineHeight: 23,
    marginTop: space.sm,
  },
  choice: {
    padding: space.xl,
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: radius.xl,
    backgroundColor: color.surface,
  },
  choicePressed: {
    borderColor: color.accent,
    backgroundColor: color.accentTint,
    transform: [{ scale: 0.99 }],
  },
  badge: {
    alignSelf: "flex-start",
    color: color.accent,
    fontSize: font.micro,
    fontWeight: "800",
    letterSpacing: 0.8,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.accentTint,
    marginBottom: space.md,
  },
  choiceTitle: {
    color: color.text,
    fontSize: font.title,
    fontWeight: "800",
  },
  choiceDescription: {
    color: color.textMuted,
    fontSize: font.label,
    lineHeight: 20,
    marginTop: space.sm,
  },
  choiceAction: {
    color: color.accent,
    fontSize: font.label,
    fontWeight: "700",
    marginTop: space.lg,
  },
  ownership: {
    color: color.textDim,
    fontSize: font.caption,
    lineHeight: 18,
    textAlign: "center",
    paddingHorizontal: space.lg,
  },
  formCard: {
    gap: space.lg,
  },
});
