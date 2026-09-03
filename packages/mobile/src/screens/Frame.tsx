import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Screen } from "./Screen";
import { colors } from "./theme";

export function Frame({ title, onBack, action, children }: { title: string; onBack: () => void; action?: ReactNode; children: ReactNode }) {
  return (
    <Screen>
      <View style={styles.topbar}>
        <Pressable onPress={onBack}><Text style={styles.back}>返回</Text></Pressable>
        <Text style={styles.title}>{title}</Text>
        {action ?? <View style={styles.back} />}
      </View>
      <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>
    </Screen>
  );
}

export const frameStyles = StyleSheet.create({
  hint: { color: colors.muted, fontSize: 13 },
  empty: { color: colors.muted, textAlign: "center", marginTop: 16 },
  error: { color: colors.error },
  section: { color: colors.muted, marginTop: 8, fontWeight: "600" },
  card: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 16, padding: 14 },
  cardTitle: { color: colors.ink, fontWeight: "700" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
});

const styles = StyleSheet.create({
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  back: { width: 56, color: colors.ink },
  title: { fontSize: 18, fontWeight: "700", color: colors.ink, flex: 1, textAlign: "center" },
  body: { padding: 16, gap: 10 },
});
