export function StatusMark({ state }: { state: "run" | "ok" | "err" }) {
  return (
    <span className={`status-mark is-${state}`} aria-hidden="true">
      <svg viewBox="0 0 16 16" width="14" height="14">
        <circle className="status-mark-ring" cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          className="status-mark-check"
          d="M4.5 8.2 7 10.5 11.5 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          className="status-mark-cross"
          d="M5.2 5.2 10.8 10.8M10.8 5.2 5.2 10.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
