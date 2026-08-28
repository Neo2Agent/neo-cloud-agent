import {
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Cloud,
  Copy,
  FilePlus,
  LayoutGrid,
  ListFilter,
  Monitor,
  PanelRight,
  RefreshCw,
  Search,
  Settings,
  Square,
  SquarePlus,
  ThumbsDown,
  ThumbsUp,
  Users,
  UsersRound,
  X,
  type LucideProps,
} from "lucide-react";

type IconProps = { size?: number; className?: string };

const stroke: Pick<LucideProps, "strokeWidth"> = { strokeWidth: 1.75 };

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
