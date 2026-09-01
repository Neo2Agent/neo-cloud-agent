import { useState } from "react";
import type { ProjectAsset } from "@neo-cloud-agent/contracts/project-asset";
import { api, readJson } from "../api";
import { artifactKind, artifactKindLabel, previewKind } from "../artifact.js";
import { IconClose, IconFileKind } from "../icons.js";

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
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  if (!open) return null;
  const kind = preview ? previewKind(preview) : null;
  const canSave = Boolean(projectId && token && runId);

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

  return (
    <section className={`artifacts-panel${preview ? " is-previewing" : ""}`} id="run-artifacts">
      <div className="artifact-head">
        <strong>产物</strong>
        {!canSave && !preview ? <p className="hint">只有项目对话才能保存到项目。</p> : null}
      </div>
      {loading ? <p className="hint">正在读取…</p> : null}
      {error ? <p className="setup err">{error}</p> : null}
      {saveError ? <p className="setup err">{saveError}</p> : null}
      {!loading && !error && artifacts.length === 0 ? <p className="hint">还没有产物。</p> : null}
      <ul className="artifact-list">
        {artifacts.map((item) => {
          const selected = preview?.name === item.name;
          const thumb = previewKind(item) === "image" && item.url;
          return (
            <li key={item.name} className={selected ? "is-on" : undefined}>
              <button
                type="button"
                className="artifact-row"
                aria-pressed={selected}
                onClick={() => setPreview(selected ? null : item)}
              >
                <span className="artifact-glyph">
                  {thumb ? <img src={item.url} alt="" /> : <IconFileKind kind={artifactKind(item)} size={16} />}
                </span>
                <span className="artifact-copy">
                  <span className="artifact-name">{item.name}</span>
                  <small>{artifactKindLabel(item)}</small>
                </span>
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
                <button
                  type="button"
                  className="quiet-btn primary"
                  disabled={busy}
                  onClick={() => void save(preview)}
                >
                  {busy ? "保存中…" : "存入项目"}
                </button>
              ) : null}
              <button type="button" className="icon-btn" aria-label="关闭预览" onClick={() => setPreview(null)}>
                <IconClose size={16} />
              </button>
            </span>
          </div>
          {kind === "image" && preview.url ? (
            <div className="artifact-preview-frame">
              <img src={preview.url} alt={preview.name} />
            </div>
          ) : kind === "html" && preview.url ? (
            <iframe className="artifact-preview-frame" title={preview.name} src={preview.url} sandbox="allow-scripts" />
          ) : (
            <div className="artifact-preview-empty">
              <IconFileKind kind={artifactKind(preview)} size={28} />
              <p>{artifactKindLabel(preview)} 文件，无法预览</p>
              {preview.url || onOpen ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    if (onOpen) {
                      onOpen(preview);
                      return;
                    }
                    if (preview.url) window.open(preview.url, "_blank", "noopener,noreferrer");
                  }}
                >
                  打开
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
