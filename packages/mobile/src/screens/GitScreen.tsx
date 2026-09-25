import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  parseHunkLines,
  splitPatchByFile,
  type PullRequestFeedback,
  type RunCommitsResponse,
  type RunDiffResponse,
} from "@neo-cloud-agent/contracts/git";
import type { MobileClient } from "../api/client";
import { colors } from "./theme";

type Tab = "diff" | "review" | "commits";

export function GitScreen({
  client,
  runId,
  busy = false,
  onBack,
}: {
  client: MobileClient;
  runId: string;
  busy?: boolean;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<Tab>("diff");
  const [diff, setDiff] = useState<RunDiffResponse | null>(null);
  const [commits, setCommits] = useState<RunCommitsResponse | null>(null);
  const [feedback, setFeedback] = useState<PullRequestFeedback | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void Promise.all([client.runDiff(runId), client.runCommits(runId)])
        .then(async ([nextDiff, nextCommits]) => {
          if (cancelled) return;
          setDiff(nextDiff);
          setCommits(nextCommits);
          setSelected((cur) => cur ?? nextDiff.files[0]?.path ?? null);
          const number = nextDiff.pullRequests.find((item) => item.number)?.number;
          if (!number) {
            setFeedback(null);
            return;
          }
          try {
            setFeedback(await client.runPrFeedback(runId, number));
          } catch {
            if (!cancelled) setFeedback(null);
          }
        })
        .catch((caught) => {
          if (!cancelled) setError(caught instanceof Error ? caught.message : "读不出 Git");
        });
    };
    load();
    if (!busy) return () => {
      cancelled = true;
    };
    const timer = setInterval(load, 8_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [busy, client, runId]);

  const patches = useMemo(() => new Map(splitPatchByFile(diff?.patch ?? "").map((item) => [item.path, item.patch])), [diff?.patch]);
  const hunks = selected ? parseHunkLines(patches.get(selected) ?? "") : [];
  const prs = diff?.pullRequests ?? [];
  const source = diff?.source === "desk" ? "本机快照（只读）" : "云端工作区（只读）";

  return (
    <View style={styles.page}>
      <View style={styles.topbar}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>←</Text>
        </Pressable>
        <Text style={styles.title}>Git</Text>
        <Text style={styles.muted}>{source}</Text>
      </View>
      <View style={styles.tabs}>
        <Pressable onPress={() => setTab("diff")} style={[styles.tab, tab === "diff" ? styles.tabOn : null]}>
          <Text style={styles.tabText}>改动</Text>
        </Pressable>
        <Pressable onPress={() => setTab("review")} style={[styles.tab, tab === "review" ? styles.tabOn : null]}>
          <Text style={styles.tabText}>审查</Text>
        </Pressable>
        <Pressable onPress={() => setTab("commits")} style={[styles.tab, tab === "commits" ? styles.tabOn : null]}>
          <Text style={styles.tabText}>提交</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {prs.length === 0 ? <Text style={styles.muted}>还没有 PR</Text> : null}
        {prs.map((pr) => (
          <View key={`${pr.number ?? ""}:${pr.url}`} style={styles.card}>
            <Text style={styles.pr}>{pr.title || "Pull request"}</Text>
            <Text style={styles.muted}>
              {pr.state || "open"}
              {pr.number ? ` · #${pr.number}` : ""}
              {pr.draft ? " · 草稿" : ""}
            </Text>
          </View>
        ))}
        {tab === "review" ? (
          <>
            <Text style={styles.section}>审查（只读）</Text>
            {(feedback?.checks ?? []).length === 0 ? <Text style={styles.muted}>还没有 CI</Text> : null}
            {(feedback?.checks ?? []).map((check) => (
              <View key={`${check.name}:${check.url}`} style={styles.card}>
                <Text style={styles.file}>{check.name}</Text>
                <Text style={styles.muted}>
                  {check.status}
                  {check.conclusion ? ` · ${check.conclusion}` : ""}
                </Text>
              </View>
            ))}
            {(feedback?.reviews ?? []).map((review) => (
              <View key={review.id} style={styles.card}>
                <Text style={styles.pr}>{review.author || "审阅者"}</Text>
                <Text style={styles.muted}>{review.state}</Text>
                {review.body ? <Text style={styles.file}>{review.body}</Text> : null}
              </View>
            ))}
          </>
        ) : tab === "diff" ? (
          <>
            <Text style={styles.section}>文件</Text>
            {(diff?.files ?? []).map((file) => (
              <Pressable
                key={file.path}
                onPress={() => setSelected(file.path)}
                style={[styles.fileRow, selected === file.path ? styles.fileOn : null]}
              >
                <Text style={styles.file}>{file.path}</Text>
                <Text style={styles.stat}>
                  +{file.added} -{file.removed}
                </Text>
              </Pressable>
            ))}
            {selected ? <Text style={styles.section}>{selected}</Text> : null}
            {hunks.map((line, index) => (
              <Text
                key={`${selected}-${index}`}
                style={[
                  styles.hunk,
                  line.type === "add" ? styles.add : line.type === "del" ? styles.del : null,
                ]}
                selectable
              >
                {line.text}
              </Text>
            ))}
          </>
        ) : (
          <>
            <Text style={styles.section}>提交</Text>
            {(commits?.commits ?? []).map((commit) => (
              <View key={commit.sha} style={styles.card}>
                <Text style={styles.file}>{commit.message.split("\n")[0]}</Text>
                <Text style={styles.muted}>{commit.sha.slice(0, 7)}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  back: { fontSize: 20, color: colors.ink, width: 28 },
  title: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.ink },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  tab: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 5 },
  tabOn: { backgroundColor: colors.paper },
  tabText: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  body: { padding: 16, gap: 8 },
  error: { color: colors.error },
  muted: { color: colors.muted, fontSize: 12 },
  card: { padding: 12, borderRadius: 12, backgroundColor: colors.paper, gap: 4 },
  pr: { color: colors.ink, fontWeight: "600" },
  section: { marginTop: 8, color: colors.muted, fontSize: 13, fontWeight: "600" },
  fileRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, paddingVertical: 6 },
  fileOn: { backgroundColor: colors.hover, borderRadius: 8, paddingHorizontal: 8 },
  file: { flex: 1, color: colors.ink, fontSize: 13 },
  stat: { color: colors.muted, fontSize: 12 },
  hunk: { fontFamily: "Menlo", fontSize: 11, color: colors.ink, lineHeight: 16 },
  add: { color: "#17663a" },
  del: { color: colors.error },
});
