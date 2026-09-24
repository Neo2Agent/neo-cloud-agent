import { useEffect, useRef } from "react";
import { Select } from "@neo-cloud-agent/ui";
import { repoShortLabel } from "../repo";

export type RepoBindMode = "none" | "bind";

type Props = {
  mode: RepoBindMode;
  repo: string;
  recent?: string[];
  projectDefault?: string;
  locked?: boolean;
  open?: boolean;
  onOpen?: (open: boolean) => void;
  onMode: (mode: RepoBindMode) => void;
  onRepo: (value: string) => void;
};

export function RepoBindControl({
  mode,
  repo,
  recent = [],
  projectDefault = "",
  locked = false,
  open = false,
  onOpen,
  onMode,
  onRepo,
}: Props) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!detailsRef.current?.contains(event.target as Node)) onOpen?.(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, onOpen]);

  if (locked) {
    const label = mode === "bind" && repo ? repoShortLabel(repo) : "无仓库";
    return (
      <div className="picker">
        <span className="repo-bind-lock" id="repo-bind" title={repo || "无仓库"}>
          {label}
        </span>
      </div>
    );
  }

  const suggestions = [...(projectDefault ? [projectDefault] : []), ...recent.filter((item) => item !== projectDefault)];

  return (
    <div className="picker repo-bind">
      <Select
        id="repo-mode"
        size="pill"
        aria-label="仓库"
        value={mode}
        onValueChange={(value) => {
          const next = value as RepoBindMode;
          onMode(next);
          onOpen?.(next === "bind");
        }}
        options={[
          { value: "none", label: "无仓库" },
          { value: "bind", label: "绑定 Git" },
        ]}
      />
      {mode === "bind" ? (
        <details
          ref={detailsRef}
          className="repo-bind-pop"
          id="repo-bind"
          open={open}
          onToggle={(event) => onOpen?.((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>{repoShortLabel(repo) || "选择仓库…"}</summary>
          <div className="repo-bind-menu">
            <input
              id="repo-bind-url"
              name="repo-bind-url"
              type="text"
              autoComplete="off"
              placeholder="owner/repo 或 github.com/org/repo"
              value={repo}
              onChange={(event) => onRepo(event.target.value)}
            />
            {suggestions.length > 0 ? (
              <ul>
                {suggestions.map((item) => (
                  <li key={item}>
                    <button
                      type="button"
                      onClick={() => {
                        onRepo(item);
                        onOpen?.(false);
                      }}
                    >
                      {item === projectDefault ? `项目默认 · ${repoShortLabel(item)}` : repoShortLabel(item)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">输入 owner/repo，或从项目设置里写默认仓库。</p>
            )}
          </div>
        </details>
      ) : null}
    </div>
  );
}
