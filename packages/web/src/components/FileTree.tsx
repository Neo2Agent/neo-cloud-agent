import { useEffect, useState } from "react";
import { api, readJson } from "../api";

export type FsEntry = { name: string; path: string; type: "file" | "dir"; size?: number };
export type FsListing = {
  path: string;
  type: "file" | "dir";
  entries?: FsEntry[];
  content?: string;
  truncated?: boolean;
};

type Props = {
  token: string;
  runId: string | null;
  open: boolean;
};

export function FileTree({ token, runId, open }: Props) {
  const [path, setPath] = useState("");
  const [listing, setListing] = useState<FsListing | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !runId) {
      setListing(null);
      setPath("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await api(token, `/v1/runs/${runId}/fs?path=${encodeURIComponent(path)}&content=${path ? "1" : "0"}`);
        const body = await readJson<FsListing & { error?: string }>(response);
        if (cancelled) return;
        if (!response.ok) throw new Error(body.error || "读取工作区失败");
        setListing(body);
        setError("");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "读取工作区失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, path, runId, token]);

  if (!open) return null;
  if (!runId) return <p className="hint">发送任务后可以浏览工作区文件。</p>;

  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

  return (
    <section className="file-tree" id="file-tree">
      <div className="file-tree-bar">
        <strong>工作区</strong>
        <span>{listing?.path || "."}</span>
        {path ? (
          <button type="button" className="ghost" onClick={() => setPath(parent)}>
            上级
          </button>
        ) : null}
      </div>
      {error ? <p className="setup err">{error}</p> : null}
      {listing?.type === "dir" ? (
        <ul>
          {(listing.entries ?? []).map((entry) => (
            <li key={entry.path}>
              <button type="button" onClick={() => setPath(entry.path)}>
                {entry.type === "dir" ? "📁" : "📄"} {entry.name}
              </button>
            </li>
          ))}
        </ul>
      ) : listing?.type === "file" ? (
        <pre className="file-view">
          {listing.content}
          {listing.truncated ? "\n…（已截断）" : ""}
        </pre>
      ) : null}
    </section>
  );
}
