export interface CloneToken {
  repoUrl: string;
  token: string;
  expiresAt: string;
}

/** Short-lived clone/push tokens. Long-lived SCM creds never enter the VM. */
export function mintCloneToken(repoUrl: string): CloneToken {
  return {
    repoUrl,
    token: `dev-git-token-${crypto.randomUUID()}`,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
}

export function openPullRequest(input: {
  repoUrl: string;
  branch: string;
  title: string;
  body: string;
}): { url: string; draft: true } {
  const slug = input.repoUrl.replace(/[^a-zA-Z0-9]+/g, "-");
  return {
    url: `https://example.invalid/${slug}/pull/new/${input.branch}`,
    draft: true,
  };
}
