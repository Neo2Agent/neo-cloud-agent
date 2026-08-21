import type { ReactNode } from "react";

type Props = { text: string; className?: string };

export function MarkdownBody({ text, className }: Props) {
  return <div className={className ? `md ${className}` : "md"}>{renderBlocks(text)}</div>;
}

function renderBlocks(source: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      nodes.push(
        <pre key={key++} className="md-pre">
          <code data-lang={lang || undefined}>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const Tag = (`h${heading[1].length}` as "h1" | "h2" | "h3");
      nodes.push(
        <Tag key={key++} className="md-h">
          {renderInline(heading[2] ?? "")}
        </Tag>,
      );
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      nodes.push(
        <ul key={key++} className="md-list">
          {items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !/^```/.test(lines[i] ?? "") && !/^(#{1,3})\s+/.test(lines[i] ?? "") && !/^\s*[-*]\s+/.test(lines[i] ?? "")) {
      para.push(lines[i] ?? "");
      i += 1;
    }
    nodes.push(
      <p key={key++} className="md-p">
        {renderInline(para.join(" "))}
      </p>,
    );
  }
  return nodes;
}

function renderInline(source: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(source))) {
    if (match.index > last) {
      nodes.push(source.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = link?.[2] ?? "";
      if (/^https?:\/\//i.test(href) || href.startsWith("/")) {
        nodes.push(
          <a key={key++} href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="noreferrer">
            {link?.[1]}
          </a>,
        );
      } else {
        nodes.push(link?.[1] ?? token);
      }
    }
    last = match.index + token.length;
  }
  if (last < source.length) {
    nodes.push(source.slice(last));
  }
  return nodes;
}
