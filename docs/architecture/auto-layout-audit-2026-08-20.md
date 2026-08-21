# Auto Layout / Responsive Layout — Audit, Repair & Implementation Report

Date: 2026-08-20
Author: agent (working session on `master`)
Scope of this pass: audit of the existing subsystem + targeted repairs to the
highest-value correctness and frontend-config gaps. This is NOT a from-scratch
build — the Auto Layout subsystem already exists, is wired into the editor, and
has a passing test suite (61 tests before this pass).

## A. Initial diagnosis

The repository already contains a coherent, deterministic layout engine. The
architecture matches the boundary the spec asks for:

```
Persistent scene props (FrameNode.layoutStyle, per-child layoutSizing* /
layoutPosition / layoutAlign)  →  @varve/layout engine  →  resolved transforms
→  render pipeline (Canvas2D / WebGPU / export share one scene)
```

| Capability        | Scene Model | Engine | Inspector | Canvas Editing | Persistence | Export | Tests | Status |
| ----------------- | ----------- | ------ | --------- | -------------- | ----------- | ------ | ----- | ------ |
| Horizontal layout | Yes         | Yes    | Yes       | Partial        | Yes         | Yes    | Yes   | Working |
| Vertical layout   | Yes         | Yes    | Yes       | Partial        | Yes         | Yes    | Yes   | Working |
| Padding           | Yes         | Yes    | Yes       | Partial        | Yes         | Yes    | Yes   | Working |
| Gap               | Yes         | Yes    | Yes       | Partial        | Yes         | Yes    | Yes   | Working |
| Hug contents      | Yes         | Yes    | Yes       | Partial        | Yes         | Yes    | Yes   | Working* |
| Fill container    | Yes         | Yes    | Yes       | Partial        | Yes         | Yes    | Yes   | Working |
| Fixed size        | Yes         | Yes    | Yes       | Partial        | Yes         | Yes    | Yes   | Working |
| Wrap              | Yes         | Yes    | Yes       | Partial        | Yes         | Yes    | Yes   | Working |
| Alignment         | Yes         | Yes    | Yes       | n/a           | Yes         | Yes    | Yes   | Working |
| Distribution      | Yes         | Yes    | Yes       | n/a           | Yes         | Yes    | Yes   | Working |
| Absolute child    | Yes         | Yes    | Yes       | Partial        | Yes         | Yes    | Yes   | Working |
| Nested layout     | Yes         | Yes    | Yes       | Partial        | Yes         | Yes    | Yes   | Working |
| Min/max           | Yes         | Yes    | Yes       | Partial        | Yes         | Yes    | Yes   | Working |
| Grid              | Yes         | Yes    | Yes       | Partial        | Yes         | Yes    | Yes   | Working (separate) |
| Components         | Partial     | n/a    | Partial    | Partial        | Yes         | Yes    | Yes   | Partial |
| Responsive resize | Yes         | Yes    | n/a       | Partial        | n/a         | n/a    | Partial| Partial |

`*` Hug contents had a real defect for fixed-width (area) text — see B.

Working-but-Partial items are gaps in *canvas interaction* (drag-to-reorder,
live resize handle converting hug→fixed, gap/padding canvas handles, insertion
indicators), not in the layout computation itself. The engine computes correct
geometry; the direct-manipulation affordances are not fully built.

## B. Root causes of the gaps found

1. **Text intrinsic measurement ignored resizing mode (#30 / #134).**
   `measureNodeSize` (packages/layout/src/measure.ts) measured every text node
   with single-line `measureText`, ignoring `n.w` and `n.textResizing`. A
   fixed-width wrapping (area) text node therefore reported an unwrapped,
   single-line width/height, so a `hug` parent of a vertical stack of such
   labels collapsed. This is the most important correctness bug found.

2. **Inspector/engine `alignItems` default disagreed (#13 / #44).**
   The engine defaults `alignItems` to `'start'` (computeFlexLayout.ts:176),
   but LayoutSection displayed `'stretch'` when the field was undefined. The
   inspector selection therefore lied about the rendered cross-axis alignment.

3. **Per-child cross-axis alignment override was unexposed (#49).**
   The engine reads `child.layoutAlign` (inherit/start/center/end/stretch) in
   computeFlexLayout, but `LayoutChildSection` only exposed Position + Width +
   Height sizing. Users could not override a single child's alignment.

## C. Final architecture (unchanged boundary, repaired internals)

- **Authored geometry**: `FrameNode.layoutStyle` (mode/direction/wrap/gap/
  padding/alignItems/justifyContent/grow/shrink + grid tracks) and per-child
  `layoutSizingWidth`/`layoutSizingHeight`/`layoutPosition`/`layoutAlign`.
- **Measurement**: single `measureNodeSize` (measure.ts) — now text-mode aware.
- **Resolution**: `resolveIntrinsicSizes` (bottom-up hug) → `computeFlexLayout`
  (or `applyGridLayout`) → `reflowLayoutChildren` (top-down, recursive into
  child frames, upward propagation when a hug frame grows). Cycle is broken by
  definition: a fill child contributes only its min size to a hug parent.
- **Computed geometry**: written as child `transform` + (for non-fixed axes)
  `resizeNodeGeometry`. Disable (setNodeLayout id, undefined) keeps the last
  baked transforms, so appearance is preserved (#93 / #162 satisfied).

## D. Files changed

Scene/model: none (model already supported all fields, including `layoutAlign`).

Layout engine:
- `packages/layout/src/measure.ts` — text-mode-aware intrinsic measurement.

Tests:
- `packages/layout/src/__tests__/measure.test.ts` (new) — 3 tests for text
  resizing modes.

Editor / UI:
- `packages/editor/src/components/Inspector/sections/LayoutChildSection.tsx` —
  added per-child `Align` (layoutAlign) control.
- `packages/editor/src/components/Inspector/sections/LayoutSection.tsx` —
  fixed `alignItems` default to `'start'` to match the engine.
- `packages/editor/src/context/layoutChildSetters.ts` — extended
  `applySelectedLayoutChildField` to accept `layoutAlign` (with reflow).
- `packages/editor/src/context.tsx` — implemented `setSelectedLayoutAlign`.
- `packages/editor/src/context/types.ts` — declared `setSelectedLayoutAlign`.

## E. Feature matrix (after this pass)

horizontal ✓ · vertical ✓ · padding ✓ · gap ✓ · hug ✓ (fixed-width text fixed)
· fill ✓ · fixed ✓ · alignment ✓ (child override now exposable) · wrap ✓ ·
absolute ✓ · nested ✓ · min/max ✓ · grid ✓ · components Partial.

## F. Tests

Command: `npx vitest run packages/layout/src/__tests__`
Outcome: 59 fast tests pass (autolayout 18, measure 3 new, reflow 11,
cycleDetection 6, computeGridLayout 21). The 5-file `reflow.bench.test.ts`
(1000/10k/50k-child perf) was run separately earlier and passed;
it was excluded from the fast run to keep the loop fast.
Editor inspector `LayoutSection.test.tsx` (3 tests) passes.

## G. Visual validation

Not performed this pass (no browser/Playwright harness exercised). The fixes
are unit-verified against exact geometry assertions. Visual fixtures (#137) and
the resize-visual matrix (#138) remain as follow-up work requiring the canvas
harness.

## H. Performance

Baseline (prior session): reflow of 1k flex children ~761ms, 10k ~2.26s, 50k
~17.6s, roughly linear. No change to the hot path this pass.

## I. Compatibility

- Old documents: `axisSizing` falls back to legacy unified `layoutSizing`, so
  pre-per-axis documents keep behaviour. Missing `layoutStyle` = no layout.
- Import/export: layout is computed geometry; SVG/PDF/raster export use resolved
  transforms. Codegen maps flex→CSS flexbox / Flutter Row-Column / SwiftUI
  HStack-VStack (see @varve/codegen).
- Components: per-instance text overrides reflow via the same engine.

## J. Remaining limitations (prioritized)

- P0 (correctness): full browser/font-metric text measurement parity (current
  `measureText` is a deterministic estimate; wraps agree with the renderer only
  when the same estimate is used — confirmed it is, via @varve/shared).
- P1 (responsive workflow gaps): canvas drag-to-reorder within a layout
  container; resize-handle hug→fixed / fill→fixed conversion; gap/padding
  canvas handles; insertion indicators; "Add Auto Layout" wrap-selection action
  (#18-#20, #42-#43, #91-#92).
- P1: component-master ↔ instance layout propagation tests (#56-#60).
- P2: baseline alignment (#14 — currently not exposed, correctly absent rather
  than faked); absolute-child constraint coexistence on canvas (#25).
- P3: grid intrinsic (hug) sizing (grid-mode frames keep authored box today,
  see intrinsicSize.ts), true CSS-grid interoperability notes (#54-#55).
