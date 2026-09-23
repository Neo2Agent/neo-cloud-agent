import { useCallback, useEffect, useMemo, useState } from "react";
import {
  feedbackFollowUpText,
  groupCommitsByDay,
  parseHunkLines,
  splitPatchByFile,
  type GitFileChange,
  type PullRequestFeedback,
  type RunCommitsResponse,
  type RunDiffResponse,
  type RunGitContext,
} from "@neo-cloud-agent/contracts/git";
import type { PullRequestRef, RunCommitRef } from "@neo-cloud-agent/contracts/run";
import { api, readJson } from "../api";
import { formatListWhen } from "../format";
import { IconBranch, IconCopy, IconPr, IconRefresh } from "../icons";

export type GitView = "diff" | "review" | "commits";

/** The slice of `RunSubscription` the review tab shows. */
type RunSubscription = { id: string; kind: string; repo: string; prNumber?: number | null };

type Props = {
  token: string;
  runId: string;
  context: Exclude<RunGitContext, "none">;
  /** Re-read everything when this changes, e.g. when a turn settles. */
  refreshKey: string;
  busy?: boolean;
  onOpenPr?: () => Promise<void> | void;
  onPullRequests?: (next: PullRequestRef[]) => void;
};

const STATUS_MARK: Record<GitFileChange["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

const PR_BADGE: Record<string, string> = {
  open: "Open",
  merged: "Merged",
  closed: "Closed",
};

/** While a turn runs, the diff moves with the agent. */
const LIVE_POLL_MS = 8_000;

function prBadge(pr: PullRequestRef): { label: string; tone: string } {
  if (pr.url.startsWith("local://")) return { label: "本地", tone: "local" };
  if (pr.state === "merged") return { label: PR_BADGE.merged!, tone: "merged" };
  if (pr.state === "closed") return { label: PR_BADGE.closed!, tone: "closed" };
  if (pr.draft) return { label: "Draft", tone: "draft" };
  return { label: PR_BADGE.open!, tone: "open" };
}

function fileNameParts(path: string): { dir: string; base: string } {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? { dir: path.slice(0, slash), base: path.slice(slash + 1) } : { dir: "", base: path };
}

function Stat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="git-stat">
      <span className="git-stat-add">+{added}</span>
      <span className="git-stat-del">-{removed}</span>
    </span>
  );
}

function PrHeader({
  pr,
  branch,
  baseBranch,
  context,
  onRefresh,
  refreshing,
}: {
  pr: PullRequestRef | undefined;
  branch: string | null;
  baseBranch: string | null;
  context: Props["context"];
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const badge = pr ? prBadge(pr) : null;
  const head = pr?.branch || branch;
  const base = pr?.baseBranch || baseBranch;
  return (
    <header className="git-head">
      <div className="git-head-title">
        {pr ? (
          <a className="git-pr-title" href={pr.url.startsWith("local://") ? undefined : pr.url} target="_blank" rel="noreferrer">
            <span className="git-pr-name">{pr.title || "Pull request"}</span>
            {pr.number ? <span className="git-pr-number">#{pr.number}</span> : null}
          </a>
        ) : (
          <span className="git-pr-name is-muted">{context === "desk" ? "这台电脑上的改动" : "还没有 PR"}</span>
        )}
        <button type="button" className="icon-btn git-refresh" aria-label="刷新" title="刷新" disabled={refreshing} onClick={onRefresh}>
          <IconRefresh size={14} className={refreshing ? "spin" : undefined} />
        </button>
      </div>
      <div className="git-head-meta">
        {badge ? <span className={`git-badge is-${badge.tone}`}>{badge.label}</span> : null}
        {head ? (
          <span className="git-branch">
            <IconBranch size={13} />
            <code>{head}</code>
            {base ? (
              <>
                <span aria-hidden="true">→</span>
                <code>{base}</code>
              </>
            ) : null}
          </span>
        ) : null}
        {pr?.checks ? (
          <span className="git-checks" title="CI 检查">
            {pr.checks.passed ? <span className="is-pass">✓ {pr.checks.passed}</span> : null}
            {pr.checks.failed ? <span className="is-fail">✕ {pr.checks.failed}</span> : null}
            {pr.checks.pending ? <span className="is-pending">● {pr.checks.pending}</span> : null}
          </span>
        ) : null}
      </div>
    </header>
  );
}

function FileLabel({ path, oldPath }: { path: string; oldPath?: string }) {
  const { dir, base } = fileNameParts(path);
  return (
    <span className="git-file-path" title={oldPath ? `${oldPath} → ${path}` : path}>
      <span className="git-file-base">{base}</span>
      {dir ? <span className="git-file-dir">{dir}</span> : null}
    </span>
  );
}

function DiffView({
  diff,
  context,
  selectedPath,
  onSelect,
  committing,
  commitError,
  opening,
  onCommit,
  onOpenPr,
}: {
  diff: RunDiffResponse | null;
  context: Props["context"];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  committing: boolean;
  commitError: string;
  opening: boolean;
  onCommit: (message: string) => void;
  onOpenPr?: () => void;
}) {
  const patches = useMemo(() => new Map(splitPatchByFile(diff?.patch ?? "").map((item) => [item.path, item.patch])), [diff?.patch]);
  const files = diff?.files ?? [];
  const selected = files.find((item) => item.path === selectedPath) ?? files[0];
  const lines = useMemo(() => parseHunkLines(patches.get(selected?.path ?? "") ?? ""), [patches, selected?.path]);
  const totals = files.reduce((sum, item) => ({ added: sum.added + item.added, removed: sum.removed + item.removed }), { added: 0, removed: 0 });
  return (
    <div className="git-diff">
      {diff?.source === "desk" && diff.capturedAt ? (
        <p className="git-note">来自这台电脑的快照 · {formatListWhen(diff.capturedAt)}前</p>
      ) : null}
      {context === "desk" && diff?.source === "none" ? <p className="git-note">正在等这台电脑上报改动。电脑离线时这里是空的。</p> : null}
      {files.length === 0 ? (
        <p className="git-empty">{diff ? "没有改动。" : "正在读取…"}</p>
      ) : (
        <>
          <p className="git-summary">
            {files.length} 个文件 <Stat {...totals} />
          </p>
          <ul className="git-files" role="listbox" aria-label="改动的文件">
            {files.map((file) => {
              const on = file.path === selected?.path;
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={on ? "git-file is-on" : "git-file"}
                    onClick={() => onSelect(file.path)}
                  >
                    <span className={`git-file-mark is-${file.status}`} title={file.status}>
                      {STATUS_MARK[file.status]}
                    </span>
                    <FileLabel path={file.path} oldPath={file.oldPath} />
                    {file.binary ? <span className="git-file-binary">二进制</span> : <Stat added={file.added} removed={file.removed} />}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="git-hunks" role="region" aria-label="文件改动">
            {selected?.binary ? (
              <p className="git-file-none">二进制文件不显示内容。</p>
            ) : lines.length > 0 ? (
              lines.map((line, index) => (
                <div key={`${line.type}:${line.oldLine ?? ""}:${line.newLine ?? ""}:${index}`} className={`git-hunk-line is-${line.type}`}>
                  <span className="git-gutter git-gutter-old">{line.oldLine ?? ""}</span>
                  <span className="git-gutter git-gutter-new">{line.newLine ?? ""}</span>
                  <span className="git-hunk-sign" aria-hidden="true">
                    {line.type === "add" ? "+" : line.type === "del" ? "-" : line.type === "hunk" ? "" : " "}
                  </span>
                  <span className="git-hunk-text">{line.text || " "}</span>
                </div>
              ))
            ) : (
              <p className="git-file-none">{diff?.truncated ? "这个文件的改动没有进预览（太大被截断）。" : "没有可预览的改动。"}</p>
            )}
          </div>
          {diff?.truncated ? <p className="git-note">改动太大，预览只显示了前一部分。</p> : null}
        </>
      )}
      {context === "cloud" ? (
        <form
          className="git-commit"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const message = String(data.get("message") ?? "").trim();
            if (message) {
              onCommit(message);
              event.currentTarget.reset();
            }
          }}
        >
          <textarea name="message" rows={2} placeholder="提交说明" disabled={committing || files.length === 0} />
          <div className="git-commit-actions">
            <button type="submit" className="quiet-btn primary" disabled={committing || files.length === 0}>
              {committing ? "提交中…" : "提交"}
            </button>
            {onOpenPr ? (
              <button type="button" className="quiet-btn git-open-pr" disabled={opening} onClick={onOpenPr}>
                <IconPr size={14} />
                {opening ? "正在开…" : "开草稿 PR"}
              </button>
            ) : null}
          </div>
          {commitError ? <p className="setup err">{commitError}</p> : null}
        </form>
      ) : (
        <p className="git-note git-commit-note">本机对话的改动在这台电脑上提交，这里只读。</p>
      )}
    </div>
  );
}

function CommitRow({ commit }: { commit: RunCommitRef }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="git-commit-row">
      <span className="git-commit-message" title={commit.message}>
        {commit.message || "(无提交说明)"}
      </span>
      <span className="git-commit-meta">
        <span className="git-avatar" title={commit.author}>
          {(commit.author || "?").slice(0, 2).toUpperCase()}
        </span>
        <button
          type="button"
          className="git-sha"
          title="复制完整 sha"
          onClick={() => {
            void navigator.clipboard?.writeText(commit.sha).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {commit.sha.slice(0, 7)}
          <IconCopy size={11} />
        </button>
        {copied ? <span className="git-copied">已复制</span> : null}
        <Stat added={commit.added} removed={commit.removed} />
        <span>{commit.files} 个文件</span>
        <span className="git-commit-when">{formatListWhen(commit.authoredAt)}</span>
      </span>
    </li>
  );
}

function CommitsView({ commits }: { commits: RunCommitsResponse | null }) {
  if (!commits) return <p className="git-empty">正在读取…</p>;
  if (commits.commits.length === 0) return <p className="git-empty">这个分支还没有提交。</p>;
  return (
    <div className="git-commits">
      {commits.source === "recorded" ? <p className="git-note">工作区已回收，这里是提交时记下的记录。</p> : null}
      {groupCommitsByDay(commits.commits).map((group) => (
        <section key={group.day} className="git-day">
          <h4>{group.day}的提交</h4>
          <ul>
            {group.commits.map((commit) => (
              <CommitRow key={commit.sha} commit={commit} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ReviewView({
  pr,
  feedback,
  feedbackError,
  subscriptions,
  reviewState,
  onReview,
  onHandOff,
}: {
  pr: PullRequestRef | undefined;
  feedback: PullRequestFeedback | null;
  feedbackError: string;
  subscriptions: RunSubscription[];
  reviewState: "idle" | "sending" | "sent" | "error";
  onReview: () => void;
  onHandOff: (item: { author: string; body: string; path?: string | null; line?: number | null; url?: string }) => Promise<void>;
}) {
  const [handed, setHanded] = useState<Record<string, boolean>>({});
  const items = [
    ...(feedback?.reviews ?? []).map((item) => ({ key: `r${item.id}`, author: item.author, body: item.body, label: item.state, url: item.url, path: null, line: null })),
    ...(feedback?.comments ?? []).map((item) => ({ key: `c${item.id}`, author: item.author, body: item.body, label: item.path ? `${item.path}${item.line ? `:${item.line}` : ""}` : "评论", url: item.url, path: item.path, line: item.line })),
  ].filter((item) => item.body.trim());
  return (
    <div className="git-review">
      <section className="git-review-agent">
        <div>
          <h4>Find Issues</h4>
          <p className="hint">只审不改，结果会出现在对话里。</p>
        </div>
        <button type="button" className="quiet-btn primary" disabled={reviewState === "sending"} onClick={onReview}>
          {reviewState === "sending" ? "发送中…" : reviewState === "sent" ? "再审一次" : "Find Issues"}
        </button>
      </section>
      {reviewState === "sent" ? <p className="git-note">已发给 Agent，看对话里的回复。</p> : null}
      {reviewState === "error" ? <p className="setup err">发送审查失败</p> : null}
      {pr && !pr.url.startsWith("local://") ? (
        <section className="git-review-pr">
          <h4>PR 讨论</h4>
          {feedbackError ? <p className="setup err">{feedbackError}</p> : null}
          {!feedback && !feedbackError ? <p className="git-empty">正在读取…</p> : null}
          {feedback && items.length === 0 ? <p className="git-empty">PR 上还没有评论。</p> : null}
          <ul className="git-feedback">
            {items.map((item) => (
              <li key={item.key}>
                <p className="git-feedback-head">
                  <b>{item.author || "someone"}</b>
                  <span>{item.label}</span>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      在 GitHub 查看
                    </a>
                  ) : null}
                </p>
                <p className="git-feedback-body">{item.body}</p>
                <button
                  type="button"
                  className="quiet-btn"
                  disabled={handed[item.key]}
                  onClick={() => {
                    void onHandOff(item).then(() => setHanded((prev) => ({ ...prev, [item.key]: true })));
                  }}
                >
                  {handed[item.key] ? "已交给 Agent" : "交给 Agent 处理"}
                </button>
              </li>
            ))}
          </ul>
          {feedback && feedback.checks.length > 0 ? (
            <>
              <h4>CI 检查</h4>
              <ul className="git-check-list">
                {feedback.checks.map((check) => (
                  <li key={`${check.name}-${check.url}`} className={`is-${check.status !== "completed" ? "pending" : check.conclusion === "success" || check.conclusion === "neutral" || check.conclusion === "skipped" ? "pass" : "fail"}`}>
                    <a href={check.url || undefined} target="_blank" rel="noreferrer">
                      {check.name}
                    </a>
                    <span>{check.status !== "completed" ? check.status : check.conclusion}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
      {subscriptions.length > 0 ? (
        <section className="git-review-subs">
          <h4>正在等</h4>
          <ul>
            {subscriptions.map((item) => (
              <li key={item.id}>
                {item.kind === "github_ci" ? "CI 结果" : "PR 评论"} · {item.repo}
                {item.prNumber ? ` #${item.prNumber}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function GitPanel({ token, runId, context, refreshKey, busy = false, onOpenPr, onPullRequests }: Props) {
  const [view, setView] = useState<GitView>("diff");
  const [diff, setDiff] = useState<RunDiffResponse | null>(null);
  const [commits, setCommits] = useState<RunCommitsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState("");
  const [opening, setOpening] = useState(false);
  const [feedback, setFeedback] = useState<PullRequestFeedback | null>(null);
  const [feedbackError, setFeedbackError] = useState("");
  const [subscriptions, setSubscriptions] = useState<RunSubscription[]>([]);
  const [reviewState, setReviewState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const pr = diff?.pullRequests?.[0];
  const files = diff?.files ?? [];
  const resolvedPath = files.some((item) => item.path === selectedPath) ? selectedPath : (files[0]?.path ?? null);

  const load = useCallback(
    async (refreshPr: boolean) => {
      setLoading(true);
      setError("");
      try {
        const [diffRes, commitsRes] = await Promise.all([
          api(token, `/v1/runs/${runId}/diff`),
          api(token, `/v1/runs/${runId}/commits`),
        ]);
        const nextDiff = await readJson<RunDiffResponse & { error?: string }>(diffRes);
        if (!diffRes.ok) throw new Error(nextDiff.error || "读取改动失败");
        const nextCommits = await readJson<RunCommitsResponse & { error?: string }>(commitsRes);
        if (refreshPr && nextDiff.pullRequests?.length) {
          const prRes = await api(token, `/v1/runs/${runId}/pull-requests?refresh=1`);
          const prBody = await readJson<{ pullRequests?: PullRequestRef[] }>(prRes);
          if (prRes.ok && prBody.pullRequests) {
            nextDiff.pullRequests = prBody.pullRequests;
            onPullRequests?.(prBody.pullRequests);
          }
        }
        setDiff(nextDiff);
        setCommits(commitsRes.ok ? nextCommits : { commits: [], source: "none" });
      } catch (err) {
        setError(err instanceof Error ? err.message : "读取改动失败");
      } finally {
        setLoading(false);
      }
    },
    [onPullRequests, runId, token],
  );

  useEffect(() => {
    setDiff(null);
    setCommits(null);
    setFeedback(null);
    setReviewState("idle");
    setSelectedPath(null);
  }, [runId]);

  useEffect(() => {
    void load(true);
  }, [load, refreshKey]);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void load(false), LIVE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [busy, load]);

  useEffect(() => {
    if (view !== "review") return;
    void api(token, `/v1/runs/${runId}/subscriptions`)
      .then((res) => readJson<{ subscriptions?: RunSubscription[] }>(res))
      .then((body) => setSubscriptions(body.subscriptions ?? []))
      .catch(() => setSubscriptions([]));
    if (!pr?.number || pr.url.startsWith("local://")) return;
    setFeedbackError("");
    void api(token, `/v1/runs/${runId}/pull-requests/${pr.number}/feedback`)
      .then(async (res) => {
        const body = await readJson<PullRequestFeedback & { error?: string }>(res);
        if (!res.ok) throw new Error(body.error || "读取 PR 讨论失败");
        setFeedback(body);
      })
      .catch((err) => setFeedbackError(err instanceof Error ? err.message : "读取 PR 讨论失败"));
  }, [pr?.number, pr?.url, runId, token, view]);

  const commit = async (message: string) => {
    setCommitting(true);
    setCommitError("");
    try {
      const body = await readJson<{ error?: string }>(
        await api(token, `/v1/runs/${runId}/commit`, { method: "POST", body: JSON.stringify({ message }) }),
      );
      if (body.error) throw new Error(body.error);
      await load(false);
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setCommitting(false);
    }
  };

  const followUp = async (text: string) => {
    const res = await api(token, `/v1/runs/${runId}/follow-ups`, {
      method: "POST",
      body: JSON.stringify({ text, delivery: "follow_up" }),
    });
    if (!res.ok) throw new Error("发送失败");
  };

  return (
    <section className="git-panel" id="run-git">
      <PrHeader
        pr={pr}
        branch={diff?.branch ?? null}
        baseBranch={diff?.baseBranch ?? null}
        context={context}
        refreshing={loading}
        onRefresh={() => void load(true)}
      />
      <div className="git-tabs" role="tablist" aria-label="Git">
        {(
          [
            ["diff", "Diff"],
            ["review", "审查"],
            ["commits", "提交"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? "is-on" : ""} onClick={() => setView(id)}>
            {label}
            {id === "commits" && commits?.commits.length ? <span className="git-tab-count">{commits.commits.length}</span> : null}
          </button>
        ))}
      </div>
      <div className="git-body">
        {error ? <p className="setup err">{error}</p> : null}
        {view === "diff" ? (
          <DiffView
            diff={diff}
            context={context}
            selectedPath={resolvedPath}
            onSelect={setSelectedPath}
            committing={committing}
            commitError={commitError}
            opening={opening}
            onCommit={(message) => void commit(message)}
            onOpenPr={
              onOpenPr
                ? () => {
                    setOpening(true);
                    void Promise.resolve(onOpenPr())
                      .then(() => load(false))
                      .finally(() => setOpening(false));
                  }
                : undefined
            }
          />
        ) : view === "commits" ? (
          <CommitsView commits={commits} />
        ) : (
          <ReviewView
            pr={pr}
            feedback={feedback}
            feedbackError={feedbackError}
            subscriptions={subscriptions}
            reviewState={reviewState}
            onReview={() => {
              setReviewState("sending");
              void api(token, `/v1/runs/${runId}/review`, { method: "POST", body: "{}" })
                .then((res) => setReviewState(res.ok ? "sent" : "error"))
                .catch(() => setReviewState("error"));
            }}
            onHandOff={(item) => followUp(feedbackFollowUpText({ number: pr?.number ?? 0, ...item }))}
          />
        )}
      </div>
    </section>
  );
}
