import { Select } from "@neo-cloud-agent/ui";
import {
  TARGET_CLOUD,
  TARGET_REMOTE,
  isLocalDeskKind,
  targetPickerOptions,
  type DeskTarget,
} from "../desk";

type Props = {
  target: DeskTarget;
  canRunLocal: boolean;
  folder?: string;
  remoteAvailable?: boolean;
  /** An open desk-hosted run cannot change where it executes. */
  locked?: boolean;
  lockLabel?: string;
  onTarget: (target: DeskTarget) => void;
  onPickFolder?: () => void;
};

export function TargetPicker({
  target,
  canRunLocal,
  folder,
  remoteAvailable = false,
  locked = false,
  lockLabel = "Remote Control",
  onTarget,
  onPickFolder,
}: Props) {
  const options = targetPickerOptions({ canRunLocal, remoteAvailable });
  const local = isLocalDeskKind(target.kind);
  const value = options.some((item) => item.value === target.kind) ? target.kind : TARGET_CLOUD;
  if (locked) {
    return (
      <div className="picker">
        <Select
          id="execution-target"
          size="pill"
          aria-label="目标"
          disabled
          value="locked"
          onValueChange={() => undefined}
          options={[{ value: "locked", label: lockLabel }]}
        />
      </div>
    );
  }
  return (
    <div className="picker">
      <Select
        id="execution-target"
        size="pill"
        aria-label="目标"
        value={value}
        onValueChange={(next) => {
          const kind = next as DeskTarget["kind"];
          if (kind === TARGET_REMOTE && !remoteAvailable) {
            return;
          }
          onTarget({ ...target, kind });
        }}
        options={options}
      />
      {local && canRunLocal ? (
        <button type="button" className="ghost picker-extra" onClick={onPickFolder}>
          {folder || "选择文件夹…"}
        </button>
      ) : null}
    </div>
  );
}
