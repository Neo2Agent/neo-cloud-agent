import { BuddyIcon, type BuddyIconName } from "./icons";

export type BuddyPlusAction =
  | "image"
  | "file"
  | "repo"
  | "expert"
  | "skill"
  | "camera"
  | "new"
  | "pr"
  | "settings"
  | "memory";

const GRID: Array<{ id: BuddyPlusAction; label: string; icon: BuddyIconName }> = [
  { id: "image", label: "图片", icon: "image" },
  { id: "file", label: "文件", icon: "file" },
  { id: "repo", label: "仓库", icon: "repo" },
  { id: "expert", label: "@ 专家", icon: "expert" },
  { id: "skill", label: "@ 技能", icon: "skill" },
  { id: "camera", label: "拍照", icon: "camera" },
];

export const BUDDY_PLUS_ROWS: Array<{ id: BuddyPlusAction; label: string; icon: BuddyIconName }> = [
  { id: "memory", label: "记忆", icon: "doc" },
  { id: "settings", label: "设置", icon: "gear" },
  { id: "new", label: "新对话", icon: "chat" },
  { id: "pr", label: "导出 / 开 PR", icon: "pr" },
];

type Props = {
  open: boolean;
  canOpenPr?: boolean;
  onClose: () => void;
  onAction: (id: BuddyPlusAction) => void;
};

export function BuddyPlusSheet({ open, canOpenPr = false, onClose, onAction }: Props) {
  if (!open) return null;
  return (
    <div className="buddy-sheet-root">
      <button type="button" className="buddy-sheet-backdrop" aria-label="关闭" onClick={onClose} />
      <div className="buddy-sheet" role="dialog" aria-label="添加">
        <span className="buddy-sheet-handle" />
        <h3>添加</h3>
        <div className="buddy-sheet-grid">
          {GRID.map((item) => (
            <button key={item.id} type="button" onClick={() => onAction(item.id)}>
              <span className="buddy-icon-slot">
                <BuddyIcon name={item.icon} />
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <ul className="buddy-sheet-rows">
          {BUDDY_PLUS_ROWS.map((item) => (
            <li key={item.id}>
              <button type="button" disabled={item.id === "pr" && !canOpenPr} onClick={() => onAction(item.id)}>
                <BuddyIcon name={item.icon} size={18} />
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
