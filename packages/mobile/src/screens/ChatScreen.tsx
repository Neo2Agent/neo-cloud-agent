import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { transcriptGroups } from "@neo-cloud-agent/contracts/transcript";
import type { TranscriptMessage, TranscriptTool } from "@neo-cloud-agent/contracts/events";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { avatarLetter, toolArgPreview, toolBodyText, toolDisplayName } from "../format";
import { runPlaceLabel } from "../place";
import { colors } from "./theme";

type Props = {
  run: Run | null;
  status: string;
  running: boolean;
  messages: TranscriptMessage[];
  userEmail: string;
  userAvatar?: string | null;
  neoAvatar?: string | null;
  onOpenDrawer: () => void;
};

function Avatar({ src, letter, neo }: { src?: string | null; letter: string; neo?: boolean }) {
  return (
    <View style={[styles.avatar, neo ? styles.avatarNeo : styles.avatarUser]}>
      {src ? <Image source={{ uri: src }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>{letter}</Text>}
    </View>
  );
}

function ToolBlock({ tool }: { tool: TranscriptTool }) {
  const running = tool.status === "running";
  const [open, setOpen] = useState(running);
  useEffect(() => {
    if (running) setOpen(true);
  }, [running]);
  const preview = toolArgPreview(tool.args);
  const body = toolBodyText(tool);
  return (
    <Pressable onPress={() => setOpen((value) => !value)} style={styles.tool} accessibilityRole="button">
      <Text style={styles.toolTitle}>
        {running ? "…" : tool.isError ? "✗" : "✓"} {toolDisplayName(tool)} {open ? "▾" : "▸"}
      </Text>
      {preview ? <Text style={styles.cmd}>{preview}</Text> : null}
      {open ? <Text style={styles.toolOut} selectable>{body || "没有输出"}</Text> : null}
    </Pressable>
  );
}

export function ChatScreen({
  run,
  status,
  running,
  messages,
  userEmail,
  userAvatar,
  neoAvatar,
  onOpenDrawer,
}: Props) {
  const mine = avatarLetter(userEmail);
  return (
    <View style={styles.page}>
      <View style={styles.topbar}>
        <Pressable onPress={onOpenDrawer} hitSlop={12}>
          <Text style={styles.menu}>☰</Text>
        </Pressable>
        <View style={[styles.pill, running ? styles.pillBusy : null]}>
          <Text style={styles.pillText} numberOfLines={1}>{status}</Text>
        </View>
        <Text style={styles.place}>{run ? runPlaceLabel(run) : ""}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {messages.length === 0 ? <Text style={styles.empty}>还没有消息。</Text> : null}
        {messages.map((message) => {
          const mineMsg = message.role === "user";
          return (
            <View key={message.id} style={[styles.row, mineMsg ? styles.rowUser : styles.rowAgent]}>
              <Avatar
                src={mineMsg ? userAvatar : neoAvatar}
                letter={mineMsg ? mine : "N"}
                neo={!mineMsg}
              />
              <View style={[styles.bubble, mineMsg ? styles.user : styles.agent]}>
                {transcriptGroups(message).map((group, index) =>
                  group.type === "text" ? (
                    <Text key={`${message.id}-t${index}`} style={styles.body}>{group.text}</Text>
                  ) : (
                    <View key={`${message.id}-g${index}`}>
                      {group.tools.map((tool) => (
                        <ToolBlock key={tool.id ?? tool.name} tool={tool} />
                      ))}
                    </View>
                  ),
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  menu: { fontSize: 20, color: colors.ink, width: 28 },
  pill: { flex: 1, borderRadius: 999, backgroundColor: colors.paper, paddingHorizontal: 10, paddingVertical: 6 },
  pillBusy: { backgroundColor: "#d7f6f2" },
  pillText: { color: colors.ink, fontSize: 13 },
  place: { width: 56, color: colors.muted, fontSize: 12, textAlign: "right" },
  list: { padding: 14, gap: 12, paddingBottom: 24 },
  empty: { color: colors.muted, textAlign: "center", marginTop: 24 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8, maxWidth: "100%" },
  rowUser: { alignSelf: "flex-end", flexDirection: "row-reverse" },
  rowAgent: { alignSelf: "flex-start" },
  avatar: { width: 32, height: 32, borderRadius: 16, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  avatarImage: { width: 32, height: 32 },
  avatarUser: { backgroundColor: colors.ink },
  avatarNeo: { backgroundColor: colors.accent },
  avatarText: { color: colors.cream, fontWeight: "800", fontSize: 13 },
  bubble: { borderRadius: 16, padding: 12, maxWidth: "78%", borderWidth: 1, borderColor: colors.line },
  user: { backgroundColor: colors.bubbleUser },
  agent: { backgroundColor: colors.bubbleAgent },
  body: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  tool: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line },
  toolTitle: { color: colors.ink, fontWeight: "600", fontSize: 13 },
  cmd: { color: colors.muted, fontSize: 12, marginTop: 2 },
  toolOut: { color: colors.ink, fontSize: 12, lineHeight: 18, marginTop: 8 },
});
