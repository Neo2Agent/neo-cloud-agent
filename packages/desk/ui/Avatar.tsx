import { initials } from "./project/helpers";

export function Avatar({
  src,
  label,
  className,
  fallback,
}: {
  src?: string | null;
  label: string;
  className?: string;
  fallback?: string;
}) {
  const classes = className ? `avatar ${className}` : "avatar";
  if (src) {
    return <img className={classes} src={src} alt="" />;
  }
  return (
    <span className={classes} aria-hidden="true">
      {fallback ?? initials(label)}
    </span>
  );
}
