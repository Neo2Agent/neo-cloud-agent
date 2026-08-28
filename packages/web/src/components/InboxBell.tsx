import { useEffect, useState } from "react";
import type { InboxItem } from "@neo-cloud-agent/contracts/project-message";
import { api, readJson } from "../api";
import { IconInbox } from "../icons";

type Props = {
  token: string;
  authed: boolean;
  onOpenRun: (id: string) => void;
  onOpenProject: (id: string) => void;
};

export function InboxBell({ token, authed, onOpenRun, onOpenProject }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);

  const refresh = async () => {
    if (!authed || !token) return;
    const res = await api(token, "/v1/inbox");
    if (!res.ok) return;
    const body = await readJson<{ items?: InboxItem[]; unread?: number }>(res);
    setItems(body.items ?? []);
    setUnread(body.unread ?? 0);
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [token, authed]);

  if (!authed) return null;

  return (
    <div className="inbox-bell">
      <button
        type="button"
        className="icon-btn inbox-btn"
        title="收件箱"
        aria-label="收件箱"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void refresh();
        }}
      >
        <IconInbox size={16} />
        {unread > 0 ? <span className="inbox-dot">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="inbox-backdrop"
            aria-label="关闭收件箱"
            onClick={() => setOpen(false)}
          />
          <div className="inbox-pop" role="menu">
          <p className="eyebrow">收件箱</p>
          {items.length === 0 ? (
            <p className="hint">没有通知。</p>
          ) : (
            items.slice(0, 12).map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.read ? "inbox-row" : "inbox-row unread"}
                onClick={() => {
                  void api(token, `/v1/inbox/${item.id}/read`, { method: "POST" }).then(() => refresh());
                  setOpen(false);
                  if (item.runId) onOpenRun(item.runId);
                  else if (item.projectId) onOpenProject(item.projectId);
                }}
              >
                <strong>{item.title}</strong>
              </button>
            ))
          )}
          </div>
        </>
      ) : null}
    </div>
  );
}
