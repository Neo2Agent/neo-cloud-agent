import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { preview } from "../format";
import { runRowMeta } from "../session";
import { isActiveRunStatus } from "../turn";
import { splitShelvedRuns, toggleSelected } from "../cloud";
import { SettingsIcon } from "./composer-icons";
import { IslandButton } from "./island";
import { drawerTopInset } from "./safe-area";
import { colors } from "./theme";

type NavId = "home" | "automations" | "experts" | "projects" | "settings" | "memories" | "inbox" | "skills";

type Props = {
  open: boolean;
  runs: Run[];
  userEmail: string;
  health: string;
  /** Unread inbox count, already capped by `unreadBadge`. */
  unread?: string;
  onClose: () => void;
  onNew: () => void;
  onOpenRun: (id: string) => void;
  onOpenNav: (id: NavId) => void;
  onArchiveMany?: (ids: string[]) => Promise<void>;
  /** Archived and expired runs only; the control plane rejects the rest. */
  onDeleteRun?: (id: string) => Promise<void>;
};

const PANEL_W = 280;
const OPEN_MS = 360;
const CLOSE_MS = 280;

export function Drawer(props: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(props.open);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { live, shelved } = splitShelvedRuns(props.runs);

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
              ["inbox", "消息"],
              ["automations", "定时任务"],
              ["projects", "项目"],
              ["experts", "专家"],
              ["skills", "技能"],
              ["memories", "记忆"],
            ] as const
          ).map(([id, label]) => (
            <Pressable key={id} onPress={() => props.onOpenNav(id)} style={styles.nav}>
              <Text style={styles.navText}>{label}</Text>
              {id === "inbox" && props.unread ? <Text style={styles.badge}>{props.unread}</Text> : null}
            </Pressable>
          ))}
          <View style={styles.sectionRow}>
            <Text style={styles.section}>近期</Text>
            {props.onArchiveMany && live.length > 0 ? (
              <Pressable
                onPress={() => {
                  if (!selecting) {
                    setSelecting(true);
                    return;
                  }
                  setSelecting(false);
                  setSelected([]);
                }}
              >
                <Text style={styles.sectionAction}>{selecting ? "取消" : "多选"}</Text>
              </Pressable>
            ) : null}
          </View>
          {selecting && selected.length > 0 && props.onArchiveMany ? (
            <IslandButton
              label={busy ? "归档中…" : `归档选中 ${selected.length} 条`}
              disabled={busy}
              onPress={() => {
                setBusy(true);
                void props.onArchiveMany?.(selected).finally(() => {
                  setBusy(false);
                  setSelecting(false);
                  setSelected([]);
                });
              }}
            />
          ) : null}
          <ScrollView>
            {props.runs.length === 0 ? <Text style={styles.empty}>暂无近期任务</Text> : null}
            {live.map((run) => (
              <Pressable
                key={run.id}
                onPress={() => (selecting ? setSelected((prev) => toggleSelected(prev, run.id)) : props.onOpenRun(run.id))}
                style={styles.row}
              >
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {selecting ? (selected.includes(run.id) ? "☑ " : "☐ ") : isActiveRunStatus(run.status) ? "● " : ""}
                  {preview(run.prompt)}
                </Text>
                <Text style={styles.rowMeta}>{runRowMeta(run)}</Text>
              </Pressable>
            ))}
            {shelved.length > 0 ? <Text style={styles.section}>已归档</Text> : null}
            {shelved.map((run) => (
              <View key={run.id} style={styles.row}>
                <Pressable onPress={() => props.onOpenRun(run.id)}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{preview(run.prompt)}</Text>
                  <Text style={styles.rowMeta}>{runRowMeta(run)}</Text>
                </Pressable>
                {props.onDeleteRun ? (
                  <Pressable onPress={() => void props.onDeleteRun?.(run.id)} hitSlop={8}>
                    <Text style={styles.delete}>删除</Text>
                  </Pressable>
                ) : null}
              </View>
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
  nav: { paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  navText: { color: colors.ink, fontSize: 16 },
  badge: {
    backgroundColor: colors.accent,
    color: colors.cream,
    fontSize: 12,
    fontWeight: "700",
    minWidth: 20,
    textAlign: "center",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  section: { color: colors.muted, marginTop: 12, marginBottom: 6 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionAction: { color: colors.accent, fontSize: 13, fontWeight: "700" },
  delete: { color: colors.error, fontSize: 12, marginTop: 4 },
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
