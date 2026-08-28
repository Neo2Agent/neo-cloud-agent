import * as RadioPrimitive from "@radix-ui/react-radio-group";

export type RadioOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  onValueChange: (value: string) => void;
  options: RadioOption[];
  variant?: "segmented" | "list";
  name?: string;
  className?: string;
  "aria-label"?: string;
};

export function RadioGroup({
  value,
  onValueChange,
  options,
  variant = "segmented",
  name,
  className,
  "aria-label": ariaLabel,
}: Props) {
  return (
    <RadioPrimitive.Root
      className={`neo-radio neo-radio-${variant}${className ? ` ${className}` : ""}`}
      value={value}
      onValueChange={onValueChange}
      name={name}
      aria-label={ariaLabel}
    >
      {options.map((item) => (
        <RadioPrimitive.Item
          key={item.value}
          className="neo-radio-item"
          value={item.value}
          disabled={item.disabled}
        >
          {variant === "list" ? <span className="neo-radio-dot" /> : null}
          <span>{item.label}</span>
        </RadioPrimitive.Item>
      ))}
    </RadioPrimitive.Root>
  );
}
