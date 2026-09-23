import { useEffect, useState } from "react";
import type { ProjectAsset } from "@neo-cloud-agent/contracts/project-asset";
import { ARTIFACT_TEXT_PREVIEW_BYTES, decodeUtf8Preview } from "../artifact-text.js";
import { api, readJson } from "../api";
import { artifactKind, artifactKindLabel, previewKind } from "../artifact.js";
import { IconClose, IconFileKind } from "../icons.js";
import { MarkdownBody } from "@neo-cloud-agent/ui";

type Artifact = { name: string; url?: string; contentType?: string };

type Props = {
  loading: boolean;
  error: string;
  artifacts: Artifact[];
  projectId?: string | null;
  token?: string;
  runId?: string | null;
  onOpen?: (item: Artifact) => void;
  onSaved?: (asset: ProjectAsset) => void;
  focusName?: string | null;
};

export function ArtifactsPanel({
  loading,
  error,
  artifacts,
  projectId,
  token,
  runId,
  onOpen,
  onSaved,
  focusName,
}: Props) {
  const [preview, setPreview] = useState<Artifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [textPreview, setTextPreview] = useState("");
  const [textError, setTextError] = useState("");
  const [textLoading, setTextLoading] = useState(false);
  useEffect(() => {
    if (!focusName) return;
    const match = artifacts.find((item) => item.name === focusName);
    if (match) setPreview(match);
  }, [artifacts, focusName]);

  useEffect(() => {
    const kind = preview ? previewKind(preview) : null;
    const textual = kind === "markdown" || kind === "text" || kind === "json";
    if (!preview?.url || !textual || !token) {
      setTextPreview("");
      setTextError("");
      setTextLoading(false);
      return;
    }
    let cancelled = false;
    setTextLoading(true);
    setTextError("");
    setTextPreview("");
    void (async () => {
      const response = await api(token, preview.url!);
      if (!response.ok) throw new Error("打不开这个文件");
      const bytes = new Uint8Array(await response.arrayBuffer());
      const slice = bytes.subarray(0, ARTIFACT_TEXT_PREVIEW_BYTES);
      let text = "";
      try {
        text = decodeUtf8Preview(slice);
      } catch {
        throw new Error("utf8");
      }
      if (cancelled) return;
      setTextPreview(bytes.length > slice.length ? `${text}\n\n…已截断` : text);
    })()
      .catch((error: unknown) => {
        if (cancelled) return;
        setTextError(error instanceof Error && error.message === "utf8" ? "这个文件不是 UTF-8，无法预览。" : "打不开这个文件");
      })
      .finally(() => {
        if (!cancelled) setTextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preview, token]);

  const kind = preview ? previewKind(preview) : null;
  const textual = kind === "markdown" || kind === "text" || kind === "json";
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
    <section
      className={`artifacts-panel is-split${preview ? " is-previewing" : ""}`}
      id="run-artifacts"
      title={canSave ? undefined : "只有项目对话才能保存到项目。"}
    >
      <header className="workspace-files-head">
        {preview ? (
          <>
            <span className="workspace-files-title">
              <IconFileKind kind={artifactKind(preview)} size={16} />
              <strong>{preview.name}</strong>
            </span>
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
          </>
        ) : null}
      </header>
      <ul className="artifact-list">
        {loading ? <li className="hint">正在读取…</li> : null}
        {error ? <li className="setup err">{error}</li> : null}
        {saveError ? <li className="setup err">{saveError}</li> : null}
        {!loading && !error && artifacts.length === 0 ? <li className="hint">还没有产物。</li> : null}
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
          {kind === "image" && preview.url ? (
            <div className="artifact-preview-frame">
              <img src={preview.url} alt={preview.name} />
            </div>
          ) : kind === "html" && preview.url ? (
            <iframe className="artifact-preview-frame" title={preview.name} src={preview.url} sandbox="allow-scripts" />
          ) : textual ? (
            <div className="artifact-preview-frame artifact-text">
              {textLoading ? <p className="hint">正在读取…</p> : null}
              {textError ? <p className="setup err">{textError}</p> : null}
              {kind === "markdown" && textPreview ? <MarkdownBody text={textPreview} /> : null}
              {kind !== "markdown" && textPreview ? <pre>{textPreview}</pre> : null}
            </div>
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
