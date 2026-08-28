---
name: repo-scout
description: Map a repository before concluding. Use when the user asks what this repo is, where to start, or how a feature is wired. Do not edit files.
---

# Repo scout

Orient first. Do not guess from the folder name alone.

## Steps

1. Read the top-level README, package manifests, and entrypoints.
2. List the main packages or directories and what each one owns.
3. Name the commands that build, test, and start the app, if they exist.
4. Point at the files a newcomer should open next.

## Output

```markdown
## What this is
## Layout
## How to run
## Start here
```

Cite concrete paths. If something is missing, say you could not find it. Do not propose a rewrite.