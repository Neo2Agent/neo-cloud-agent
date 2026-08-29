import { Container, File, FileCode, FileJson, FileText, Folder, FolderOpen, GitBranch, Settings2 } from "lucide-react";
import type { FileKind } from "../src/file-kind";

export function FileGlyph({ kind, open = false }: { kind: FileKind; open?: boolean }) {
  const props = { size: 14, strokeWidth: 2.15, className: `file-ico kind-${kind}`, "aria-hidden": true as const };
  if (kind === "dir") {
    return open ? <FolderOpen {...props} /> : <Folder {...props} />;
  }
  if (kind === "md") {
    return <FileText {...props} />;
  }
  if (kind === "json") {
    return <FileJson {...props} />;
  }
  if (kind === "ts") {
    return <FileCode {...props} />;
  }
  if (kind === "yml" || kind === "lock") {
    return <FileText {...props} />;
  }
  if (kind === "git") {
    return <GitBranch {...props} />;
  }
  if (kind === "env") {
    return <Settings2 {...props} />;
  }
  if (kind === "docker") {
    return <Container {...props} />;
  }
  return <File {...props} />;
}
