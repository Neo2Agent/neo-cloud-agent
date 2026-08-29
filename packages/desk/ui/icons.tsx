import {
  ArrowUp,
  Bell,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Cloud,
  Copy,
  File,
  FilePlus,
  FolderMinus,
  LayoutGrid,
  LogOut,
  Maximize2,
  ListFilter,
  Monitor,
  PanelRight,
  RefreshCw,
  Search,
  Settings,
  Square,
  SquarePlus,
  SquareTerminal,
  ThumbsDown,
  ThumbsUp,
  Users,
  UsersRound,
  X,
  type LucideProps,
} from "lucide-react";

type IconProps = { size?: number; className?: string };

const stroke: Pick<LucideProps, "strokeWidth" | "strokeLinecap" | "strokeLinejoin"> = {
  strokeWidth: 2.15,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function icon(Icon: typeof Search, props: IconProps) {
  return <Icon {...stroke} size={props.size ?? 16} className={props.className} aria-hidden="true" />;
}

export function IconNewChat(props: IconProps) {
  return icon(SquarePlus, props);
}

export function IconPlus(props: IconProps) {
  return icon(CirclePlus, props);
}

export function IconSearch(props: IconProps) {
  return icon(Search, props);
}

export function IconAutomations(props: IconProps) {
  return icon(Bot, props);
}

export function IconProjects(props: IconProps) {
  return icon(LayoutGrid, props);
}

export function IconExperts(props: IconProps) {
  return icon(Users, props);
}

export function IconCloud(props: IconProps) {
  return icon(Cloud, props);
}

export function IconComputer(props: IconProps) {
  return icon(Monitor, props);
}

export function IconPeople(props: IconProps) {
  return icon(UsersRound, props);
}

export function IconGear(props: IconProps) {
  return icon(Settings, props);
}

export function IconBell(props: IconProps) {
  return icon(Bell, props);
}

export function IconLogOut(props: IconProps) {
  return icon(LogOut, props);
}

export function IconArrowUp(props: IconProps) {
  return icon(ArrowUp, props);
}

export function IconStop(props: IconProps) {
  return <Square size={props.size ?? 14} className={props.className} fill="currentColor" strokeWidth={0} aria-hidden="true" />;
}

export function IconBack(props: IconProps) {
  return icon(ChevronLeft, props);
}

export function IconForward(props: IconProps) {
  return icon(ChevronRight, props);
}

export function IconSort(props: IconProps) {
  return icon(ListFilter, props);
}

export function IconAddRepo(props: IconProps) {
  return icon(FilePlus, props);
}

export function IconUnbindFolder(props: IconProps) {
  return icon(FolderMinus, props);
}

export function IconCopy(props: IconProps) {
  return icon(Copy, props);
}

export function IconThumbsUp(props: IconProps) {
  return icon(ThumbsUp, props);
}

export function IconThumbsDown(props: IconProps) {
  return icon(ThumbsDown, props);
}

export function IconChevron({ open, className, ...props }: IconProps & { open?: boolean }) {
  return (
    <ChevronRight
      {...stroke}
      size={props.size ?? 16}
      className={`${className ?? ""} chevron${open ? " open" : ""}`.trim()}
      aria-hidden="true"
    />
  );
}

export function IconChevronDown(props: IconProps) {
  return icon(ChevronDown, props);
}

export function IconSync(props: IconProps) {
  return icon(RefreshCw, props);
}

export function IconClose(props: IconProps) {
  return icon(X, props);
}

/** Panel toggle, same idea as the Agents Window right-sidebar button. */
export function IconPanelRight(props: IconProps) {
  return icon(PanelRight, props);
}

/** Codex pane-bar dock: square with a chevron pointing at the right rail. */
export function IconRailDock(props: IconProps) {
  const size = props.size ?? 16;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={props.className}
      aria-hidden="true"
    >
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" stroke="currentColor" strokeWidth="2.15" />
      <path d="M11.25 3.2v9.6" stroke="currentColor" strokeWidth="2.15" />
      <path
        d="M5.1 8h4.1m0 0L7.7 6.55M9.2 8 7.7 9.45"
        stroke="currentColor"
        strokeWidth="2.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconTerminal(props: IconProps) {
  return icon(SquareTerminal, props);
}

export function IconFile(props: IconProps) {
  return icon(File, props);
}

export function IconExpand(props: IconProps) {
  return icon(Maximize2, props);
}
