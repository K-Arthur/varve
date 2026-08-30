# Auto Layout Audit and Repair — 2026-08-29

## Scope and diagnosis

The repository has one active TypeScript layout path:

```text
Scene layout properties → @varve/layout → resolved geometry on scene nodes
→ canvas / selection / export
```

`crates/varve-layout` is an unwired Taffy experiment, not a second runtime
layout path. The editor calls the shared `reflowLayoutChildren` entry point
from layout setters, hierarchy edits, and frame resize commits.

The audit found three regressions or missing integration points:

1. Grid frames marked `hug` were silently skipped by intrinsic measurement.
2. Resizing a hug-sized layout frame did not persist the changed axis as
   fixed, so a later reflow could discard the user's explicit size.
3. `spaceEvenly` existed in the model, engine, and codegen but was not
   available in the inspector. Dragging a flow child in its own layout parent
   was also treated as a no-op instead of an order change.

## Current feature matrix

| Capability | Model | Engine | Inspector | Canvas | Status |
| --- | --- | --- | --- | --- | --- |
| Horizontal / vertical / reverse | Yes | Yes | Yes | Yes | Working |
| Padding, gap, wrap | Yes | Yes | Yes | Yes | Working |
| Fixed, hug, fill per axis | Yes | Yes | Yes | Yes | Working |
| Alignment and distribution | Yes | Yes | Yes | Yes | Working, including `spaceEvenly` |
| Min/max and hidden children | Yes | Yes | Yes | — | Working |
| Absolute children | Yes | Yes | Yes | Partial | Flow exclusion works; responsive anchors are not modeled |
| Nested flex and grid hug | Yes | Yes | Yes | Yes | Working |
| Same-container canvas reorder | Yes | Yes | — | Yes | Working for one flow child |
| Components and instances | Yes | Structural | Partial | — | Needs dedicated propagation coverage |
| Import/export/codegen | Yes | Resolved geometry | — | — | Existing paths retained; not re-audited end-to-end |

## Repairs

- `resolveIntrinsicSizes` now measures grid hug dimensions through
  `computeGridLayout`, so explicit `px` and `auto` tracks contribute a stable
  intrinsic size while fractional tracks contribute no unconstrained size.
- `TransformEngine` converts each manually resized hug axis to `fixed` before
  future reflow can own the dimension again.
- The Layout inspector exposes the engine's `spaceEvenly` distribution option.
- `layoutDropInsertionIndex` maps a canvas drop back to the scene's child
  order. The Select tool uses it for a single flow child already inside its
  flex parent, then delegates to the normal atomic reparent/reflow path.

## Validation

- Layout unit suite: 60 tests passed.
- Transform regression: 25 tests passed.
- Layout drop resolver and Select-tool integration: 64 tests passed.
- Inspector regression: 4 tests passed.
- E2E typecheck passed.
- Playwright Chromium on isolated port 1422 passed for `spaceEvenly` and
  canvas flow-child reorder. Inspected screenshots:
  `test-results/autolayout-06c-justify-space-evenly.png` and
  `test-results/autolayout-11b-canvas-reorder.png`.
- Reflow benchmark gate passed for 100, 1k, 10k, and 50k-child flex frames;
  no hot per-frame layout path changed in this repair, so no new p50/p95
  comparison is claimed.
- `audit:docs`, `audit:emoji`, and `audit:tokens` passed.

The editor package's broad typecheck remains blocked by existing errors in
mask replay, mockups, export-region tests, and pre-existing layout test
fixtures; the changed files do not appear in that failure set.

## Remaining work

- P1: visual insertion indicator, multi-child reordering, and canvas
  gap/padding handles.
- P1: component-master/instance layout propagation and save/reopen tests.
- P2: absolute-child anchoring within a layout container and baseline
  alignment.
- P3: logical RTL direction and richer grid interoperability.
