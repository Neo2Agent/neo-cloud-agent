---
name: pr-review
description: Review a code diff by severity. Use when the user asks to review a PR, check a change, or list blockers before merge. Do not rewrite business logic.
---

# PR review

Read the diff and nearby code first. Do not start editing.

## Steps

1. Identify the change set (`git diff`, `git log`, or the files the user named).
2. Check correctness, security, missing tests, and accidental secrets.
3. Group findings by severity. Skip style nits unless they hide a bug.

## Output

```markdown
## Blockers
- file:line — what is wrong and why it must be fixed before merge

## Risks
- file:line — what could break later

## Notes
- optional follow-ups
```

If there are no blockers, say so in one sentence, then list residual risks. Do not implement the fix unless the user asks.