import type { Run } from "@neo-cloud-agent/contracts/run";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import type { Ref } from "react";
import { PersonalChatHeader } from "./PersonalChatHeader";
import { PersonalRunBar } from "./PersonalRunBar";
import { ChatTranscript } from "./transcript";

export function PersonalChatPage({
  title,
  current,
  visible,
  activity,
  user,
  feedRef,
  onSearch,
  onRefresh,
  onCopy,
  onAbort,
}: {
  title: string;
  current: Run;
  visible: TranscriptMessage[];
  activity: string | null;
  user: string;
  feedRef: Ref<HTMLDivElement>;
  onSearch: () => void;
  onRefresh: () => void;
  onCopy: (text: string) => void;
  onAbort: () => void;
}) {
  return (
    <div className="personal-chat-shell">
      <PersonalChatHeader title={title} onSearch={onSearch} onRefresh={onRefresh} />
      <PersonalRunBar running={current.status === "RUNNING"} onAbort={onAbort} />
      <ChatTranscript current={current} visible={visible} activity={activity} user={user} feedRef={feedRef} onCopy={onCopy} />
    </div>
  );
}
