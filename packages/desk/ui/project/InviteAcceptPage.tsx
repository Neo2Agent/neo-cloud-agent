import type { Project } from "@neo-cloud-agent/contracts/project";
import { useEffect, useState } from "react";
import { api, readJson } from "../api";
import { Page } from "../pages";

export function InviteAcceptPage({
  token,
  inviteToken,
  onJoined,
}: {
  token: string;
  inviteToken: string;
  onJoined: (project: Project) => void;
}) {
  const [info, setInfo] = useState<{ projectName: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    void api(token, `/v1/invites/${inviteToken}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("邀请无效或已过期");
        setInfo(await readJson<{ projectName: string; status: string }>(response));
      })
      .catch((item) => setError(item instanceof Error ? item.message : "邀请无效"));
  }, [inviteToken, token]);

  return (
    <Page>
      <header className="dash-head">
        <div className="dash-copy">
          <h1>{info?.projectName || "加入项目"}</h1>
          <p>加入后能看到同一段指令和成员，也可以开自己的对话。</p>
        </div>
      </header>
      <div className="page-body">
        <div className="settings-card">
          <p className="hint">
            {info?.status === "pending" ? "你已经申请过了，等管理员通过。" : "用这个链接加入项目，不会自动看到别人的会话。"}
          </p>
          <button
            type="button"
            className="dash-create"
            disabled={busy || info?.status === "pending"}
            onClick={() => {
              setBusy(true);
              setError("");
              void api(token, `/v1/invites/${inviteToken}`, { method: "POST", body: JSON.stringify({}) })
                .then(async (response) => {
                  const body = await readJson<Project & { error?: string }>(response);
                  if (!response.ok) throw new Error(body.error || "加入失败");
                  const invite = body.invites.find((item) => item.token === inviteToken);
                  if (invite?.status === "pending") {
                    setInfo({ projectName: body.name, status: "pending" });
                    return;
                  }
                  onJoined(body);
                })
                .catch((item) => setError(item instanceof Error ? item.message : "加入失败"))
                .finally(() => setBusy(false));
            }}
          >
            {info?.status === "pending" ? "已申请，等待通过" : busy ? "加入中…" : "加入项目"}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </div>
      </div>
    </Page>
  );
}
