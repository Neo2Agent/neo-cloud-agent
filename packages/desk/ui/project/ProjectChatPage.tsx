import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import type { ReactNode, Ref } from "react";
import { ChatTranscript } from "../chat/transcript";
import { ChatHeader } from "./ChatHeader";

export function ProjectChatPage({
  title,
  project,
  current,
  token,
  userId,
  user,
  visible,
  activity,
  busy,
  feedRef,
  onOpenProject,
  onRefresh,
  onRunChange,
  onCopy,
  headerMeta,
  headerEnd,
  thinkingHint,
  onOpenDiagnostics,
  onOpenArtifact,
}: {
  title: string;
  project: Project | null;
  current: Run;
  token: string;
  userId: string;
  user: string;
  visible: TranscriptMessage[];
  activity: string | null;
  busy?: boolean;
  feedRef: Ref<HTMLDivElement>;
  onOpenProject: () => void;
  onRefresh: () => void;
  onRunChange: (run: Run) => void;
  onCopy: (text: string) => void;
  headerMeta?: ReactNode;
  headerEnd?: ReactNode;
  thinkingHint?: string;
  onOpenDiagnostics?: () => void;
  onOpenArtifact?: (name: string) => void;
}) {
  return (
    <div className="project-chat-shell">
      <ChatHeader
        title={title}
        project={project}
        run={current}
        token={token}
        userId={userId}
        onOpenProject={onOpenProject}
        onRefresh={onRefresh}
        onRunChange={onRunChange}
        meta={headerMeta}
        end={headerEnd}
      />
      <ChatTranscript
        current={current}
        visible={visible}
        activity={activity}
        busy={busy}
        user={user}
        userId={userId}
        feedRef={feedRef}
        onCopy={onCopy}
        thinkingHint={thinkingHint}
        onOpenDiagnostics={onOpenDiagnostics}
        onOpenArtifact={onOpenArtifact}
      />
    </div>
  );
}
