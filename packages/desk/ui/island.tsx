import { Switch } from "@neo-cloud-agent/ui";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

type NativeButtonType = "button" | "submit" | "reset";
type ButtonKind = "primary" | "default" | "text" | "button" | NativeButtonType;

type IslandButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  type?: ButtonKind;
  htmlType?: NativeButtonType;
  block?: boolean;
  icon?: ReactNode;
  loading?: boolean;
  danger?: boolean;
  size?: string;
};

function nativeButtonType(type: ButtonKind | undefined, htmlType: NativeButtonType | undefined): NativeButtonType {
  if (htmlType) return htmlType;
  if (type === "submit" || type === "reset") return type;
  return "button";
}

function buttonKind(type: ButtonKind | undefined): "primary" | "text" | "ghost" {
  if (type === "primary") return "primary";
  if (type === "text") return "text";
  return "ghost";
}

/** Web/Cursor chrome. Call sites still say Island*; nothing here loads 动森. */
export function IslandButton({
  type = "default",
  htmlType,
  block,
  icon,
  loading,
  danger,
  size: _size,
  className,
  children,
  disabled,
  ...props
}: IslandButtonProps) {
  const kind = buttonKind(type);
  const classes = [
    "ui-btn",
    kind === "primary" ? "ui-btn-primary" : kind === "text" ? "ui-btn-text" : "ghost",
    block ? "is-block" : "",
    danger ? "is-danger" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={nativeButtonType(type, htmlType)} className={classes} disabled={disabled || loading} {...props}>
      {icon}
      {children}
    </button>
  );
}

export function IslandInput({
  shadow: _shadow,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { shadow?: boolean }) {
  return <input className={`ui-input${className ? ` ${className}` : ""}`} {...props} />;
}

export function IslandCard({
  hoverable: _hoverable,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { hoverable?: boolean; children?: ReactNode }) {
  return (
    <div className={`ui-card${className ? ` ${className}` : ""}`} {...props}>
      {children}
    </div>
  );
}

export function IslandTag({
  children,
  color: _color,
  size: _size,
  variant: _variant,
  className,
}: {
  children?: ReactNode;
  color?: string;
  size?: string;
  variant?: string;
  className?: string;
}) {
  return <span className={`ui-tag${className ? ` ${className}` : ""}`}>{children}</span>;
}

export function IslandSwitch({
  checked,
  onChange,
  disabled,
  size: _size,
  "aria-label": ariaLabel,
}: {
  checked?: boolean;
  onChange?: () => void;
  disabled?: boolean;
  size?: string;
  "aria-label"?: string;
}) {
  return (
    <Switch
      checked={Boolean(checked)}
      disabled={disabled}
      aria-label={ariaLabel}
      onCheckedChange={() => onChange?.()}
    />
  );
}

export function IslandCollapse({
  question,
  answer,
  children,
}: {
  question?: ReactNode;
  answer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <details className="ui-collapse">
      <summary>{question ?? "思考过程"}</summary>
      <div>{answer ?? children}</div>
    </details>
  );
}

export function IslandTitle({
  children,
  size = "middle",
  color: _color,
  className,
}: {
  children?: ReactNode;
  size?: "middle" | "large" | string;
  color?: string;
  className?: string;
}) {
  return <h1 className={`ui-title ui-title-${size}${className ? ` ${className}` : ""}`}>{children}</h1>;
}
