import { StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";

/** Same subset as packages/ui MarkdownBody, rendered with RN Text. */
export function MarkdownNative({ text }: { text: string }) {
  return <View style={styles.md}>{renderBlocks(text)}</View>;
}

function renderBlocks(source: string) {
  const nodes = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (/^```/.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      nodes.push(
        <Text key={key++} style={styles.pre} selectable>
          {body.join("\n")}
        </Text>,
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      nodes.push(
        <Text key={key++} style={styles.h} selectable>
          {renderInline(heading[2] ?? "")}
        </Text>,
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
        <View key={key++} style={styles.list}>
          {items.map((item, index) => (
            <Text key={index} style={styles.body} selectable>
              • {renderInline(item)}
            </Text>
          ))}
        </View>,
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
      <Text key={key++} style={styles.body} selectable>
        {renderInline(para.join(" "))}
      </Text>,
    );
  }
  return nodes;
}

function renderInline(source: string) {
  const nodes = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(source))) {
    if (match.index > last) nodes.push(source.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <Text key={key++} style={styles.bold}>
          {token.slice(2, -2)}
        </Text>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <Text key={key++} style={styles.code}>
          {token.slice(1, -1)}
        </Text>,
      );
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      nodes.push(
        <Text key={key++} style={styles.link}>
          {link?.[1] ?? token}
        </Text>,
      );
    }
    last = match.index + token.length;
  }
  if (last < source.length) nodes.push(source.slice(last));
  return nodes;
}

const styles = StyleSheet.create({
  md: { gap: 8 },
  body: { color: colors.ink, fontSize: 16, lineHeight: 24 },
  h: { color: colors.ink, fontSize: 17, fontWeight: "700", lineHeight: 24 },
  pre: {
    color: colors.ink,
    fontFamily: "Menlo",
    fontSize: 13,
    lineHeight: 18,
    backgroundColor: colors.paper,
    padding: 8,
    borderRadius: 8,
  },
  list: { gap: 4 },
  bold: { fontWeight: "700", color: colors.ink },
  code: { fontFamily: "Menlo", fontSize: 13, backgroundColor: colors.paper, color: colors.ink },
  link: { color: colors.ink, textDecorationLine: "underline" },
});
