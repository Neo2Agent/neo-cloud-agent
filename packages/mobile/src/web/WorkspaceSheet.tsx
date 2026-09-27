import { useEffect, useMemo, useState } from "react";
import { createWorkspaceTermApi } from "@neo-cloud-agent/ui/workspace-term";
import { readWorkspaceFs, type WorkspaceFsEntry, type WorkspaceFsListing } from "@neo-cloud-agent/ui/workspace-fs";
import type { MobileClient } from "../api/client";

type Tab = "files" | "term";

const FS_READ_FAILED = "读取工作区失败";
const TERM_OPEN_FAILED = "打不开终端";
const TERM_WRITE_FAILED = "写入失败";

function asErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function parentPath(path: string): string {
  return path.includes("/") ? path.replace(/\/[^/]+$/, "") : "";
}

export function WorkspaceSheet({
  client,
  runId,
  onClose,
}: {
  client: MobileClient;
  runId: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("files");
  const [listing, setListing] = useState<WorkspaceFsListing | null>(null);
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [termText, setTermText] = useState("");
  const [termId, setTermId] = useState("");
  const [draft, setDraft] = useState("");

  const request = (apiPath: string, init?: RequestInit) =>
    fetch(client.absoluteUrl(apiPath), { ...init, headers: { ...client.headers(Boolean(init?.body)), ...init?.headers } });

  const termApi = useMemo(
    () =>
      createWorkspaceTermApi({
        request,
        eventsUrl: (apiPath) => {
          const params = new URLSearchParams();
          if (client.token) params.set("access_token", client.token);
          const query = params.toString() ? `?${params}` : "";
          return client.absoluteUrl(`${apiPath}${query}`);
        },
      }),
    [client],
  );

  useEffect(() => {
    let cancelled = false;
    void readWorkspaceFs(request, runId, path, Boolean(path))
      .then((next) => {
        if (!cancelled) setListing(next);
      })
      .catch((caught) => {
        if (!cancelled) setError(asErrorMessage(caught, FS_READ_FAILED));
      });
    return () => {
      cancelled = true;
    };
  }, [path, runId]);

  useEffect(() => {
    if (tab !== "term") return;
    let unsub = () => undefined;
    void termApi
      .ensureWorkspaceTerms(runId)
      .then((sessions) => {
        const first = sessions[0];
        if (!first) return;
        setTermId(first.id);
        unsub = termApi.subscribeWorkspaceTerm(runId, first.id, client.token, (event) => {
          if (event.type === "data") setTermText((current) => `${current}${event.chunk}`);
        });
      })
      .catch((caught) => setError(asErrorMessage(caught, TERM_OPEN_FAILED)));
    return () => unsub();
  }, [client.token, runId, tab, termApi]);

  const entries: WorkspaceFsEntry[] = listing?.entries ?? [];
  const parent = parentPath(path);

  return (
    <div className="workspace-sheet">
      <header className="workspace-sheet-head">
        <div className="workspace-tabs">
          <button type="button" className={tab === "files" ? "is-on" : ""} onClick={() => setTab("files")}>
            文件
          </button>
          <button type="button" className={tab === "term" ? "is-on" : ""} onClick={() => setTab("term")}>
            终端
          </button>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </header>
      {error ? <p className="page-error">{error}</p> : null}
      {tab === "files" ? (
        <div className="workspace-files-lite">
          {path ? (
            <button type="button" className="nav" onClick={() => setPath(parent)}>
              ← {parent || "/"}
            </button>
          ) : null}
          {listing?.type === "file" ? (
            <pre className="setup-fail-log">{listing.content || "空文件"}</pre>
          ) : (
            <ul className="workspace-list">
              {entries.map((item) => (
                <li key={item.path}>
                  <button type="button" onClick={() => setPath(item.path)}>
                    {item.type === "dir" ? "📁" : "📄"} {item.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="workspace-term-lite">
          <pre className="setup-fail-log">{termText || "终端已连接。输入命令后回车。"}</pre>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!termId || !draft.trim()) return;
              void termApi.writeWorkspaceTerm(runId, termId, `${draft}\n`).catch((caught) => {
                setError(asErrorMessage(caught, TERM_WRITE_FAILED));
              });
              setDraft("");
            }}
          >
            <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="终端输入" />
          </form>
        </div>
      )}
    </div>
  );
}
