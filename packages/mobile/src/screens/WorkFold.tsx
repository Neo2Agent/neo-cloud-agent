import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { formatDuration } from "@neo-cloud-agent/contracts/display";
import { previewWorkTools, resolveFoldOpen, workGroupLabel, type PartitionedTurn } from "@neo-cloud-agent/contracts/work-view";
import { colors } from "./theme";
import { MarkdownNative } from "./MarkdownNative";
import { useReducedMotion } from "./use-reduced-motion";

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
  const reducedMotion = useReducedMotion();
  const spin = useRef(new Animated.Value(0)).current;
  const chevron = useRef(new Animated.Value(0)).current;
  const empty = turn.buckets.length === 0 && turn.notes.length === 0;
  const duration = live ? "" : formatDuration(createdAt, updatedAt);
  const label = live ? "工作中" : duration ? `工作了 ${duration}` : "工作了";

  useEffect(() => {
    if (!live || reducedMotion || empty) {
      spin.stopAnimation();
      spin.setValue(0);
      return;
    }
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [empty, live, reducedMotion, spin]);

  useEffect(() => {
    if (reducedMotion) {
      chevron.setValue(open ? 1 : 0);
      return;
    }
    const anim = Animated.timing(chevron, { toValue: open ? 1 : 0, duration: 160, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [chevron, open, reducedMotion]);

  if (empty) return null;

  return (
    <View style={styles.fold}>
      <Pressable onPress={toggle} style={styles.sum} accessibilityState={{ expanded: open }}>
        <View style={styles.sumLeft}>
          <Text style={styles.label}>{label}</Text>
          {live ? (
            <Animated.View
              style={[
                styles.spinner,
                {
                  transform: [
                    {
                      rotate: spin.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["0deg", "360deg"],
                      }),
                    },
                  ],
                },
              ]}
            />
          ) : null}
        </View>
        <Animated.Text
          style={[
            styles.chevron,
            {
              transform: [
                {
                  rotate: chevron.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0deg", "90deg"],
                  }),
                },
              ],
            },
          ]}
        >
          ›
        </Animated.Text>
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
  sumLeft: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  label: { color: colors.muted, fontSize: 13 },
  spinner: {
    width: 10,
    height: 10,
    borderWidth: 2,
    borderColor: "rgba(28, 28, 28, 0.2)",
    borderTopColor: colors.ink,
    borderRadius: 5,
  },
  chevron: { color: colors.muted, fontSize: 16 },
  body: { gap: 8, paddingLeft: 8 },
  group: { gap: 6 },
  groupLabel: { color: colors.muted, fontSize: 12 },
  more: { color: colors.muted, fontSize: 12 },
});
