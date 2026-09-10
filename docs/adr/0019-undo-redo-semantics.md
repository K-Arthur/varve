# ADR-0019: Undo and redo semantics (movable cursor with branch-on-divergence)

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0022, ADR-0023, ADR-0039

## Context

Today undo/redo is a 50-entry in-memory stack of full document snapshots
(`context.tsx:2226-2231`); reload wipes it. The persistent model needs undo
that survives reload, never erases history, and behaves correctly with
branches, checkpoints, and merges.

## Alternatives

- **Model A — movable undo cursor:** undo moves the active branch's working
  cursor to a parent revision; redo follows the remembered descendant; a new
  edit after undo creates a branch rather than deleting the abandoned
  direction. Photoshop-like, history never erased, efficient.
- **Model B — compensating revert operations:** undo appends a semantic
  inverse transaction. Append-only, collaboration-friendly, but verbose,
  unintuitive for repeated undo/redo, and requires safe inverses after later
  edits.
- **Hybrid (chosen):** cursor movement for private, unpublished, single-user
  working history; compensating reverts for shared sessions, published
  checkpoints, merge revisions, and Git-linked history.

## Decision

Implement the hybrid: the default undo path is cursor movement on the active
branch (Model A); when the target history is shared/published/referenced, undo
becomes an explicit revert transaction. The UI states which model is in effect.
Requirements: history is never silently erased; redo ambiguity is surfaced
(multiple descendants → pick list); new edit after historical navigation
preserves the old direction as a new branch; undo survives reload; labels
remain meaningful; selection/viewport restoration is separate from document
history; merge revisions have a documented undo policy (revert, never cursor
into a merge's ancestry unless explicitly checked out).

## Consequences

- **Migration impact:** the current undo stacks are replaced by persistent
  cursor state; the 50-entry cap disappears in favor of revision-based
  navigation with lazy materialization.
- **Backward compatibility:** `undo()/redo()` API surface kept; behavior
  changes are additive (history now survives reload).
- **Cross-platform/Performance:** cursor moves are O(1); revert transactions
  replay only their own ops.
- **Security:** invalid inverses are impossible (reverts are themselves typed
  operations).
- **Accessibility:** "Restore revision", "Revert revision", and "Move working
  head here" are three distinct commands with distinct language.
- **Rejected shortcuts:** erasing abandoned descendants on undo; a single
  global undo stack shared across branches; last-writer-wins undo of remote
  edits.
