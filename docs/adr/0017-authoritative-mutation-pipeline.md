# ADR-0017: Authoritative mutation pipeline (typed command dispatcher)

- **Status:** Accepted (persistent-history architecture, 2026-08-05)
- **Date:** 2026-08-05
- **Related:** ADR-0018, ADR-0025, ADR-0039; audit `docs/audits/history-mutation-inventory-2026-08-05.md`

## Context

~90 % of authored edits flow through `updateDoc(fn)` (`context.tsx:2488`) and
`updateNodeProp` (`context.tsx:2565`); ~10 % use raw `setState` with manual undo
pushes; `useLogoGeometry` pushes the undo stack itself. All are opaque
`(doc) => doc` / `(node) => node` callbacks. Nothing records what changed, so
nothing can be persisted, diffed, merged, or replayed.

## Alternatives

1. Wrap `updateDoc` to snapshot before/after and compute a JSON patch — a
   generic patch has no semantic owner, no conflict key, and no stable
   inverse; rejected.
2. Full before/after document snapshot per step (status quo) — works for undo,
   useless for merge/diff/replay; rejected as the persistent model.
3. Typed operation registry + dispatcher with pure `apply(doc, payload)`.

## Decision

Every authored mutation must eventually enter through a typed operation
(`DesignOperation` envelope) dispatched by a single dispatcher. Existing
convenience methods (`updateDoc`, `updateNode`) remain temporarily as adapters
that translate to typed operations; opaque callbacks are classified either as
typed semantics (converted) or administrative replacement (load/migration/
recovery). A mutation-coverage diagnostic reports unclassified callbacks.
Milestone 4 introduces the registry and dispatcher in `@varve/scene` (pure),
with editor adapters.

## Consequences

- **Migration impact:** editor call sites migrate incrementally by functional
  area; each commit keeps the gate green.
- **Backward compatibility:** `updateDoc`/`updateNode` stay available as
  adapters; no scene API breakage.
- **Cross-platform:** pure scene code is runtime-agnostic.
- **Performance:** dispatch is a function call + payload validation; must stay
  out of the per-pointer-move path (previews never dispatch).
- **Security:** payloads validated against registered operation schemas; no
  arbitrary property-path patches.
- **Accessibility:** none.
- **Rejected shortcuts:** instrumenting `updateDoc` to capture before/after
  JSON patches and calling that "typed operations"; logging raw undo snapshots
  as persistent history.
