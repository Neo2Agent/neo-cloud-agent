type Target = "cloud" | "desk";

type Props = {
  value: Target;
  onChange: (value: Target) => void;
  deskDisabled?: boolean;
  wide?: boolean;
};

export function BuddyTargetToggle({ value, onChange, deskDisabled = false, wide = false }: Props) {
  return (
    <div className={wide ? "buddy-toggle is-wide" : "buddy-toggle"} role="tablist" aria-label="执行目标">
      <button
        type="button"
        role="tab"
        className={value === "cloud" ? "is-on" : ""}
        aria-selected={value === "cloud"}
        aria-label="云端工作"
        onClick={() => onChange("cloud")}
      >
        云端
      </button>
      <button
        type="button"
        role="tab"
        className={value === "desk" ? "is-on" : ""}
        aria-selected={value === "desk"}
        aria-label="连接电脑"
        disabled={deskDisabled && value !== "desk"}
        onClick={() => onChange("desk")}
      >
        电脑
      </button>
    </div>
  );
}
