import type { ReactNode } from "react";

type IconProps = { size?: number; className?: string };

function Svg({ size = 16, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconNewChat(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 8v8M8 12h8" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  );
}

export function IconAutomations(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 8V5M9 13h.01M15 13h.01" />
    </Svg>
  );
}

export function IconCustomize(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Svg>
  );
}

export function IconCloud(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.3-1.8A3.5 3.5 0 0 0 7 18Z" />
    </Svg>
  );
}

export function IconPeople(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M4 19a5 5 0 0 1 10 0" />
      <circle cx="17" cy="9" r="2" />
      <path d="M16 19a4 4 0 0 0-1.2-2.8" />
    </Svg>
  );
}

export function IconGear(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
      <path d="M19 12a7 7 0 1 1-7-7" />
    </Svg>
  );
}

export function IconMic(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4" />
    </Svg>
  );
}

export function IconBack(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m14 6-6 6 6 6" />
    </Svg>
  );
}

export function IconForward(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m10 6 6 6-6 6" />
    </Svg>
  );
}

export function IconSort(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </Svg>
  );
}

export function IconAddRepo(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20V6a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M13 4v5h5M9 14h6M12 11v6" />
    </Svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
    </Svg>
  );
}

export function IconThumbsUp(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 11v9H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3Zm0 0 4-7a2 2 0 0 1 2 2v3h4.2a2 2 0 0 1 2 2.3l-1 6A2 2 0 0 1 17.3 20H8" />
    </Svg>
  );
}

export function IconThumbsDown(props: IconProps) {
  return (
    <Svg {...props} className={props.className}>
      <g transform="rotate(180 12 12)">
        <path d="M8 11v9H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3Zm0 0 4-7a2 2 0 0 1 2 2v3h4.2a2 2 0 0 1 2 2.3l-1 6A2 2 0 0 1 17.3 20H8" />
      </g>
    </Svg>
  );
}

export function IconChevron({ open, ...props }: IconProps & { open?: boolean }) {
  return (
    <Svg {...props} className={`${props.className ?? ""} chevron${open ? " open" : ""}`}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}

export function IconSync(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12a8 8 0 1 1-2.2-5.5" />
      <path d="M20 4v5h-5" />
    </Svg>
  );
}

export function IconSlack({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path fill="#E01E5A" d="M3.6 10.1a1.5 1.5 0 1 1-1.5-1.5h1.5z" />
      <path fill="#E01E5A" d="M4.3 10.1a1.5 1.5 0 1 1 3 0v3.8a1.5 1.5 0 1 1-3 0z" />
      <path fill="#36C5F0" d="M5.9 3.6a1.5 1.5 0 1 1 1.5-1.5v1.5z" />
      <path fill="#36C5F0" d="M5.9 4.3a1.5 1.5 0 1 1 0 3H2.1a1.5 1.5 0 0 1 0-3z" />
      <path fill="#2EB67D" d="M12.4 5.9a1.5 1.5 0 1 1 1.5 1.5h-1.5z" />
      <path fill="#2EB67D" d="M11.7 5.9a1.5 1.5 0 1 1-3 0V2.1a1.5 1.5 0 0 1 3 0z" />
      <path fill="#ECB22E" d="M10.1 12.4a1.5 1.5 0 1 1-1.5 1.5v-1.5z" />
      <path fill="#ECB22E" d="M10.1 11.7a1.5 1.5 0 1 1 0-3h3.8a1.5 1.5 0 0 1 0 3z" />
    </svg>
  );
}
