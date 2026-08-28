---
name: release-notes
description: Write user-facing release notes from commits and PRs. Use when the user asks for changelog, 发版说明, or what changed in a release. Do not write marketing copy.
---

# Release notes

Use the repository history. Do not invent features.

## Steps

1. Collect commits and PR titles for the range the user named. If they did not name a range, use commits since the last tag, or the current branch vs `main`.
2. Group changes by user-visible outcome, not by file.
3. Drop chore, format-only, and internal-only commits unless they affect operators.

## Output

```markdown
## Changes
- one line per user-visible change

## Fixes
- one line per bug fix

## Notes
- upgrade or config steps, if any
```

Write in the same language as the user. Keep each bullet one sentence.