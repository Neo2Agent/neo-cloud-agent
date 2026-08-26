import type { ReactNode } from "react";

type IconProps = { size?: number };

function Svg({ size = 22, children }: IconProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function IconOverview(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7" height="9" rx="2" />
      <rect x="14" y="3" width="7" height="5" rx="2" />
      <rect x="14" y="12" width="7" height="9" rx="2" />
      <rect x="3" y="16" width="7" height="5" rx="2" />
    </Svg>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.6 19.2c.6-3 2.7-4.6 5.4-4.6s4.8 1.6 5.4 4.6" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M16.2 14.8c2.1.3 3.6 1.6 4.2 3.8" />
    </Svg>
  );
}

export function IconRuns(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 6h14M5 12h10M5 18h12" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconExperts(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="2.8" />
      <path d="M4.2 18.4c.6-2.8 2.4-4.4 4.8-4.4s4.2 1.6 4.8 4.4" />
      <path d="M16 7.2v5.2M13.4 9.8H18.6" />
    </Svg>
  );
}

export function IconSystem(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4.5v2.2M12 17.3V19.5M4.5 12h2.2M17.3 12H19.5M6.4 6.4l1.6 1.6M16 16l1.6 1.6M17.6 6.4 16 8M8 16l-1.6 1.6" />
    </Svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12a8 8 0 1 1-2.2-5.5" />
      <path d="M20 4v5h-5" />
    </Svg>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 7V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-1" />
      <path d="M4 12h10M11 9l3 3-3 3" />
    </Svg>
  );
}
