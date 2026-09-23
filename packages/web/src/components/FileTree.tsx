import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api, readJson } from "../api";
import { artifactKind, type ArtifactKind } from "../artifact";
import { IconFileKind } from "../icons";

export type FsEntry = { name: string; path: string; type: "file" | "dir"; size?: number };
export type FsListing = {
  path: string;
  type: "file" | "dir";
  entries?: FsEntry[];
  content?: string;
  truncated?: boolean;
  workspace?: { state?: "present" | "evicted" | "missing"; evictedReason?: string };
};

type Props = {
  token: string;
  runId: string | null;
  onSelect?: (name: string | null) => void;
};

const ROOT = "";

function fileGlyphKind(name: string): ArtifactKind {
  const kind = artifactKind({ name });
  if (kind !== "file") return kind;
  if (/\.(tsx?|jsx?|css|py|go|java|sh|ya?ml|toml)$/i.test(name)) return "html";
  return "file";
}

function sourceParts(line: string): Array<{ kind: "text" | "link" | "code"; text: string }> {
  const parts: Array<{ kind: "text" | "link" | "code"; text: string }> = [];
  const re = /(`[^`\n]+`)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  for (const match of line.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: "text", text: line.slice(last, index) });
    const token = match[0];
    parts.push({ kind: token.startsWith("`") ? "code" : "link", text: token });
    last = index + token.length;
  }
  if (last < line.length) parts.push({ kind: "text", text: line.slice(last) });
  if (parts.length === 0) parts.push({ kind: "text", text: " " });
  return parts;
}

function SourceLine({ line }: { line: string }) {
  const heading = /^#{1,6}\s/.test(line);
  return (
    <code className={heading ? "is-heading" : undefined}>
      {sourceParts(line).map((part, index) =>
        part.kind === "text" ? (
          <span key={index}>{part.text}</span>
        ) : (
          <span key={index} className={part.kind === "code" ? "file-code" : "file-link"}>
            {part.text}
          </span>
        ),
      )}
    </code>
  );
}

function SourceView({ text, truncated }: { text: string; truncated?: boolean }) {
  const lines = text.split("\n");
  return (
    <div className="file-source">
      <ol>
        {lines.map((line, index) => (
          <li key={index}>
            <span className="file-source-gutter">{index + 1}</span>
            <SourceLine line={line} />
          </li>
        ))}
        {truncated ? (
          <li>
            <span className="file-source-gutter" />
            <code className="file-trunc">已截断</code>
          </li>
        ) : null}
      </ol>
    </div>
  );
}

export function FileTree({ token, runId, onSelect }: Props) {
  const [dirs, setDirs] = useState<Record<string, FsEntry[]>>({});
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({ [ROOT]: true });
  const [file, setFile] = useState<{ path: string; content: string; truncated?: boolean } | null>(null);
  const [error, setError] = useState("");
  const [evicted, setEvicted] = useState(false);

  const loadDir = async (dir: string) => {
    if (!runId) return;
    const response = await api(token, `/v1/runs/${runId}/fs?path=${encodeURIComponent(dir)}&content=0`);
    const body = await readJson<FsListing & { error?: string }>(response);
    if (!response.ok) throw new Error(body.error || "读取工作区失败");
    setDirs((prev) => ({ ...prev, [dir]: body.entries ?? [] }));
    setEvicted(body.workspace?.state === "evicted");
    setError("");
  };

  useEffect(() => {
    if (!runId) {
      setDirs({});
      setFile(null);
      onSelect?.(null);
      return;
    }
    let cancelled = false;
    void loadDir(ROOT).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "读取工作区失败");
    });
    return () => {
      cancelled = true;
    };
  }, [runId, token]);

  const toggleDir = (dir: string) => {
    setOpenDirs((prev) => {
      const next = !prev[dir];
      if (next) {
        void loadDir(dir).catch((err) => setError(err instanceof Error ? err.message : "读取工作区失败"));
      }
      return { ...prev, [dir]: next };
    });
  };

  const openFile = (path: string) => {
    if (!runId) return;
    onSelect?.(path.split("/").pop() ?? path);
    void (async () => {
      const response = await api(token, `/v1/runs/${runId}/fs?path=${encodeURIComponent(path)}&content=1`);
      const body = await readJson<FsListing & { error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "读取工作区失败");
      setFile({ path, content: body.content ?? "", truncated: body.truncated });
      setError("");
    })().catch((err) => setError(err instanceof Error ? err.message : "读取工作区失败"));
  };

  const renderDir = (dir: string, depth: number): ReactNode =>
    (dirs[dir] ?? []).map((entry) => (
      <li key={entry.path}>
        <button
          type="button"
          className={file?.path === entry.path ? "is-on" : ""}
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => (entry.type === "dir" ? toggleDir(entry.path) : openFile(entry.path))}
        >
          <span className="file-mark" aria-hidden="true">
            {entry.type === "dir" ? (
              openDirs[entry.path] ? (
                <ChevronDown size={14} strokeWidth={1.75} />
              ) : (
                <ChevronRight size={14} strokeWidth={1.75} />
              )
            ) : null}
          </span>
          {entry.type === "file" ? <IconFileKind kind={fileGlyphKind(entry.name)} size={14} /> : null}
          <span className="file-name">{entry.name}</span>
        </button>
        {entry.type === "dir" && openDirs[entry.path] ? <ul>{renderDir(entry.path, depth + 1)}</ul> : null}
      </li>
    ));

  if (!runId) {
    return (
      <section className="file-tree" id="file-tree">
        <p className="hint">发送任务后可以浏览工作区文件。</p>
      </section>
    );
  }

  return (
    <section className="file-tree file-split" id="file-tree">
      <div className="file-split-body">
        <div className="file-tree-list">
          {error ? <p className="setup err">{error}</p> : null}
          {evicted ? <p className="hint">工作区已回收。发跟进会按仓库重新检出。</p> : null}
          <ul>{renderDir(ROOT, 0)}</ul>
        </div>
        {file ? <SourceView text={file.content} truncated={file.truncated} /> : <div className="file-source is-empty" />}
      </div>
    </section>
  );
}
