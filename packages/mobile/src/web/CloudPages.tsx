/**
 * Lab mirrors of the RN cloud screens. Same client and helpers, DOM markup.
 */
import { useMemo, useState } from "react";
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
import { Page } from "./chrome";
import { IslandButton, IslandInput } from "./island";

export function MemoriesPage(props: {
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
    <Page title="记忆" onBack={props.onBack}>
      <p className="hint">{memoryHint({ configured: props.configured, count: props.items.length, error: props.error })}</p>
      {props.configured ? (
        <>
          <IslandInput
            value={text}
            placeholder="记一条，比如「测试用 pnpm test」"
            onChange={(event) => setText(event.target.value)}
          />
          <IslandButton
            type="primary"
            disabled={busy || !text.trim()}
            onClick={() => {
              setBusy(true);
              void props.onAdd(text.trim()).then(() => setText("")).finally(() => setBusy(false));
            }}
          >
            {busy ? "保存中…" : "记一条"}
          </IslandButton>
          {props.items.length > 0 ? (
            <IslandInput value={query} placeholder="搜索记忆" onChange={(event) => setQuery(event.target.value)} />
          ) : null}
        </>
      ) : null}
      {visible.map((item) => (
        <div key={item.id} className="dash-card">
          <div>
            <strong>{item.text}</strong>
          </div>
          <IslandButton onClick={() => void props.onDelete(item.id)}>删除</IslandButton>
        </div>
      ))}
      {props.configured && props.items.length > 0 && visible.length === 0 ? (
        <p className="empty">没有匹配的记忆。</p>
      ) : null}
    </Page>
  );
}

export function InboxPage(props: {
  items: InboxItem[];
  error: string;
  onBack: () => void;
  onOpen: (item: InboxItem) => void;
}) {
  const ordered = useMemo(() => sortInbox(props.items), [props.items]);
  return (
    <Page title="消息" onBack={props.onBack}>
      <p className="hint">项目邀请、审批、转交和提到你的留言。</p>
      {ordered.length === 0 ? <p className="empty">还没有消息。</p> : null}
      {ordered.map((item) => (
        <button
          key={item.id}
          type="button"
          className={item.read ? "dash-card" : "dash-card is-unread"}
          onClick={() => props.onOpen(item)}
        >
          <div>
            <strong>{item.title}</strong>
            <p>
              {inboxKindLabel(item.kind)}
              {item.read ? "" : " · 未读"}
            </p>
          </div>
        </button>
      ))}
      {props.error ? <p className="error">{props.error}</p> : null}
    </Page>
  );
}

export function SkillsPage(props: {
  items: PluginCatalogItem[];
  error: string;
  onBack: () => void;
  onToggle: (item: PluginCatalogItem) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState("");
  const visible = useMemo(() => filterPlugins(props.items, query), [props.items, query]);
  return (
    <Page title="技能" onBack={props.onBack}>
      <p className="hint">启用的技能会在开对话时装进工作区。</p>
      <IslandInput value={query} placeholder="搜索技能" onChange={(event) => setQuery(event.target.value)} />
      {visible.length === 0 ? <p className="empty">没有匹配的技能。</p> : null}
      {visible.map((item) => (
        <div key={item.id} className="dash-card">
          <div>
            <strong>{item.name}</strong>
            <p>{item.description}</p>
          </div>
          <IslandButton
            type={item.enabled ? "button" : "primary"}
            disabled={busyId === item.id}
            onClick={() => {
              setBusyId(item.id);
              void props.onToggle(item).finally(() => setBusyId(""));
            }}
          >
            {busyId === item.id ? "处理中…" : pluginActionLabel(item)}
          </IslandButton>
        </div>
      ))}
      {props.error ? <p className="error">{props.error}</p> : null}
    </Page>
  );
}

export function ArtifactsPage(props: {
  items: RunArtifact[];
  saveHint: string;
  error: string;
  onBack: () => void;
  onSave: (item: RunArtifact) => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  return (
    <Page title="产物" onBack={props.onBack}>
      {props.saveHint ? <p className="hint">{props.saveHint}</p> : null}
      {props.items.length === 0 ? <p className="empty">还没有产物。</p> : null}
      {props.items.map((item) => (
        <div key={item.name} className="dash-card">
          <div>
            <strong>{item.name}</strong>
            <p>
              {artifactKindLabel(item)}
              {typeof item.size === "number" ? ` · ${prettyBytes(item.size)}` : ""}
            </p>
          </div>
          {props.saveHint ? null : (
            <IslandButton
              disabled={busy === item.name}
              onClick={() => {
                setBusy(item.name);
                void props.onSave(item).finally(() => setBusy(""));
              }}
            >
              {busy === item.name ? "保存中…" : "保存到项目"}
            </IslandButton>
          )}
        </div>
      ))}
      {props.error ? <p className="error">{props.error}</p> : null}
    </Page>
  );
}

export function DiagnosticsPage(props: {
  logs: Array<{ name: string; content: string }>;
  errorMessage: string | null;
  onBack: () => void;
}) {
  return (
    <Page title="诊断" onBack={props.onBack}>
      {props.errorMessage ? <p className="error">{props.errorMessage}</p> : null}
      {props.logs.length === 0 ? <p className="empty">还没有日志。</p> : null}
      {props.logs.map((item) => (
        <div key={item.name} className="dash-card">
          <div>
            <strong>{item.name}</strong>
            <pre className="tool-out">{item.content.trim() || "（空）"}</pre>
          </div>
        </div>
      ))}
    </Page>
  );
}
