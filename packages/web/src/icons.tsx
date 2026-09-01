import {
  Archive,
  ArrowUp,
  Bell,
  BookOpen,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Cloud,
  Download,
  File,
  FileBraces,
  FileCode,
  FileImage,
  FilePen,
  FileText,
  FolderGit2,
  GitPullRequest,
  Globe,
  LayoutGrid,
  LoaderCircle,
  Menu,
  Mic,
  MessageSquare,
  MoreHorizontal,
  Monitor,
  Package,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  Plus,
  Puzzle,
  Search,
  Settings,
  Square,
  SquarePlus,
  Star,
  TerminalSquare,
  Timer,
  Trash2,
  Users,
  Wrench,
  X,
  type LucideProps,
} from "lucide-react";
import type { ArtifactKind } from "./artifact.js";

type IconProps = { size?: number; className?: string };

const stroke: Pick<LucideProps, "strokeWidth"> = { strokeWidth: 1.75 };

function icon(Icon: typeof Search, props: IconProps) {
  return <Icon {...stroke} size={props.size ?? 16} className={props.className} aria-hidden="true" />;
}

export function IconNewChat(props: IconProps) {
  return icon(SquarePlus, props);
}

export function IconMenu(props: IconProps) {
  return icon(Menu, props);
}

export function IconSidebarOpen(props: IconProps) {
  return icon(PanelLeft, props);
}

export function IconSidebarClose(props: IconProps) {
  return icon(PanelLeftClose, props);
}

export function IconChat(props: IconProps) {
  return icon(MessageSquare, props);
}

export function IconProjects(props: IconProps) {
  return icon(LayoutGrid, props);
}

export function IconExperts(props: IconProps) {
  return icon(Users, props);
}

export function IconSkills(props: IconProps) {
  return icon(BookOpen, props);
}

export function IconAutomations(props: IconProps) {
  return icon(Timer, props);
}

export function IconGear(props: IconProps) {
  return icon(Settings, props);
}

export function IconArrowUp(props: IconProps) {
  return icon(ArrowUp, props);
}

export function IconMic(props: IconProps) {
  return icon(Mic, props);
}

export function IconStop(props: IconProps) {
  return <Square size={props.size ?? 10} className={props.className} fill="currentColor" strokeWidth={0} aria-hidden="true" />;
}

export function IconClose(props: IconProps) {
  return icon(X, props);
}

export function IconX(props: IconProps) {
  return icon(X, props);
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

export function IconStar(props: IconProps) {
  return icon(Star, props);
}

export function IconDiff(props: IconProps) {
  return icon(FileCode, props);
}

export function IconTerminal(props: IconProps) {
  return icon(TerminalSquare, props);
}

export function IconArtifacts(props: IconProps) {
  return icon(Package, props);
}

export function IconFiles(props: IconProps) {
  return icon(FolderGit2, props);
}

export function IconPanelRight(props: IconProps) {
  return icon(PanelRight, props);
}

export function IconCheck(props: IconProps) {
  return icon(Check, props);
}

export function IconError(props: IconProps) {
  return icon(CircleAlert, props);
}

export function IconSpinner(props: IconProps) {
  return <LoaderCircle size={props.size ?? 14} className={`spin ${props.className ?? ""}`.trim()} strokeWidth={1.75} aria-hidden="true" />;
}

export function IconCloud(props: IconProps) {
  return icon(Cloud, props);
}

export function IconComputer(props: IconProps) {
  return icon(Monitor, props);
}

export function IconSearch(props: IconProps) {
  return icon(Search, props);
}

export function IconArchive(props: IconProps) {
  return icon(Archive, props);
}

export function IconTrash(props: IconProps) {
  return icon(Trash2, props);
}

export function IconDownload(props: IconProps) {
  return icon(Download, props);
}

export function IconFileKind({ kind, ...props }: IconProps & { kind: ArtifactKind }) {
  if (kind === "html") return icon(FileCode, props);
  if (kind === "image") return icon(FileImage, props);
  if (kind === "json") return icon(FileBraces, props);
  if (kind === "markdown" || kind === "text") return icon(FileText, props);
  return icon(File, props);
}

export function IconInbox(props: IconProps) {
  return icon(Bell, props);
}

export function IconMemory(props: IconProps) {
  return icon(BookOpen, props);
}

export function IconMore(props: IconProps) {
  return icon(MoreHorizontal, props);
}

export function IconPr(props: IconProps) {
  return icon(GitPullRequest, props);
}

export function IconBack(props: IconProps) {
  return icon(ChevronLeft, props);
}

function toolGlyph(name: string) {
  if (name === "neo_subagent" || name.includes("subagent")) return Bot;
  if (name.startsWith("neo_git") || name === "git" || name === "commit") return FolderGit2;
  if (name.startsWith("neo_pr") || name.includes("pull_request")) return GitPullRequest;
  if (name.startsWith("neo_browse") || name.includes("browse")) return Globe;
  if (name.startsWith("neo_mcp") || name.includes("mcp")) return Puzzle;
  if (name.startsWith("neo_artifact") || name.includes("artifact")) return Package;
  if (name.startsWith("neo_memory") || name.includes("memory")) return BookOpen;
  if (name === "bash" || name === "shell" || name.startsWith("neo_diag")) return TerminalSquare;
  if (name === "edit" || name === "write" || name === "apply_patch") return FilePen;
  if (name === "read" || name === "cat") return FileCode;
  return Wrench;
}

export function IconTool({ name, ...props }: IconProps & { name: string }) {
  return icon(toolGlyph(name), props);
}
