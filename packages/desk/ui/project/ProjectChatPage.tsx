import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import type { Ref } from "react";
import { ChatTranscript } from "../chat/transcript";
import { ChatHeader } from "./ChatHeader";
import { RunChrome } from "./run-chrome";

export function ProjectChatPage({
  title,
  project,
  current,
  token,
  userId,
  user,
  toolsOpen,
  visible,
  activity,
  feedRef,
  onOpenProject,
  onSearch,
  onRefresh,
  onToggleTools,
  onRunChange,
  onAbort,
  onTransferred,
  onCopy,
}: {
  title: string;
  project: Project | null;
  current: Run;
  token: string;
  userId: string;
  user: string;
  toolsOpen: boolean;
  visible: TranscriptMessage[];
  activity: string | null;
  feedRef: Ref<HTMLDivElement>;
  onOpenProject: () => void;
  onSearch: () => void;
  onRefresh: () => void;
  onToggleTools: () => void;
  onRunChange: (run: Run) => void;
  onAbort: () => void;
  onTransferred: (run: Run) => void;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="project-chat-shell">
      <ChatHeader
        title={title}
        project={project}
        run={current}
        token={token}
        userId={userId}
        toolsOpen={toolsOpen}
        onOpenProject={onOpenProject}
        onSearch={onSearch}
        onRefresh={onRefresh}
        onToggleTools={onToggleTools}
        onRunChange={onRunChange}
      />
      <RunChrome
        token={token}
        run={current}
        project={project}
        userId={userId}
        toolsOpen={toolsOpen}
        onAbort={onAbort}
        onTransferred={onTransferred}
      />
      <ChatTranscript current={current} visible={visible} activity={activity} user={user} feedRef={feedRef} onCopy={onCopy} />
    </div>
  );
}
