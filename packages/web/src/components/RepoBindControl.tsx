import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeRepoMenu, repoMenuClampElement } from "../repo-menu";
import { repoShortLabel, splitRepoLabel } from "../repo";

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

type MenuCoords = { top: number; left: number; width: number };

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
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [coords, setCoords] = useState<MenuCoords | null>(null);

  const label = mode === "bind" && repo ? repoShortLabel(repo) : "无仓库";
  const ranked = useMemo(() => {
    const recentUrls = new Set(recent);
    const top = repos.filter((item) => recentUrls.has(item.url));
    const rest = repos.filter((item) => !recentUrls.has(item.url));
    const merged = [...top, ...rest];
    const q = query.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter(
      (item) => item.fullName.toLowerCase().includes(q) || item.url.toLowerCase().includes(q),
    );
  }, [query, recent, repos]);

  const place = () => {
    const triggerEl = triggerRef.current;
    const menuEl = menuRef.current;
    const trigger = triggerEl?.getBoundingClientRect();
    if (!triggerEl || !trigger) return;
    const clamp = repoMenuClampElement(triggerEl).getBoundingClientRect();
    const next = placeRepoMenu({
      trigger,
      menu: {
        width: menuEl?.offsetWidth || 280,
        height: menuEl?.offsetHeight || 1,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      clamp,
      gap: 4,
    });
    setCoords((prev) =>
      prev && prev.top === next.top && prev.left === next.left && prev.width === next.width ? prev : next,
    );
  };

  useLayoutEffect(() => {
    if (!open || locked) {
      setCoords(null);
      return;
    }
    place();
    const frame = window.requestAnimationFrame(() => place());
    const menuEl = menuRef.current;
    const observer = menuEl ? new ResizeObserver(() => place()) : null;
    if (menuEl) observer?.observe(menuEl);
    const onReposition = () => place();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, locked, ranked.length, reposLoading, query]);

  useEffect(() => {
    if (!open || locked) return;
    const onPointer = (event: PointerEvent) => {
      const node = event.target as Node;
      if (triggerRef.current?.contains(node) || menuRef.current?.contains(node)) return;
      onOpen?.(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpen?.(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, locked, onOpen]);

  useEffect(() => {
    if (!open || locked) return;
    searchRef.current?.focus({ preventScroll: true });
  }, [open, locked]);

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
        <span className="repo-bind-lock" id="repo-bind" title={`${label}（对话已开始，不能再换仓库）`}>
          <span className="repo-bind-label">{label}</span>
        </span>
      </div>
    );
  }

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          className="repo-bind-menu"
          role="listbox"
          aria-label="选择仓库"
          style={
            coords
              ? { top: coords.top, left: coords.left, width: coords.width }
              : { visibility: "hidden", top: 0, left: 0 }
          }
        >
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
                {mode === "none" ? (
                  <span className="repo-bind-check" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
            </li>
            {ranked.map((item) => {
              const selected = mode === "bind" && (repo === item.url || repoShortLabel(repo) === item.fullName);
              const parts = splitRepoLabel(item.fullName);
              return (
                <li key={item.url}>
                  <button
                    type="button"
                    className={selected ? "is-selected" : undefined}
                    aria-label={item.fullName}
                    title={item.fullName}
                    onClick={() => pickRepo(item.url)}
                  >
                    <span className="repo-bind-item">
                      <span className="repo-bind-item-name">{parts.name}</span>
                      {parts.owner ? <span className="repo-bind-item-owner">{parts.owner}</span> : null}
                    </span>
                    {selected ? (
                      <span className="repo-bind-check" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
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
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="picker repo-bind">
      <button
        ref={triggerRef}
        type="button"
        id="repo-bind"
        className={`repo-bind-trigger${open ? " is-open" : ""}`}
        aria-label="仓库"
        aria-expanded={open}
        aria-haspopup="listbox"
        title={label}
        onClick={() => onOpen?.(!open)}
      >
        <span className="repo-bind-label">{label}</span>
      </button>
      {menu}
    </div>
  );
}
