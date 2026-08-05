# ADR-0139: Incremental reflow

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Every paint re-lays out text (`replay.ts:2133`); there is no story-level
dirtying. Editing one character must not recompose every story (perf
requirement §34, 500-frame stories).

## Decision

D1 — Story dirtying: composition tracks the earliest affected
paragraph/frame; reflow starts there and stops when downstream output
stabilizes (compare composed line boxes before/after; identical ⇒ done).

D2 — Invalidation sources: text edits, style changes, font availability,
frame resize/reorder, page resize, column/inset changes, master changes,
exclusion geometry, baseline-grid changes. Each maps to a dirty-scope
(story-wide for text/style; frame-forward for geometry; assigned-page-set
for master changes).

D3 — Incremental results are validated against the composition key; a worker
may return partial segments that are merged in order, latest-wins.

D4 — Overset state is recomputed for the tail of the story (last composed
frame) on every incremental pass, never assumed stable.

D5 — Master text frames that participate in a story invalidate all assigned
pages' projections but recompose the story once (shared composition cache).

## Alternatives

- Full-story recomposition per edit — rejected for 10k-character stories over
  100 frames (main-thread blocking, §34 budgets).
- Per-frame independent composition — rejected: paragraph-level rules
  (keep-with-next, widow/orphan) cross frame boundaries.

## Consequences

- Benchmarks: edit-in-middle reflow cost proportional to downstream frames,
  not story size (budget in ADR-0154).

## Migration impact

None.

## Compatibility impact

None.

## Security considerations

Composition duration budgets and worker cancellation (ADR-0137 D5) bound
pathological inputs.

## Rejected shortcuts

- Reflow by frame-number range only (ignores paragraph rules).
- Caching per-frame ranges without paragraph context.
