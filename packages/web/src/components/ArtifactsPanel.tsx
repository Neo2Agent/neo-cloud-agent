import { useState } from "react";
import type { ProjectAsset } from "@neo-cloud-agent/contracts/project-asset";
import { api, readJson } from "../api";
import { previewKind } from "../artifact.js";

type Artifact = { name: string; url?: string; contentType?: string };

type Props = {
  open: boolean;
  loading: boolean;
  error: string;
  artifacts: Artifact[];
  projectId?: string | null;
  token?: string;
  runId?: string | null;
  onOpen?: (item: Artifact) => void;
  onSaved?: (asset: ProjectAsset) => void;
};

export function ArtifactsPanel({
  open,
  loading,
  error,
  artifacts,
  projectId,
  token,
  runId,
  onOpen,
  onSaved,
}: Props) {
  const [preview, setPreview] = useState<Artifact | null>(null);
  const [busyName, setBusyName] = useState("");
  const [saveError, setSaveError] = useState("");
  if (!open) return null;
  const kind = preview ? previewKind(preview) : null;
  const canSave = Boolean(projectId && token && runId);

  const save = async (item: Artifact) => {
    if (!token || !runId) return;
    setBusyName(item.name);
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
      setBusyName("");
    }
  };

  return (
    <section className="artifacts-panel" id="run-artifacts">
      <strong>产物</strong>
      {loading ? <p className="hint">正在读取…</p> : null}
      {error ? <p className="setup err">{error}</p> : null}
      {saveError ? <p className="setup err">{saveError}</p> : null}
      {!canSave ? <p className="hint">只有项目对话才能保存到项目。</p> : null}
      {!loading && !error && artifacts.length === 0 ? <p className="hint">还没有产物。</p> : null}
      <ul className="artifact-list">
        {artifacts.map((item) => (
          <li key={item.name}>
            <a
              href={item.url || "#"}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (previewKind(item) && item.url) {
                  event.preventDefault();
                  setPreview(item);
                  return;
                }
                if (onOpen) {
                  event.preventDefault();
                  onOpen(item);
                }
              }}
            >
              {item.name}
            </a>
            {item.contentType ? <small>{item.contentType}</small> : null}
            {canSave ? (
              <button type="button" className="ghost" disabled={busyName === item.name} onClick={() => void save(item)}>
                {busyName === item.name ? "保存中…" : "保存到项目"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {preview && kind && preview.url ? (
        <div className="artifact-preview">
          <div className="artifact-preview-bar">
            <strong>{preview.name}</strong>
            <button type="button" className="ghost" onClick={() => setPreview(null)}>
              关闭预览
            </button>
          </div>
          {kind === "image" ? (
            <img src={preview.url} alt={preview.name} />
          ) : (
            <iframe title={preview.name} src={preview.url} sandbox="allow-scripts" />
          )}
        </div>
      ) : null}
    </section>
  );
}
