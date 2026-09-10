# ADR-0113: Git integration boundary

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Token repositories are usually Git repositories. Varve must treat Git as an
optional transport and review workflow for token files — never as the
canonical token representation, and never as an auto-pilot.

## Decisions

### D1 — Local working-tree integration only

The Git source kind (ADR-0107) operates on a local checkout without network.
State detection covers: dirty working tree, staged changes, untracked files,
merge/rebase/cherry-pick in progress, detached HEAD, missing upstream,
deleted branch, worktrees, submodules, sparse checkout, case-insensitive
path collisions, line-ending configuration, LFS pointer files, and
repository ownership warnings.

### D2 — Explicit user actions only

The Token Sync UI may offer: refresh from working tree, preview file
changes, write files, stage token files, commit token files, push current
branch, create a branch, and create a pull request where a provider adapter
exists. Each is a discrete, previewed, user-initiated action.

Never: auto-checkout, auto-pull, auto-rebase, auto-resolve Git conflicts,
auto-stage unrelated files, auto-commit after edits, auto-push, force-push,
embed credentials in remotes, or run arbitrary repository scripts.

### D3 — Product-generated commits

Before creating a commit: show the exact files, show the commit message,
ensure only approved token files are staged, let the user cancel, and report
hook/signing failures honestly. Staging uses exact paths — unrelated staged
files are never touched, and a dirty working tree is never "cleaned".

### D4 — Git is a separate process boundary

Git operations run through a `GitProcess` boundary in `@varve/platform`
(spawn-based, no shell interpolation, no `--force`, strict error mapping).
Tauri exposes `git_*` commands; web builds report the capability as
unavailable.

## Alternatives

- libgit2 bindings — rejected for now: process boundary gives exact
  CLI-compatible semantics, hooks, and credential handling with less
  surface; re-evaluable later.
- Shelling out with string interpolation — rejected: command injection.
- Auto-commit after every token edit — rejected: violates explicit-action
  and reviewability requirements.

## Consequences

- Playwright workflow 5 verifies: write → stage only approved files →
  explicit commit → no push → simulated push rejection → recoverable error.
- Git conflicts are surfaced as such and never overwritten.

## Migration impact

None — new source kind.

## Compatibility impact

None.

## Security considerations

Credentials come from the OS Git credential helper or secure storage
(ADR-0119) — never from documents, token files, or app logs; hooks run only
because Git itself runs them (the user owns the repository); output is
sanitized before logging.

## Rejected shortcuts

- Auto-push after commit.
- Staging with `git add -A`.
- Running `npm install`/build scripts in a connected repository.
- Rewriting history in any form.
