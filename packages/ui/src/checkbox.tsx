import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import type { ReactNode } from "react";
import { IconCheck } from "./icons";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  id?: string;
  className?: string;
};

export function Checkbox({ checked, onCheckedChange, disabled, label, id, className }: Props) {
  return (
    <label className={`neo-check${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}>
      <CheckboxPrimitive.Root
        id={id}
        className="neo-check-box"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      >
        <CheckboxPrimitive.Indicator className="neo-check-mark">
          <IconCheck size={12} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label ? <span className="neo-check-label">{label}</span> : null}
    </label>
  );
}
