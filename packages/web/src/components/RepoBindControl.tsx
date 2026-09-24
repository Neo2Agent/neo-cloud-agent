import { useEffect, useMemo, useRef } from "react";
import { repoShortLabel } from "../repo";

export type RepoBindMode = "none" | "bind";

export type GithubRepoOption = {
  fullName: string;
  url: string;
};

type Props = {
  mode: RepoBindMode;
  repo: string;
  repos?: GithubRepoOption[];
  reposLoading?: boolean;
  reposConfigured?: boolean;
  recent?: string[];
  locked?: boolean;
  open?: boolean;
  query?: string;
  onQuery?: (value: string) => void;
  onOpen?: (open: boolean) => void;
  onMode: (mode: RepoBindMode) => void;
  onRepo: (value: string) => void;
  onOpenSettings?: () => void;
};

export function RepoBindControl({
  mode,
  repo,
  repos = [],
  reposLoading = false,
  reposConfigured = false,
  recent = [],
  locked = false,
  open = false,
  query = "",
  onQuery,
  onOpen,
  onMode,
  onRepo,
  onOpenSettings,
}: Props) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!detailsRef.current?.contains(event.target as Node)) onOpen?.(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, onOpen]);
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const label = mode === "bind" && repo ? repoShortLabel(repo) : "无仓库";
  const ranked = useMemo(() => {
    const recentUrls = new Set(recent);
    const top = repos.filter((item) => recentUrls.has(item.url));
    const rest = repos.filter((item) => !recentUrls.has(item.url));
    return [...top, ...rest];
  }, [recent, repos]);

  const pickNone = () => {
    onMode("none");
    onRepo("");
    onOpen?.(false);
  };
  const pickRepo = (url: string) => {
    onMode("bind");
    onRepo(url);
    onOpen?.(false);
  };

  if (locked) {
    return (
      <div className="picker">
        <span className="repo-bind-lock" id="repo-bind" title={repo || "无仓库"}>
          {label}
        </span>
      </div>
    );
  }

  return (
    <div className="picker repo-bind">
      <details
        ref={detailsRef}
        className="repo-bind-pop"
        id="repo-bind"
        open={open}
        onToggle={(event) => onOpen?.((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary aria-label="仓库">{label}</summary>
        <div className="repo-bind-menu">
          <input
            ref={searchRef}
            id="repo-bind-search"
            name="repo-bind-search"
            type="search"
            autoComplete="off"
            placeholder="搜索仓库…"
            value={query}
            onChange={(event) => onQuery?.(event.target.value)}
          />
          <ul>
            <li>
              <button type="button" className={mode === "none" ? "is-selected" : undefined} onClick={pickNone}>
                <span>无仓库</span>
                {mode === "none" ? <span className="repo-bind-check" aria-hidden="true">✓</span> : null}
              </button>
            </li>
            {ranked.map((item) => {
              const selected = mode === "bind" && (repo === item.url || repoShortLabel(repo) === item.fullName);
              return (
                <li key={item.url}>
                  <button type="button" className={selected ? "is-selected" : undefined} onClick={() => pickRepo(item.url)}>
                    <span>{item.fullName}</span>
                    {selected ? <span className="repo-bind-check" aria-hidden="true">✓</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {reposLoading ? <p className="hint">正在拉取仓库…</p> : null}
          {!reposLoading && !reposConfigured ? (
            <p className="hint">
              先在设置里绑定 GitHub。
              {onOpenSettings ? (
                <button type="button" className="repo-bind-link" onClick={onOpenSettings}>
                  去设置
                </button>
              ) : null}
            </p>
          ) : null}
          {!reposLoading && reposConfigured && ranked.length === 0 ? (
            <p className="hint">{query.trim() ? "没有匹配的仓库" : "这个账号下还没有可用仓库"}</p>
          ) : null}
        </div>
      </details>
    </div>
  );
}
