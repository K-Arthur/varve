# ADR-0198: Undo and history integration

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Undo is whole-document snapshot stacks (50 deep, `useHistory.ts:13-30`); the
`DesignOperation` envelope + registry exist but have zero production
consumers (`operations/registry.ts:15-96`, "editor and future history package
dispatch through the registry" — bootstrap.ts:5). Page ops are plain
functions via `updateDoc`.

## Decision

D1 — Register semantic operations for page/master/spread/section/story/thread
mutations in the existing registry (`page.create/delete/duplicate/reorder/
resize/move-on-pasteboard/assign-master/set-print-geometry`, `spread.*`,
`section.*`, `master.*`, `story.*`, `text-frame.*`) — each with
validate/apply/summarize/invert so the envelope becomes real.

D2 — Transaction boundaries = one meaningful user action (add five pages,
apply a master to ten pages, link two frames, cross-page move). Derived
composition, projection, and thumbnail updates never create history steps.

D3 — Snapshot undo remains as the immediate in-session mechanism while the
registry is adopted incrementally; op-based invert must agree with snapshot
restore (dual-path tests).

D4 — Cancellation restores page geometry, ownership, threads, story ranges,
overrides, selection, active page, and spread membership (the transaction
coordinator with rollback, `operations/transaction.ts:80-191`).

## Alternatives

- Rewriting undo to ops-only immediately — rejected: snapshot undo works and
  is battle-tested; the registry needs consumers before it can replace it.
- Continuing op-less — rejected: persistent history (spec §28), diff, and
  merge require semantic operations.

## Consequences

- History panel (future) renders op summaries, not node diffs.
- Autosave/version snapshots remain content-addressed
  (`VersionHistoryService`), now aligned with op granularity.

## Migration impact

None for documents.

## Compatibility impact

None.

## Security considerations

Op validation runs before apply; rollback restores exact pre-transaction
state (no partial mutation).

## Rejected shortcuts

- Recording per-node ops for a page-level action (history noise).
- Persisting compositor cache updates as history.
