import type { FollowUp } from "@neo-cloud-agent/contracts";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { Run } from "@neo-cloud-agent/contracts/run";
import { useEffect, useMemo, useState } from "react";
import { api, readJson } from "../api";
import { hostHint } from "./helpers";

export function RunChrome({
  token,
  run,
  project,
  userId,
  onAbort,
  onTransferred,
  toolsOpen = false,
  refreshKey = 0,
  onQueuedChange,
}: {
  token: string;
  run: Run;
  project: Project | null;
  userId: string;
  onAbort: () => void;
  onTransferred: (run: Run) => void;
  toolsOpen?: boolean;
  refreshKey?: number;
  onQueuedChange?: (items: FollowUp[]) => void;
}) {
  const cloud = run.executionTarget?.loop !== "desk";
  const members = project?.members ?? [];
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
        const next = body.followUps ?? [];
        setFollowUps(next);
        onQueuedChange?.(next.filter((item) => item.status === "queued"));
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
  }, [onQueuedChange, refreshKey, run.id, token]);

  const queued = useMemo(() => followUps.filter((item) => item.status === "queued"), [followUps]);
  const running = run.status === "RUNNING";

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
      {queued.length > 0 || running ? (
        <div className="queue-bar">
          <div className="queue-bar-head">
            <span>{running ? "正在处理当前回合" : "空闲"}</span>
            {queued.length > 0 ? <span>排队 {queued.length} 条</span> : null}
            {running ? (
              <button type="button" className="ghost" onClick={onAbort}>
                停止当前回合
              </button>
            ) : null}
          </div>
          {queued.length > 0 ? (
            <ul className="queue-list">
              {queued.map((item, index) => (
                <li key={item.id}>
                  <strong>{item.actorEmail || "跟进"}</strong>
                  <span className="queue-text">{item.text}</span>
                  <em>{index === 0 ? "下一条" : "排队中"}</em>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="hint run-host-hint">
          {cloud ? "云端" : "本机"} · {hostHint(run, members)}
        </p>
      )}
      {toolsOpen && run.projectId ? (
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
      {toolsOpen && run.projectId && cloud ? (
        <div className="run-chrome-actions">
          <label>
            <span>把房主交给</span>
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
            转交房主
          </button>
        </div>
      ) : toolsOpen && run.projectId ? (
        <div className="run-chrome-actions">
          <p className="hint">本机对话不能拉人进会话。要一起改文件，先开在 Cloud。</p>
          <label>
            <span>给对方开新对话</span>
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
            开新对话
          </button>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
