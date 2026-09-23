import type { ReactNode } from "react";
import { IconExpand, IconPanelRight } from "../icons";
import { PANE_MIN } from "../pane-size";
import { ResizeHandle } from "./ResizeHandle";

export type InspectorTab = "git" | "terminal" | "files";

const INSPECTOR_TABS: ReadonlyArray<{ id: InspectorTab; label: string }> = [
  { id: "git", label: "Git" },
  { id: "terminal", label: "终端" },
  { id: "files", label: "文件" },
];

/** A plain chat has no repo, so it has no Git tab. */
export function inspectorTabs(hasGit: boolean): ReadonlyArray<{ id: InspectorTab; label: string }> {
  return hasGit ? INSPECTOR_TABS : INSPECTOR_TABS.filter((item) => item.id !== "git");
}

type Props = {
  tab: InspectorTab;
  hasGit: boolean;
  width: number;
  maxWidth: number;
  fullscreen: boolean;
  onWidth: (next: number) => void;
  onDragEnd?: (next: number) => void;
  onSelect: (id: InspectorTab) => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
  children: ReactNode;
};

export function InspectorShell({
  tab,
  hasGit,
  width,
  maxWidth,
  fullscreen,
  onWidth,
  onDragEnd,
  onSelect,
  onToggleFullscreen,
  onClose,
  children,
}: Props) {
  return (
    <aside className="inspector">
      {fullscreen ? null : (
        <ResizeHandle
          label="调整右栏宽度"
          value={width}
          min={PANE_MIN}
          max={maxWidth}
          invert
          onChange={onWidth}
          onDragEnd={onDragEnd}
        />
      )}
      <div className="inspector-tabs" role="tablist" aria-label="对话侧栏">
        {inspectorTabs(hasGit).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={tab === item.id ? "is-on" : ""}
            aria-selected={tab === item.id}
            onClick={() => onSelect(item.id)}
          >
            {item.label}
          </button>
        ))}
        <div className="inspector-actions">
          <button
            type="button"
            className="icon-btn inspector-collapse"
            aria-label={fullscreen ? "退出全屏" : "全屏"}
            title={fullscreen ? "退出全屏" : "全屏"}
            aria-pressed={fullscreen}
            onClick={onToggleFullscreen}
          >
            <IconExpand size={16} />
          </button>
          <button type="button" className="icon-btn pane-close" aria-label="收起侧栏" title="收起侧栏" onClick={onClose}>
            <IconPanelRight size={16} />
            <span className="pane-close-label">返回对话</span>
          </button>
        </div>
      </div>
      <div className="inspector-body">{children}</div>
    </aside>
  );
}
