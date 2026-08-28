---
name: incident-brief
description: Write a one-page incident brief from logs and recent commits. Use when the user asks for a postmortem draft, outage summary, or what broke. Do not declare root cause without evidence.
---

# Incident brief

Stick to evidence in the workspace. Separate facts from guesses.

## Steps

1. Collect timestamps, error messages, and the commits or deploys in the window.
2. Write the user-visible impact in one paragraph.
3. List what was checked and what is still unknown.
4. Propose the next debugging step, not a permanent fix, unless the cause is proven.

## Output

```markdown
## Summary
## Timeline
## Impact
## Evidence
## Unknowns
## Next step
```

Quote log lines and file paths. If the logs are missing, say so and stop. Do not invent a root cause.