import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { useId, type ReactNode } from "react";
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
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={`neo-check${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}>
      <CheckboxPrimitive.Root
        id={inputId}
        className="neo-check-box"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      >
        <CheckboxPrimitive.Indicator className="neo-check-mark">
          <IconCheck size={12} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label ? (
        <label className="neo-check-label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
    </div>
  );
}
