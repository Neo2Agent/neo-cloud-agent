import { Pressable, StyleSheet, Text, View } from "react-native";
import type { RemoteCloudContinueCopy } from "@neo-cloud-agent/contracts/desk";
import { colors } from "./theme";

export function RemoteOfflineCard({ copy, onContinue }: { copy: RemoteCloudContinueCopy; onContinue: () => void }) {
  return (
    <View style={styles.card} accessibilityLabel={copy.title}>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
      {copy.repoLine ? <Text style={styles.meta}>{copy.repoLine}</Text> : null}
      <Text style={styles.warn}>{copy.warning}</Text>
      <Pressable testID="continue-remote-cloud" onPress={onContinue} style={styles.go}>
        <Text style={styles.goText}>{copy.action}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 6,
  },
  title: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  body: { color: colors.ink, fontSize: 13, lineHeight: 20 },
  meta: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  warn: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  go: {
    marginTop: 8,
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  goText: { color: colors.cream, fontSize: 13, fontWeight: "700" },
});
