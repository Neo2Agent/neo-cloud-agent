import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  type?: "button" | "submit" | "reset" | "primary" | "text";
  submit?: boolean;
  size?: "small" | "middle";
};

export function IslandButton({ type = "button", submit = false, size = "small", className, children, ...props }: ButtonProps) {
  const kind = type === "primary" ? "primary" : type === "text" ? "text" : "ghost";
  return (
    <button
      type={submit || type === "submit" ? "submit" : "button"}
      className={`island-btn island-btn-${kind} island-btn-${size}${className ? ` ${className}` : ""}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function IslandInput({ shadow: _shadow = false, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { shadow?: boolean }) {
  return <input className={`island-input${className ? ` ${className}` : ""}`} {...props} />;
}

export function IslandCard({
  children,
  className,
  color,
}: {
  children?: ReactNode;
  className?: string;
  color?: string;
}) {
  return (
    <div className={`island-card${className ? ` ${className}` : ""}`} data-color={color}>
      {children}
    </div>
  );
}

export function IslandTag({
  children,
  color = "brown",
  className,
}: {
  children?: ReactNode;
  color?: string;
  className?: string;
  size?: string;
  variant?: string;
}) {
  return (
    <span className={`island-tag island-tag-${color}${className ? ` ${className}` : ""}`}>{children}</span>
  );
}

export function IslandSwitch({
  checked,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  checked?: boolean;
  onChange?: () => void;
  disabled?: boolean;
  size?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={checked ? "island-switch is-on" : "island-switch"}
      onClick={onChange}
    />
  );
}

export function IslandTitle({
  children,
  size = "middle",
  color = "app-teal",
  className,
}: {
  children?: ReactNode;
  size?: "middle" | "large";
  color?: string;
  className?: string;
}) {
  return <h1 className={`island-title island-title-${size} island-title-${color}${className ? ` ${className}` : ""}`}>{children}</h1>;
}

export function IslandCollapse({
  question,
  children,
}: {
  question?: ReactNode;
  children?: ReactNode;
  answer?: ReactNode;
}) {
  return (
    <details className="island-collapse">
      <summary>{question ?? "思考过程"}</summary>
      <div>{children}</div>
    </details>
  );
}
