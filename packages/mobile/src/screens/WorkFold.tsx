import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatDuration } from "@neo-cloud-agent/contracts/display";
import { previewWorkTools, resolveFoldOpen, workGroupLabel, type PartitionedTurn } from "@neo-cloud-agent/contracts/work-view";
import { colors } from "./theme";
import { MarkdownNative } from "./MarkdownNative";

function useFoldOpen(live: boolean): [boolean, () => void] {
  const [choice, setChoice] = useState<boolean | null>(null);
  useEffect(() => {
    if (!live) setChoice(null);
  }, [live]);
  return [resolveFoldOpen(live, choice), () => setChoice((cur) => !resolveFoldOpen(live, cur))];
}

export function WorkFold({
  turn,
  live,
  createdAt,
  updatedAt,
  renderTools,
}: {
  turn: PartitionedTurn;
  live: boolean;
  createdAt: string;
  updatedAt?: string | null;
  renderTools: (tools: PartitionedTurn["buckets"][number]["tools"]) => ReactNode;
}) {
  const [open, toggle] = useFoldOpen(live);
  if (turn.buckets.length === 0 && turn.notes.length === 0) return null;
  const duration = live ? "" : formatDuration(createdAt, updatedAt);
  return (
    <View style={styles.fold}>
      <Pressable onPress={toggle} style={styles.sum}>
        <Text style={styles.label}>{live ? "工作中" : duration ? `工作了 ${duration}` : "工作了"}</Text>
        <Text style={styles.chevron}>{open ? "⌄" : "›"}</Text>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          {turn.notes.map((text, index) => (
            <MarkdownNative key={index} text={text} />
          ))}
          {turn.buckets.map((bucket) => {
            const { shown, hidden } = live ? { shown: bucket.tools, hidden: 0 } : previewWorkTools(bucket.tools);
            return (
              <View key={bucket.id} style={styles.group}>
                <Text style={styles.groupLabel}>{workGroupLabel(bucket.id, bucket.tools)}</Text>
                {hidden > 0 ? <Text style={styles.more}>还有 {hidden} 步</Text> : null}
                {renderTools(shown)}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fold: { gap: 6 },
  sum: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 28 },
  label: { color: colors.muted, fontSize: 13 },
  chevron: { color: colors.muted, fontSize: 16 },
  body: { gap: 8, paddingLeft: 8 },
  group: { gap: 6 },
  groupLabel: { color: colors.muted, fontSize: 12 },
  more: { color: colors.muted, fontSize: 12 },
});
