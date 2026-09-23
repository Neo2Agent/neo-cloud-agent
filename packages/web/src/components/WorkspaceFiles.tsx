import type { ReactNode } from "react";

export type FilesView = "tree" | "artifacts";

type Props = {
  view: FilesView;
  onView: (view: FilesView) => void;
  /** The active view draws its own `.workspace-files-head` into the top-right cell. */
  children: ReactNode;
};

export function WorkspaceFiles({ view, onView, children }: Props) {
  return (
    <section className="workspace-files">
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
      <div className="workspace-files-body">{children}</div>
    </section>
  );
}
