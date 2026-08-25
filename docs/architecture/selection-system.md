# Selection System

Varve has two independent selection domains that must not be conflated, plus
two persistence mechanisms layered on top of them. This doc is the
current-state contract for all four; treat it as canonical over the dated
audit/plan records below, which capture point-in-time snapshots.

Evidence trail: `docs/audits/selection-system-audit-2026-08-23.md` (gap
analysis before this work), `docs/plans/archived/selection-system-implementation.md`
(phased plan, archived — implemented), `docs/audits/selection-validation-report-2026-08-23.md`
(delivery + final validation, including the UI wiring landed after the plan's
"pending" notes were written).

## The domains

```
NODE SELECTION                          AREA SELECTION (pixel/coverage)
───────────────                         ────────────────────────────────
Data: NodeId[] (ordered)                Data: AreaSelection (expression tree)
Storage: EditorState.selection          Storage: EditorState.areaSelection
  (ephemeral session state)               (ephemeral session state)
UI: SelectionOverlay (handles, bbox)    UI: marching-ants boundary overlay
Ops: click, shift-click, marquee,       Ops: marquee, object-space AND pixel-
  object lasso, Tab, arrow keys           space lasso, paint, refine, transform,
                                           image-derived sources
Persistence: Selection Sets              Persistence: Saved Area Selections
  (document.selectionSets)                (document.savedAreaSelections)
```

Node Selection and Area Selection are independent state — a node selection
and a pixel selection can both be active at once and are not derived from
each other. Selection Sets (named node-ID groups) and Saved Area Selections
(named coverage snapshots) are separate persistence mechanisms; do not
conflate "saved node group" with "saved pixel selection."

## Area selection tools

| Tool | Produces | Notes |
|---|---|---|
| `MarqueeTool` (rectangle/ellipse) | `RectangleSelectionShape` / `EllipseSelectionShape` | Fixed ratio/size/from-center; shift/alt/shift+alt for add/subtract/intersect |
| `LassoTool` → `ObjectLassoTool` adapter | node selection | Freehand + polygonal, unchanged from before this work |
| `PixelLassoTool` (`packages/editor/src/tools/PixelLassoTool.ts`) | `PolygonSelectionShape` | Freehand + polygonal modes via the shared `LassoGesture` engine (`lassoGesture.ts`) — no duplicated gesture logic with the object lasso |
| Selection Paint / Quick Mask (`SelectionPaintTool`, `quickMask` state in `packages/editor/src/context.tsx`) | `RasterMaskSelectionShape` | Explicit Apply/Cancel session; one undo entry per completed stroke; reachable from the Photo/Draw toolbar flyout and the Pixel Selection menu |

All area-selection shapes compose through `combineAreaSelections()` into a
binary expression tree (`add`/`subtract`/`intersect`; `replace` discards the
prior tree). Rasterization is bounded (`MAX_AREA_SELECTION_PIXELS` = 16.7M,
`MAX_AREA_SELECTION_DIMENSION` cap) and happens per-consumer-request, never
eagerly for the whole canvas.

## Image-derived sources

`packages/engine/src/areaSelectionImage.ts`: `areaSelectionFromImageAlpha`,
`areaSelectionFromImageLuminance` (proportional coverage, optional
`threshold`/`invert`), `areaSelectionFromColorRange` (OKLab perceptual
distance via `@varve/shared`, `tolerance` + `feather` band, global or
contiguous flood-fill). All produce bounded `RasterMaskSelectionShape`s over
the image frame. Exposed as **Select from Image Alpha**, **Select from Image
Luminance**, and **Magic Wand from Image** in the Pixel Selection menu
(`packages/editor/src/menu/defs.ts`) and the Selection Sources panel; both
disable themselves when the current selection isn't a single image node.

SAM2 subject segmentation (`Sam2SegmentationTool`) remains a separate,
raster-mask-producing path and does **not** feed into `AreaSelection` —
"Select Subject" and pixel selection are still two different systems.

## Refinement and transform

Engine functions in `packages/engine/src/areaSelection.ts`:

- `refineAreaSelection(selection, op, params)` — `op` is `'grow'`, `'shrink'`,
  `'smooth'`, or `'threshold'`. All are bounded raster operations (the
  selection is rasterized, morphologically processed, and re-wrapped).
- Transform (move/scale/rotate) is applied analytically via
  `areaSelectionTransformMatrix()` in `packages/editor/src/actions/createActionHandlers.ts`
  — the expression tree itself is transformed, not rasterized.

Both are exposed as **Grow / Shrink / Smooth / Threshold** and **Nudge /
Scale / Rotate** commands in the Pixel Selection menu, each a single
increment per invocation (repeatable via shortcut or menu re-trigger) rather
than a live drag handle.

## Path ↔ selection conversion

`areaSelectionToPath` / `pathToAreaSelection` (`packages/engine/src/areaSelection.ts`)
bridge Bézier path geometry and the selection expression tree. Exposed as
**Path to Selection** / **Selection to Path** in the Pixel Selection menu and
the Selection Sources panel.

## Saved Area Selections

Persistent, document-scoped, distinct from Selection Sets (which store node
IDs, not coverage). Model: `document.savedAreaSelections: SavedAreaSelection[]`
(serialized via `packages/editor/src/tools/savedAreaSelections.ts`).

UI: `SelectionSourcesPanel` (`packages/editor/src/components/Inspector/SelectionSourcesPanel.tsx`,
mounted from `PropertiesPanel.tsx`) — save the current selection under a
name, load (replace) or add/subtract/intersect a saved selection into the
active one, rename, duplicate, delete. The panel also surfaces the image-alpha/
luminance/color-range sources and the path-conversion commands, plus a
Selection Paint entry point, as one place to both build and manage selections.
**Save Area Selection** / **Restore Last Saved Area Selection** / **Delete
Last Saved Area Selection** are also available directly from the Pixel
Selection menu for the common single-slot case.

## Known limitations

- **Coverage Math is engine-only.** `blendAreaSelections()`
  (`packages/engine/src/areaSelectionComposite.ts`; `add`/`subtract`/
  `multiply`/`min`/`max` with numeric soft-edge composition, distinct from
  the analytical `combineAreaSelections()`) has no editor UI. Nothing in
  `packages/editor/src` currently calls it.
- **No live transform handle.** Selection transform is increment-per-command
  (nudge/scale-step/rotate-step); there is no draggable on-canvas handle for
  the selection boundary itself.
- **Marching-ants boundary segment cap.** `selectionMask.ts`'s
  `MAX_BOUNDARY_SEGMENTS` (250,000) can truncate the visualized boundary for
  very complex raster masks; the underlying selection is unaffected, only its
  on-screen outline.
- **No live announcements for selection changes** (e.g. dimensions on
  create) beyond the per-action `announce()` calls already listed above.

See `docs/audits/selection-system-audit-2026-08-23.md` §19 for the fuller
P2/P3 backlog (focus-based selection, cross-document saved selections,
split/merge channels) — those remain deferred and out of scope for this doc.
