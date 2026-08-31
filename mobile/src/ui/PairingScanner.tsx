import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "./components";
import { BrandIcon } from "./icons";
import { color, font, radius, space } from "./theme";

export function PairingScannerScreen({
  onScanned,
  onBack,
}: {
  onScanned: (value: string) => void;
  onBack: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);

  if (!permission?.granted) {
    return (
      <View style={styles.permissionScreen}>
        <View style={styles.topRow}>
          <BackButton onPress={onBack} />
          <BrandIcon size={34} />
          <View style={styles.spacer} />
        </View>
        <View style={styles.permissionCopy}>
          <Text style={styles.eyebrow}>PAIR EXISTING AGENT</Text>
          <Text style={styles.title}>Scan its setup code</Text>
          <Text style={styles.subtitle}>
            The QR code carries the gateway URL and bearer token. It stays on
            this device and is never added without your confirmation.
          </Text>
        </View>
        <Button
          label="Allow camera access"
          tone="primary"
          onPress={() => void requestPermission()}
        />
      </View>
    );
  }

  return (
    <View style={styles.cameraScreen}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (scannedRef.current) return;
          scannedRef.current = true;
          onScanned(data);
        }}
      />
      <View style={styles.overlay}>
        <View style={styles.cameraTop}>
          <BackButton onPress={onBack} />
          <Text style={styles.cameraTitle}>Scan setup QR</Text>
          <View style={styles.spacer} />
        </View>
        <View style={styles.scanFrame}>
          <View style={[styles.corner, styles.cornerTopLeft]} />
          <View style={[styles.corner, styles.cornerTopRight]} />
          <View style={[styles.corner, styles.cornerBottomLeft]} />
          <View style={[styles.corner, styles.cornerBottomRight]} />
        </View>
        <Text style={styles.cameraHint}>
          Point the camera at an agent_tts setup code.
        </Text>
      </View>
    </View>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={10}
      onPress={onPress}
      style={styles.back}
    >
      <Text style={styles.backGlyph}>‹</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  permissionScreen: {
    flex: 1,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    gap: space.xl,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  spacer: {
    width: 36,
  },
  back: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: "rgba(20, 22, 29, 0.88)",
  },
  backGlyph: {
    color: color.text,
    fontSize: 30,
    lineHeight: 31,
    marginLeft: -2,
  },
  permissionCopy: {
    flex: 1,
    justifyContent: "center",
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
    marginTop: space.md,
  },
  cameraScreen: {
    flex: 1,
    backgroundColor: color.bg,
    marginTop: -space.sm,
  },
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.xxxl,
    backgroundColor: "rgba(6, 7, 11, 0.28)",
  },
  cameraTop: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cameraTitle: {
    color: color.text,
    fontSize: font.label,
    fontWeight: "800",
  },
  scanFrame: {
    width: 246,
    height: 246,
  },
  corner: {
    position: "absolute",
    width: 44,
    height: 44,
    borderColor: color.accent,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: radius.md,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: radius.md,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: radius.md,
  },
  cornerBottomRight: {
    right: 0,
    bottom: 0,
    borderRightWidth: 4,
    borderBottomWidth: 4,
    borderBottomRightRadius: radius.md,
  },
  cameraHint: {
    color: color.text,
    fontSize: font.label,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    backgroundColor: "rgba(10, 11, 15, 0.72)",
    overflow: "hidden",
  },
});
