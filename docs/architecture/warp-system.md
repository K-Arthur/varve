# Non-Destructive Vector Warp and Envelope Distort

- **Status:** Implemented (v1 vertical slices), Milestones 1–5
- **Date:** 2026-08-05
- **ADRs:** 0155–0169

Varve's native warp system: skew, four-corner perspective, four-edge Bézier
envelopes, bilinear mesh warp, and parameterized bend presets — all as live,
source-preserving geometry modifiers on the canonical document.

## 1. What the user can do

1. Select compatible content (shape / text / group / frame).
2. Activate the **Warp tool** (`W`, toolbar, Object menu, command palette)
   — a live modifier is added (one undo step) and the cage overlay appears.
3. Drag cage/mesh handles directly on the canvas; numeric controls in the
   Inspector (`Warp` section); Escape aborts the in-flight drag.
4. Keep editing the original content (text stays text; path edits re-derive
   the warp from normalized controls).
5. Save/reopen, copy/paste, undo/redo — the modifier stack persists.
6. Export SVG (baked vector), PDF (raster path), PNG/JPEG/WebP (live canvas).
7. Disable or remove the modifier — the exact source is restored.
8. Expand Appearance (destructive bake, one undo step) only when requested.

## 2. Core principle

Warp is a **live, source-preserving geometry modifier**. The canonical
document retains the original geometry, an ordered modifier stack, control
data in normalized coordinates, evaluation settings, and derived tessellation
that is always disposable and reproducible. The source is never rewritten;
the tessellated result is never the only stored representation.

Forbidden implementations (per task): CSS transforms, canvas-only display
state, screenshots, destructive point rewriting, Inspector-local state,
export-only geometry, AI scene patches, hidden duplicate nodes.

## 3. Data model

On `NodeBase` (`packages/scene/src/types.ts`, v2.16):

```ts
warps?: WarpModifier[];        // ordered stack, cap 8
warpSettings?: WarpSettings;   // quality/stroke/foldover/layout policy
```

Modifier kinds (`packages/engine/src/warp/types.ts`):

| Kind | Controls | Notes |
|------|----------|-------|
| `skew` | skewX, skewY (deg), origin (normalized) | exact affine around pivot |
| `perspective` | 4 corners (normalized) | exact homography (DLT) |
| `envelope` | 4 corners + 8 edge controls | Coons-patch interior |
| `mesh-warp` | rows/columns/points | bilinear cells (bicubic deferred) |
| `bend` | mode, amount, axis, origin, wavelength | arc/arch/bulge/shell/flag/wave/rise |

Validation: known kinds sanitized on ingest (finite values, clamped ranges,
mesh dimension caps, stack cap); unknown future kinds preserved inert with
diagnostics. Migrations: `2.15 → 2.16` (`warpMigration.ts`) sanitizes
`warps`/`warpSettings` on load.

## 4. Coordinate spaces

```
source-local (geometry)
  → normalized-source (controls: 0..1 over current source bounds)
  → modifier-local (per-kind maps)
  → node-local → parent-local → world → viewport
```

- Default `coordinateSpace: 'normalized-source'`: source resizes → cage
  scales with it (normalized deformation preserved).
- `'source-local'`: absolute controls; fixed cage when the source changes.
- Zero/near-zero bounds → identity maps; never NaN.
- Envelope edge controls bounded to [-2, 3] (curved edges bulge outside).

## 5. Operation order (single canonical pipeline)

```
canonical source content
→ source-local path generation (shapeToPathPoints, handles preserved)
→ leaf's own warp stack (array order, first-applied first)
→ affine chain to the warped container
→ container warp stack
→ stroke treatment (per strokeBehavior policy)
→ clipping/masking (straight clip boxes in local space)
→ object transform (world)
→ visual effects (after deformation)
→ compositing
→ export conversion (same evaluator, export tolerance)
```

Enforced by one evaluator used by: Canvas2D replay, render worker,
WebGPU-fallback, hit testing, visual bounds, SVG export, PDF raster path,
raster export, Expand Appearance. No backend may use a different order.

## 6. Evaluator

`packages/engine/src/warp/geometry.ts` — pure, deterministic:

- **Maps**: skew (affine), perspective (homography from the existing
  `mockup/homography` DLT, singular/degenerate cages degrade to identity
  with a flag), envelope (allocation-free Coons patch), mesh (bilinear),
  bend (ported from `scene/textWarp.ts` math, phase-shifted by origin).
- **Shape → path**: exact conversion (rect/ellipse/polygon/star/line/path,
  cubic handles preserved); holes/fill rules preserved.
- **Adaptive subdivision**: output-space flatness (mapped control points),
  mapped-endpoint reuse, depth + point budgets, exact-duplicate cleanup,
  non-finite fallback to source points. Quality profiles map to absolute
  tolerances: draft 2 / interactive 0.5 / high 0.25 / export 0.1 px.
- **Bounds**: conservative sampled bounds (points + 24×24 grid + pad) —
  `warpDomainBounds`, `warpBoundsOfPoints`, `warpBoundsOfWarpedPoints`.
- **Foldover**: Jacobian determinant sampling (24×24 grid), inverted/
  collapsed cell counts, source-space regions, severity; policy
  `prevent` (drag revert) / `warn` / `allow`.
- **Text**: per-cluster affine adjustments from the Jacobian
  (`warp/text.ts`), consumed by the renderer's existing `drawClusters`
  glyphAdjustments path — text stays text.
- **Diagnostics**: `warpDiagnostics` counters (evaluations, generated
  points, non-finite fallbacks, caps, invalid cages) — no artwork data.

## 7. Source vs. derived geometry

| Concept | Where | Notes |
|---------|-------|-------|
| Canonical source | scene node | never rewritten |
| Evaluated (warped) | engine node `shape` / text `glyphAdjustments` | derived per node change |
| Interaction preview | same evaluator, `interactive` | memoized by node reference |
| Export geometry | same evaluator, `export` | identical output contract |
| Caches | `EngineNodeMemo` + `SubtreeIrCache` | keyed on immutable node reference — warp edits change the reference, so no stale cache |

Disabling a modifier never requires reverse-warping: the source was never
touched.

## 8. Bounds and layout

- `nodeLocalBounds`/`nodeWorldBounds` are warp-aware (conservative evaluated
  bounds) — selection, culling, dirty regions, snap follow the visible shape.
- Layout (`w`/`h`, auto-layout, constraints) uses **source bounds**
  (`layoutBounds: 'source'`, the only evaluated value) — no reflow loops.
  `'visual'` is accepted by schema, shown disabled in the Inspector.

## 9. Stroke / paint policy

- `preserve-width` (default): centerline warped, width preserved.
- `warp-appearance`: stroke expanded to outline before warp (contract
  defined; full variable-width/dash/arrow fidelity is a follow-up).
- `scale-approx`: validated, not shipped (needs visual justification).
- Gradients: `deform-with-object` (default) — geometry warp carries the
  fill; `object-paint-space` for affine-only warps. Image fills under warp
  render warped; SVG bakes with a warning comment.

## 10. Text behavior

Per-cluster affine warp (see §6) with documented scope gates: plain
single-line LTR text, point/area mode, no rich text / path text / tabs /
case transforms. Unsupported cases render unwarped with the reason exposed
to the Inspector. Expand Appearance bakes adjustments into
`glyphAdjustments` (text stays text).

## 11. Groups and components

- Multi-selection → shared warp group (one envelope, one undo step).
- Warped containers evaluate descendant leaves into vector items
  (`editor/warp/warpContainerRender.ts`) — children stay editable.
- Components: warps propagate via existing deep-clone propagation;
  instance warp overrides deferred (documented).

## 12. Rendering

- Leaves: `sceneToEngine` evaluates the warp into the engine node's shape /
  text adjustments — zero changes to `replayIr`/`paintText`.
- Containers: a gated branch in `CanvasArea.replaySubtreeToCtx` forces the
  flatten path and paints evaluated items (vector, not raster).
- WebGPU: anything outside its solid-shape subset falls back to Canvas2D —
  warp never depends on GPU.
- Rust IR (`varve-engine`) is a pass-through; warp evaluation is webview
  side, shared by every backend (ADR-0167).

## 13. Hit testing

Warped leaves evaluate draft-quality geometry; warped containers evaluate
descendant items. Selection follows the visible shape. Inverse mapping is
explicitly not used (non-unique under foldover). Deep selection inside
warped containers resolves to the container in v1.

## 14. Canvas UX

- **Warp tool** (`W`): adds/activates a modifier; Escape exits to select.
- **WarpOverlay**: screen-constant handles; cage + edge handles (envelope),
  grid + points (mesh, shift multi-select), corner handles (perspective),
  pivot + shear handles (skew), strength handle (bend); foldover warning
  (text + icon, never color-only); Escape aborts the drag
  (abortTransaction); pixel-grid snap when snapping is enabled.
- **Warp Section (Inspector)**: ordered stack (enable/rename/duplicate/
  reset/reorder/remove), per-kind numeric controls, preset quick-add,
  settings (stroke behavior, foldover policy, layout bounds), Expand
  Appearance with warning, Remove All Warps.
- All colors trace to design tokens; handles have high-contrast and
  reduced-motion variants (`WarpSection.css`).

## 15. Multimodal boundary

Typed `WarpPlan` + `validateWarpPlan` (reject non-finite/unknown kinds/
oversized meshes/structural mismatch). v1 ships deterministic builders
(`perspectiveFromQuad`, `fitEnvelopeFromPath` with fit-error metric).
Image-reference analysis is a documented extension behind the same boundary
with ADR-0201 privacy rules (no upload by default, no image text as
instructions). Manual warp works fully offline.

## 16. Limits (v1)

| Limit | Value |
|-------|-------|
| Modifiers per node | 8 |
| Mesh cells per axis | 1..32 (validated) |
| Mesh points | (rows+1)×(columns+1) |
| Subdivision depth | 14 (per segment) |
| Generated points per node | 50 000 (default) |
| Envelope edge controls | [-2, 3] normalized |
| Bend amount | [-1, 1] |
| Bend wavelength | 1..8 |

At a limit: source preserved, visible message, lower-quality option or
cancel — never a hang or silent memory exhaustion.

## 17. Known limitations (documented, follow-ups)

- Text: multi-line/RTL/rich-text warp deferred; true glyph outlines via the
  Rust shaping backend.
- Bicubic mesh interpolation: schema-validated, not evaluated.
- `warp-appearance` stroke fidelity (variable width/dash/arrowheads).
- `scale-approx` stroke mode and `canvas-fixed` gradient mode not shipped.
- Warped-container Expand Appearance unsupported (use export flattening).
- Deep selection inside warped containers resolves to the container.
- Worker offload + Rust/WASM evaluator port (must match tolerances).
- Image-reference (vision) proposals behind the typed boundary.

## 18. Files

Engine: `packages/engine/src/warp/{types,geometry,text,plan,fit,index}.ts`
+ `__tests__/` (39 unit + property tests).
Scene: `types.ts` (warps/warpSettings), `warpOps.ts`, `warpMigration.ts`
(2.16), `warpBounds.ts`, `expandWarp.ts`, `nodeBounds.ts`,
`coordinateService.ts` + tests.
Editor: `tools/WarpTool.ts`, `components/WarpOverlay.tsx`,
`components/Inspector/sections/WarpSection.{tsx,css}`, `warp/warpActions.ts`,
`warp/warpContainerRender.ts`, `render/sceneToEngine.ts`,
`hitTest/HitTestEngine.ts`, `CanvasArea.tsx` (gated container branch),
`CanvasOverlays.tsx`, toolbar/shortcuts/palette/menus, Inspector registry,
feature ownership, context state (`useWarpEdit`).
Export: `packages/codegen/src/svg.ts` (warp bake), `flattening.ts`
(mustFlatten `warp`), `ir-types.ts`; editor `SpecPanel/export.ts`
(PDF raster fallback).
E2E: `tests/e2e/canvas/warp.spec.ts` (3 workflows).
