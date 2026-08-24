import type { DeskTarget } from "../desk";

type Props = {
  target: DeskTarget;
  canRunLocal: boolean;
  folder?: string;
  onTarget: (target: DeskTarget) => void;
  onPickFolder?: () => void;
};

export function TargetPicker({ target, canRunLocal, folder, onTarget, onPickFolder }: Props) {
  return (
    <label className="picker">
      <span className="picker-label">目标</span>
      <select
        id="execution-target"
        value={target.kind}
        onChange={(event) => {
          const kind = event.target.value as DeskTarget["kind"];
          if (kind === "desk" && !canRunLocal) {
            return;
          }
          onTarget({ ...target, kind });
        }}
      >
        <option value="cloud">云端</option>
        <option value="desk" disabled={!canRunLocal}>
          {canRunLocal ? "本机" : "本机（P2 需 Desk）"}
        </option>
        <option value="remote" disabled>
          远程机（P3）
        </option>
      </select>
      {target.kind === "desk" ? (
        <button type="button" className="ghost picker-extra" onClick={onPickFolder}>
          {folder || "选择文件夹…"}
        </button>
      ) : null}
    </label>
  );
}
