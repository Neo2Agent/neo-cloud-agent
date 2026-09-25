import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import type { MobileClient } from "../api/client";
import { colors } from "./theme";

export function RunInvite({
  client,
  run,
  userId,
}: {
  client: MobileClient;
  run: Run;
  userId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [invitee, setInvitee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !run.projectId) return;
    void client.getProject(run.projectId).then(setProject).catch(() => setProject(null));
  }, [client, open, run.projectId]);

  if (!run.projectId) return null;

  const others = (project?.members ?? []).filter(
    (item) => item.userId !== userId && !(run.collaborators ?? []).some((row) => row.userId === item.userId),
  );

  return (
    <View>
      <Pressable
        onPress={() => setOpen((cur) => !cur)}
        style={styles.action}
        accessibilityLabel="邀请加入这条对话"
      >
        <Text style={styles.actionText}>邀请</Text>
      </Pressable>
      {open ? (
        <View style={styles.pop} accessibilityLabel="邀请同事">
          <Text style={styles.title}>邀请加入这条对话</Text>
          {others.length === 0 ? (
            <Text style={styles.hint}>没有可邀请的项目成员。对方要先在项目里。</Text>
          ) : (
            others.map((item) => (
              <Pressable
                key={item.userId}
                onPress={() => setInvitee(item.userId)}
                style={[styles.row, invitee === item.userId ? styles.rowOn : null]}
              >
                <Text style={styles.rowText}>{item.email}</Text>
              </Pressable>
            ))
          )}
          {others.length > 0 ? (
            <Pressable
              disabled={!invitee || busy}
              onPress={() => {
                if (!invitee || busy) return;
                setBusy(true);
                setError("");
                void client
                  .inviteCollaborator(run.id, invitee)
                  .then(() => {
                    setInvitee("");
                    setOpen(false);
                  })
                  .catch((caught) => setError(caught instanceof Error ? caught.message : "邀请失败"))
                  .finally(() => setBusy(false));
              }}
              style={styles.send}
            >
              <Text style={styles.sendText}>{busy ? "邀请中…" : "邀请"}</Text>
            </Pressable>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    borderRadius: 999,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  actionText: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  pop: {
    position: "absolute",
    top: 36,
    right: 0,
    zIndex: 8,
    width: 240,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    gap: 8,
  },
  title: { color: colors.ink, fontWeight: "700", fontSize: 13 },
  hint: { color: colors.muted, fontSize: 12 },
  row: { paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8 },
  rowOn: { backgroundColor: colors.hover },
  rowText: { color: colors.ink, fontSize: 13 },
  send: { alignSelf: "flex-start", backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  sendText: { color: colors.cream, fontSize: 12, fontWeight: "700" },
  error: { color: colors.error, fontSize: 12 },
});
