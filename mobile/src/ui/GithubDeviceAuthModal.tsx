import {
  Linking,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { GithubDeviceAuthorization } from "../github";
import { Button } from "./components";
import { color, font, monoFamily, radius, space } from "./theme";

export function GithubDeviceAuthModal({
  authorization,
  onCancel,
}: {
  authorization: GithubDeviceAuthorization | null;
  onCancel: () => void;
}) {
  if (!authorization) return null;

  const openGithub = () => {
    void Linking.openURL(
      authorization.verificationUriComplete ?? authorization.verificationUri,
    );
  };

  const shareCode = () => {
    void Share.share({
      message: authorization.userCode,
      title: "GitHub device code",
    });
  };

  return (
    <Modal
      visible
      animationType="fade"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>AUTHORIZE GITHUB</Text>
          <Text style={styles.title}>Enter this code on GitHub</Text>
          <Text style={styles.detail}>
            Keep this screen open. Open GitHub, sign in if needed, then enter
            the code below. This app waits until you approve.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Device code ${authorization.userCode}. Double tap to share.`}
            onPress={shareCode}
            style={styles.codeBox}
          >
            <Text selectable style={styles.code}>
              {authorization.userCode}
            </Text>
            <Text style={styles.codeHint}>Tap to share or copy</Text>
          </Pressable>

          <Button
            tone="primary"
            label="Open GitHub"
            onPress={openGithub}
          />
          <Button tone="ghost" label="Cancel" onPress={onCancel} />
          <Text style={styles.waiting}>Waiting for authorization…</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: color.overlay,
    justifyContent: "center",
    paddingHorizontal: space.xl,
  },
  card: {
    gap: space.md,
    padding: space.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
  },
  eyebrow: {
    color: color.textDim,
    fontSize: font.micro,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  title: {
    color: color.text,
    fontSize: font.title,
    fontWeight: "700",
  },
  detail: {
    color: color.textMuted,
    fontSize: font.caption,
    lineHeight: 18,
  },
  codeBox: {
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.accent,
    backgroundColor: color.accentTint,
  },
  code: {
    color: color.text,
    fontFamily: monoFamily,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 2,
  },
  codeHint: {
    color: color.textDim,
    fontSize: font.micro,
    fontWeight: "600",
  },
  waiting: {
    color: color.live,
    fontSize: font.caption,
    fontWeight: "700",
    textAlign: "center",
  },
});
