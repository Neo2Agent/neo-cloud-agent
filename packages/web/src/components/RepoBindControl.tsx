import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight, IconFolder, IconPlus, IconSearch } from "../icons";
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
type Pane = "root" | "github";

function matchesRepo(item: GithubRepoOption, q: string): boolean {
  return item.fullName.toLowerCase().includes(q) || item.url.toLowerCase().includes(q);
}

function isRepoSelected(mode: RepoBindMode, repo: string, item: GithubRepoOption): boolean {
  return mode === "bind" && (repo === item.url || repoShortLabel(repo) === item.fullName);
}

function matchesScratch(q: string): boolean {
  return /无仓库|从头|none|scratch/i.test(q);
}

function RepoRow({
  item,
  selected,
  onPick,
}: {
  item: GithubRepoOption;
  selected: boolean;
  onPick: () => void;
}) {
  const parts = splitRepoLabel(item.fullName);
  return (
    <li>
      <button
        type="button"
        className={selected ? "is-selected" : undefined}
        aria-label={item.fullName}
        title={item.fullName}
        onClick={onPick}
      >
        <span className="repo-bind-row-icon" aria-hidden="true">
          <IconFolder size={16} />
        </span>
        <span className="repo-bind-item">
          <span className="repo-bind-item-name">{parts.name}</span>
          {parts.owner ? <span className="repo-bind-item-owner">{parts.owner}</span> : null}
        </span>
        {selected ? (
          <span className="repo-bind-check" aria-hidden="true">
            <IconCheck size={14} />
          </span>
        ) : null}
      </button>
    </li>
  );
}

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
  const [pane, setPane] = useState<Pane>("root");

  const label = mode === "bind" && repo ? repoShortLabel(repo) : "无仓库";
  const q = query.trim().toLowerCase();
  const searching = Boolean(q);

  const recentItems = useMemo(() => {
    const items: GithubRepoOption[] = [];
    for (const url of recent) {
      const found = repos.find((item) => item.url === url);
      items.push(found ?? { fullName: repoShortLabel(url) || url, url });
    }
    return items;
  }, [recent, repos]);

  const filteredRecent = useMemo(
    () => (searching ? recentItems.filter((item) => matchesRepo(item, q)) : recentItems),
    [q, recentItems, searching],
  );
  const filteredRepos = useMemo(() => {
    const listed = searching ? repos.filter((item) => matchesRepo(item, q)) : repos;
    if (!searching) return listed;
    const recentUrls = new Set(recentItems.filter((item) => matchesRepo(item, q)).map((item) => item.url));
    return listed.filter((item) => !recentUrls.has(item.url));
  }, [q, recentItems, repos, searching]);

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
      setPane("root");
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
  }, [open, locked, pane, filteredRecent.length, filteredRepos.length, reposLoading, query]);

  useEffect(() => {
    if (!open || locked) return;
    const onPointer = (event: PointerEvent) => {
      const node = event.target as Node;
      if (triggerRef.current?.contains(node) || menuRef.current?.contains(node)) return;
      onOpen?.(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pane === "github" && !searching) {
        setPane("root");
        return;
      }
      onOpen?.(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, locked, onOpen, pane, searching]);

  useEffect(() => {
    if (!open || locked) return;
    searchRef.current?.focus({ preventScroll: true });
  }, [open, locked, pane]);

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
  const openSettings = () => {
    onOpenSettings?.();
    onOpen?.(false);
  };

  const triggerInner = (
    <>
      <span className="repo-bind-row-icon" aria-hidden="true">
        <IconFolder size={14} />
      </span>
      <span className="repo-bind-label">{label}</span>
    </>
  );

  if (locked) {
    return (
      <div className="picker">
        <span className="repo-bind-lock" id="repo-bind" title={`${label}（对话已开始，不能再换仓库）`}>
          {triggerInner}
        </span>
      </div>
    );
  }

  const showScratch = !searching || matchesScratch(q);
  const showRecent = filteredRecent.length > 0 && (searching || pane === "root");

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
          <label className="repo-bind-search">
            <span className="repo-bind-row-icon" aria-hidden="true">
              <IconSearch size={14} />
            </span>
            <input
              ref={searchRef}
              id="repo-bind-search"
              name="repo-bind-search"
              type="text"
              inputMode="search"
              autoComplete="off"
              placeholder="搜索仓库…"
              value={query}
              onChange={(event) => onQuery?.(event.target.value)}
            />
          </label>
          <div className="repo-bind-body">
            {showRecent ? (
              <section className="repo-bind-section">
                <h3 className="repo-bind-heading">最近</h3>
                <ul>
                  {filteredRecent.map((item) => (
                    <RepoRow
                      key={`recent:${item.url}`}
                      item={item}
                      selected={isRepoSelected(mode, repo, item)}
                      onPick={() => pickRepo(item.url)}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            {searching ? (
              <section className="repo-bind-section">
                {filteredRepos.length > 0 ? <h3 className="repo-bind-heading">仓库</h3> : null}
                {reposLoading ? <p className="hint">正在拉取仓库…</p> : null}
                {!reposLoading && !reposConfigured ? (
                  <ul>
                    <li>
                      <button type="button" onClick={openSettings}>
                        <span className="repo-bind-row-icon" aria-hidden="true">
                          <IconFolder size={16} />
                        </span>
                        <span className="repo-bind-item">
                          <span className="repo-bind-item-name">绑定 GitHub</span>
                        </span>
                        <span className="repo-bind-check" aria-hidden="true">
                          <IconChevronRight size={14} />
                        </span>
                      </button>
                    </li>
                  </ul>
                ) : null}
                {!reposLoading && reposConfigured && filteredRepos.length === 0 && filteredRecent.length === 0 ? (
                  <p className="hint">没有匹配的仓库</p>
                ) : null}
                {reposConfigured && filteredRepos.length > 0 ? (
                  <ul>
                    {filteredRepos.map((item) => (
                      <RepoRow
                        key={item.url}
                        item={item}
                        selected={isRepoSelected(mode, repo, item)}
                        onPick={() => pickRepo(item.url)}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : pane === "github" ? (
              <section className="repo-bind-section">
                <button type="button" className="repo-bind-back" aria-label="返回" onClick={() => setPane("root")}>
                  <span className="repo-bind-row-icon" aria-hidden="true">
                    <IconChevronLeft size={16} />
                  </span>
                  <span className="repo-bind-item">
                    <span className="repo-bind-item-name">GitHub</span>
                  </span>
                </button>
                {reposLoading ? <p className="hint">正在拉取仓库…</p> : null}
                {!reposLoading && reposConfigured && filteredRepos.length === 0 ? (
                  <p className="hint">这个账号下还没有可用仓库</p>
                ) : null}
                {reposConfigured && filteredRepos.length > 0 ? (
                  <ul>
                    {filteredRepos.map((item) => (
                      <RepoRow
                        key={item.url}
                        item={item}
                        selected={isRepoSelected(mode, repo, item)}
                        onPick={() => pickRepo(item.url)}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : (
              <section className="repo-bind-section">
                <h3 className="repo-bind-heading">仓库</h3>
                <ul>
                  <li>
                    {reposConfigured ? (
                      <button type="button" aria-label="GitHub" onClick={() => setPane("github")}>
                        <span className="repo-bind-row-icon" aria-hidden="true">
                          <IconFolder size={16} />
                        </span>
                        <span className="repo-bind-item">
                          <span className="repo-bind-item-name">GitHub</span>
                        </span>
                        <span className="repo-bind-check" aria-hidden="true">
                          <IconChevronRight size={14} />
                        </span>
                      </button>
                    ) : (
                      <button type="button" aria-label="绑定 GitHub" onClick={openSettings}>
                        <span className="repo-bind-row-icon" aria-hidden="true">
                          <IconFolder size={16} />
                        </span>
                        <span className="repo-bind-item">
                          <span className="repo-bind-item-name">绑定 GitHub</span>
                        </span>
                        <span className="repo-bind-check" aria-hidden="true">
                          <IconChevronRight size={14} />
                        </span>
                      </button>
                    )}
                  </li>
                  {showScratch ? (
                    <li>
                      <button
                        type="button"
                        className={mode === "none" ? "is-selected" : undefined}
                        aria-label="从头开始"
                        onClick={pickNone}
                      >
                        <span className="repo-bind-row-icon" aria-hidden="true">
                          <IconPlus size={16} />
                        </span>
                        <span className="repo-bind-item">
                          <span className="repo-bind-item-name">从头开始</span>
                        </span>
                        {mode === "none" ? (
                          <span className="repo-bind-check" aria-hidden="true">
                            <IconCheck size={14} />
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ) : null}
                </ul>
              </section>
            )}

            {searching && showScratch ? (
              <section className="repo-bind-section">
                <ul>
                  <li>
                    <button
                      type="button"
                      className={mode === "none" ? "is-selected" : undefined}
                      aria-label="从头开始"
                      onClick={pickNone}
                    >
                      <span className="repo-bind-row-icon" aria-hidden="true">
                        <IconPlus size={16} />
                      </span>
                      <span className="repo-bind-item">
                        <span className="repo-bind-item-name">从头开始</span>
                      </span>
                      {mode === "none" ? (
                        <span className="repo-bind-check" aria-hidden="true">
                          <IconCheck size={14} />
                        </span>
                      ) : null}
                    </button>
                  </li>
                </ul>
              </section>
            ) : null}
          </div>
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
        {triggerInner}
        <span className="repo-bind-chevron" aria-hidden="true">
          <IconChevronDown size={12} />
        </span>
      </button>
      {menu}
    </div>
  );
}
