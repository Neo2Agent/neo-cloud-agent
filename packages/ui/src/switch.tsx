import * as SwitchPrimitive from "@radix-ui/react-switch";
import { useId, type ReactNode } from "react";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  id?: string;
  className?: string;
};

export function Switch({ checked, onCheckedChange, disabled, label, id, className }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={`neo-switch${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}>
      {label ? (
        <label className="neo-switch-label" htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      <SwitchPrimitive.Root
        id={inputId}
        className="neo-switch-root"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      >
        <SwitchPrimitive.Thumb className="neo-switch-thumb" />
      </SwitchPrimitive.Root>
    </div>
  );
}
