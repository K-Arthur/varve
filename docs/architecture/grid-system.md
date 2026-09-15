# Grid system architecture

Varve has four different kinds of canvas guidance, each with an explicit owner:

| System | Owner | Purpose | Changes child arrangement? |
| --- | --- | --- | --- |
| Document grid | `Document.gridSettings.documentGrid` | World-space Cartesian alignment and optional snapping | No |
| Pixel grid | `Document.gridSettings.pixelGrid` plus view toggles | High-zoom pixel inspection and optional integer snapping | No |
| Baseline/isometric overlays | `Document.gridSettings.baselineGrids` / `isometricGrids` | Typography and isometric construction references | No |
| Frame layout guides | `Document.gridSettings.layoutGrids[frameId][]` | Authored column/row/uniform boundaries and optional child snap targets | No |

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

## Multiple guides and migration

`layoutGrids` is keyed by owning frame and stores an array. Version 2.24 migrates the prior
single-object-per-frame representation into a one-element array. Figma import preserves every
supported layout-grid entry and gives each imported entry a stable per-frame id.

## Decision record

- Visual guide geometry is a pure editor helper (`layoutGridGeometry.ts`), shared by drawing
  and snapping, so those paths cannot disagree about margins, track widths, or alignment.
- Layout-guide snap targets are lower priority than document-grid and ruler-guide targets and
  are scoped to the active editor scene.
- Rotated document-grid drawing and snapping use the same configured origin and radians value.
- Pixel-grid lines are drawn on the overlay canvas rather than under the opaque artwork canvas.
- Grid overlays are non-exporting interface guidance and do not enter the scene graph.

The follow-up audit and implementation tracker are in
[`docs/audits/grid-system-audit-2026-09-09.md`](../audits/grid-system-audit-2026-09-09.md).
