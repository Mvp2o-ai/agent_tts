import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { credentialVault } from "../secure-credential-vault";
import { HARNESSES } from "../settings";
import {
  resolveVoiceCredential,
} from "../voice-credentials";
import {
  getVoiceProvider,
  STT_PROVIDERS,
  TTS_PROVIDERS,
} from "../voice-providers";
import { SetupShell } from "./AgentSetup";
import { Button, Card, Field, Select } from "./components";
import { color, font, radius, space } from "./theme";

export function AppSettingsScreen({
  onBack,
  onSaved,
  sttProviderId: initialSttProviderId,
  ttsProviderId: initialTtsProviderId,
}: {
  onBack: () => void;
  onSaved: (patch: {
    sttProviderId: string;
    ttsProviderId: string;
  }) => void | Promise<void>;
  sttProviderId: string;
  ttsProviderId: string;
}) {
  const [sttProviderId, setSttProviderId] = useState(initialSttProviderId);
  const [ttsProviderId, setTtsProviderId] = useState(initialTtsProviderId);
  const savedProviderIds = {
    stt: initialSttProviderId,
    tts: initialTtsProviderId,
  };
  const [voiceSecrets, setVoiceSecrets] = useState<Record<string, string>>({});
  const [modelKeys, setModelKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void credentialVault.list().then(
      async (entries) => {
        const fields = selectedVoiceFields(
          initialSttProviderId,
          initialTtsProviderId,
        );
        const loadedVoiceSecrets = await Promise.all(
          fields.map(async ({ provider, field }) => {
            const entry = entries
              .filter(
                (candidate) =>
                  candidate.kind === "voice-key" &&
                  candidate.providerId === provider.id &&
                  candidate.keyEnv === field.env,
              )
              .at(-1);
            if (!entry) return null;
            const secret = await credentialVault.getSecret(entry.id);
            return secret
              ? { key: voiceFieldKey(provider.id, field.env), secret }
              : null;
          }),
        );
        const nextVoiceSecrets: Record<string, string> = {};
        for (const loaded of loadedVoiceSecrets) {
          if (loaded) nextVoiceSecrets[loaded.key] = loaded.secret;
        }
      const nextModelKeys: Record<string, string> = {};
      await Promise.all(
        HARNESSES.map(async (harness) => {
          const entry = entries
            .filter(
              (candidate) =>
                candidate.kind === "model-key" &&
                candidate.keyEnv === harness.keyEnv,
            )
            .at(-1);
          if (!entry) return;
          const secret = await credentialVault.getSecret(entry.id);
          if (secret) nextModelKeys[harness.keyEnv] = secret;
        }),
      );
      if (!active) return;
      setVoiceSecrets(nextVoiceSecrets);
      setModelKeys(nextModelKeys);
      setLoaded(true);
      },
    );
    return () => {
      active = false;
    };
  }, [initialSttProviderId, initialTtsProviderId]);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const fields = selectedVoiceFields(sttProviderId, ttsProviderId);
      await Promise.all(
        fields.map(({ provider, field }) => {
          const secret = voiceSecrets[voiceFieldKey(provider.id, field.env)] ?? "";
          if (!secret.trim()) return undefined;
          return resolveVoiceCredential(credentialVault, {
            providerId: provider.id,
            keyEnv: field.env,
            label: field.label,
            secret,
          });
        }),
      );
      await Promise.all(
        HARNESSES.map(async (harness) => {
          const secret = modelKeys[harness.keyEnv]?.trim();
          if (!secret) return;
          const entries = await credentialVault.list();
          const existing = entries
            .filter(
              (entry) =>
                entry.kind === "model-key" &&
                entry.keyEnv === harness.keyEnv,
            )
            .at(-1);
          await credentialVault.save({
            id: existing?.id,
            kind: "model-key",
            keyEnv: harness.keyEnv,
            label: `${harness.label} API key`,
            secret,
          });
        }),
      );
      await onSaved({ sttProviderId, ttsProviderId });
      onBack();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save voice keys.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SetupShell
      eyebrow="APP"
      title="App credentials"
      subtitle="Choose the app-level voice services and credentials used for launches from this phone. Paired hosts keep their own gateway environment."
      onBack={onBack}
    >
      <Text style={styles.sectionLabel}>VOICE SERVICES</Text>
      <Card style={styles.formCard}>
        {[
          {
            role: "stt" as const,
            label: "Speech-to-text",
            providerId: sttProviderId,
            providers: STT_PROVIDERS,
            onChange: setSttProviderId,
          },
          {
            role: "tts" as const,
            label: "Text-to-speech",
            providerId: ttsProviderId,
            providers: TTS_PROVIDERS,
            onChange: setTtsProviderId,
          },
        ].map((service) => {
          const provider = getVoiceProvider(service.role, service.providerId);
          const fields = selectedVoiceFields(
            sttProviderId,
            ttsProviderId,
          ).filter((entry) => entry.provider.id === provider.id);
          return (
            <View key={service.role} style={styles.voiceService}>
              <View style={styles.voiceServiceHeader}>
                <View style={styles.voiceServiceTitle}>
                  <Text style={styles.pickerLabel}>{service.label}</Text>
                  <Text style={styles.providerHint}>
                    {provider.label} credentials
                  </Text>
                </View>
                <Select
                  options={service.providers.map((entry) => ({
                    value: entry.id,
                    label: entry.label,
                  }))}
                  value={service.providerId}
                  onChange={service.onChange}
                  disabled={busy}
                />
              </View>
              {fields.map(({ provider: fieldProvider, field }) => (
                <Field
                  key={voiceFieldKey(fieldProvider.id, field.env)}
                  label={field.label}
                  value={
                    voiceSecrets[
                      voiceFieldKey(fieldProvider.id, field.env)
                    ] ?? ""
                  }
                  onChange={(value) =>
                    setVoiceSecrets((current) => ({
                      ...current,
                      [voiceFieldKey(fieldProvider.id, field.env)]: value,
                    }))
                  }
                  autoCapitalize="none"
                  secure={field.secret}
                  mono={field.secret}
                  hint={field.hint}
                />
              ))}
            </View>
          );
        })}
      </Card>
      <Text style={styles.sectionLabel}>AGENT RUNTIMES</Text>
      <Card style={styles.formCard}>
        {HARNESSES.map((harness) => (
          <Field
            key={harness.id}
            label={`${harness.label} API key`}
            value={modelKeys[harness.keyEnv] ?? ""}
            onChange={(value) =>
              setModelKeys((current) => ({
                ...current,
                [harness.keyEnv]: value,
              }))
            }
            autoCapitalize="none"
            secure
            mono
            hint={`Used when an agent runs ${harness.label}.`}
          />
        ))}
      </Card>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        label="Save app credentials"
        tone="primary"
        busy={busy}
        disabled={
          !loaded ||
          busy ||
          (sttProviderId === savedProviderIds.stt &&
            ttsProviderId === savedProviderIds.tts &&
            ![
              ...Object.values(voiceSecrets),
              ...Object.values(modelKeys),
            ].some((value) => value.trim()))
        }
        onPress={() => void save()}
      />
      <View style={styles.noteBox}>
        <Text style={styles.note}>
          Existing hosts keep the keys already in their environment. Only
          in-app launches copy these values into a new container.
        </Text>
      </View>
    </SetupShell>
  );
}

function selectedVoiceFields(sttProviderId: string, ttsProviderId: string) {
  const providers = [
    getVoiceProvider("stt", sttProviderId),
    getVoiceProvider("tts", ttsProviderId),
  ];
  const seenEnvs = new Set<string>();
  return providers.flatMap((provider) =>
    provider.credentialFields
      .filter((field) => {
        if (!field.secret || seenEnvs.has(field.env)) return false;
        seenEnvs.add(field.env);
        return true;
      })
      .map((field) => ({ provider, field })),
  );
}

function voiceFieldKey(providerId: string, env: string): string {
  return `${providerId}:${env}`;
}

const styles = StyleSheet.create({
  formCard: {
    gap: space.lg,
  },
  pickerLabel: {
    color: color.textDim,
    fontSize: font.caption,
    fontWeight: "700",
  },
  voiceService: {
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.bgElevated,
  },
  voiceServiceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    marginBottom: space.md,
  },
  voiceServiceTitle: {
    flex: 1,
    gap: 4,
  },
  providerHint: {
    color: color.textDim,
    fontSize: font.caption,
  },
  sectionLabel: {
    color: color.textDim,
    fontSize: font.micro,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  error: {
    color: color.danger,
    fontSize: font.caption,
    lineHeight: 18,
  },
  noteBox: {
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surface,
  },
  note: {
    color: color.textDim,
    fontSize: font.caption,
    lineHeight: 18,
  },
});
