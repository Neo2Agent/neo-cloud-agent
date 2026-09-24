import { useCallback, useEffect, useMemo, useState } from "react";
import {
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
import { IconBranch, IconCopy, IconMore } from "../icons";

export type GitView = "diff" | "review" | "commits";

type Props = {
  token: string;
  runId: string;
  context: Exclude<RunGitContext, "none">;
  /** Re-read everything when this changes, e.g. when a turn settles. */
  refreshKey: string;
  busy?: boolean;
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
  open: "打开",
  merged: "已合并",
  closed: "已关闭",
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
  if (pr.draft) return { label: "草稿", tone: "draft" };
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

type HeadAction = { kind: "ready" | "merge" | "merged" | "closed"; label: string; disabled?: boolean };

function headAction(pr: PullRequestRef | undefined, context: Props["context"]): HeadAction | null {
  if (context !== "cloud") return null;
  if (!isGithubPr(pr) || !pr) return null;
  if (pr.state === "merged") return { kind: "merged", label: "已合并", disabled: true };
  if (pr.state === "closed") return { kind: "closed", label: "已关闭", disabled: true };
  if (pr.draft) return { kind: "ready", label: "标为可合并" };
  return { kind: "merge", label: "压缩合并" };
}

function checkPassed(check: { status: string; conclusion: string | null }): boolean {
  return check.status === "completed" && (check.conclusion === "success" || check.conclusion === "neutral" || check.conclusion === "skipped");
}

function checkStatusLabel(check: { status: string; conclusion: string | null }): string {
  if (check.status !== "completed") {
    if (check.status === "in_progress" || check.status === "queued" || check.status === "pending") return "进行中";
    return check.status;
  }
  if (check.conclusion === "success") return "通过";
  if (check.conclusion === "failure") return "失败";
  if (check.conclusion === "neutral" || check.conclusion === "skipped") return "跳过";
  if (check.conclusion === "cancelled") return "已取消";
  return check.conclusion || "完成";
}

function PrHeader({
  pr,
  branch,
  baseBranch,
  context,
  onRefresh,
  refreshing,
  acting,
  actionError,
  onReady,
  onMerge,
}: {
  pr: PullRequestRef | undefined;
  branch: string | null;
  baseBranch: string | null;
  context: Props["context"];
  onRefresh: () => void;
  refreshing: boolean;
  acting: boolean;
  actionError: string;
  onReady: () => void;
  onMerge: () => void;
}) {
  const badge = pr ? prBadge(pr) : null;
  const head = pr?.branch || branch;
  const base = pr?.baseBranch || baseBranch;
  const view = prHref(pr);
  const compare = compareHref(pr, branch, baseBranch);
  const action = headAction(pr, context);
  const runAction = () => {
    if (!action || action.disabled) return;
    if (action.kind === "ready") onReady();
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
            <a className="git-btn is-ghost git-view-pr" href={view} target="_blank" rel="noreferrer">
              查看 PR
            </a>
          ) : null}
          {action ? (
            <button
              type="button"
              className={`git-btn git-head-cta${action.disabled ? " is-ghost" : " is-primary"}`}
              data-action={action.kind}
              disabled={acting || action.disabled}
              onClick={runAction}
            >
              {acting ? "…" : action.label}
            </button>
          ) : null}
          <details className="git-more">
            <summary className="icon-btn" aria-label="更多">
              <IconMore size={16} />
            </summary>
            <div className="inspector-more-pop">
              <button type="button" disabled={refreshing} onClick={onRefresh}>
                刷新
              </button>
            </div>
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
            {item.count} 行未改
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
        <div className="git-empty">
          <strong>{diff ? "没有改动" : "正在读取"}</strong>
          <p>{diff ? "工作区相对 HEAD 是干净的。" : "正在比对这个分支和底部分支。"}</p>
        </div>
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
            <button type="submit" className="git-btn is-primary" disabled={committing}>
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
  if (!commits) {
    return (
      <div className="git-empty">
        <strong>正在读取</strong>
        <p>正在拉这个分支上的提交。</p>
      </div>
    );
  }
  if (commits.commits.length === 0) {
    return (
      <div className="git-empty">
        <strong>还没有提交</strong>
        <p>这个分支上还没有记下提交。</p>
      </div>
    );
  }
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
    ? `${fromList.failed} 项失败`
    : fromList.pending
      ? `${fromList.pending} 项进行中`
      : "检查已通过";
  return (
    <details className="git-checks-card" open>
      <summary>
        <span className={`git-check-dot ${fromList.failed ? "is-fail" : fromList.pending ? "is-pending" : "is-pass"}`} />
        {title}
      </summary>
      {fromList.passed ? <p className="git-check-count">{fromList.passed} 项通过</p> : null}
      {checks.length > 0 ? (
        <ul className="git-check-list">
          {checks.map((check) => (
            <li
              key={`${check.name}-${check.url}`}
              className={`is-${check.status !== "completed" ? "pending" : checkPassed(check) ? "pass" : "fail"}`}
            >
              {check.url ? (
                <a className="git-check-name" href={check.url} target="_blank" rel="noreferrer">
                  {check.name}
                </a>
              ) : (
                <span className="git-check-name">{check.name}</span>
              )}
              <span className="git-check-status">{checkStatusLabel(check)}</span>
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
}: {
  pr: PullRequestRef | undefined;
  feedback: PullRequestFeedback | null;
  feedbackError: string;
}) {
  const checks = feedback?.checks ?? [];
  const counts = pr?.checks ?? { passed: 0, failed: 0, pending: 0 };
  const hasChecks = checks.length > 0 || counts.passed + counts.failed + counts.pending > 0;
  return (
    <div className="git-review">
      {feedbackError ? <p className="setup err">{feedbackError}</p> : null}
      {hasChecks ? (
        <ChecksSummary pr={pr} checks={checks} />
      ) : (
        <div className="git-empty">
          <strong>还没有检查</strong>
          <p>绑定 GitHub PR 之后，这里显示 CI / CD 结果。</p>
        </div>
      )}
    </div>
  );
}

export function GitPanel({ token, runId, context, refreshKey, busy = false, onPullRequests }: Props) {
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
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const pr = diff?.pullRequests?.[0];
  const files = diff?.files ?? [];
  const resolvedPath = files.some((item) => item.path === selectedPath) ? selectedPath : (files[0]?.path ?? null);
  const reviewDot = Boolean(pr?.checks?.failed);

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
    if (!pr?.number || pr.url.startsWith("local://")) return;
    setFeedbackError("");
    void api(token, `/v1/runs/${runId}/pull-requests/${pr.number}/feedback`)
      .then(async (res) => {
        const body = await readJson<PullRequestFeedback & { error?: string }>(res);
        if (!res.ok) throw new Error(body.error || "读取检查失败");
        setFeedback(body);
      })
      .catch((err) => setFeedbackError(err instanceof Error ? err.message : "读取检查失败"));
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

  const writePr = async (path: "ready" | "merge") => {
    if (!pr?.number) return;
    setActing(true);
    setActionError("");
    try {
      const res = await api(token, `/v1/runs/${runId}/pull-requests/${pr.number}/${path}`, { method: "POST", body: "{}" });
      const body = await readJson<{ error?: string; pullRequest?: PullRequestRef }>(res);
      if (!res.ok || body.error) throw new Error(body.error || (path === "ready" ? "标为可合并失败" : "合并失败"));
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
        refreshing={loading}
        acting={acting}
        actionError={actionError}
        onRefresh={() => void load(true)}
        onReady={() => void writePr("ready")}
        onMerge={() => void writePr("merge")}
      />
      <div className="git-tabs" role="tablist" aria-label="Git">
        {(
          [
            ["diff", "改动"],
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
          <ReviewView pr={pr} feedback={feedback} feedbackError={feedbackError} />
        )}
      </div>
    </section>
  );
}
