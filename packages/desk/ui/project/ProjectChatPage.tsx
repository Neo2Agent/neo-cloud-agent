import type { FollowUp } from "@neo-cloud-agent/contracts";
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
  busy,
  feedRef,
  onOpenProject,
  onSearch,
  onRefresh,
  onToggleTools,
  onRunChange,
  onAbort,
  onTransferred,
  onCopy,
  queueEpoch = 0,
  onQueuedChange,
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
  busy?: boolean;
  feedRef: Ref<HTMLDivElement>;
  onOpenProject: () => void;
  onSearch: () => void;
  onRefresh: () => void;
  onToggleTools: () => void;
  onRunChange: (run: Run) => void;
  onAbort: () => void;
  onTransferred: (run: Run) => void;
  onCopy: (text: string) => void;
  queueEpoch?: number;
  onQueuedChange?: (items: FollowUp[]) => void;
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
        refreshKey={queueEpoch}
        onQueuedChange={onQueuedChange}
        onAbort={onAbort}
        onTransferred={onTransferred}
      />
      <ChatTranscript current={current} visible={visible} activity={activity} busy={busy} user={user} feedRef={feedRef} onCopy={onCopy} />
    </div>
  );
}
