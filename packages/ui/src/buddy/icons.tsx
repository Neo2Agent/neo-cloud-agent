export type BuddyIconName =
  | "expert"
  | "skill"
  | "project"
  | "more"
  | "code"
  | "doc"
  | "search"
  | "diff"
  | "grid"
  | "globe"
  | "alert"
  | "shield"
  | "slides"
  | "chart"
  | "image"
  | "file"
  | "repo"
  | "camera"
  | "chat"
  | "pr"
  | "gear"
  | "plus"
  | "clock"
  | "chevron"
  | "info";

type Props = { name: BuddyIconName; size?: number; className?: string };

function path(name: BuddyIconName): string {
  switch (name) {
    case "expert":
      return "M12 12a3.2 3.2 0 1 0-3.2-3.2A3.2 3.2 0 0 0 12 12Zm0 1.6c-2.9 0-8 1.45-8 4.3V20h16v-2.1c0-2.85-5.1-4.3-8-4.3Z";
    case "skill":
      return "M10.2 4.4 8 8.1 4.2 9.2l3.2 3.1-.8 3.9L10.2 14l3.6 2.2-.8-3.9 3.2-3.1-3.8-1.1Z";
    case "project":
      return "M4 7.5h16v11H4Zm2-3h5l1.4 2H18v1H4V4.5Z";
    case "more":
      return "M6 12.5h.01M12 12.5h.01M18 12.5h.01";
    case "code":
      return "M9 8 5 12l4 4M15 8l4 4-4 4";
    case "doc":
      return "M7 4h7l4 4v12H7Zm7 0v4h4";
    case "search":
      return "M11 17a6 6 0 1 1 0-12 6 6 0 0 1 0 12Zm8 2-3.6-3.6";
    case "diff":
      return "M8 5h8M8 12h8M8 19h5M6 5v14";
    case "grid":
      return "M5 5h6v6H5Zm8 0h6v6h-6ZM5 13h6v6H5Zm8 0h6v6h-6Z";
    case "globe":
      return "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-8-8h16M12 4c2.4 2.4 2.4 13.6 0 16M12 4c-2.4 2.4-2.4 13.6 0 16";
    case "alert":
      return "M12 4 3.5 19h17Zm0 6v5m0 2.5h.01";
    case "shield":
      return "M12 3.5 19 6v6.2c0 4.3-2.9 7.3-7 8.3-4.1-1-7-4-7-8.3V6Z";
    case "slides":
      return "M4 7h16v10H4Zm3 13h10M12 17v3";
    case "chart":
      return "M5 19V9m7 10V5m7 14v-7";
    case "image":
      return "M5 6h14v12H5Zm2 9 3.2-3.4L14 16l2-2 3 3";
    case "file":
      return "M8.5 7h7l-2.2 10H6.3Zm3.4-2.5 1.4 2.5";
    case "repo":
      return "M7 5v14m10-10v10M7 9h10M7 15h10";
    case "camera":
      return "M4 8h4l1.5-2h5L16 8h4v11H4Zm8 9a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 12 17Z";
    case "chat":
      return "M5 6h14v9H9l-4 3z";
    case "pr":
      return "M7 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 4v8m10-4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0-6v6M7 18a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z";
    case "gear":
      return "M12 15.2A3.2 3.2 0 1 0 12 8.8a3.2 3.2 0 0 0 0 6.4Zm7.4-2.4.9-1.6-1.8-3.1-1.8.4a7.2 7.2 0 0 0-1.6-.9l-.4-1.9H10.3l-.4 1.9a7.2 7.2 0 0 0-1.6.9l-1.8-.4-1.8 3.1.9 1.6a6.6 6.6 0 0 0 0 1.8l-.9 1.6 1.8 3.1 1.8-.4c.5.4 1 .7 1.6.9l.4 1.9h3.4l.4-1.9c.6-.2 1.1-.5 1.6-.9l1.8.4 1.8-3.1-.9-1.6c.1-.6.1-1.2 0-1.8Z";
    case "plus":
      return "M12 6v12M6 12h12";
    case "clock":
      return "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-12v5l3 2";
    case "chevron":
      return "M9 6l6 6-6 6";
    case "info":
      return "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-9v5m0-8h.01";
    default:
      return "";
  }
}

export function BuddyIcon({ name, size = 22, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d={path(name)}
        stroke="currentColor"
        strokeWidth={name === "more" ? 2.4 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
