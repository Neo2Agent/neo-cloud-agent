import type { FollowUp } from "@neo-cloud-agent/contracts";
import type { Project, ProjectMember } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { useEffect, useMemo, useState } from "react";
import { api, readJson } from "../api";

export function RunChrome({
  token,
  run,
  project,
  userId,
  onAbort,
  onTransferred,
}: {
  token: string;
  run: Run;
  project: Project | null;
  userId: string;
  onAbort: () => void;
  onTransferred: (run: Run) => void;
}) {
  const cloud = run.executionTarget?.loop !== "desk";
  const canInvite = Boolean(run.projectId && cloud);
  const members = project?.members ?? [];
  const others = members.filter((item) => item.userId !== userId && !(run.collaborators ?? []).some((row) => row.userId === item.userId));
  const [invitee, setInvitee] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [note, setNote] = useState("");
  const [handoffTitle, setHandoffTitle] = useState("");
  const [artifactName, setArtifactName] = useState("");
  const [artifacts, setArtifacts] = useState<Array<{ name: string }>>([]);
  const [pickedArtifacts, setPickedArtifacts] = useState<string[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      const [queueRes, artifactRes] = await Promise.all([
        api(token, `/v1/runs/${run.id}/follow-ups`),
        api(token, `/v1/runs/${run.id}/artifacts`),
      ]);
      if (cancelled) return;
      if (queueRes.ok) {
        const body = await readJson<{ followUps?: FollowUp[] }>(queueRes);
        setFollowUps(body.followUps ?? []);
      }
      if (artifactRes.ok) {
        const body = await readJson<{ artifacts?: Array<{ name: string }> }>(artifactRes);
        setArtifacts(body.artifacts ?? []);
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [run.id, token]);

  const queued = useMemo(() => followUps.filter((item) => item.status === "queued"), [followUps]);
  const running = run.status === "RUNNING";

  const invite = async () => {
    if (!invitee || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api(token, `/v1/runs/${run.id}/collaborators`, {
        method: "POST",
        body: JSON.stringify({ userId: invitee }),
      });
      const body = await readJson<Run & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "邀请失败");
      setInvitee("");
      onTransferred(body);
    } catch (item) {
      setError(item instanceof Error ? item.message : "邀请失败");
    } finally {
      setBusy(false);
    }
  };

  const transfer = async () => {
    if (!transferTo || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await api(token, `/v1/runs/${run.id}/transfer`, {
        method: "POST",
        body: JSON.stringify({
          toUserId: transferTo,
          note,
          mode: cloud ? "reassign" : "fork",
        }),
      });
      const body = await readJson<Run & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "转交失败");
      setTransferTo("");
      setNote("");
      onTransferred(body);
    } catch (item) {
      setError(item instanceof Error ? item.message : "转交失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="run-chrome">
      <div className="run-chrome-tags">
        {project ? <span className="role-badge">{project.name}</span> : null}
        <span className="role-badge">{cloud ? "Cloud" : "This Computer"}</span>
        <span className="hint">{hostLabel(run, members)}</span>
      </div>
      {queued.length > 0 || running ? (
        <div className="queue-bar">
          <span>{running ? "正在处理当前回合" : "空闲"}</span>
          {queued[0] ? <span>下一条 {queued[0].actorEmail || "跟进"}</span> : null}
          {running ? (
            <button type="button" className="ghost" onClick={onAbort}>
              停止当前回合
            </button>
          ) : null}
        </div>
      ) : null}
      {run.projectId ? (
        <div className="run-chrome-actions">
          <input
            value={handoffTitle}
            onChange={(event) => setHandoffTitle(event.target.value)}
            placeholder="流转为待办的标题"
          />
          <input
            value={artifactName}
            onChange={(event) => setArtifactName(event.target.value)}
            placeholder="产物文件名，保存到项目"
          />
          <button
            type="button"
            className="ghost"
            disabled={!artifactName.trim() || busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void api(token, `/v1/runs/${run.id}/artifacts/${encodeURIComponent(artifactName.trim())}/save-to-project`, {
                method: "POST",
                body: JSON.stringify({}),
              })
                .then(async (response) => {
                  const body = await readJson<{ error?: string }>(response);
                  if (!response.ok) throw new Error(body.error || "保存失败");
                  setArtifactName("");
                })
                .catch((item) => setError(item instanceof Error ? item.message : "保存失败"))
                .finally(() => setBusy(false));
            }}
          >
            保存到项目
          </button>
          {artifacts.length > 0 ? (
            <fieldset className="handoff-artifacts">
              <legend>一并保存到项目</legend>
              {artifacts.map((item) => (
                <label key={item.name}>
                  <input
                    type="checkbox"
                    checked={pickedArtifacts.includes(item.name)}
                    onChange={(event) => {
                      setPickedArtifacts((cur) =>
                        event.target.checked ? [...cur, item.name] : cur.filter((name) => name !== item.name),
                      );
                    }}
                  />
                  {item.name}
                </label>
              ))}
            </fieldset>
          ) : null}
          <button
            type="button"
            className="ghost"
            disabled={!handoffTitle.trim() || busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void api(token, `/v1/projects/${run.projectId}/todos`, {
                method: "POST",
                body: JSON.stringify({
                  title: handoffTitle.trim(),
                  runId: run.id,
                  source: "handoff",
                  artifactNames: pickedArtifacts,
                }),
              })
                .then(async (response) => {
                  const body = await readJson<{ error?: string; failedAttachments?: string[] }>(response);
                  if (!response.ok) throw new Error(body.error || "流转失败");
                  setHandoffTitle("");
                  setPickedArtifacts([]);
                  if (body.failedAttachments?.length) {
                    setError(`有 ${body.failedAttachments.length} 个附件没保存上，待办还在`);
                  }
                })
                .catch((item) => setError(item instanceof Error ? item.message : "流转失败"))
                .finally(() => setBusy(false));
            }}
          >
            流转为待办
          </button>
        </div>
      ) : null}
      {canInvite ? (
        <div className="run-chrome-actions">
          <label>
            <span>邀请加入这条对话</span>
            <select value={invitee} onChange={(event) => setInvitee(event.target.value)}>
              <option value="">选择项目成员</option>
              {others.map((item) => (
                <option key={item.userId} value={item.userId}>
                  {item.email}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="ghost" disabled={!invitee || busy} onClick={() => void invite()}>
            邀请
          </button>
          <label>
            <span>{cloud ? "把房主交给" : "给对方开新对话"}</span>
            <select value={transferTo} onChange={(event) => setTransferTo(event.target.value)}>
              <option value="">选择成员</option>
              {members
                .filter((item) => item.userId !== userId)
                .map((item) => (
                  <option key={item.userId} value={item.userId}>
                    {item.email}
                  </option>
                ))}
            </select>
          </label>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="交接备注（可选）" />
          <button type="button" className="ghost" disabled={!transferTo || busy} onClick={() => void transfer()}>
            {cloud ? "转交房主" : "开新对话"}
          </button>
        </div>
      ) : run.projectId ? (
        <p className="hint">本机对话不能拉人进会话。要一起改文件，先开在 Cloud。</p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

function hostLabel(run: Run, members: ProjectMember[]): string {
  const host = run.collaborators?.find((item) => item.role === "host");
  const email = host?.email || members.find((item) => item.userId === (run.assigneeUserId || run.userId))?.email;
  return email ? `房主 ${email}` : "房主";
}
