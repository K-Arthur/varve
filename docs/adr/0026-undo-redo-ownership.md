# ADR-0026: Undo and redo ownership

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Undo/redo is per-session, snapshot-based, with one active stack
(`undoStackRef`/`redoStackRef`, `context.tsx:2226-2231`, cap 50,
swapped wholesale on tab switch). If each window had its own stack, the same
edit sequence would fork.

## Alternatives

1. Per-window stacks synced by copying — rejected (forks, duplicates).
2. One authoritative stack in the canonical provider, broker-routed undo
   commands (chosen).

## Decision

- The canonical provider keeps the **sole** undo/redo stacks; `undo` and
  `redo` from any window arrive as broker commands (`undo`, `redo`,
  ADR-0025) and execute on the canonical stacks.
- Command availability (`canUndo`/`canRedo`/`undoLabel`/`redoLabel`,
  `context/types.ts:161,169-172`) is part of the session-shared snapshot
  and patches, so every window shows consistent enabled/disabled state.
- Text-field transactions, slider drags, and coalesced inspector edits in
  detached windows follow the same rule as primary-window drags: the panel
  submits one command at transaction end (existing `beginTransaction`/
  `commitTransaction`/`abortTransaction` primitives, `context.tsx:5081-5084`)
  so one drag = one undo step.
- A stale panel editing after an undo (revision mismatch) is rejected and
  resynced (ADR-0024/0025).

## Consequences

- Undo invoked from the detached window appears in the same sequence as
  primary-window edits; exactly one undo per invocation.
- No window can observe divergent canUndo state.

## Migration impact

None; the canonical stacks are unchanged. Only the entry points gain a
broker wrapper.

## Cross-platform implications

None; broker-routed undo is OS-agnostic.

## Security implications

Undo/redo commands are validated like any command (sender registration,
active document, payload).

## Accessibility implications

Undo announcements and shortcut state are consistent across windows.

## Performance implications

Snapshot-based undo already caps stack depth at 50; no new copies are
introduced. Coalescing prevents undo-step explosion for detached drags.

## Rejected shortcuts

Per-window stacks; broadcasting raw `Document` snapshots for undo;
letting `undo` from an auxiliary window operate on a replicated stack.
