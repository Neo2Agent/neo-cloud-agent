import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { isDeskBoundRun, isRemoteControlRun } from "../desk";
import { Select } from "@neo-cloud-agent/ui";
import { useRef, useState, type ReactNode } from "react";
import { api, readJson } from "../api";
import { useDismissOnOutside } from "../dismiss";
import { IconPeople, IconSync } from "../icons";
import { IslandButton } from "../island";

export function ChatHeader({
  title,
  project,
  run,
  token,
  userId,
  onOpenProject,
  onRefresh,
  onRunChange,
  meta,
  end,
}: {
  title: string;
  project: Project | null;
  run: Run;
  token: string;
  userId: string;
  onOpenProject: () => void;
  onRefresh: () => void;
  onRunChange: (run: Run) => void;
  meta?: ReactNode;
  end?: ReactNode;
}) {
  const canInvite = !isDeskBoundRun(run) || isRemoteControlRun(run);
  const members = project?.members ?? [];
  const others = members.filter(
    (item) => item.userId !== userId && !(run.collaborators ?? []).some((row) => row.userId === item.userId),
  );
  const inviteRef = useRef<HTMLDivElement>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  useDismissOnOutside(inviteOpen, () => setInviteOpen(false), inviteRef, ".neo-select-content");
  const [invitee, setInvitee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const invite = async () => {
    if (!invitee || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api(token, `/v1/runs/${run.id}/collaborators`, {
        method: "POST",
        body: JSON.stringify({ userId: invitee }),
      });
      const body = await readJson<Run & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "邀请失败");
      setInvitee("");
      setInviteOpen(false);
      onRunChange(body);
    } catch (item) {
      setError(item instanceof Error ? item.message : "邀请失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="chat-head">
      <div className="chat-head-lead">
        <nav className="chat-crumb" aria-label="项目对话位置">
          <button type="button" className="crumb-link" onClick={onOpenProject}>
            项目
          </button>
          <span aria-hidden="true">/</span>
          <button type="button" className="crumb-link" onClick={onOpenProject}>
            {project?.name ?? "…"}
          </button>
          <span aria-hidden="true">/</span>
          <strong>{title}</strong>
        </nav>
      </div>
      <div className="chat-head-end">
        {meta}
        <div className="chat-head-actions">
          <button type="button" className="icon-btn" aria-label="刷新" onClick={onRefresh}>
            <IconSync />
          </button>
          {canInvite ? (
            <div className="chat-head-pop" ref={inviteRef}>
              <button
                type="button"
                className={`icon-btn${inviteOpen ? " on" : ""}`}
                aria-label="邀请加入这条对话"
                onClick={() => setInviteOpen((cur) => !cur)}
              >
                <IconPeople />
              </button>
              {inviteOpen ? (
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
                      <IslandButton type="default" disabled={!invitee || busy} onClick={() => void invite()}>
                        邀请
                      </IslandButton>
                    </>
                  )}
                  {error ? <p className="error">{error}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {end}
      </div>
    </header>
  );
}
