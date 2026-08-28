import type { Run } from "@neo-cloud-agent/contracts/run";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import type { Ref } from "react";
import { PersonalChatHeader } from "./PersonalChatHeader";
import { ChatTranscript } from "./transcript";

export function PersonalChatPage({
  title,
  current,
  visible,
  activity,
  busy,
  user,
  feedRef,
  onCopy,
}: {
  title: string;
  current: Run;
  visible: TranscriptMessage[];
  activity: string | null;
  busy?: boolean;
  user: string;
  feedRef: Ref<HTMLDivElement>;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="personal-chat-shell">
      <PersonalChatHeader title={title} />
      <ChatTranscript current={current} visible={visible} activity={activity} busy={busy} user={user} feedRef={feedRef} onCopy={onCopy} />
    </div>
  );
}
