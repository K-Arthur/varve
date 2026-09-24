# Grid system architecture

Varve has four different kinds of canvas guidance, each with an explicit owner:

| System | Owner | Purpose | Changes child arrangement? |
| --- | --- | --- | --- |
| Document grid | `Document.gridSettings.documentGrid` | World-space Cartesian alignment and optional snapping | No |
| Pixel grid | `Document.gridSettings.pixelGrid` plus view toggles | High-zoom pixel inspection and optional integer snapping | No |
| Baseline / isometric | `Document.gridSettings.baselineGrids` / `isometricGrids` | Typography rhythm and plane-aware isometric construction | No |
| Frame layout guides | `Document.gridSettings.layoutGrids[frameId][]` | Authored column/row/uniform boundaries and optional child snap targets | No |
| Publishing page layouts | `Page.layout` → `MasterPage.layout` → `Document.pageLayout` | Independent page rows/columns and margins; derived geometry only | No |

Auto layout is not a grid overlay. `FrameNode.layoutStyle` and `@varve/layout` arrange
children; they must not be used as a proxy for visual layout-guide geometry.

## Coordinate and state contract

All canvas overlays project through the shared `screenToWorld` / `worldToScreen` camera
helpers. This keeps pan, zoom, viewport-centred rotation, and high-DPI canvas drawing
consistent with artwork rendering. A frame guide is resolved in frame-local coordinates,
then composed through the frame's world transform. Invalid track geometry is not drawn or
offered as a snap target.

Document-authored grid geometry, including document-grid visibility, is restored from the
document. View preferences control transient display choices such as pixel-grid display and
the global layout-guide visibility switch. The legacy viewport `gridVisible` value remains
read/write-compatible for older settings stores but is no longer authoritative for a loaded
document's persisted geometry.

## Isometric grid: one canonical geometry

`packages/scene/src/isometricGeometry.ts` is the single source of truth for isometric /
axonometric geometry. Overlay rendering, snapping, plane-aware tools, fit-to-plane, and
grid-artwork generation all consume the same resolved `IsometricGridGeometry`; no consumer
re-derives the lattice independently.

| Concept | Contract |
| --- | --- |
| Dimensions | Document space: `+X` right, `+Y` down. Axis `angle` is degrees, **line direction** (`direction = (cos θ, sin θ)`, `normal = (−sin θ, cos θ)`), so the three default families are 30°, 150°, 90°. |
| Basis | Columns `b1 = s·(cos θ1, sin θ1)`, `b2 = s·(cos θ2, sin θ2)`, chosen from the first two visible axes in authored order (basis axes are never chosen by "best conditioning", which would silently re-assign the ground plane). |
| `spacing` | The projected length of one lattice step along each axis (lattice constant `s`). Per-family perpendicular spacings are **derived** (`s·sin Δ`), never independently authored. |
| Third family | Accepted as lattice when it is (anti)parallel to `b1 ± b2`; otherwise it is rendered dashed and excluded from lattice snapping as an explicit directional guide. |
| Presets | True isometric (30°) and Dimetric 2:1 with `atan2(1, 2)`, plus an explicitly illustrative "trimetric-style" set. A ratio input converts a rhombus ratio to an exact angle. |
| Planes | `top` = Right+Left (ground); `front` = Right+Vertical; `side` = Left+Vertical. Plane bases are **unit-scale**: one plane unit is one document unit; grid spacing scales lattice indices, not the projection. |
| Conditioning | `|sin θ|` between basis columns; `< 0.1` is rejected, `< 0.25` warns. Duplicate-angle equality is not sufficient. |
| Active grid | `gridSettings.activeIsometricGridId`, then the well-known default id, then the lexicographically smallest id. `Object.values(...)[0]` is prohibited. |
| Spacing migration | v2.27 → v2.28 converts the legacy per-family line gap to axis step by dividing by `sin Δ` (`×2/√3` for the standard preset), preserving the drawn grid; `spacingMode: 'axis-step'` makes the conversion idempotent. |

### Snapping

`packages/editor/src/tools/isometricSnapping.ts` finds the nearest lattice intersection with
an exact 2-D Voronoi (Conway–Sloane) correction — independent coordinate rounding is **not**
correct for an oblique lattice (regression-tested counterexample). Line snapping projects
perpendicular to an authored family. Both produce **one** translation for the whole
selection, applied by the shared `snapPosition` solver, so relative arrangement is preserved
and descendants are never moved twice. Source features are the artwork's own anchors
(shifted to the raw, unsnapped proposal), not a world AABB corner. Snapping is independent of
display visibility; `snapEnabled` owns snapping and `visible` owns drawing.

### Construction, fit, and export

- An active plane maps pointer positions through `B⁻¹`, applies tool rules in plane
  coordinates, and maps back through `B`. A plane rectangle is an editable quadratic path; a
  plane ellipse is the exact affine image of a cubic circle approximation. `Off` disables
  plane-aware drawing while keeping display and snapping.
- Fit to Plane applies one world-space affine per selection **root** (`pivot + B·(p − pivot)`),
  preserving hierarchy and editability; Unproject applies the validated inverse around the
  same pivot. Per-object decomposition (the Affinity defect class) is prohibited.
- Turning a grid on never transforms artwork and never enters the scene graph. Create Grid
  Artwork is a separate, bounded, one-undo command that emits ordinary line nodes into the
  active workspace content root.

### Display density

The overlay generates only visible lines from the viewport corners, clipped in screen space.
A nested power-of-two display ladder with a 0.8–1.25 hysteresis dead band reduces density
without changing authored spacing or phase; major lines are authored multiples and retain
identity across levels. `Create Grid Artwork` coarsens the same ladder to respect its line
budget.

## Multiple guides and migration

`layoutGrids` is keyed by owning frame and stores an array. Version 2.24 migrates the prior
single-object-per-frame representation into a one-element array. Figma import preserves every
supported layout-grid entry and gives each imported entry a stable per-frame id. Version 2.28
migrates isometric grids to the canonical spacing contract described above and adds explicit
`activePlaneId`, `majorEvery`, `snapToSubdivisions`, `snapToLines`, and `customAxes`.

### Guide Layouts workflow (v2.30)

Open **View → Guides → Guide Layouts…**, press **Ctrl+Alt+Shift+G**, use command
search, or choose it from the frame/page context menu.
The target is snapshotted when the dialog opens, so later selection changes do
not retarget a preview. Add is the default; Replace all states its removal
count, and Clear all is confirmed separately. Apply validates all targets and
creates one undo entry. Invalid numeric input remains visible with an inline
error and leaves the last valid preview in place. Escape, Cancel, switching
documents, or deleting the owner restores only the guide fields in the target
snapshot.

Frame layouts support columns, rows, and a true square uniform lattice. A
hidden layout can still snap when global guide snapping and that layout's snap
toggle are enabled; the transient feedback identifies the winning finite
segment as “Layout guide”. Locked layouts can be shown/hidden, snap-toggled,
or unlocked, but their geometry cannot be edited or deleted until unlocked.

Publishing pages resolve page override → master → document default → built-in
default. Reset to inherited removes only the page override. Page layout guides
remain separate from auto layout, ruler guides, document grids, pixel grids,
baseline grids, and isometric construction. They never move authored content.

## Decision record

- Visual guide geometry is a pure editor helper (`layoutGridGeometry.ts`), shared by drawing
  and snapping, so those paths cannot disagree about margins, track widths, or alignment.
- Layout-guide snap targets are lower priority than document-grid and ruler-guide targets and
  are scoped to the active editor scene.
- Rotated document-grid drawing and snapping use the same configured origin and radians value.
- Pixel-grid lines are drawn on the overlay canvas rather than under the opaque artwork canvas.
- Grid overlays are non-exporting interface guidance and do not enter the scene graph.
- Custom axis sets that do not form a lattice are still shown, but only lattice families are
  snap candidates: the app does not promise plane transformations for inconsistent guides.
- Grid visibility authored in the document is a normal undoable edit; the transient overlay
  mode toggle (`Alt+Shift+I`) is view state and never enters history. Display visibility and
  snapping remain independent (`visible` draws, `snapEnabled` snaps).
- Document-grid and isometric-grid setters own an edit transaction when the caller has not
  already opened one. Inspector number entry keeps the transaction open for the full focused
  edit, so typing creates one undo step and does not use the history fallback path.
- Frame layout-guide setters also own a document transaction when invoked outside an existing
  edit, and no-op guide updates do not create history entries. This keeps inspector visibility,
  add, and remove actions on the same undoable document-history path.
- `IsometricAxis.spacing` is deprecated and inert: per-family line spacing is derived from the
  basis, and an independent authored value could make the three families disagree.

The follow-up audit and implementation tracker are in
[`docs/audits/grid-system-audit-2026-09-09.md`](../audits/grid-system-audit-2026-09-09.md);
the isometric research record and capability matrix are in
[`docs/audits/isometric-grid-research-2026-09-14.md`](../audits/isometric-grid-research-2026-09-14.md);
the independent real-editor verification (including the cube, multi-object move, and
hide/undo scenarios) is in
[`docs/audits/isometric-grid-audit-2026-09-15.md`](../audits/isometric-grid-audit-2026-09-15.md).
