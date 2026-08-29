type Target = "cloud" | "desk";

type Props = {
  value: Target;
  onChange: (value: Target) => void;
  deskDisabled?: boolean;
};

export function BuddyTargetToggle({ value, onChange, deskDisabled = false }: Props) {
  return (
    <div className="buddy-toggle" role="tablist" aria-label="执行目标">
      <button
        type="button"
        role="tab"
        className={value === "cloud" ? "is-on" : ""}
        aria-selected={value === "cloud"}
        onClick={() => onChange("cloud")}
      >
        云端工作
      </button>
      <button
        type="button"
        role="tab"
        className={value === "desk" ? "is-on" : ""}
        aria-selected={value === "desk"}
        disabled={deskDisabled && value !== "desk"}
        onClick={() => onChange("desk")}
      >
        连接电脑
      </button>
    </div>
  );
}
