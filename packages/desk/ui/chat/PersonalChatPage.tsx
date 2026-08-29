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
  userAvatar,
  neoAvatar,
  feedRef,
  onCopy,
  headerMeta,
  headerEnd,
  thinkingHint,
}: {
  title: string;
  current: Run;
  visible: TranscriptMessage[];
  activity: string | null;
  busy?: boolean;
  user: string;
  userAvatar?: string | null;
  neoAvatar?: string | null;
  feedRef: Ref<HTMLDivElement>;
  onCopy: (text: string) => void;
  headerMeta?: ReactNode;
  headerEnd?: ReactNode;
  thinkingHint?: string;
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
        userAvatar={userAvatar}
        neoAvatar={neoAvatar}
        feedRef={feedRef}
        onCopy={onCopy}
        thinkingHint={thinkingHint}
      />
    </div>
  );
}
