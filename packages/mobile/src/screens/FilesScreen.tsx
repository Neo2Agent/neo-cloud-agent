import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { MobileClient } from "../api/client";
import { IslandButton } from "./island";
import { Screen } from "./Screen";
import { colors } from "./theme";

const FS_READ_FAILED = "读取工作区失败";
const TERM_OPEN_FAILED = "打不开终端";
const TERM_WRITE_FAILED = "写入失败";
const TERM_EMPTY = "输入命令后发送。输出在下一轮跟进里也能从诊断看到。";

function asErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function parentPath(path: string): string {
  return path.includes("/") ? path.replace(/\/[^/]+$/, "") : "";
}

export function FilesScreen({
  client,
  runId,
  onBack,
}: {
  client: MobileClient;
  runId: string;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"files" | "term">("files");
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [entries, setEntries] = useState<Array<{ name: string; path: string; type: "file" | "dir" }>>([]);
  const [error, setError] = useState("");
  const [termText, setTermText] = useState("");
  const [termId, setTermId] = useState("");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (tab !== "files") return;
    let cancelled = false;
    void client
      .workspaceFs(runId, path, Boolean(path))
      .then((listing) => {
        if (cancelled) return;
        setEntries(listing.entries ?? []);
        setContent(listing.type === "file" ? listing.content ?? "" : "");
      })
      .catch((caught) => {
        if (!cancelled) setError(asErrorMessage(caught, FS_READ_FAILED));
      });
    return () => {
      cancelled = true;
    };
  }, [client, path, runId, tab]);

  useEffect(() => {
    if (tab !== "term") return;
    let cancelled = false;
    void (async () => {
      const listed = await client.listTerms(runId);
      const first = listed.sessions[0] ?? (await client.openTerm(runId));
      if (cancelled) return;
      setTermId(first.id);
    })().catch((caught) => {
      if (!cancelled) setError(asErrorMessage(caught, TERM_OPEN_FAILED));
    });
    return () => {
      cancelled = true;
    };
  }, [client, runId, tab]);

  const parent = parentPath(path);

  return (
    <Screen>
      <View style={styles.topbar}>
        <Pressable onPress={onBack}><Text style={styles.back}>返回</Text></Pressable>
        <Text style={styles.title}>{tab === "files" ? "文件" : "终端"}</Text>
        <View style={styles.tabs}>
          <Pressable onPress={() => setTab("files")}><Text style={tab === "files" ? styles.tabOn : styles.tab}>文件</Text></Pressable>
          <Pressable onPress={() => setTab("term")}><Text style={tab === "term" ? styles.tabOn : styles.tab}>终端</Text></Pressable>
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {tab === "files" ? (
        <ScrollView contentContainerStyle={styles.body}>
          {path ? (
            <Pressable onPress={() => setPath(parent)}>
              <Text style={styles.link}>← {parent || "/"}</Text>
            </Pressable>
          ) : null}
          {content ? <Text style={styles.log} selectable>{content}</Text> : null}
          {entries.map((item) => (
            <Pressable key={item.path} onPress={() => setPath(item.path)} style={styles.row}>
              <Text style={styles.rowText}>{item.type === "dir" ? "📁" : "📄"} {item.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.body}>
          <ScrollView>
            <Text style={styles.log} selectable>{termText || TERM_EMPTY}</Text>
          </ScrollView>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            style={styles.input}
            placeholder="命令"
            placeholderTextColor={colors.muted}
          />
          <IslandButton
            label="发送"
            primary
            onPress={() => {
              if (!termId || !draft.trim()) return;
              void client.writeTerm(runId, termId, `${draft}\n`)
                .then(() => setTermText((current) => `${current}\n$ ${draft}`))
                .catch((caught) => setError(asErrorMessage(caught, TERM_WRITE_FAILED)));
              setDraft("");
            }}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, gap: 8 },
  back: { color: colors.ink, width: 48 },
  title: { fontSize: 18, fontWeight: "700", color: colors.ink },
  tabs: { flexDirection: "row", gap: 8 },
  tab: { color: colors.muted },
  tabOn: { color: colors.ink, fontWeight: "700" },
  body: { padding: 16, gap: 8 },
  error: { color: colors.error, paddingHorizontal: 16 },
  link: { color: colors.ink, marginBottom: 8 },
  row: { paddingVertical: 8 },
  rowText: { color: colors.ink },
  log: { color: colors.ink, fontSize: 12, backgroundColor: colors.paper, padding: 8, borderRadius: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
});
