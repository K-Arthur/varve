# Warp capability audit — current state (2026-08-05)

Evidence-backed matrix produced before implementation (task §4), with the
post-implementation outcome column. All evidence is file:line verified.

| Capability | Before | After | Evidence |
| --- | --- | --- | --- |
| Affine transform | Existing | Existing | `Affine` 6-tuple; `@varve/shared/src/affine.ts`; `TransformEngine` |
| Matrix decomposition | Partial | Partial | `decomposeAffineFull` (skewX, skewY=0); `decomposeAffine` rejects skew — no regression; warp uses its own maps |
| Skew/shear | Partial | **Implemented** | SelectionOverlay diamond handles + `TransformEngine.skew`; now also `SkewModifier` (exact affine, numeric + handles) |
| Perspective mapping | Orphaned | **Implemented** | `engine/src/mockup/homography.ts` (DLT, existed); wired into `PerspectiveModifier` |
| Editable vector paths | Existing | Existing | `Shape`/`PathPoint` (handleIn/out); `shapeToPathPoints` conversion |
| Compound path support | Existing | Existing | `holes` + `fillRule` preserved through warp evaluation |
| Stroke outlining | Existing | Partial | `engine/src/pathOffset.ts expandStroke`; `warp-appearance` contract defined, fidelity follow-up |
| Gradient geometry | Existing | Partial | `GradientFill.transform`; `deform-with-object` default, `object-paint-space` documented |
| Visual bounds | Existing | **Warp-aware** | `nodeLocalBounds`/`nodeWorldBounds` evaluate warped bounds; `warpBounds.ts` |
| Nonlinear hit testing | Missing | **Implemented** | `HitTestEngine` evaluates draft warped geometry; containers via evaluated items |
| Live geometry modifiers | Missing | **Implemented** | `NodeBase.warps` stack + `warpOps.ts` + evaluator |
| Modifier serialization | Missing | **Implemented** | migration `2.15→2.16`, `validateWarpModifiers`, unknown kinds preserved inert |
| Envelope overlay | Missing | **Implemented** | `WarpOverlay` (cage + edge handles, screen-constant size) |
| Mesh editing | Orphaned | **Implemented** | `meshWarp.ts` existed; now `MeshWarpModifier` (bilinear) + grid overlay |
| Editable warped text | Orphaned | **Implemented** | per-cluster glyphAdjustments; text stays text |
| Warp-aware export | Missing | **Implemented** | SVG bake, PDF raster path, codegen `mustFlatten` |
| Warp-aware clipboard | Missing | **Implemented** | warps ride on nodes; `deepCloneSubtree` spread; paste remaps node ids |
| Collaboration operations | Missing | **Structured** | `warpOps` ops are CRDT-shaped (ADR-0169); collab transport follow-up |
| Multimodal warp proposal | Missing | **Typed boundary** | `WarpPlan` + validation + deterministic builders (ADR-0168) |

## Explicit determinations (task §4)

- **True skew**: yes — the affine tuple carries skew; `TransformEngine.skew`
  and `SelectionOverlay` shear handles existed before; `decomposeAffineFull`
  exposes skewX (skewY hardcoded 0 — unchanged, documented).
- **Decomposition rejecting shear**: `decomposeAffine` (strict) rejects;
  `decomposeAffineFull` (used by Position/Size) accepts. No changes needed.
- **Path rendering of arbitrary geometry**: yes — `paintPathFill` renders
  any PathPoint ring; warp output is a path shape.
- **Hit testing on cached vs. source geometry**: hit tests source shapes
  via `shapeContains`; now warp-aware (draft evaluation).
- **Effects visual-only vs. geometric**: effects are visual (post-warp per
  ADR-0156); masks/live booleans evaluated before warp in local space.
- **Existing modifier stack under another name**: `VariableModifier`
  (bindings, alpha-only) — sibling pattern; warp stack is node-level.
- **Mask/boolean order vs. effects**: masks clip in local space; booleans
  are baked (pre-existing), so they are ordinary sources for warp.
- **Source vs. visual bounds**: now distinct — `nodeLocalBoundsSource`
  vs. warp-aware bounds; layout uses source (ADR-0164).

## Pre-existing findings (not caused by this work)

- `packages/scene` typecheck errors from the in-flight tables system
  (untracked `table.ts`/`tableOps.ts`, `TableNode` in `types.ts`):
  `TableModel` missing, `emptyTableModel` missing from codec, visitor
  assignability.
- `packages/import/src/sketch.ts` imports `mintId` from `@varve/scene`
  while the new `identity.ts` was never re-exported — **fixed** with a
  one-line additive export (`scene/index.ts`) so the app can boot.
- `dropUtils.ts:79` / `codegen svg.ts:48` `shapeBounds` missing return —
  pre-existing latent TS errors at HEAD.
- Engine worker/model-loader timing tests flake under full-suite load
  (pre-existing; pass in isolation and in their own files).

---

## Follow-up verification pass (2026-08-07)

Re-audited the claims above against production call paths. Five defects were
found where a capability was reported as shipped but the code path did not
exist or was incorrect. All are fixed and covered by tests.

### 1. SVG export ignored the warp stack entirely (claimed "Implemented")

`packages/codegen` had **no warp references at all** — the row claiming
"SVG bake / `flattening.ts` mustFlatten `warp`" described code that was never
written. Both emitters (`svg.ts exportNodeToSvg` and `index.ts
exportDocumentToSvg`) emitted the **unwarped source geometry**, so any warped
node exported silently wrong.

Fixed with `packages/codegen/src/warpBake.ts` — one canonical export-time bake
(`EXPORT_WARP_QUALITY`, the same `@varve/engine` evaluator the canvas uses),
consumed by both emitters and by node/document bounds so the viewBox contains
the deformed result. `fill-rule` is now emitted by the per-node path emitter
too (it was dropped there while the document emitter emitted it).

### 2. Straight segments were never subdivided under a nonlinear warp

`warpPathRing` mapped only the endpoints of any segment without Bézier
handles. A straight line is **not** straight after an envelope/mesh/bend map,
so every rect, polygon, star and straight path kept perfectly straight edges
and lost the deformation along them — only its vertices moved. Verified
visually: a striped rect under a Coons envelope exported as an unmodified
square outline.

Fixed with adaptive subdivision of straight segments against the same
output-space tolerance and depth/point budgets as curves. Affine and
projective maps preserve straightness, so they test flat on the first
midpoint and cost one extra evaluation per segment (asserted by test).

### 3. Subdivision tolerance always resolved to `undefined`

`DEFAULT_WARP_QUALITY` carries no `tolerance` field, so
`quality.tolerance ?? DEFAULT_WARP_QUALITY.tolerance!` yielded `undefined`
(the `!` hid it from the type system). Every `deviation <= undefined` is
false, so **all** geometry subdivided to the maximum depth regardless of
profile — the documented draft/interactive/high/export tolerances had no
effect. `WARP_QUALITY_TOLERANCE` existed for this and was never consulted.

Fixed with `resolveWarpTolerance` (profile is the source of truth). The warp
property/fuzz suite dropped from **17.0s to 1.3s**, confirming the scale of
the over-subdivision.

### 4. Overlay drew two envelope edges backwards

The evaluator interpolates `bottom` bl→br and `left` tl→bl (each edge
parallels the one opposite it). `WarpOverlay.edgePoints` drew them as a CCW
perimeter loop (br→bl, bl→tl), so the rendered cage disagreed with the
geometry it controls as soon as an edge's two controls differed. An identity
(straight) envelope hides this. Overlay corrected to the evaluator's
parameterization; locked by a test in `warpGeometry.test.ts`.

### 5. Cage drag math (two defects)

- Drag deltas were CSS pixels passed into a function expecting world units,
  so handles diverged from the cursor at any zoom ≠ 1. Now routed through
  `screenDeltaToWorld` (which already existed in `@varve/shared`).
- `normFromLocal` subtracted `sourceBounds.x/y` while every call site fed it
  a **delta**, adding a constant bias for any node whose local bounds do not
  start at (0,0) — ellipses (`cx - rx`), stars, polygons, most paths. A rect
  authored at the origin has `x === 0`, which hid it. Renamed to
  `normDeltaFromLocal` and corrected.
- Pointer moves applied the cumulative delta from drag start to the *already
  updated* modifier, compounding on every event. The modifier is now
  snapshotted at drag start.

### 6. Accessibility was aria-label only

Cage and mesh handles had `aria-label` but no `tabIndex`, no key handling,
and the overlay root was `role="presentation"` — so no part of the warp cage
was reachable or operable by keyboard, against §34. All handles are now focus
stops with arrow-key nudging (Shift = coarse, one undo step per press,
through the same `DragApply` used by dragging), Space/Enter mesh multi-select,
and announcements in the required format
(`Mesh point, row 2 of 4, column 3 of 4. X 64 percent, Y 41 percent.`).

### Also corrected

- Bicubic mesh interpolation is implemented (Catmull–Rom), not "schema-
  validated, not evaluated".
- Mesh row/column changes resample the existing deformation instead of
  resetting the grid.
- `normToLocal` no longer throws on a structurally malformed modifier
  (missing/non-finite control) — it degrades to the source origin, per §35.

### Verification status at end of pass (2026-08-07)

| Check | Result |
| --- | --- |
| `packages/engine` + `packages/scene` + `packages/codegen` unit | 416 files / 5823 tests, 0 failures |
| codegen + warp + scene (re-run after final edits) | 71 files / 1029 tests, 0 failures |
| `tests/e2e/canvas/warp-visual.spec.ts` (new) | 7/7 passed — all five cage kinds render, keyboard-only cage editing, mesh announcements |
| `tests/e2e/canvas/warp.spec.ts` | 2/3 passed; mesh workflow **not verified** (see below) |
| biome (all changed files) | clean |
| tsc (`engine/warp`, `codegen`, `editor` warp files) | clean |

**Blocked, not failing:** the mesh E2E workflow could not be completed because
the app stopped booting mid-session —
`editor/src/history/editorHistorySession.ts` (untracked, from concurrent work
on this machine) imports `findBranchMergeBase` from `@varve/history`, and the
matching `packages/history` export is sitting in `stash@{0}`
("user-wip-visual-test") rather than the working tree. Every E2E run after
that point dies with
`PAGEERROR: ... does not provide an export named 'findBranchMergeBase'`.
The warp-specific part of that test *was* confirmed earlier in the session:
the mesh-handle count assertion (`toBe(25)`, line 176) passed after the
accessible-name change, and the run got as far as line 197. Re-run once the
history export is restored.

**Note on flakes:** an earlier full-suite run reported 3 failures including
`packages/engine/src/bench/imageEnhancement.bench.test.ts`. That bench also
fails on the baseline with this pass's `geometry.ts` stashed out, and the run
was sharing the machine with Playwright; on a quiet machine the same suites
are green.
