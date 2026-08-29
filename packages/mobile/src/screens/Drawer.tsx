import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { preview } from "../format";
import { runRowMeta } from "../session";
import { isActiveRunStatus } from "../turn";
import { SettingsIcon } from "./composer-icons";
import { IslandButton } from "./island";
import { drawerTopInset } from "./safe-area";
import { colors } from "./theme";

type NavId = "home" | "automations" | "experts" | "projects" | "settings";

type Props = {
  open: boolean;
  runs: Run[];
  userEmail: string;
  health: string;
  onClose: () => void;
  onNew: () => void;
  onOpenRun: (id: string) => void;
  onOpenNav: (id: NavId) => void;
};

const PANEL_W = 280;
const OPEN_MS = 360;
const CLOSE_MS = 280;

export function Drawer(props: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(props.open);

  useEffect(() => {
    if (props.open) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: OPEN_MS,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }).start();
      return;
    }
    if (!mounted) return;
    const anim = Animated.timing(progress, {
      toValue: 0,
      duration: CLOSE_MS,
      easing: Easing.bezier(0.4, 0, 1, 1),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return () => anim.stop();
  }, [mounted, progress, props.open]);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={props.onClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: progress }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} accessibilityLabel="关闭侧栏" />
        </Animated.View>
        <Animated.View
          style={[
            styles.panel,
            {
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-PANEL_W - 12, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.brand}>Neo</Text>
          <IslandButton primary label="新建对话" onPress={props.onNew} />
          {(
            [
              ["automations", "定时任务"],
              ["projects", "项目"],
              ["experts", "专家"],
            ] as const
          ).map(([id, label]) => (
            <Pressable key={id} onPress={() => props.onOpenNav(id)} style={styles.nav}>
              <Text style={styles.navText}>{label}</Text>
            </Pressable>
          ))}
          <Text style={styles.section}>近期</Text>
          <ScrollView>
            {props.runs.length === 0 ? <Text style={styles.empty}>暂无近期任务</Text> : null}
            {props.runs.map((run) => (
              <Pressable key={run.id} onPress={() => props.onOpenRun(run.id)} style={styles.row}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {isActiveRunStatus(run.status) ? "● " : ""}
                  {preview(run.prompt)}
                </Text>
                <Text style={styles.rowMeta}>{runRowMeta(run)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.foot}>
            <View style={styles.account}>
              <Text style={styles.email} numberOfLines={1}>{props.userEmail || "已登录"}</Text>
              <Text style={styles.health}>{props.health}</Text>
            </View>
            <Pressable
              onPress={() => props.onOpenNav("settings")}
              style={styles.settings}
              accessibilityLabel="设置"
              hitSlop={8}
            >
              <SettingsIcon color={colors.ink} />
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(61, 52, 40, 0.34)" },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: PANEL_W,
    maxWidth: "78%",
    backgroundColor: colors.rail,
    paddingTop: drawerTopInset,
    paddingHorizontal: 16,
  },
  brand: { fontSize: 20, fontWeight: "800", color: colors.ink, marginBottom: 12 },
  nav: { paddingVertical: 12 },
  navText: { color: colors.ink, fontSize: 16 },
  section: { color: colors.muted, marginTop: 12, marginBottom: 6 },
  empty: { color: colors.muted, paddingVertical: 12 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  rowTitle: { color: colors.ink, fontWeight: "600" },
  rowMeta: { color: colors.muted, marginTop: 4, fontSize: 12 },
  foot: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 16 },
  account: { flex: 1, minWidth: 0, gap: 4 },
  email: { color: colors.ink },
  health: { color: colors.muted, fontSize: 12 },
  settings: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
