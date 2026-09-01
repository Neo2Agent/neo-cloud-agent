import {
  BookOpen,
  Bot,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  MessageSquarePlus,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Users,
  X,
  type LucideProps,
} from "lucide-react";

type IconProps = { size?: number; className?: string };

const stroke: Pick<LucideProps, "strokeWidth"> = { strokeWidth: 1.75 };

function icon(Icon: typeof Search, props: IconProps) {
  return <Icon {...stroke} size={props.size ?? 16} className={props.className} aria-hidden="true" />;
}

export function IconOverview(props: IconProps) {
  return icon(LayoutDashboard, props);
}

export function IconUsers(props: IconProps) {
  return icon(Users, props);
}

export function IconRuns(props: IconProps) {
  return icon(MessageSquare, props);
}

export function IconExperts(props: IconProps) {
  return icon(Bot, props);
}

export function IconMemories(props: IconProps) {
  return icon(BookOpen, props);
}

export function IconSystem(props: IconProps) {
  return icon(Settings, props);
}

export function IconRefresh(props: IconProps) {
  return icon(RefreshCw, props);
}

export function IconLogout(props: IconProps) {
  return icon(LogOut, props);
}

export function IconMenu(props: IconProps) {
  return icon(Menu, props);
}

export function IconSidebarClose(props: IconProps) {
  return icon(PanelLeftClose, props);
}

export function IconClose(props: IconProps) {
  return icon(X, props);
}

export function IconX(props: IconProps) {
  return icon(X, props);
}

export function IconSearch(props: IconProps) {
  return icon(Search, props);
}

export function IconPlus(props: IconProps) {
  return icon(Plus, props);
}

export function IconChevronLeft(props: IconProps) {
  return icon(ChevronLeft, props);
}

export function IconChevronRight(props: IconProps) {
  return icon(ChevronRight, props);
}

export function IconBack(props: IconProps) {
  return icon(ChevronLeft, props);
}

export function IconChatHome(props: IconProps) {
  return icon(MessageSquarePlus, props);
}
