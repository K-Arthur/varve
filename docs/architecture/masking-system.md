# Masking System — Architecture & Canonical Semantics

Status: current-state documentation (2026-08-07). Supersedes the ad-hoc mask
notes spread across session docs.

This document defines Varve's masking/clipping model, its invariants, the
canonical compositing order, renderer parity, export semantics, and the
effect-targeting system. Read it before adding mask behavior: the system is
deliberately one coherent subsystem, not a pile of per-feature special cases.

---

## 1. Canonical terminology

| Term | Meaning |
|---|---|
| **Mask** | A single object attached to a container node (`mask` on `NodeBase`). Exactly one of three source forms: a **child node** (`sourceNodeId`), a self-contained **vector path** (`vectorMask`), or a **raster PNG** (`rasterMask`). |
| **Clipping mask (clip group)** | A `GroupNode`/`FrameNode` whose `mask.type === 'clip'` and whose `sourceNodeId` points at one of its own children. Every *other* child is clipped to the matte. This is the "create clipping mask" workflow. |
| **Matte / mask source** | The node supplying mask data. It remains a real, editable scene node. |
| **Vector clip / clip path** | A geometric path (`vectorMask` or a traced node outline) that decides inside/outside with a fill rule (`nonzero`/`evenodd`). |
| **Alpha mask** | Mask alpha (`A`) controls target opacity. |
| **Luminance mask** | Mask luminance (`L·A`, BT.709 coefficients in linear RGB) controls target opacity (SVG 1.1 §14.4 semantics). |
| **Raster mask** | A document-owned PNG payload (`Document.rasterMaskAssets`) supplying mask pixels. Attaches to image-filled shape nodes (`source-image-pixels` space) or frames (`container-local-pixels` space); must be `type: 'alpha'`. |
| **Brush mask** | A raster mask created/edited by painting with the brush tool (`refineMask`): paint reveals, Alt+paint hides, pressure/coalesced events supported. Images and frames both support paint-to-create — no background removal required. |
| **Layer mask** | A mask attached to a single node (leaf raster masks; container masks). |
| **Group mask** | A mask attached to a group: group children composite, then the mask modulates the group's result. |
| **Effect mask** | A mask attached to an **adjustment node**: it limits *where* the adjustment's result is visible. |
| **Adjustment scope** | Controls *what* content an adjustment processes (`AdjustmentScope`). Distinct from any spatial mask: scope = input set, mask = output region. They compose (see §6). |
| **Frame clipping** | `FrameNode.clipContent` (default true) clips children to the frame quad. Composes with a mask as an intersection. |
| **Hide mask source** | `hideMaskSource`: the matte still supplies mask data but is not rendered as visible content. |
| **Boolean operations** | Path union/intersection/subtract are destructive geometry operations — not masks. They are modeled separately and never conflated. |

**Not conflated:** a "clipping mask" (relationship between sibling scene
objects) is *not* the same as an alpha mask, a luminance mask, a vector clip,
or an effect target scope. The model has separate, typed concepts for each.

## 2. The clipping relationship

Representation (option C in the design space — a dedicated container):

```
GroupNode / FrameNode (mask: { type: 'clip', sourceNodeId: <matte>, hideMaskSource: true })
├── Matte (child 0 by convention, a real editable node)
├── Clipped content A   (every other child is clipped content)
├── Clipped content B
└── Clipped content C
```

- The relationship lives entirely in the container's `mask` + its children
  list; there is no separate edge entity to keep in sync.
- **One matte clips any number of siblings** — inserting another ordinary
  item into the run just clips it (no migration needed). Moving the matte
  within the run keeps the relationship (it must remain a direct child).
- `canBeClipMaskSource` governs which nodes can be mattes: shapes (except
  line/arrow and open paths), and frames. Live text and groups are excluded
  (no tracable outline); text must be outlined first — this is an explicit
  limitation, not an oversight.
- **Adjustment nodes cannot be mask sources for frame/group containers**
  (they have no renderable geometry). An adjustment's *own* mask may
  reference any node.

### Invariants (enforced)

- A mask source must be a direct child of its container (frames/groups;
  adjustments may reference any node).
- `sourceNodeId` may never dangle: `removeNode` clears masks referencing a
  removed node; `reparentNode` **releases the container's mask when the
  matte leaves the container** (a plain drag/reorder can never corrupt the
  graph); in-container reorders keep the mask.
- Mask reference graph is acyclic: `addMask` and `setMaskSourceNode` both
  run `detectMaskCycles` and reject cyclic masks. The only reachable cycle
  shape is adjustment↔adjustment (only adjustments may mask arbitrary
  nodes).
- `validateMasks`/`validateClippingMasks` detect dangling sources,
  adjustment-as-source, and structural violations; malformed documents load
  without crashing (the renderer treats a missing source as "no mask").

### Editing behavior

| Operation | Behavior |
|---|---|
| Reorder inside the run | Relationship preserved. |
| Insert between clipped layers | New item is clipped too. |
| Move matte within container | Preserved (still a child). |
| Move matte out of container | Mask released (container shows content unclipped); matte itself untouched. |
| Delete matte | `removeNode` clears the mask; group content renders unclipped. Undo restores everything. |
| Duplicate (in-document) | Matte id and scope target ids remap to the cloned copies. |
| Copy/paste (cross-document) | Ids inside the pasted subtree remap; **foreign mask sources/targets are dropped** (the item is pasted unclipped; a vector mask keeps its geometry). |
| Group / ungroup | Standard container ops; group becomes a clipped child of the run. |
| Undo/redo | One gesture = one history entry (all mask ops are single `updateDoc` mutations). |

## 3. Mask parameters

| Parameter | Semantics |
|---|---|
| `inverted` | `mask = 1 - mask`. For clips: content inside the region is hidden, outside visible. |
| `density` (0..1) | Scales mask contribution; 1 = full effect, 0 = no effect. Works on clip masks too (partial clip via alpha compositing). |
| `feather` | Gaussian blur of the mask alpha. Units: world pixels (mask-local), so it does not vary with viewport zoom. Works on clip masks (soft edge). |
| `linked` | Default true: the mask follows the matte's world transform. `false`: the mask uses its own `transform`. |
| `transform` | The independent mask transform when `linked === false`. |
| `hideMaskSource` | Matte supplies mask data without rendering as content. Hit-testing and editability of the matte are unaffected. |
| `visible` | When false the mask is ignored entirely. |
| `fillRule` | `nonzero` (default) / `evenodd` for clip and vector masks. |

## 4. Canonical compositing order

For a masked container:

```
container children (matte + clipped content, each: source content → local
effects → own layer mask) 
→ clip/mask application (clip path, alpha, or luminance; invert → feather →
density order)
→ [matte rendered on top unless hideMaskSource]
→ group opacity / blend mode / isolation
→ parent composition → adjustment layers → group masks
```

Decisions (each was settled by the renderer's existing structure and is
tested — see `replayScene.test.ts` and the E2E corpus):

1. **A layer's own effects run before clipping.** Effects (blur, bloom,
   shadow) expand within the node, and the clip constrains the expanded
   output: clipped effects cannot escape the matte. There is no per-effect
   "escape" toggle — effect output is always confined by the matte. This is
   uniform across live canvas, export replay, and SVG codegen.
2. **A layer mask (on a leaf) and a clipping mask compose as an
   intersection** — the leaf renders with its own mask, then the clip
   boundary applies.
3. **Matte effects contribute to mask alpha.** The matte is replayed as
   ordinary content into the mask surface, so its fills, strokes, effects,
   and transforms all shape the mask (alpha/luminance) or its outline
   (clip).
4. **Matte opacity does not affect clipping strength.** Clip type uses the
   geometry; alpha/luminance types use the rendered matte pixels. Use
   `density` to weaken a mask.
5. **A hidden matte still clips.** `visible === false` on the *matte node*
   hides its content but the mask stays active (the mask has its own
   `visible` flag). `hideMaskSource` is the explicit "invisible matte" mode.
6. **Group opacity applies after masking** (masked surface composites with
   the group's opacity/blend); isolated groups composite their masked
   surface before blending.
7. **Frame quad clip ∩ mask** = intersection (content must satisfy both).
8. **Adjustments inside a clipped run are confined by the matte** — the
   adjustment's filtered backdrop is composited inside the clip scope, so
   its output cannot leak outside the matte.
9. **Raster masks apply only to image-filled shapes** and are resolved to
   `FillIR.alphaMask`; they never conflict with structural masks.

## 5. Effect targeting

`AdjustmentNode.scope` (v2.3+) is the single targeting mechanism:

```ts
type AdjustmentScope =
  | { mode: 'image-local'; targetNodeId }          // the layer below, explicitly
  | { mode: 'explicit-targets'; targetNodeIds[] }  // arbitrary set, stable ids
  | { mode: 'container-descendant'; containerId; includeNested }
  | { mode: 'document' };
```

- Scopes store **ids, never names or computed lists** — renaming, reparenting,
  and moving targets is safe; save/reopen is stable.
- Missing/deleted targets are silently dropped at resolution; one dead target
  never fails the whole adjustment. Undo restores deleted targets.
- Recursive target graphs are structurally impossible (a target list cannot
  contain the adjustment's own subtree via `resolveAdjustmentScope`, which
  skips adjustment children; cycle prevention mirrors the mask graph).
- `resolveAdjustmentScope` is the only resolver; the editor live renderer,
  export flattening, and the inspector all consume it.

### Spatial mask × scope compose

```
Adjustment
├── scope     → WHAT content is processed (input set)
└── mask      → WHERE the result is visible (output region)
```

The mask is applied to the filtered backdrop in place (`destination-in`):
outside the mask the backdrop keeps its original pixels, so the underlying
content shows through untouched. A plain hard clip skips the ImageData
round-trip; alpha/luminance masks (and clips with invert/feather/density)
use the post-processing path. Implemented in the live canvas
(`CanvasArea.tsx` adjustment branch) and the export replay
(`replayScene.ts`), with unit tests in both.

## 6. Renderer support matrix

| Capability | Canvas2D (live) | Canvas2D (export `replayScene`) | WebGPU compositor | Native (Tauri webview) | SVG codegen |
|---|---|---|---|---|---|
| Vector clip (hard) | ✓ `ctx.clip()` | ✓ `ctx.clip()` | falls back to structural Canvas2D | ✓ (webview Canvas2D) | ✓ `<clipPath>` |
| Alpha mask | ✓ destination-in | ✓ destination-in | falls back | ✓ | ✓ `<mask mask-type="alpha">` |
| Luminance mask | ✓ | ✓ | falls back | ✓ | ✓ `<mask>` |
| Invert | ✓ | ✓ | falls back | ✓ | ✓ |
| Feather | ✓ | ✓ | falls back | ✓ | ✓ (feGaussianBlur) |
| Density | ✓ | ✓ | falls back | ✓ | ✓ (alpha rect) |
| Unlinked transform | ✓ | ✓ | falls back | ✓ | ✓ (`maskUnits=userSpaceOnUse`) |
| Hide mask source | ✓ | ✓ | falls back | ✓ | ✓ |
| Nested masks | ✓ | ✓ | falls back | ✓ | ✓ |
| Clipping stack (multi-content) | ✓ | ✓ | falls back | ✓ | ✓ |
| Group opacity/blend after mask | ✓ | ✓ | falls back | ✓ | ✓ |
| Frame clip ∩ mask | ✓ | ✓ | falls back | ✓ | ✓ |
| Raster mask (leaf image) | ✓ (engine `alphaMask`) | ✓ | ✓ via engine IR | ✓ | ✓ |
| Brush mask (frame, container-local) | ✓ (alpha path) | ✓ | falls back | ✓ | ✓ `<mask>`+`<image>` |
| Adjustment scope | ✓ | ✓ | falls back | ✓ | rasterized per boundary |
| Spatial mask on adjustment | ✓ | ✓ | falls back | ✓ | rasterized per boundary |

**WebGPU:** the compositor renders leaf IR primitives only. Structural
compositing — masks, clips, flattening, adjustments — is Canvas2D by
design and forces the structural path (`sceneNeedsStructuralCompositing`).
This is a documented fallback, not a bug: WebGPU-active documents retain
full mask fidelity through the 2D structural path, and GPU loss preserves
document state (mask relationships, parameters, and scopes live in the
document, never in GPU resources).

**Native (Tauri):** the native side renders IR through the same webview
replay; mask semantics are identical to the web build. The Rust crates are
mask-blind at the IR level (only `alphaMask` on image fills crosses the
wire) — masks are a scene-graph semantic applied by the webview renderer
for every backend.

## 7. Export semantics

- **Raster (PNG/JPG/WebP):** `exportNodeAsRaster` replays through
  `replayStructuredScene` — the same structural renderer as the live canvas.
  Masks, clipped effects, adjustment scopes, and spatial masks reproduce
  exactly. Adjustment layers render (filtered backdrop composite) rather
  than being dropped.
- **SVG:** `@varve/codegen` emits native constructs — `<clipPath>` for
  vector clips, `<mask>` for alpha/luminance, `feGaussianBlur` for feather,
  density rects, inversion rects, `userSpaceOnUse` for unlinked masks.
  Mask sources referenced by the group are omitted when
  `hideMaskSource` is set.
- **PDF/print:** unsupported mask combinations are rasterized at the
  smallest possible boundary (the flatten compositor widens adjustment
  boundaries to the shared ancestor of scope targets); masks are never
  silently dropped. Preflight still flags structural clip/alpha/luminance
  masks for PDF targets where the Rust writer has no native clipping
  operator or soft-mask support (raster fallback covers those combinations);
  PDF/X-1a cannot express soft masks at all and requires explicit
  flattening.
- **Limitation:** a spatial mask whose source lies outside the exported
  subtree cannot render in raster export (the source isn't flattened into
  the boundary surface). The common case — adjustment + matte inside one
  container — is fully supported.

## 8. Hit-testing and selection

- `HitTestEngine.isPointVisibleThroughClipMasks` walks ancestors and
  excludes points outside active clip masks (respecting unlinked
  transforms, fill rules, and inversion). Clipped-away pixels do not steal
  ordinary canvas clicks; the Layers panel always allows selecting hidden
  or fully clipped objects.
- Selection/transform bounds intentionally remain **source bounds**:
  a 4000×3000 photo inside a circle matte stays movable/resizable beyond
  the matte (the photo is never destructively cropped). Bounds intersect
  only for export/crop decisions (`imageBounds.ts`).

## 9. Performance notes

- The ordinary no-mask path is untouched: the mask branch runs only for
  masked containers; plain hard clips use `ctx.clip()` with no offscreen
  allocation.
- Offscreen mask surfaces come from a bounded pool
  (`acquireMaskSurface`/`releaseMaskSurface`, 16 surfaces max) instead of
  per-frame `document.createElement`; `renderEnhancedMask` and
  `applyMaskAlpha` use the pool.
- Feathered/alpha/luminance masks cost one full-viewport surface per masked
  container per frame; inverted clips reuse the same path. Whole-canvas
  invalidation is avoided by existing dirty-region pruning (mask subtrees
  force full-subtree replay only for themselves).
- The hot per-node switch in `CanvasArea.tsx` was not restructured for
  masks (the mask branch is a prelude, not part of the leaf dispatch).

## 10. Accessibility

- Layers rows expose the relationship textually: the matte row is labelled
  as clip source and clipped rows as clipped content (aria + visible chips),
  not just indentation/color.
- All mask operations are keyboard- and menu-reachable:
  `Ctrl+7` create, `Ctrl+Alt+7` release, plus Object menu, Layers context
  menu, canvas context menu, and command palette entries for
  add/remove/toggle/invert mask and mask parameters.
- The drop preview on a matte row announces "Clip to <name>" and the drop
  announces the resulting relationship via the live region.

## 10b. Quick-mask mode

Quick-mask is a transient editor state for selection editing (painting mask
coverage over the canvas). It is NOT part of the document model: it is never
serialized, is cleared on document close, and does not participate in
undo/redo. `exitQuickMask(convertToMask?)` may convert the coverage buffer
into a leaf raster mask when requested.

## 10c. Edge-case matrix

| Case | Behavior |
|---|---|
| Empty/open path as mask source | Rejected for clipping-mask creation (`canBeClipMaskSource`) |
| Fully transparent mask source | Alpha mask hides all masked content |
| Fully opaque mask source | Alpha mask reveals all masked content |
| Mask source not a child (frames/groups) | `resolveMask()` returns null; mask ignored |
| Adjustment node as mask source | Rejected at `addMask`/`setMaskSourceNode`; `validateMasks` flags legacy docs; renderers skip the clip (content renders unmasked, never vanishes) |
| Inverted clip with no children | Alpha-path inversion has no visible effect |
| Zero-size offscreen canvas | `renderEnhancedMask`/`applyMaskAlpha` return early |
| Masks on invisible containers | Container visibility check runs first |
| Deeply nested masks | Each container's mask resolves independently per pass |
| Cross-origin images in a mask | `getImageData` may fail (tainted canvas); falls back to unprocessed `destination-in` |
| Vector mask with no child source | Purely geometric; no visual content rendered |
| Both `sourceNodeId` and `vectorMask` present | Vector path = geometry, source node = visual content |
| `evenodd` vector clip | Filled/clipped with `evenodd` |
| Mask source deleted | `removeNode()` clears the mask |
| Mask source reparented out of the container | `reparentNode()` releases the mask |
| Brush mask on a group | Rejected (`addRasterMaskAsset` is frame/image-only) |
| Frame brush mask asset still decoding | Container renders unmasked this frame, decode kicked |
| Frame brush mask source identity | Must be `{kind:'source-metadata', locator:'container-local'}` |
| Mask cycle (adjustment↔adjustment) | Rejected by `addMask`/`setMaskSourceNode` |
| Unlinked mask transform | Mask uses its independent `transform` |
| SVG export of inverted clip masks | `<mask>` with white rect + black clip shape |
| SVG export of an active-page clipping group | Editable `<clipPath>`, hidden source omitted from children |
| Old document with an adjustment mask source | Loads; mask ignored by renderers; `validateMasks` reports it |

## 10d. Brush masks (painted raster masks)

Brush painting is the pixel-level mask editing surface:

- **Where it works:** image-filled shapes (mask space = `source-image-pixels`,
  1:1 with the source image) and frames (mask space =
  `container-local-pixels`, 1:1 with the frame's local units, stretched with
  the container transform; capped at 2048px per side).
- **Paint-to-create:** the tool creates a fresh fully-transparent mask when
  the selected image/frame has none — no background removal required. Paint
  reveals, Alt+paint hides, `[`/`]` resize the brush, `Shift+[`/`]` adjust
  hardness, pressure modulates opacity, coalesced pointer events keep
  strokes seamless.
- **Commit & undo:** each stroke commits through `commitRasterMask`
  (immutable versioned assets `mask-{nodeId}[-v{N}]`) inside one
  transaction — one gesture, one undo step.
- **Entry points:** canvas right-click → Paint Mask… (images and frames),
  Mask section (frames) → Paint mask… / Create brush mask…; the tool leaves
  via `Escape`/`V`.
- **Rendering:** the live canvas and export replay draw the asset stretched
  over the frame's local box under its world transform (alpha path with
  invert/feather/density post-processing available); while an asset decodes,
  the container renders unmasked rather than disappearing. SVG export emits
  `<mask maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">`
  with an embedded `<image>` over the frame's box.
- **Quick-mask mode** (transient selection-editing coverage in editor state)
  is a separate, still-unwired concept — it is not a document mask and is
  not part of this pipeline.

## 11. Adding a future mask type

1. Extend `MaskType` and the `Mask` union in `packages/scene/src/types.ts`;
   add a migration step in `packages/scene/src/version.ts` (version table +
   `version-migrations.ts`).
2. Extend `validateMaskSource` / `validateMasks` invariants.
3. Extend `renderEnhancedMask`/`applyMaskAlpha` post-processing in
   `packages/engine/src/maskCompositing.ts` (all renderers share it).
4. Extend `maskCapability.ts` per-format declarations and the SVG codegen
   emitter; raster export picks it up automatically via `replayScene.ts`.
5. Add the parameter surface to `MaskSection.tsx` and E2E coverage.

## 12. Known limitations

- Live text and groups cannot be mattes (`canBeClipMaskSource`); text must
  be outlined first.
- Per-effect masks on ordinary layers (masking a single bloom on an image
  without a layer mask) are not modeled; use a masked adjustment layer for
  that workflow.
- Spatial-mask sources outside the exported subtree are not rasterized in
  export.
- The mask cache is document-version-keyed (full re-render on any document
  change); no per-mask raster cache yet.
