import type { ExecutionTarget, PullRequestRef, RunCommitRef } from "./run.js";

/**
 * Which Git surface a run has.
 * `none`: a plain chat with no repo, so the panel has nothing to show.
 * `cloud`: the control plane holds the workspace (cloned or copied repo).
 * `desk`: files live on a laptop (This Computer or Remote Control); the Desk reports snapshots.
 */
export type RunGitContext = "none" | "cloud" | "desk";

export function runGitContext(run: {
  repoUrls?: string[] | null;
  branchName?: string | null;
  pullRequests?: PullRequestRef[] | null;
  executionTarget?: ExecutionTarget | null;
}): RunGitContext {
  const target = run.executionTarget;
  if (target?.tools === "desk" && target.deskId) return "desk";
  if (run.branchName || (run.repoUrls?.length ?? 0) > 0 || (run.pullRequests?.length ?? 0) > 0) return "cloud";
  return "none";
}

export type GitFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface GitFileChange {
  path: string;
  oldPath?: string;
  status: GitFileStatus;
  added: number;
  removed: number;
  binary?: boolean;
}

export type RunGitSource = "workspace" | "recorded" | "desk" | "none";

export interface RunDiffResponse {
  branch: string | null;
  baseBranch: string | null;
  pullRequests: PullRequestRef[];
  /** `git diff --stat` text, kept for the CLI. */
  stat: string;
  patch: string;
  files: GitFileChange[];
  truncated: boolean;
  source: RunGitSource;
  /** Desk snapshots only: when the laptop last reported. */
  capturedAt?: string | null;
}

export interface RunCommitsResponse {
  commits: RunCommitRef[];
  source: RunGitSource;
  capturedAt?: string | null;
}

/** What a Desk uploads for a run whose files are on that laptop. */
export interface DeskGitSnapshot {
  branch: string | null;
  baseBranch: string | null;
  stat: string;
  patch: string;
  files: GitFileChange[];
  truncated: boolean;
  commits: RunCommitRef[];
}

export interface PullRequestReview {
  id: number;
  author: string;
  state: string;
  body: string;
  url: string;
  submittedAt: string | null;
}

export interface PullRequestComment {
  id: number;
  author: string;
  body: string;
  /** Set for inline review comments. */
  path: string | null;
  line: number | null;
  url: string;
  createdAt: string | null;
}

export interface PullRequestCheck {
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
}

export interface PullRequestFeedback {
  number: number;
  reviews: PullRequestReview[];
  comments: PullRequestComment[];
  checks: PullRequestCheck[];
}

/** Follow-up text that hands one piece of PR feedback to the agent. */
export function feedbackFollowUpText(input: {
  number: number;
  author: string;
  body: string;
  path?: string | null;
  line?: number | null;
  url?: string;
}): string {
  const where = input.path ? `${input.path}${input.line ? `:${input.line}` : ""}` : `PR #${input.number}`;
  return [
    `请处理 PR #${input.number} 上 ${input.author || "审阅者"} 的反馈（${where}）：`,
    input.body.trim(),
    input.url ?? "",
    "改完后提交，并简要说明改了什么。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Hard cap on a patch body sent to a browser. */
export const GIT_PATCH_MAX_BYTES = 512 * 1024;
export const GIT_COMMITS_MAX = 100;
/** Git's empty tree: diff against it when a repo has no commits yet. */
export const GIT_EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** `git diff --numstat -z` is harder to read; the plain form with `{a => b}` rename arrows is enough here. */
export function parseNumstat(output: string): Map<string, { added: number; removed: number; binary: boolean }> {
  const out = new Map<string, { added: number; removed: number; binary: boolean }>();
  for (const line of output.split("\n")) {
    const match = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(line.trim());
    if (!match) continue;
    const binary = match[1] === "-" || match[2] === "-";
    out.set(renamedTarget(match[3] ?? ""), {
      added: binary ? 0 : Number(match[1]),
      removed: binary ? 0 : Number(match[2]),
      binary,
    });
  }
  return out;
}

/** `a/{x => y}/b` or `x => y` to the new path. */
function renamedTarget(raw: string): string {
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw);
  if (braced) return `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/\//g, "/");
  const plain = /^(.*) => (.*)$/.exec(raw);
  return plain ? (plain[2] ?? raw) : raw;
}

/** `git diff --name-status -M` lines: `M\tpath`, `R100\told\tnew`. */
export function parseNameStatus(output: string): Array<{ status: GitFileStatus; path: string; oldPath?: string }> {
  const out: Array<{ status: GitFileStatus; path: string; oldPath?: string }> = [];
  for (const line of output.split("\n")) {
    const parts = line.split("\t");
    const code = (parts[0] ?? "").trim();
    if (!code || parts.length < 2) continue;
    if (code.startsWith("R") || code.startsWith("C")) {
      out.push({ status: "renamed", oldPath: parts[1], path: parts[2] ?? parts[1] ?? "" });
      continue;
    }
    const status: GitFileStatus = code === "A" ? "added" : code === "D" ? "deleted" : "modified";
    out.push({ status, path: parts[1] ?? "" });
  }
  return out;
}

export function mergeFileChanges(
  names: Array<{ status: GitFileStatus; path: string; oldPath?: string }>,
  stats: Map<string, { added: number; removed: number; binary: boolean }>,
  untracked: Array<{ path: string; added: number; binary?: boolean }> = [],
): GitFileChange[] {
  const files: GitFileChange[] = names.map((item) => {
    const stat = stats.get(item.path);
    return {
      path: item.path,
      ...(item.oldPath ? { oldPath: item.oldPath } : {}),
      status: item.status,
      added: stat?.added ?? 0,
      removed: stat?.removed ?? 0,
      ...(stat?.binary ? { binary: true } : {}),
    };
  });
  const seen = new Set(files.map((item) => item.path));
  for (const item of untracked) {
    if (seen.has(item.path)) continue;
    files.push({ path: item.path, status: "untracked", added: item.added, removed: 0, ...(item.binary ? { binary: true } : {}) });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

const RECORD_SEP = "\u001e";
const FIELD_SEP = "\u001f";

/** Format string for `git log` that `parseGitLog` reads back. Pair it with `--numstat`. */
export const GIT_LOG_FORMAT = `${RECORD_SEP}%H${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s`;

export function parseGitLog(output: string): RunCommitRef[] {
  const commits: RunCommitRef[] = [];
  for (const record of output.split(RECORD_SEP)) {
    const text = record.replace(/^\n+/, "");
    if (!text.trim()) continue;
    const [header = "", ...rest] = text.split("\n");
    const [sha = "", author = "", authoredAt = "", ...subject] = header.split(FIELD_SEP);
    if (!/^[0-9a-f]{7,40}$/.test(sha)) continue;
    let added = 0;
    let removed = 0;
    let files = 0;
    for (const [, stat] of parseNumstat(rest.join("\n"))) {
      added += stat.added;
      removed += stat.removed;
      files += 1;
    }
    commits.push({ sha, author, authoredAt, message: subject.join(FIELD_SEP), added, removed, files });
  }
  return commits;
}

export type HunkLineType = "hunk" | "add" | "del" | "ctx";

export interface HunkLine {
  type: HunkLineType;
  text: string;
  oldLine?: number;
  newLine?: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Unified-diff body with old/new line numbers, starting at the first `@@`.
 * File headers (`diff --git`, `---`, `+++`) are skipped. Used by the Git panel, not chat cards.
 */
export function parseHunkLines(patch: string): HunkLine[] {
  const out: HunkLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const raw of patch.replace(/\r\n/g, "\n").split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      inHunk = true;
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      out.push({ type: "hunk", text: raw });
      continue;
    }
    if (!inHunk) continue;
    if (
      raw.startsWith("\\") ||
      raw.startsWith("diff --git ") ||
      raw.startsWith("index ") ||
      raw.startsWith("---") ||
      raw.startsWith("+++")
    ) {
      continue;
    }
    if (raw.startsWith("+")) {
      out.push({ type: "add", text: raw.slice(1), newLine });
      newLine += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      out.push({ type: "del", text: raw.slice(1), oldLine });
      oldLine += 1;
      continue;
    }
    const text = raw.startsWith(" ") ? raw.slice(1) : raw;
    out.push({ type: "ctx", text, oldLine, newLine });
    oldLine += 1;
    newLine += 1;
  }
  return out;
}

/** Split a unified patch into per-file bodies keyed by the new path. */
export function splitPatchByFile(patch: string): Array<{ path: string; patch: string }> {
  const out: Array<{ path: string; patch: string }> = [];
  const chunks = patch.split(/^(?=diff --git )/m);
  for (const chunk of chunks) {
    if (!chunk.startsWith("diff --git ")) continue;
    const plus = /^\+\+\+ (?:b\/)?(.+)$/m.exec(chunk)?.[1];
    const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk);
    const path = plus && plus !== "/dev/null" ? plus.trim() : (header?.[2] ?? header?.[1] ?? "").trim();
    out.push({ path, patch: chunk.replace(/\n$/, "") });
  }
  return out;
}

const utf8 = new TextEncoder();

function utf8Bytes(text: string): number {
  return utf8.encode(text).length;
}

/** Keep a patch under `max` bytes, cutting at a line break. */
export function capPatch(patch: string, max = GIT_PATCH_MAX_BYTES): { patch: string; truncated: boolean } {
  if (utf8Bytes(patch) <= max) return { patch, truncated: false };
  let cut = patch.slice(0, max);
  while (utf8Bytes(cut) > max) cut = cut.slice(0, -1024);
  const newline = cut.lastIndexOf("\n");
  return { patch: newline > 0 ? cut.slice(0, newline) : cut, truncated: true };
}

/** Runs `git <args>` in the workspace. Hosts inject their own spawn so this module stays free of Node APIs. */
export type GitRunner = (args: string[]) => Promise<{ code: number; stdout: string }>;

/** Untracked files get a synthetic patch; past this many only the name is listed. */
const UNTRACKED_PATCH_FILES = 50;
const UNTRACKED_LIST_FILES = 200;

/** Where this branch forked: merge-base with the base branch, else HEAD, else the empty tree. */
export async function gitDiffBase(git: GitRunner, baseBranch?: string | null): Promise<string> {
  const head = await git(["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (head.code !== 0) return GIT_EMPTY_TREE;
  if (baseBranch) {
    const base = await git(["merge-base", baseBranch, "HEAD"]);
    if (base.code === 0 && base.stdout.trim()) return base.stdout.trim();
  }
  return "HEAD";
}

async function untrackedChanges(git: GitRunner): Promise<{ files: Array<{ path: string; added: number; binary?: boolean }>; patch: string }> {
  const listed = await git(["ls-files", "--others", "--exclude-standard"]);
  const paths = listed.stdout
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item && !item.startsWith(".neo/"))
    .slice(0, UNTRACKED_LIST_FILES);
  const files: Array<{ path: string; added: number; binary?: boolean }> = [];
  const patches: string[] = [];
  for (const [index, file] of paths.entries()) {
    if (index >= UNTRACKED_PATCH_FILES) {
      files.push({ path: file, added: 0 });
      continue;
    }
    const entry = [...parseNumstat((await git(["diff", "--no-index", "--numstat", "--", "/dev/null", file])).stdout).values()][0];
    files.push({ path: file, added: entry?.added ?? 0, ...(entry?.binary ? { binary: true } : {}) });
    const body = await git(["diff", "--no-index", "--", "/dev/null", file]);
    if (body.stdout.trim()) patches.push(body.stdout.replace(/\n$/, ""));
  }
  return { files, patch: patches.join("\n") };
}

/**
 * Everything changed from `base` to the working tree: committed, staged, unstaged, and untracked.
 * Stat, patch, and file list share one base.
 */
export async function collectWorkspaceDiff(
  git: GitRunner,
  base: string,
): Promise<{ stat: string; patch: string; files: GitFileChange[]; truncated: boolean }> {
  // One at a time: a plain `git diff` may refresh the index and parallel runs then race on index.lock.
  const diff = (...args: string[]) => git(["--no-optional-locks", "diff", "-M", ...args, base]);
  const stat = await diff("--stat");
  const patch = await diff();
  const numstat = await diff("--numstat");
  const names = await diff("--name-status");
  const untracked = await untrackedChanges(git);
  const files = mergeFileChanges(parseNameStatus(names.stdout), parseNumstat(numstat.stdout), untracked.files);
  const capped = capPatch([patch.stdout.replace(/\n$/, ""), untracked.patch].filter(Boolean).join("\n"));
  const untrackedLine = untracked.files.length > 0 ? `${untracked.files.length} untracked file(s)` : "";
  return {
    stat: [stat.stdout.trim(), untrackedLine].filter(Boolean).join("\n"),
    patch: capped.patch,
    files,
    truncated: capped.truncated,
  };
}

/** `git log` over `range` (or `--since` filters), newest first, capped. */
export async function collectCommits(git: GitRunner, range: string[]): Promise<RunCommitRef[]> {
  const log = await git(["log", "--no-merges", `-n${GIT_COMMITS_MAX}`, `--format=${GIT_LOG_FORMAT}`, "--numstat", ...range]);
  return log.code === 0 ? parseGitLog(log.stdout) : [];
}

/** Commits grouped under an Asia/Shanghai calendar day label such as `9月23日`, newest day first. */
export function groupCommitsByDay(commits: RunCommitRef[]): Array<{ day: string; commits: RunCommitRef[] }> {
  const groups: Array<{ day: string; commits: RunCommitRef[] }> = [];
  const sorted = [...commits].sort((left, right) => Date.parse(right.authoredAt) - Date.parse(left.authoredAt));
  for (const commit of sorted) {
    const date = new Date(commit.authoredAt);
    const day = Number.isNaN(date.getTime())
      ? "更早"
      : date.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric" });
    const last = groups.at(-1);
    if (last?.day === day) last.commits.push(commit);
    else groups.push({ day, commits: [commit] });
  }
  return groups;
}
