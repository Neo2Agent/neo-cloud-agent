import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ReactNode } from "react";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  id?: string;
  className?: string;
};

export function Switch({ checked, onCheckedChange, disabled, label, id, className }: Props) {
  return (
    <label className={`neo-switch${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}>
      {label ? <span className="neo-switch-label">{label}</span> : null}
      <SwitchPrimitive.Root
        id={id}
        className="neo-switch-root"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      >
        <SwitchPrimitive.Thumb className="neo-switch-thumb" />
      </SwitchPrimitive.Root>
    </label>
  );
}
