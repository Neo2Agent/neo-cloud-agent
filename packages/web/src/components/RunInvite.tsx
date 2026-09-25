import { Select } from "@neo-cloud-agent/ui";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { useState } from "react";
import { api, readJson } from "../api";
import { IconExperts } from "../icons";

/** Invite a project member onto this cloud run (Desk already had this; P15). */
export function RunInvite({
  token,
  run,
  userId,
}: {
  token: string;
  run: Run;
  userId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [invitee, setInvitee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!run.projectId) return null;

  const load = () => {
    void api(token, `/v1/projects/${run.projectId}`)
      .then((res) => readJson<Project>(res))
      .then(setProject)
      .catch(() => undefined);
  };

  const others = (project?.members ?? []).filter(
    (item) => item.userId !== userId && !(run.collaborators ?? []).some((row) => row.userId === item.userId),
  );

  const invite = async () => {
    if (!invitee || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api(token, `/v1/runs/${run.id}/collaborators`, {
        method: "POST",
        body: JSON.stringify({ userId: invitee }),
      });
      const body = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "邀请失败");
      setInvitee("");
      setOpen(false);
    } catch (item) {
      setError(item instanceof Error ? item.message : "邀请失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat-head-pop">
      <button
        type="button"
        className={`icon-btn${open ? " on" : ""}`}
        aria-label="邀请加入这条对话"
        title="邀请加入这条对话"
        onClick={() => {
          setOpen((cur) => !cur);
          if (!open) load();
        }}
      >
        <IconExperts size={16} />
      </button>
      {open ? (
        <div className="chat-pop" role="dialog" aria-label="邀请同事">
          <p className="palette-label">邀请加入这条对话</p>
          {others.length === 0 ? (
            <p className="hint">没有可邀请的项目成员。对方要先在项目里。</p>
          ) : (
            <>
              <Select
                value={invitee}
                onValueChange={setInvitee}
                placeholder="选择项目成员"
                options={[
                  { value: "", label: "选择项目成员" },
                  ...others.map((item) => ({ value: item.userId, label: item.email })),
                ]}
              />
              <button type="button" className="ghost" disabled={!invitee || busy} onClick={() => void invite()}>
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
