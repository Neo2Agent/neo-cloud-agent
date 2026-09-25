import { useEffect, useState } from "react";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import type { MobileClient } from "../api/client";

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
    <div className="chat-head-pop">
      <button
        type="button"
        className={`icon-btn${open ? " on" : ""}`}
        aria-label="邀请加入这条对话"
        title="邀请加入这条对话"
        onClick={() => setOpen((cur) => !cur)}
      >
        邀请
      </button>
      {open ? (
        <div className="chat-pop" role="dialog" aria-label="邀请同事">
          <p className="palette-label">邀请加入这条对话</p>
          {others.length === 0 ? (
            <p className="hint">没有可邀请的项目成员。对方要先在项目里。</p>
          ) : (
            <>
              <select value={invitee} onChange={(event) => setInvitee(event.target.value)} aria-label="选择项目成员">
                <option value="">选择项目成员</option>
                {others.map((item) => (
                  <option key={item.userId} value={item.userId}>
                    {item.email}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ghost"
                disabled={!invitee || busy}
                onClick={() => {
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
              >
                邀请
              </button>
            </>
          )}
          {error ? <p className="error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
