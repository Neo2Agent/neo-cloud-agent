import { createContext, useState, type ReactNode } from "react";
import { IconExpand, IconPanelRight } from "../icons";
import { PANE_MIN } from "../pane-size";
import { ResizeHandle } from "./ResizeHandle";

export const InspectorMenuSlot = createContext<HTMLElement | null>(null);

export type InspectorTab = "diff" | "terminal" | "files";

const INSPECTOR_TABS: ReadonlyArray<{ id: InspectorTab; label: string }> = [
  { id: "diff", label: "Diff" },
  { id: "terminal", label: "终端" },
  { id: "files", label: "文件" },
];

type Props = {
  tab: InspectorTab;
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
  const [menuSlot, setMenuSlot] = useState<HTMLElement | null>(null);
  return (
    <InspectorMenuSlot.Provider value={menuSlot}>
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
          {INSPECTOR_TABS.map((item) => (
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
            <div className="inspector-menu" ref={setMenuSlot} />
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
            </button>
          </div>
        </div>
        <div className="inspector-body">{children}</div>
      </aside>
    </InspectorMenuSlot.Provider>
  );
}
