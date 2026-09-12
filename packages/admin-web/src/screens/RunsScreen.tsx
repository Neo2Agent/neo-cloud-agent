import { useEffect, useMemo, useState } from "react";
import { api, readJson } from "../api";
import { clampPage, filterByQuery, filterRunsByTab, isLiveStatus, paginate, snippet } from "../catalog";
import { CatalogEmpty, CatalogList, CatalogPager, CatalogRow, CatalogTabs, CatalogToolbar } from "../components/Catalog";
import { TranscriptView } from "../components/TranscriptView";
import { formatTokens, formatWhen, slotLabel, sourceLabel, statusLabel, statusTone } from "../format";
import { IconBack } from "../icons";
import type { AdminRun, AdminRunDetail, TranscriptSnapshot } from "../types";

type Props = {
  token: string;
  runs: AdminRun[] | null;
  selectedId: string;
  tab: string;
  onTab: (tab: string) => void;
  onOpen: (id: string) => void;
  onBack: () => void;
};

function runTitle(item: Pick<AdminRun, "title" | "prompt">): string {
  return snippet(item.title || item.prompt, 56) || "未命名任务";
}

export function RunsScreen({ token, runs, selectedId, tab, onTab, onOpen, onBack }: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AdminRunDetail | null>(null);
  const [snapshot, setSnapshot] = useState<TranscriptSnapshot | null>(null);
  const [detailError, setDetailError] = useState("");
  const [transcriptError, setTranscriptError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);

  const list = runs ?? [];
  const activeTab = tab || "all";
  const scoped = filterRunsByTab(list, activeTab);
  const filtered = useMemo(
    () =>
      filterByQuery(scoped, query, (item) => [
        item.prompt,
        item.title,
        item.status,
        statusLabel(item.status),
        item.model,
        item.userId,
        item.userEmail,
        item.source,
        sourceLabel(item.source),
        item.errorMessage,
      ]),
    [query, scoped],
  );
  const listPage = clampPage(page, filtered.length);
  const visible = paginate(filtered, listPage);

  useEffect(() => {
    setPage(1);
  }, [query, activeTab]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setSnapshot(null);
      setDetailError("");
      setTranscriptError("");
      return;
    }
    const cached = list.find((item) => item.id === selectedId) ?? null;
    if (cached) setDetail(cached);
    setDetailLoading(true);
    setDetailError("");
    setTranscriptError("");
    void (async () => {
      const [runRes, transcriptRes] = await Promise.all([
        api(token, `/v1/admin/runs/${encodeURIComponent(selectedId)}`),
        api(token, `/v1/admin/runs/${encodeURIComponent(selectedId)}/transcript?limit=40`),
      ]);
      const runBody = await readJson<{ run?: AdminRunDetail; error?: string }>(runRes);
      if (!runRes.ok) throw new Error(runBody.error || "读取对话失败");
      if (runBody.run) setDetail(runBody.run);
      if (transcriptRes.ok) {
        const body = await readJson<{ snapshot?: TranscriptSnapshot }>(transcriptRes);
        setSnapshot(body.snapshot ?? null);
      } else {
        setTranscriptError("读取对话内容失败");
      }
    })()
      .catch((err) => setDetailError(err instanceof Error ? err.message : "读取对话失败"))
      .finally(() => setDetailLoading(false));
  }, [list, selectedId, token]);

  const loadOlder = () => {
    if (!selectedId || !snapshot?.nextBefore || olderLoading) return;
    setOlderLoading(true);
    void (async () => {
      const response = await api(
        token,
        `/v1/admin/runs/${encodeURIComponent(selectedId)}/transcript?limit=40&before=${encodeURIComponent(snapshot.nextBefore ?? "")}`,
      );
      const body = await readJson<{ snapshot?: TranscriptSnapshot; error?: string }>(response);
      if (!response.ok) throw new Error(body.error || "加载更早消息失败");
      const older = body.snapshot;
      if (!older) return;
      setSnapshot({
        ...older,
        messages: [...older.messages, ...snapshot.messages],
        remaining: older.remaining ?? 0,
        nextBefore: older.nextBefore ?? null,
        total: older.total ?? snapshot.total,
      });
    })()
      .catch((err) => setTranscriptError(err instanceof Error ? err.message : "加载更早消息失败"))
      .finally(() => setOlderLoading(false));
  };

  if (selectedId) {
    const item = detail;
    return (
      <section className="page catalog-page">
        <header className="page-head">
          <div>
            <button type="button" className="catalog-back" onClick={onBack}>
              <IconBack />
              全部对话
            </button>
            <h2>{item ? runTitle(item) : "对话详情"}</h2>
            <p className="hint">
              {item
                ? `${statusLabel(item.status)} · ${item.userEmail || item.userId} · ${item.model || "默认模型"}`
                : "正在读取这条对话。"}
            </p>
          </div>
        </header>
        {detailError ? <p className="banner">{detailError}</p> : null}
        {item ? (
          <section className="panel">
            <dl className="facts facts-wide">
              <div>
                <dt>状态</dt>
                <dd>{statusLabel(item.status)}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>{sourceLabel(item.source) || item.source || "对话"}</dd>
              </div>
              <div>
                <dt>用户</dt>
                <dd>{item.userEmail || item.userId}</dd>
              </div>
              <div>
                <dt>Token</dt>
                <dd>{item.usage?.totalTokens ? formatTokens(item.usage.totalTokens) : "—"}</dd>
              </div>
              <div>
                <dt>槽位</dt>
                <dd>{item.vmSlotId ? slotLabel(item.vmSlotId) : "未占用"}</dd>
              </div>
              <div>
                <dt>更新</dt>
                <dd>{formatWhen(item.updatedAt)}</dd>
              </div>
              {item.kernel ? (
                <div>
                  <dt>内核</dt>
                  <dd>{item.kernel}</dd>
                </div>
              ) : null}
              {item.branchName ? (
                <div>
                  <dt>分支</dt>
                  <dd>{item.branchName}</dd>
                </div>
              ) : null}
            </dl>
            {item.errorMessage ? <p className="banner">{item.errorMessage}</p> : null}
            {item.prompt ? <p className="body prompt-block">{item.prompt}</p> : null}
            {item.pullRequests && item.pullRequests.length > 0 ? (
              <ul className="link-list">
                {item.pullRequests.map((pr) => (
                  <li key={pr.url}>
                    <a href={pr.url} target="_blank" rel="noreferrer">
                      {pr.title || pr.url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : detailLoading ? (
          <div className="skeleton panel" />
        ) : null}
        <TranscriptView
          snapshot={snapshot}
          loading={detailLoading || olderLoading}
          error={transcriptError}
          onOlder={snapshot?.nextBefore ? loadOlder : undefined}
        />
      </section>
    );
  }

  if (runs === null) {
    return (
      <section className="page catalog-page">
        <div className="skeleton panel" />
        <div className="skeleton panel" />
      </section>
    );
  }

  return (
    <section className="page catalog-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">对话</p>
          <h2>全平台对话</h2>
          <p className="hint">按状态切开。点进一条看内容和占用。</p>
        </div>
        <p className="count-pill">{filtered.length} 条</p>
      </header>

      <CatalogTabs
        tabs={[
          { id: "live", label: "进行中", count: list.filter((item) => isLiveStatus(item.status)).length },
          { id: "idle", label: "空闲", count: list.filter((item) => item.status === "IDLE").length },
          { id: "error", label: "出错", count: list.filter((item) => item.status === "ERROR").length },
          { id: "archived", label: "已归档", count: list.filter((item) => item.status === "ARCHIVED" || item.status === "EXPIRED").length },
          { id: "all", label: "全部", count: list.length },
        ]}
        active={activeTab}
        onChange={onTab}
      />
      <CatalogToolbar search={query} onSearch={setQuery} placeholder="搜索提示、用户、状态或模型" />

      {filtered.length === 0 ? (
        <CatalogEmpty
          title={list.length === 0 ? "还没有对话" : "没有匹配的对话"}
          hint={list.length === 0 ? "用户开对话之后会出现在这里。" : "换个关键词或状态再试试。"}
        />
      ) : (
        <>
          <CatalogList>
            {visible.map((item) => (
              <CatalogRow
                key={item.id}
                title={runTitle(item)}
                badge={statusLabel(item.status)}
                badgeTone={statusTone(item.status)}
                description={[sourceLabel(item.source) || "对话", item.userEmail || item.userId, item.model]
                  .filter(Boolean)
                  .join(" · ")}
                meta={`${item.usage?.totalTokens ? `${formatTokens(item.usage.totalTokens)} tok · ` : ""}${formatWhen(item.updatedAt)}`}
                onOpen={() => onOpen(item.id)}
              />
            ))}
          </CatalogList>
          <CatalogPager page={listPage} total={filtered.length} onPage={setPage} />
        </>
      )}
    </section>
  );
}
