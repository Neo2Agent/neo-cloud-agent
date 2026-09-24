import { useCallback, useEffect, useMemo, useState } from "react";
import {
  feedbackFollowUpText,
  foldUnmodifiedLines,
  groupCommitsByDay,
  parseHunkLines,
  splitPatchByFile,
  type GitFileChange,
  type HunkLine,
  type PullRequestFeedback,
  type RunCommitsResponse,
  type RunDiffResponse,
  type RunGitContext,
} from "@neo-cloud-agent/contracts/git";
import type { PullRequestRef, RunCommitRef } from "@neo-cloud-agent/contracts/run";
import { api, readJson } from "../api";
import { formatListWhen } from "../format";
import { IconBranch, IconCopy, IconRefresh } from "../icons";

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

function isGithubPr(pr: PullRequestRef | undefined): boolean {
  return Boolean(pr?.url && !pr.url.startsWith("local://") && /github\.com\//i.test(pr.url));
}

function prHref(pr: PullRequestRef | undefined): string | undefined {
  return isGithubPr(pr) ? pr!.url : undefined;
}

function compareHref(pr: PullRequestRef | undefined, branch: string | null, baseBranch: string | null): string | undefined {
  if (!isGithubPr(pr)) return undefined;
  const repo = pr!.url.replace(/\/pull\/\d+.*$/i, "");
  const head = pr?.branch || branch;
  const base = pr?.baseBranch || baseBranch;
  if (!head || !base) return undefined;
  return `${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
}

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

type HeadAction = { kind: "open-draft" | "ready" | "merge" | "merged" | "closed"; label: string; disabled?: boolean };

function headAction(pr: PullRequestRef | undefined, context: Props["context"], canOpenPr: boolean): HeadAction | null {
  if (context !== "cloud") return null;
  if (canOpenPr) return { kind: "open-draft", label: "开草稿 PR" };
  if (!isGithubPr(pr) || !pr) return null;
  if (pr.state === "merged") return { kind: "merged", label: "Merged", disabled: true };
  if (pr.state === "closed") return { kind: "closed", label: "Closed", disabled: true };
  if (pr.draft) return { kind: "ready", label: "Mark as ready" };
  return { kind: "merge", label: "Squash and merge" };
}

function checkPassed(check: { status: string; conclusion: string | null }): boolean {
  return check.status === "completed" && (check.conclusion === "success" || check.conclusion === "neutral" || check.conclusion === "skipped");
}

function PrHeader({
  pr,
  branch,
  baseBranch,
  context,
  canOpenPr,
  onRefresh,
  refreshing,
  acting,
  actionError,
  onOpenPr,
  onReady,
  onMerge,
}: {
  pr: PullRequestRef | undefined;
  branch: string | null;
  baseBranch: string | null;
  context: Props["context"];
  canOpenPr: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  acting: boolean;
  actionError: string;
  onOpenPr?: () => void;
  onReady: () => void;
  onMerge: () => void;
}) {
  const badge = pr ? prBadge(pr) : null;
  const head = pr?.branch || branch;
  const base = pr?.baseBranch || baseBranch;
  const view = prHref(pr);
  const compare = compareHref(pr, branch, baseBranch);
  const action = headAction(pr, context, canOpenPr);
  const runAction = () => {
    if (!action || action.disabled) return;
    if (action.kind === "open-draft") onOpenPr?.();
    else if (action.kind === "ready") onReady();
    else if (action.kind === "merge") onMerge();
  };
  return (
    <header className="git-head">
      <div className="git-head-title">
        {pr ? (
          view ? (
            <a className="git-pr-title" href={view} target="_blank" rel="noreferrer">
              <span className="git-pr-name">{pr.title || "Pull request"}</span>
              {pr.number ? <span className="git-pr-number">#{pr.number}</span> : null}
            </a>
          ) : (
            <span className="git-pr-name">{pr.title || "Pull request"}</span>
          )
        ) : (
          <span className="git-pr-name is-muted">{context === "desk" ? "这台电脑上的改动" : "还没有 PR"}</span>
        )}
        <div className="git-head-actions">
          {view ? (
            <a className="quiet-btn git-view-pr" href={view} target="_blank" rel="noreferrer">
              View PR
            </a>
          ) : null}
          {action ? (
            <button
              type="button"
              className="quiet-btn primary git-head-cta"
              data-action={action.kind}
              disabled={acting || action.disabled}
              onClick={runAction}
            >
              {acting ? "…" : action.label}
            </button>
          ) : null}
          <details className="git-more">
            <summary aria-label="更多">…</summary>
            <button type="button" className="quiet-btn" disabled={refreshing} onClick={onRefresh}>
              <IconRefresh size={14} className={refreshing ? "spin" : undefined} />
              刷新
            </button>
          </details>
        </div>
      </div>
      <div className="git-head-meta">
        {badge ? <span className={`git-badge is-${badge.tone}`}>{badge.label}</span> : null}
        {head ? (
          compare ? (
            <a className="git-branch" href={compare} target="_blank" rel="noreferrer">
              <IconBranch size={13} />
              <code>{head}</code>
              {base ? (
                <>
                  <span aria-hidden="true">→</span>
                  <code>{base}</code>
                </>
              ) : null}
            </a>
          ) : (
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
          )
        ) : null}
      </div>
      {actionError ? <p className="setup err">{actionError}</p> : null}
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

function HunkRow({ line }: { line: HunkLine }) {
  return (
    <div className={`git-hunk-line is-${line.type}`}>
      <span className="git-gutter git-gutter-old">{line.oldLine ?? ""}</span>
      <span className="git-gutter git-gutter-new">{line.newLine ?? ""}</span>
      <span className="git-hunk-sign" aria-hidden="true">
        {line.type === "add" ? "+" : line.type === "del" ? "-" : line.type === "hunk" ? "" : " "}
      </span>
      <span className="git-hunk-text">{line.text || " "}</span>
    </div>
  );
}

function HunkPreview({ lines }: { lines: HunkLine[] }) {
  const folded = useMemo(() => foldUnmodifiedLines(lines), [lines]);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  return (
    <>
      {folded.map((item) => {
        if (item.kind === "line") {
          return <HunkRow key={`${item.line.type}:${item.line.oldLine ?? ""}:${item.line.newLine ?? ""}:${item.line.text}`} line={item.line} />;
        }
        if (open[item.id]) {
          return item.hidden.map((line, index) => <HunkRow key={`open:${item.id}:${index}`} line={line} />);
        }
        return (
          <button
            key={`fold:${item.id}`}
            type="button"
            className="git-hunk-fold"
            onClick={() => setOpen((prev) => ({ ...prev, [item.id]: true }))}
          >
            {item.count} unmodified lines
          </button>
        );
      })}
    </>
  );
}

function DiffView({
  diff,
  context,
  selectedPath,
  onSelect,
  committing,
  commitError,
  onCommit,
}: {
  diff: RunDiffResponse | null;
  context: Props["context"];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  committing: boolean;
  commitError: string;
  onCommit: (message: string) => void;
}) {
  const patches = useMemo(() => new Map(splitPatchByFile(diff?.patch ?? "").map((item) => [item.path, item.patch])), [diff?.patch]);
  const files = diff?.files ?? [];
  const selected = files.find((item) => item.path === selectedPath) ?? files[0];
  const lines = useMemo(() => parseHunkLines(patches.get(selected?.path ?? "") ?? ""), [patches, selected?.path]);
  const totals = files.reduce((sum, item) => ({ added: sum.added + item.added, removed: sum.removed + item.removed }), { added: 0, removed: 0 });
  const dirty = diff?.dirty === true;
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
              <HunkPreview lines={lines} />
            ) : (
              <p className="git-file-none">{diff?.truncated ? "这个文件的改动没有进预览（太大被截断）。" : "没有可预览的改动。"}</p>
            )}
          </div>
          {diff?.truncated ? <p className="git-note">改动太大，预览只显示了前一部分。</p> : null}
        </>
      )}
      {context === "cloud" && dirty ? (
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
          <textarea name="message" rows={2} placeholder="提交说明" disabled={committing} />
          <div className="git-commit-actions">
            <button type="submit" className="quiet-btn primary" disabled={committing}>
              {committing ? "提交中…" : "提交"}
            </button>
          </div>
          {commitError ? <p className="setup err">{commitError}</p> : null}
        </form>
      ) : context === "desk" ? (
        <p className="git-note git-commit-note">本机对话的改动在这台电脑上提交，这里只读。</p>
      ) : null}
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

function ChecksSummary({
  pr,
  checks,
}: {
  pr: PullRequestRef | undefined;
  checks: PullRequestFeedback["checks"];
}) {
  const counts = pr?.checks ?? { passed: 0, failed: 0, pending: 0 };
  const fromList = checks.length
    ? {
        passed: checks.filter((item) => checkPassed(item)).length,
        failed: checks.filter((item) => item.status === "completed" && !checkPassed(item)).length,
        pending: checks.filter((item) => item.status !== "completed").length,
      }
    : counts;
  const total = fromList.passed + fromList.failed + fromList.pending;
  if (total === 0 && checks.length === 0) return null;
  const title = fromList.failed
    ? `${fromList.failed} failing`
    : fromList.pending
      ? `${fromList.pending} pending`
      : "All checks passing";
  return (
    <details className="git-checks-card" open>
      <summary>
        <span className={`git-check-dot ${fromList.failed ? "is-fail" : fromList.pending ? "is-pending" : "is-pass"}`} />
        {title}
      </summary>
      {fromList.passed ? <p className="git-check-count">{fromList.passed} passed</p> : null}
      {checks.length > 0 ? (
        <ul className="git-check-list">
          {checks.map((check) => (
            <li
              key={`${check.name}-${check.url}`}
              className={`is-${check.status !== "completed" ? "pending" : checkPassed(check) ? "pass" : "fail"}`}
            >
              <a href={check.url || undefined} target="_blank" rel="noreferrer">
                {check.name}
              </a>
              <span>{check.status !== "completed" ? check.status : check.conclusion}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

function ReviewView({
  pr,
  feedback,
  feedbackError,
  subscriptions,
  reviewState,
  acting,
  onReview,
  onReady,
  onHandOff,
}: {
  pr: PullRequestRef | undefined;
  feedback: PullRequestFeedback | null;
  feedbackError: string;
  subscriptions: RunSubscription[];
  reviewState: "idle" | "sending" | "sent" | "error";
  acting: boolean;
  onReview: () => void;
  onReady: () => void;
  onHandOff: (item: { author: string; body: string; path?: string | null; line?: number | null; url?: string }) => Promise<void>;
}) {
  const [handed, setHanded] = useState<Record<string, boolean>>({});
  const items = [
    ...(feedback?.reviews ?? []).map((item) => ({ key: `r${item.id}`, author: item.author, body: item.body, label: item.state, url: item.url, path: null, line: null })),
    ...(feedback?.comments ?? []).map((item) => ({ key: `c${item.id}`, author: item.author, body: item.body, label: item.path ? `${item.path}${item.line ? `:${item.line}` : ""}` : "评论", url: item.url, path: item.path, line: item.line })),
  ].filter((item) => item.body.trim());
  const github = isGithubPr(pr);
  return (
    <div className="git-review">
      <ChecksSummary pr={pr} checks={feedback?.checks ?? []} />
      {github && pr?.draft ? (
        <section className="git-draft-card">
          <div>
            <h4>Draft pull request</h4>
            <p>This pull request is still a work in progress.</p>
          </div>
          <button type="button" className="quiet-btn" disabled={acting} onClick={onReady}>
            Mark as ready
          </button>
        </section>
      ) : null}
      <section className="git-review-agent">
        <div>
          <h4>Find Issues</h4>
          <p className="hint">只审不改，结果会出现在对话里。</p>
        </div>
        <button type="button" className="quiet-btn" disabled={reviewState === "sending"} onClick={onReview}>
          {reviewState === "sending" ? "发送中…" : reviewState === "sent" ? "再审一次" : "Find Issues"}
        </button>
      </section>
      {reviewState === "sent" ? <p className="git-note">已发给 Agent，看对话里的回复。</p> : null}
      {reviewState === "error" ? <p className="setup err">发送审查失败</p> : null}
      {github && items.length > 0 ? (
        <details className="git-review-pr">
          <summary>评论 {items.length}</summary>
          {feedbackError ? <p className="setup err">{feedbackError}</p> : null}
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
        </details>
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
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [feedback, setFeedback] = useState<PullRequestFeedback | null>(null);
  const [feedbackError, setFeedbackError] = useState("");
  const [subscriptions, setSubscriptions] = useState<RunSubscription[]>([]);
  const [reviewState, setReviewState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const pr = diff?.pullRequests?.[0];
  const files = diff?.files ?? [];
  const resolvedPath = files.some((item) => item.path === selectedPath) ? selectedPath : (files[0]?.path ?? null);
  const canOpenPr = context === "cloud" && Boolean(onOpenPr) && !pr?.url;
  const reviewDot = Boolean(pr?.checks?.failed || feedback?.reviews.some((item) => item.state === "CHANGES_REQUESTED"));

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
    setActionError("");
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

  const writePr = async (path: "ready" | "merge") => {
    if (!pr?.number) return;
    setActing(true);
    setActionError("");
    try {
      const res = await api(token, `/v1/runs/${runId}/pull-requests/${pr.number}/${path}`, { method: "POST", body: "{}" });
      const body = await readJson<{ error?: string; pullRequest?: PullRequestRef }>(res);
      if (!res.ok || body.error) throw new Error(body.error || (path === "ready" ? "Mark as ready 失败" : "合并失败"));
      if (body.pullRequest) onPullRequests?.([body.pullRequest]);
      await load(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setActing(false);
    }
  };

  return (
    <section className="git-panel" id="run-git">
      <PrHeader
        pr={pr}
        branch={diff?.branch ?? null}
        baseBranch={diff?.baseBranch ?? null}
        context={context}
        canOpenPr={canOpenPr}
        refreshing={loading}
        acting={acting}
        actionError={actionError}
        onRefresh={() => void load(true)}
        onOpenPr={
          onOpenPr
            ? () => {
                setActing(true);
                setActionError("");
                void Promise.resolve(onOpenPr())
                  .then(() => load(true))
                  .catch((err) => setActionError(err instanceof Error ? err.message : "开 PR 失败"))
                  .finally(() => setActing(false));
              }
            : undefined
        }
        onReady={() => void writePr("ready")}
        onMerge={() => void writePr("merge")}
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
            {id === "review" && reviewDot ? <span className="git-tab-dot" aria-hidden="true" /> : null}
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
            onCommit={(message) => void commit(message)}
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
            acting={acting}
            onReady={() => void writePr("ready")}
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
