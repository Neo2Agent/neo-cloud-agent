import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { useState } from "react";
import { Page } from "../pages";
import { ActivityTab } from "./ActivityTab";
import { AssetsTab } from "./AssetsTab";
import { BoardTab } from "./BoardTab";
import { ChatsTab } from "./ChatsTab";
import { OverviewTab } from "./OverviewTab";
import { SettingsTab } from "./SettingsTab";
import { WORKBENCH_TABS, type WorkbenchTab } from "./types";

export function ProjectWorkbench({
  project,
  runs,
  token,
  userId,
  onBack,
  onStartChat,
  onOpenRun,
  onProjectChange,
}: {
  project: Project;
  runs: Run[];
  token: string;
  userId: string;
  onBack: () => void;
  onStartChat: (todo?: { id: string; title: string }) => void;
  onOpenRun: (id: string) => void;
  onProjectChange: (project: Project) => void;
}) {
  const [tab, setTab] = useState<WorkbenchTab>("overview");
  const mine = runs.filter((item) => item.projectId === project.id);

  return (
    <Page>
      <header className="dash-head">
        <div className="dash-copy">
          <button type="button" className="ghost" onClick={onBack}>
            全部项目
          </button>
          <h1>{project.name}</h1>
          <p>
            {project.members.length} 位成员 · {mine.length} 条你的对话
          </p>
        </div>
      </header>
      <nav className="workbench-tabs" aria-label="项目分区">
        {WORKBENCH_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "on" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.soon ? <em>即将推出</em> : null}
          </button>
        ))}
      </nav>
      <div className="page-body">
        {tab === "overview" ? <OverviewTab project={project} onStartChat={() => onStartChat()} /> : null}
        {tab === "chats" ? <ChatsTab runs={mine} onOpenRun={onOpenRun} onStartChat={() => onStartChat()} /> : null}
        {tab === "board" ? (
          <BoardTab token={token} project={project} onStartChat={(id, title) => onStartChat({ id, title })} />
        ) : null}
        {tab === "assets" ? <AssetsTab /> : null}
        {tab === "activity" ? <ActivityTab project={project} /> : null}
        {tab === "settings" ? (
          <SettingsTab token={token} project={project} userId={userId} onChanged={onProjectChange} />
        ) : null}
      </div>
    </Page>
  );
}
