/**
 * The cloud surfaces the web chat page already has: personal memory, the inbox
 * bell and the skill catalog. Same `/v1` routes, redrawn for a narrow screen.
 */
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { artifactKindLabel, prettyBytes } from "@neo-cloud-agent/contracts/artifact";
import type { MemoryItem } from "@neo-cloud-agent/contracts/memory";
import type { PluginCatalogItem } from "@neo-cloud-agent/contracts/plugin";
import type { InboxItem } from "@neo-cloud-agent/contracts/project-message";
import type { RunArtifact } from "../api/client";
import {
  filterMemories,
  filterPlugins,
  inboxKindLabel,
  memoryHint,
  pluginActionLabel,
  sortInbox,
} from "../cloud";
import { Frame, frameStyles } from "./Frame";
import { IslandButton, IslandInput } from "./island";
import { colors } from "./theme";

export function MemoriesScreen(props: {
  items: MemoryItem[];
  configured: boolean;
  error: string;
  onBack: () => void;
  onAdd: (text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const visible = useMemo(() => filterMemories(props.items, query), [props.items, query]);
  return (
    <Frame title="记忆" onBack={props.onBack}>
      <Text style={frameStyles.hint}>
        {memoryHint({ configured: props.configured, count: props.items.length, error: props.error })}
      </Text>
      {props.configured ? (
        <>
          <IslandInput value={text} onChangeText={setText} placeholder="记一条，比如「测试用 pnpm test」" multiline />
          <IslandButton
            primary
            label={busy ? "保存中…" : "记一条"}
            disabled={busy || !text.trim()}
            onPress={() => {
              setBusy(true);
              void props.onAdd(text.trim()).then(() => setText("")).finally(() => setBusy(false));
            }}
          />
          {props.items.length > 0 ? (
            <IslandInput value={query} onChangeText={setQuery} placeholder="搜索记忆" />
          ) : null}
        </>
      ) : null}
      {visible.map((item) => (
        <View key={item.id} style={frameStyles.card}>
          <Text style={frameStyles.cardTitle}>{item.text}</Text>
          <View style={frameStyles.row}>
            <IslandButton label="删除" onPress={() => void props.onDelete(item.id)} />
          </View>
        </View>
      ))}
      {props.configured && props.items.length > 0 && visible.length === 0 ? (
        <Text style={frameStyles.empty}>没有匹配的记忆。</Text>
      ) : null}
    </Frame>
  );
}

export function InboxScreen(props: {
  items: InboxItem[];
  error: string;
  onBack: () => void;
  onOpen: (item: InboxItem) => void;
}) {
  const ordered = useMemo(() => sortInbox(props.items), [props.items]);
  return (
    <Frame title="消息" onBack={props.onBack}>
      <Text style={frameStyles.hint}>项目邀请、审批、转交和提到你的留言。</Text>
      {ordered.length === 0 ? <Text style={frameStyles.empty}>还没有消息。</Text> : null}
      {ordered.map((item) => (
        <Pressable
          key={item.id}
          style={[frameStyles.card, item.read ? null : styles.unread]}
          onPress={() => props.onOpen(item)}
        >
          <Text style={frameStyles.cardTitle}>{item.title}</Text>
          <Text style={frameStyles.hint}>
            {inboxKindLabel(item.kind)}
            {item.read ? "" : " · 未读"}
          </Text>
        </Pressable>
      ))}
      {props.error ? <Text style={frameStyles.error}>{props.error}</Text> : null}
    </Frame>
  );
}

export function SkillsScreen(props: {
  items: PluginCatalogItem[];
  error: string;
  onBack: () => void;
  onToggle: (item: PluginCatalogItem) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState("");
  const visible = useMemo(() => filterPlugins(props.items, query), [props.items, query]);
  return (
    <Frame title="技能" onBack={props.onBack}>
      <Text style={frameStyles.hint}>启用的技能会在开对话时装进工作区。</Text>
      <IslandInput value={query} onChangeText={setQuery} placeholder="搜索技能" />
      {visible.length === 0 ? <Text style={frameStyles.empty}>没有匹配的技能。</Text> : null}
      {visible.map((item) => (
        <View key={item.id} style={frameStyles.card}>
          <Text style={frameStyles.cardTitle}>{item.name}</Text>
          <Text style={frameStyles.hint}>{item.description}</Text>
          <View style={frameStyles.row}>
            <IslandButton
              primary={!item.enabled}
              label={busyId === item.id ? "处理中…" : pluginActionLabel(item)}
              disabled={busyId === item.id}
              onPress={() => {
                setBusyId(item.id);
                void props.onToggle(item).finally(() => setBusyId(""));
              }}
            />
            {item.installed ? <Text style={frameStyles.hint}>{item.enabled ? "已启用" : "已安装"}</Text> : null}
          </View>
        </View>
      ))}
      {props.error ? <Text style={frameStyles.error}>{props.error}</Text> : null}
    </Frame>
  );
}

export function ArtifactsScreen(props: {
  items: RunArtifact[];
  saveHint: string;
  error: string;
  onBack: () => void;
  onSave: (item: RunArtifact) => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  return (
    <Frame title="产物" onBack={props.onBack}>
      {props.saveHint ? <Text style={frameStyles.hint}>{props.saveHint}</Text> : null}
      {props.items.length === 0 ? <Text style={frameStyles.empty}>还没有产物。</Text> : null}
      {props.items.map((item) => (
        <View key={item.name} style={frameStyles.card}>
          <Text style={frameStyles.cardTitle}>{item.name}</Text>
          <Text style={frameStyles.hint}>
            {artifactKindLabel(item)}
            {typeof item.size === "number" ? ` · ${prettyBytes(item.size)}` : ""}
          </Text>
          {props.saveHint ? null : (
            <View style={frameStyles.row}>
              <IslandButton
                label={busy === item.name ? "保存中…" : "保存到项目"}
                disabled={busy === item.name}
                onPress={() => {
                  setBusy(item.name);
                  void props.onSave(item).finally(() => setBusy(""));
                }}
              />
            </View>
          )}
        </View>
      ))}
      {props.error ? <Text style={frameStyles.error}>{props.error}</Text> : null}
    </Frame>
  );
}

export function DiagnosticsScreen(props: {
  logs: Array<{ name: string; content: string }>;
  errorMessage: string | null;
  onBack: () => void;
}) {
  return (
    <Frame title="诊断" onBack={props.onBack}>
      {props.errorMessage ? <Text style={frameStyles.error}>{props.errorMessage}</Text> : null}
      {props.logs.length === 0 ? <Text style={frameStyles.empty}>还没有日志。</Text> : null}
      {props.logs.map((item) => (
        <View key={item.name} style={frameStyles.card}>
          <Text style={frameStyles.cardTitle}>{item.name}</Text>
          <Text style={styles.log}>{item.content.trim() || "（空）"}</Text>
        </View>
      ))}
    </Frame>
  );
}

const styles = StyleSheet.create({
  unread: { borderColor: colors.accent, borderWidth: 2 },
  log: { color: colors.muted, fontSize: 12, marginTop: 6 },
});
