import type { Run } from "@neo-cloud-agent/contracts/run";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import type { ReactNode, Ref } from "react";
import { PersonalChatHeader } from "./PersonalChatHeader";
import { ChatTranscript } from "./transcript";

export function PersonalChatPage({
  title,
  current,
  visible,
  activity,
  busy,
  user,
  userId,
  userAvatar,
  neoAvatar,
  feedRef,
  onCopy,
  headerMeta,
  headerEnd,
  thinkingHint,
  onOpenDiagnostics,
  onOpenArtifact,
}: {
  title: string;
  current: Run;
  visible: TranscriptMessage[];
  activity: string | null;
  busy?: boolean;
  user: string;
  userId?: string;
  userAvatar?: string | null;
  neoAvatar?: string | null;
  feedRef: Ref<HTMLDivElement>;
  onCopy: (text: string) => void;
  headerMeta?: ReactNode;
  headerEnd?: ReactNode;
  thinkingHint?: string;
  onOpenDiagnostics?: () => void;
  onOpenArtifact?: (name: string) => void;
}) {
  return (
    <div className="personal-chat-shell">
      <PersonalChatHeader title={title} meta={headerMeta} end={headerEnd} />
      <ChatTranscript
        current={current}
        visible={visible}
        activity={activity}
        busy={busy}
        user={user}
        userId={userId}
        userAvatar={userAvatar}
        neoAvatar={neoAvatar}
        feedRef={feedRef}
        onCopy={onCopy}
        thinkingHint={thinkingHint}
        onOpenDiagnostics={onOpenDiagnostics}
        onOpenArtifact={onOpenArtifact}
      />
    </div>
  );
}
