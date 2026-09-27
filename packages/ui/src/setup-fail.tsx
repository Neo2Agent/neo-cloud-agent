import { useState } from "react";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import { formatWhen } from "@neo-cloud-agent/contracts/display";
import { setupDiagToggleLabel, setupFailLogText, setupFailureTitle } from "@neo-cloud-agent/contracts/setup-fail";

type Props = {
  message: TranscriptMessage;
  highlight?: boolean;
};

export function SetupFailBanner({ message, highlight = false }: Props) {
  const [open, setOpen] = useState(false);
  const title = setupFailureTitle(message);
  const logText = setupFailLogText(message);
  const logId = `setup-fail-log-${message.id}`;
  return (
    <div
      id={`msg-${message.id}`}
      className="setup-fail"
      data-highlight={highlight ? "true" : undefined}
    >
      <p className="setup err">
        <span>{title}</span>
        <button
          type="button"
          className="ghost diag-link"
          aria-expanded={open}
          aria-controls={logId}
          onClick={() => setOpen((current) => !current)}
        >
          {setupDiagToggleLabel(open)}
        </button>
        <time className="bubble-time setup-time" dateTime={message.createdAt}>
          {formatWhen(message.createdAt)}
        </time>
      </p>
      {open ? (
        <pre id={logId} className="setup-fail-log">
          {logText}
        </pre>
      ) : null}
    </div>
  );
}
