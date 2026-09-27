import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import { formatWhen } from "@neo-cloud-agent/contracts/display";
import { setupDiagToggleLabel, setupFailLogText, setupFailureTitle } from "@neo-cloud-agent/contracts/setup-fail";
import { colors } from "./theme";

export function SetupFailBanner({ message }: { message: TranscriptMessage }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap} nativeID={`msg-${message.id}`}>
      <Text style={styles.title}>{setupFailureTitle(message)}</Text>
      <View style={styles.row}>
        <Pressable onPress={() => setOpen((current) => !current)}>
          <Text style={styles.link}>{setupDiagToggleLabel(open)}</Text>
        </Pressable>
        <Text style={styles.when}>{formatWhen(message.createdAt)}</Text>
      </View>
      {open ? <Text style={styles.log} selectable>{setupFailLogText(message)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  title: { color: colors.error, fontSize: 13 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  link: { color: colors.ink, fontSize: 12, fontWeight: "600" },
  when: { color: colors.muted, fontSize: 12 },
  log: {
    color: colors.ink,
    fontSize: 12,
    backgroundColor: colors.paper,
    padding: 8,
    borderRadius: 8,
  },
});
