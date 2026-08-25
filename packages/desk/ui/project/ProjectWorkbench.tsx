import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, readJson } from "../api";
import { IconArrowUp, IconCloud, IconComputer } from "../icons";
import { ActivityTab } from "./ActivityTab";
import { AssetsTab } from "./AssetsTab";
import { BoardTab } from "./BoardTab";
import { ChatsTab } from "./ChatsTab";
import { ProjectConfigRail } from "./ProjectConfigRail";
import { SettingsTab } from "./SettingsTab";
import { resolveWorkbenchTab, WORKBENCH_TABS, type WorkbenchTab } from "./types";

export function ProjectWorkbench({
  project,
  runs,
  token,
  userId,
  initialTab = "board",
  composing = false,
  targetKind = "cloud",
  onBack,
  onStartChat,
  onCompose,
  onOpenRun,
  onProjectChange,
}: {
  project: Project;
  runs: Run[];
  token: string;
  userId: string;
  initialTab?: WorkbenchTab;
  composing?: boolean;
  targetKind?: "cloud" | "desk" | "remote";
  onBack: () => void;
  onStartChat: (todo?: { id: string; title: string }) => void;
  onCompose: (text: string) => void;
  onOpenRun: (id: string) => void;
  onProjectChange: (project: Project) => void;
}) {
  const [tab, setTab] = useState<WorkbenchTab>(resolveWorkbenchTab(initialTab));
  const [draft, setDraft] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    setTab(resolveWorkbenchTab(initialTab));
  }, [initialTab, project.id]);
  const mine = runs.filter((item) => item.projectId === project.id);

  const invite = async () => {
    if (inviteBusy) return;
    setInviteBusy(true);
    setInviteError("");
    try {
      const response = await api(token, `/v1/projects/${project.id}/invites`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const body = await readJson<{ token?: string; url?: string; error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "创建失败");
      const url = body.url || `${location.origin}/#/invite/${body.token ?? ""}`;
      setInviteUrl(url);
      await navigator.clipboard.writeText(url).catch(() => undefined);
    } catch (item) {
      setInviteError(item instanceof Error ? item.message : "创建失败");
    } finally {
      setInviteBusy(false);
    }
  };

  const submitDraft = () => {
    const text = draft.trim();
    if (!text || composing) return;
    setDraft("");
    onCompose(text);
  };

  const onDraftKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitDraft();
    }
  };

  return (
    <section className="page workbench-page">
      <div className="workbench-shell">
        <div className="workbench-center">
          <header className="workbench-head">
            <div className="workbench-crumb">
              <button type="button" className="crumb-link" onClick={onBack}>
                项目
              </button>
              <span aria-hidden="true">/</span>
              <strong>{project.name}</strong>
            </div>
            <button type="button" className="ghost invite-btn" disabled={inviteBusy} onClick={() => void invite()}>
              {inviteBusy ? "生成中…" : inviteUrl ? "已复制邀请" : "邀请"}
            </button>
          </header>
          {inviteError ? <p className="error workbench-invite-error">{inviteError}</p> : null}

          <nav className="workbench-tabs" aria-label="项目分区">
            {WORKBENCH_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? "on" : ""}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
            {tab === "settings" ? (
              <button type="button" className="on" onClick={() => setTab("settings")}>
                设置
              </button>
            ) : null}
          </nav>

          <div className="workbench-body">
            {tab === "board" || tab === "overview" ? (
              <BoardTab token={token} project={project} onStartChat={(id, title) => onStartChat({ id, title })} />
            ) : null}
            {tab === "chats" ? <ChatsTab runs={mine} onOpenRun={onOpenRun} onStartChat={() => onStartChat()} /> : null}
            {tab === "assets" ? <AssetsTab token={token} project={project} userId={userId} /> : null}
            {tab === "activity" ? <ActivityTab project={project} token={token} userId={userId} /> : null}
            {tab === "settings" ? (
              <SettingsTab token={token} project={project} userId={userId} onChanged={onProjectChange} />
            ) : null}
          </div>

          <footer className="workbench-composer">
            <div className="project-composer">
              <textarea
                ref={taRef}
                value={draft}
                rows={2}
                placeholder="今天要做什么？可以提到项目待办或资产文件名。"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onDraftKey}
              />
              <div className="project-composer-tools">
                <span className="task-kind">
                  {targetKind === "desk" ? <IconComputer size={14} /> : <IconCloud size={14} />}
                  {targetKind === "desk" ? "本机任务" : "云端任务"}
                </span>
                <button
                  type="button"
                  className="send-btn"
                  aria-label="发送"
                  disabled={composing || !draft.trim()}
                  onClick={submitDraft}
                >
                  <IconArrowUp size={16} />
                </button>
              </div>
            </div>
          </footer>
        </div>
        <ProjectConfigRail project={project} userId={userId} onEdit={() => setTab("settings")} />
      </div>
    </section>
  );
}
