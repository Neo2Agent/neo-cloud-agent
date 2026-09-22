import { useCallback, useEffect, useState, type ReactNode } from "react";
import { artifactKind } from "../artifact";
import { IconFileKind } from "../icons";

export type FilesView = "tree" | "artifacts";

type Props = {
  view: FilesView;
  onView: (view: FilesView) => void;
  tree: (onSelect: (name: string | null) => void) => ReactNode;
  artifacts: (onSelect: (name: string | null) => void) => ReactNode;
};

export function WorkspaceFiles({ view, onView, tree, artifacts }: Props) {
  const [title, setTitle] = useState<string | null>(null);
  const onSelect = useCallback((name: string | null) => setTitle(name), []);
  useEffect(() => {
    setTitle(null);
  }, [view]);
  return (
    <section className="workspace-files">
      <header className="workspace-files-head">
        <span className="workspace-files-title">
          {title ? <IconFileKind kind={artifactKind({ name: title })} size={16} /> : null}
          {title ? <strong>{title}</strong> : null}
        </span>
        <button type="button" className="workspace-files-save" disabled title="只读">
          Save
        </button>
      </header>
      <div className="workspace-files-tabs" role="tablist" aria-label="工作区">
        <button type="button" role="tab" aria-selected={view === "tree"} className={view === "tree" ? "is-on" : ""} onClick={() => onView("tree")}>
          文件
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "artifacts"}
          className={view === "artifacts" ? "is-on" : ""}
          onClick={() => onView("artifacts")}
        >
          产物
        </button>
      </div>
      <div className="workspace-files-body">{view === "tree" ? tree(onSelect) : artifacts(onSelect)}</div>
    </section>
  );
}
