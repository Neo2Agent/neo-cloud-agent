import { Select } from "@neo-cloud-agent/ui";
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
      <Select
        id="execution-target"
        size="pill"
        aria-label="目标"
        value={target.kind}
        onValueChange={(next) => {
          const kind = next as DeskTarget["kind"];
          if (kind === "desk" && !canRunLocal) return;
          onTarget({ ...target, kind });
        }}
        options={[
          { value: "cloud", label: "云端" },
          { value: "desk", label: canRunLocal ? "本机" : "本机（P2 需 Desk）", disabled: !canRunLocal },
          { value: "remote", label: "远程机（P3）", disabled: true },
        ]}
      />
      {target.kind === "desk" ? (
        <button type="button" className="ghost picker-extra" onClick={onPickFolder}>
          {folder || "选择文件夹…"}
        </button>
      ) : null}
    </label>
  );
}
