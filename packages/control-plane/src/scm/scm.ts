import type { CreateCommitRequest, CreateGitTokenRequest, CreatePullRequestRequest, Run } from "@neo-cloud-agent/contracts";
import { prepareWorkspaceRepo } from "./branch.js";
import { commitWorkspace, openDraftPullRequest, workspaceDiff } from "./deliver.js";
import { mintGitToken, type IssuedGitToken } from "./token.js";

export { mintGitToken, resolveScmPushToken, scmPushToken, verifyGitToken } from "./token.js";
export { parseGithubRepo } from "./git.js";

export async function prepareRunRepos(
  dests: string[],
  run: Pick<Run, "id" | "prompt">,
): Promise<{ branch: string; baseBranch: string; cwd: string }[]> {
  const prepared = [];
  for (const dest of dests) {
    prepared.push(await prepareWorkspaceRepo(dest, { runId: run.id, prompt: run.prompt }));
  }
  return prepared;
}

export function issueRunGitToken(run: Run, input: CreateGitTokenRequest): IssuedGitToken {
  return mintGitToken({
    runId: run.id,
    repoUrl: input.repoUrl ?? run.repoUrls[0] ?? "",
    scope: input.scope,
  });
}

export async function commitRunWorkspace(cwd: string, input: CreateCommitRequest) {
  if (!input.message?.trim()) {
    throw new Error("commit message is required");
  }
  return commitWorkspace(cwd, { message: input.message.trim(), paths: input.paths });
}

export async function openRunPullRequest(
  cwd: string,
  run: Run,
  input: CreatePullRequestRequest,
) {
  const title = input.title?.trim() || run.prompt.slice(0, 72) || "Agent changes";
  const body = [input.body?.trim(), `Opened by Neo Cloud Agent for run \`${run.id}\`.`]
    .filter(Boolean)
    .join("\n\n");
  return openDraftPullRequest(cwd, {
    runId: run.id,
    repoUrl: run.repoUrls[0] ?? input.remoteUrl ?? "",
    branch: run.branchName ?? "HEAD",
    baseBranch: run.baseBranch ?? "main",
    title,
    body,
    remoteUrl: input.remoteUrl,
  });
}

export async function diffRunWorkspace(cwd: string, run: Run) {
  return workspaceDiff(cwd, run.baseBranch);
}
