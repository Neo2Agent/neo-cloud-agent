import * as SelectPrimitive from "@radix-ui/react-select";
import { IconCheck, IconChevron } from "./icons";

export const EMPTY_SELECT_VALUE = "__empty__";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectGroup = {
  label: string;
  options: SelectOption[];
};

type Props = {
  value: string;
  onValueChange: (value: string) => void;
  options?: SelectOption[];
  groups?: SelectGroup[];
  placeholder?: string;
  disabled?: boolean;
  size?: "field" | "pill";
  id?: string;
  name?: string;
  className?: string;
  "aria-label"?: string;
};

function collectOptions(options: SelectOption[], groups?: SelectGroup[]): SelectOption[] {
  return groups && groups.length > 0 ? groups.flatMap((group) => group.options) : options;
}

function withCurrentValue(
  value: string,
  options: SelectOption[],
  groups?: SelectGroup[],
): { options: SelectOption[]; groups?: SelectGroup[] } {
  const all = collectOptions(options, groups);
  if (all.some((item) => item.value === value)) return { options, groups };
  if (!value) return { options, groups };
  const extra = { value, label: value };
  if (groups && groups.length > 0) {
    return { options, groups: [...groups, { label: "当前", options: [extra] }] };
  }
  return { options: [...options, extra], groups };
}

function encode(value: string): string {
  return value === "" ? EMPTY_SELECT_VALUE : value;
}

function decode(value: string): string {
  return value === EMPTY_SELECT_VALUE ? "" : value;
}

function renderOptions(options: SelectOption[]) {
  return options.map((item) => (
    <SelectPrimitive.Item
      key={item.value || EMPTY_SELECT_VALUE}
      className="neo-select-item"
      value={encode(item.value)}
      disabled={item.disabled}
    >
      <SelectPrimitive.ItemText>{item.label}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="neo-select-check">
        <IconCheck />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  ));
}

export function Select({
  value,
  onValueChange,
  options = [],
  groups,
  placeholder = "请选择",
  disabled,
  size = "field",
  id,
  name,
  className,
  "aria-label": ariaLabel,
}: Props) {
  const resolved = withCurrentValue(value, options, groups);
  const encoded = encode(value);
  return (
    <SelectPrimitive.Root value={encoded} onValueChange={(next) => onValueChange(decode(next))} disabled={disabled} name={name}>
      <SelectPrimitive.Trigger
        id={id}
        className={`neo-select-trigger neo-select-${size}${className ? ` ${className}` : ""}`}
        aria-label={ariaLabel}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className="neo-select-chevron">
          <IconChevron />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="neo-select-content" position="popper" sideOffset={6} collisionPadding={12}>
          <SelectPrimitive.Viewport className="neo-select-viewport">
            {resolved.groups && resolved.groups.length > 0
              ? resolved.groups.map((group) => (
                  <SelectPrimitive.Group key={group.label}>
                    <SelectPrimitive.Label className="neo-select-label">{group.label}</SelectPrimitive.Label>
                    {renderOptions(group.options)}
                  </SelectPrimitive.Group>
                ))
              : renderOptions(resolved.options)}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
