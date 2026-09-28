import { useEffect, useRef, useState, type ReactNode } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { isSetupFailureMessage, transcriptGroups } from "@neo-cloud-agent/contracts/transcript";
import { displaySetupText } from "@neo-cloud-agent/contracts/desk";
import type { TranscriptMessage, TranscriptTool } from "@neo-cloud-agent/contracts/events";
import { artifactFileName, artifactKindLabel } from "@neo-cloud-agent/contracts/artifact";
import { liveAssistantId } from "@neo-cloud-agent/contracts/turn-state";
import { messageTimeLabel, userMessageAuthor } from "@neo-cloud-agent/contracts/turn-view";
import { partitionTurn } from "@neo-cloud-agent/contracts/work-view";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { MarkdownNative } from "./MarkdownNative";
import { WorkFold } from "./WorkFold";
import { runListTitle, toolArgPreview, toolBodyText, toolDisplayName } from "../format";
import { runPlaceLabel } from "../place";
import { generationStarted, hasVisibleTranscript, isStartupWhisper } from "../turn";
import { colors } from "./theme";

type Props = {
  run: Run | null;
  status: string;
  running: boolean;
  messages: TranscriptMessage[];
  thinking?: string | null;
  hideHandshake?: boolean;
  canLoadOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  userEmail: string;
  userAvatar?: string | null;
  neoAvatar?: string | null;
  onOpenDrawer: () => void;
  onOpenInspector?: () => void;
  onOpenArtifacts?: () => void;
  userId?: string;
  invite?: ReactNode;
};

function ToolCard({ tool }: { tool: TranscriptTool }) {
  const running = tool.status === "running";
  const [open, setOpen] = useState(running);
  useEffect(() => {
    if (running) setOpen(true);
  }, [running]);
  const preview = toolArgPreview(tool.args);
  const body = toolBodyText(tool);
  return (
    <Pressable
      onPress={() => setOpen((value) => !value)}
      style={[styles.toolCard, running ? styles.toolRun : null, tool.isError ? styles.toolErr : null]}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
    >
      <View style={styles.toolHead}>
        <Text style={[styles.toolMark, running ? styles.toolMarkRun : tool.isError ? styles.toolMarkErr : null]}>
          {running ? "…" : tool.isError ? "✗" : "✓"}
        </Text>
        <Text style={styles.toolName} numberOfLines={1}>{toolDisplayName(tool)}</Text>
        <Text style={styles.toolChevron}>{open ? "收起" : "展开"}</Text>
      </View>
      {preview ? <Text style={styles.cmd} numberOfLines={open ? 0 : 1}>{preview}</Text> : null}
      {open ? (
        <View style={styles.toolPanel}>
          <Text style={styles.toolOut} selectable>{body || "没有输出"}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ThinkingRow({ hint, neoAvatar }: { hint: string; neoAvatar?: string | null }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((value) => (value + 1) % 3), 380);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={[styles.row, styles.rowAgent]}>
      <View style={styles.thinkBox}>
        <View style={styles.thinkDots}>
          {[0, 1, 2].map((index) => (
            <View key={index} style={[styles.thinkDot, index === tick ? styles.thinkDotOn : null]} />
          ))}
        </View>
        <Text style={styles.thinkText}>{hint}</Text>
      </View>
    </View>
  );
}

export function ChatScreen({
  run,
  status,
  running,
  messages,
  thinking,
  hideHandshake = false,
  canLoadOlder,
  loadingOlder,
  onLoadOlder,
  userEmail,
  userAvatar,
  neoAvatar,
  onOpenDrawer,
  onOpenInspector,
  onOpenArtifacts,
  userId,
  invite,
}: Props) {
  const liveId = liveAssistantId(messages, running);
  const started = generationStarted(messages);
  const scrollRef = useRef<ScrollView>(null);
  const tail = messages.at(-1);
  // Keyed on the tail, not the length, so prepending older history keeps your place.
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [tail?.id, tail?.text, tail?.streaming, thinking]);
  return (
    <View style={styles.page}>
      <View style={styles.topbar}>
        <Pressable onPress={onOpenDrawer} hitSlop={12}>
          <Text style={styles.menu}>☰</Text>
        </Pressable>
        {run ? <Text style={styles.title} numberOfLines={1}>{runListTitle(run)}</Text> : <View style={styles.title} />}
        <View style={[styles.statusPill, running ? styles.pillBusy : null]}>
          <Text style={styles.statusText} numberOfLines={1}>{status}</Text>
        </View>
        <Text style={styles.place}>{run ? runPlaceLabel(run) : ""}</Text>
        {run && onOpenInspector ? (
          <Pressable onPress={onOpenInspector} hitSlop={12} accessibilityLabel="打开侧栏">
            <Text style={styles.side}>侧栏</Text>
          </Pressable>
        ) : null}
      </View>
      {run && invite ? <View style={styles.actions}>{invite}</View> : null}
      <ScrollView ref={scrollRef} contentContainerStyle={styles.list}>
        {canLoadOlder && onLoadOlder ? (
          <Pressable onPress={onLoadOlder} disabled={loadingOlder} style={styles.older}>
            <Text style={styles.olderText}>{loadingOlder ? "加载中…" : "加载更早"}</Text>
          </Pressable>
        ) : null}
        {messages.length === 0 ? <Text style={styles.empty}>还没有消息。</Text> : null}
        {messages.map((message) => {
          if (message.role === "setup") {
            if (isStartupWhisper(message) && (hideHandshake || started || thinking)) return null;
            return (
              <View key={message.id} style={styles.setupRow}>
                <Text style={isSetupFailureMessage(message) ? styles.setupErr : styles.setup}>
                  {displaySetupText(message, run)}
                </Text>
                <Text style={styles.setupTime}>{messageTimeLabel(message)}</Text>
              </View>
            );
          }
          if (message.kind === "artifact.uploaded") {
            const name = artifactFileName(message);
            return (
              <Pressable key={message.id} onPress={onOpenArtifacts} style={styles.artifact}>
                <Text style={styles.artifactName} numberOfLines={1}>{name}</Text>
                <Text style={styles.when}>{artifactKindLabel({ name, contentType: message.mediaType })}</Text>
              </Pressable>
            );
          }
          if (!hasVisibleTranscript(message)) return null;
          const mineMsg = message.role === "user";
          const author = mineMsg ? userMessageAuthor(message, { id: userId, email: userEmail }) : null;
          const live = !mineMsg && (liveId === message.id || Boolean(running && message.streaming));
          const when = messageTimeLabel(message, { live });
          const groups = transcriptGroups(message);
          return (
            <View key={message.id} style={[styles.row, mineMsg ? styles.rowUser : styles.rowAgent]}>
              <View style={mineMsg ? styles.colUser : styles.col}>
                {author ? <Text style={styles.author}>{author}</Text> : null}
                {message.images?.length ? (
                  <View style={styles.imageRow}>
                    {message.images.map((image, index) => (
                      <Image
                        key={`${message.id}-img${index}`}
                        source={{ uri: `data:${image.mediaType};base64,${image.data}` }}
                        style={styles.userImage}
                      />
                    ))}
                  </View>
                ) : null}
                {mineMsg
                  ? groups.map((group, index) =>
                      group.type === "text" ? (
                        <View key={`${message.id}-t${index}`} style={[styles.bubble, styles.user]}>
                          <Text style={styles.body} selectable>
                            {group.text}
                          </Text>
                        </View>
                      ) : (
                        <View key={`${message.id}-g${index}`} style={styles.toolStack}>
                          {group.tools.map((tool) => (
                            <ToolCard key={tool.id ?? tool.name} tool={tool} />
                          ))}
                        </View>
                      ),
                    )
                  : (() => {
                      const turn = partitionTurn(groups);
                      return (
                        <>
                          <WorkFold
                            turn={turn}
                            live={live}
                            createdAt={message.createdAt}
                            updatedAt={message.updatedAt}
                            renderTools={(tools) => (
                              <View style={styles.toolStack}>
                                {tools.map((tool) => (
                                  <ToolCard key={tool.id ?? tool.name} tool={tool} />
                                ))}
                              </View>
                            )}
                          />
                          {turn.answer ? (
                            <View style={[styles.bubble, styles.agent]}>
                              <MarkdownNative text={turn.answer} />
                            </View>
                          ) : null}
                        </>
                      );
                    })()}
                {when ? <Text style={styles.when}>{when}</Text> : null}
              </View>
            </View>
          );
        })}
        {thinking ? <ThinkingRow hint={thinking} neoAvatar={neoAvatar} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  menu: { fontSize: 20, color: colors.ink, width: 28 },
  title: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 15, fontWeight: "600" },
  statusPill: { borderRadius: 999, backgroundColor: colors.statusBg, paddingHorizontal: 10, minHeight: 28, justifyContent: "center" },
  pillBusy: { backgroundColor: colors.statusBg },
  author: { color: colors.muted, fontSize: 12 },
  when: { color: colors.muted, fontSize: 11 },
  statusText: { color: colors.status, fontSize: 12, fontWeight: "600" },
  place: { width: 56, color: colors.muted, fontSize: 12, textAlign: "right" },
  side: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  older: { alignSelf: "center", paddingHorizontal: 14, paddingVertical: 6 },
  olderText: { color: colors.muted, fontSize: 12 },
  actions: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  list: { padding: 14, gap: 12, paddingBottom: 24 },
  empty: { color: colors.muted, textAlign: "center", marginTop: 24 },
  whisper: { color: colors.muted, fontSize: 12, textAlign: "center", paddingHorizontal: 24, lineHeight: 18 },
  setupRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 8 },
  setup: { color: colors.muted, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  setupErr: { color: colors.error, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  setupTime: { color: colors.muted, fontSize: 11 },
  thinkBox: { flexShrink: 1, maxWidth: "100%", gap: 8, paddingTop: 6 },
  thinkDots: { flexDirection: "row", alignItems: "center", gap: 5 },
  thinkDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.hover },
  artifact: {
    alignSelf: "flex-start",
    maxWidth: "78%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  artifactName: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  thinkDotOn: { backgroundColor: colors.accent },
  thinkText: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8, maxWidth: "100%" },
  rowUser: { alignSelf: "flex-end", flexDirection: "row-reverse" },
  rowAgent: { alignSelf: "flex-start" },
  col: { flexShrink: 1, maxWidth: "100%", gap: 8 },
  colUser: { flexShrink: 1, maxWidth: "86%", gap: 8, alignItems: "flex-end" },
  avatar: { width: 32, height: 32, borderRadius: 16, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  avatarImage: { width: 32, height: 32 },
  avatarUser: { backgroundColor: colors.ink },
  avatarNeo: { backgroundColor: colors.accent },
  avatarText: { color: colors.cream, fontWeight: "800", fontSize: 13 },
  bubble: { borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 },
  user: { backgroundColor: colors.bubbleUser },
  agent: { backgroundColor: colors.bubbleAgent, paddingHorizontal: 8, paddingVertical: 2 },
  body: { color: colors.ink, fontSize: 16, lineHeight: 26 },
  imageRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  userImage: { width: 120, height: 120, borderRadius: 12, borderWidth: 1, borderColor: colors.line },
  toolStack: { gap: 8 },
  toolCard: {
    padding: 10,
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.line,
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
    borderRadius: 16,
  },
  toolRun: { backgroundColor: colors.hover, borderColor: colors.line },
  toolErr: { backgroundColor: "#fdecec", borderColor: "#e8b4b4", borderLeftColor: colors.error },
  toolHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  toolMark: { color: "#2b8a4e", fontWeight: "800", fontSize: 13 },
  toolMarkRun: { color: colors.accent },
  toolMarkErr: { color: colors.error },
  toolName: { flex: 1, color: colors.ink, fontWeight: "700", fontSize: 13 },
  toolChevron: { color: colors.muted, fontSize: 12 },
  cmd: { color: colors.muted, fontSize: 12, marginTop: 4 },
  toolPanel: { marginTop: 8, maxHeight: 220, backgroundColor: colors.paper, borderRadius: 12, padding: 10 },
  toolOut: {
    color: colors.ink,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});
