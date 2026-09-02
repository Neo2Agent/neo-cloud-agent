import { artifactKindLabel, previewKind } from "@neo-cloud-agent/contracts/artifact";
import type { ProjectAsset } from "@neo-cloud-agent/contracts/project-asset";
import { useEffect, useState } from "react";
import { api, readJson } from "./api";
import { withApiBase, deskBridge } from "./desk";
import { IslandButton } from "./island";

type Artifact = { name: string; url?: string; contentType?: string };

type Props = {
  token: string;
  runId: string | null;
  projectId?: string | null;
  refreshKey?: number;
  onSaved?: (asset: ProjectAsset) => void;
};

export function ArtifactsPane({ token, runId, projectId, refreshKey = 0, onSaved }: Props) {
  const [items, setItems] = useState<Artifact[]>([]);
  const [preview, setPreview] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const canSave = Boolean(projectId && token && runId);
  const kind = preview ? previewKind(preview) : null;

  useEffect(() => {
    if (!token || !runId) {
      setItems([]);
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void api(token, `/v1/runs/${runId}/artifacts`)
      .then(async (response) => {
        const body = await readJson<{ artifacts?: Artifact[]; error?: string }>(response);
        if (!response.ok) throw new Error(body.error || "读取产物失败");
        if (!cancelled) setItems(body.artifacts ?? []);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "读取产物失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, runId, refreshKey]);

  const save = async (item: Artifact) => {
    if (!token || !runId) return;
    setBusy(true);
    setSaveError("");
    try {
      const res = await api(token, `/v1/runs/${runId}/artifacts/${encodeURIComponent(item.name)}/save-to-project`, {
        method: "POST",
        body: "{}",
      });
      const body = await readJson<ProjectAsset & { error?: string }>(res);
      if (!res.ok) throw new Error(body.error || "保存失败");
      onSaved?.(body);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const open = (item: Artifact) => {
    const href = item.url ? withApiBase(item.url) : "";
    if (!href) return;
    if (deskBridge()?.openPath) {
      void deskBridge()?.openPath?.(href);
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
  };

  if (!runId) {
    return <p className="pane-note">发送任务后可以看产物。</p>;
  }

  return (
    <div className={`artifacts-pane${preview ? " is-previewing" : ""}`}>
      <div className="wb-pane-bar">
        <span className="wb-pane-title">产物</span>
        {!canSave && !preview ? <span className="hint">只有项目对话才能保存到项目。</span> : null}
      </div>
      {loading ? <p className="hint">正在读取…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {saveError ? <p className="error">{saveError}</p> : null}
      {!loading && !error && items.length === 0 ? <p className="hint">还没有产物。</p> : null}
      <ul className="artifact-list">
        {items.map((item) => {
          const selected = preview?.name === item.name;
          return (
            <li key={item.name} className={selected ? "is-on" : undefined}>
              <button type="button" className="artifact-row" aria-pressed={selected} onClick={() => setPreview(selected ? null : item)}>
                <span className="artifact-name">{item.name}</span>
                <small>{artifactKindLabel(item)}</small>
              </button>
            </li>
          );
        })}
      </ul>
      {preview ? (
        <div className="artifact-preview">
          <div className="artifact-preview-bar">
            <strong>{preview.name}</strong>
            <span className="artifact-preview-actions">
              {canSave ? (
                <IslandButton type="primary" disabled={busy} onClick={() => void save(preview)}>
                  {busy ? "保存中…" : "存入项目"}
                </IslandButton>
              ) : null}
              <IslandButton type="text" onClick={() => setPreview(null)}>
                关闭
              </IslandButton>
            </span>
          </div>
          {kind === "image" && preview.url ? (
            <div className="artifact-preview-frame">
              <img src={withApiBase(preview.url)} alt={preview.name} />
            </div>
          ) : kind === "html" && preview.url ? (
            <iframe className="artifact-preview-frame" title={preview.name} src={withApiBase(preview.url)} sandbox="allow-scripts" />
          ) : (
            <div className="artifact-preview-empty">
              <p>{artifactKindLabel(preview)} 文件，无法预览</p>
              {preview.url ? (
                <IslandButton type="default" onClick={() => open(preview)}>
                  打开
                </IslandButton>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
