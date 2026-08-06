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
