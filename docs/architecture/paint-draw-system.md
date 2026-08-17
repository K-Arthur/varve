# Paint and Draw System

Status: active implementation, correctness milestone recorded 2026-08-17.

## Product Shape

Varve uses both a drawing-focused workflow and normal first-class tools. It does
not maintain a second document model or a separate "paint mode" state. The
workspace may reorganize the toolbar and inspector, but the authoritative scene
remains the same for Design, Draw, and every other workspace.

When a raster or vector drawing tool becomes active, the existing tool-options
popover opens automatically. This keeps preset, size, opacity, flow, hardness,
spacing, strength, or stabilization controls discoverable without creating a
second drawing toolbar or duplicating brush state.

The output target is deliberately explicit:

- `Paint` and `Eraser` create or modify raster-layer pixels.
- `Smudge` modifies existing raster-layer pixels.
- `Pencil` creates editable vector path geometry.
- `Paint` is the painting interaction; document paints/fills remain styling
  entities and are not used as a name for raster tool state.

## Runtime Flow

```text
PointerEvent
  -> inputPipeline
  -> collectSourceEvents (coalesced + primary + optional predicted)
  -> NormalizedInputEvent
  -> tool stroke samples (pressure, tilt, time, speed, direction)
  -> tool-specific smoothing and dynamics
  -> raster brush dabs OR fitted vector path points
  -> transaction-scoped document mutation
  -> dirty canvas invalidation and normal scene replay
```

The shared input pipeline is responsible for browser event extraction. Raster
and vector tools remain separate after normalized samples because pixels and
editable paths have different semantics.

## Raster Targeting

Painting resolves targets in this order:

1. selected visible, unlocked raster layer;
2. visible, unlocked raster layer in the active page subtree;
3. a new page-sized raster layer, parented to the containing frame when one is
   active.

World samples are mapped through the inverse cached world transform before they
  enter raster tile compositing. Raster layers continue to use sparse 128 by
  128 RGBA tiles; the theoretical layer extent does not preallocate all tiles.

## Persistence Contract

`RasterLayerNode.tiles` is a runtime `Map<string, RasterTile>`. The canonical
document codec converts it to a keyed serializable tile object with base64 pixel
buffers on encode and reconstructs the `Map` on decode. Invalid tile payloads
are discarded with a codec warning rather than crashing document load. Tile
buffers must be exactly `128 * 128 * 4` bytes.

## Brush Semantics

The current brush engine supports round and square procedural tips, hardness,
roundness, angle, spacing, flow, opacity, pressure/speed/tilt/direction/random
dynamics, deterministic jitter, and stroke-progress dynamics. Dynamics curves
are cubic Bezier input-to-output mappings: the x coordinate is inverted before
the y coordinate is evaluated.

Eraser dabs use the same brush mask, opacity, flow, shape, hardness, angle, and
roundness as paint dabs, then reduce destination alpha. This keeps erasing from
silently becoming a square constant-alpha operation.

Preset validation clamps persisted spacing to a positive minimum so malformed
presets cannot hang dab generation. The built-in Textured preset uses the
existing deterministic procedural grain sampler and modulates dab alpha. User
preset lifecycle, external grain asset management, wet-paint scheduling, and
advanced smudge modes are not yet complete and must not be exposed as complete
capabilities.

Smudge reads from an immutable snapshot of the source tile map while writing
new destination tiles. Samples may cross 128 by 128 tile boundaries, and an
empty destination tile is allocated only when the sampled neighborhood deposits
visible pixels there. Opacity and flow affect smudge strength in the same way
they affect paint dabs.

The optional brush worker is a dab-generation optimization, not a second
compositor. Each worker request remains inside the active stroke transaction;
pointer-up defers commit until all confirmed requests settle. Cancellation
invalidates the stroke generation, so late worker responses cannot mutate a
later stroke or document.

## Capability Matrix

| Capability | Initial state | Current state | Notes |
|---|---|---|---|
| Raster brush | partial | Fixed | Sparse tiles and synchronous dab path are native. |
| Vector pencil | partial | Fixed | Final pointer sample and pointer identity are now guarded. |
| Eraser | incorrect | Fixed | Uses the shared brush mask and destination alpha semantics. |
| Pressure | partial | Fixed in shared path | Mouse uses stable `0.5` fallback; pressure reaches dab dynamics. |
| Tilt | partial | Partial | Two axes are captured, but brush semantics still use a scalar tilt value. |
| Coalesced input | partial | Fixed | Primary sample is retained after coalesced samples with deduplication. |
| Predicted input | scaffolded | Deferred | Smudge preview buffer is not yet attached to a visible overlay. |
| Transform-aware painting | incorrect | Fixed | World-to-raster-local inverse transform is used for paint and smudge. |
| Layer targeting | incorrect | Fixed | Selected/visible/unlocked/active-page targeting is explicit. |
| Raster persistence | incorrect | Fixed | Codec round-trip preserves tile pixels and runtime Map type. |
| Alpha lock | partial | Partial | Scene compositing has alpha-lock support; tool target UI is incomplete. |
| Blend modes | partial | Partial | Several scene blend modes exist; brush UI parity is incomplete. |
| Grain/texture | scaffolded | Fixed baseline | Built-in procedural grain is composited deterministically; external assets remain deferred. |
| Wet paint | scaffolded | Deferred | Wet buffer exists but is not in the live painting lifecycle. |
| Smudge | partial | Fixed baseline | Immutable cross-tile neighborhood sampling is native; advanced modes remain deferred. |
| Worker processing | disconnected | Partial | Dab generation and cancellation are transactional; production enablement still depends on runtime profiling. |
| Symmetry/assistants | partial | Partial | Existing assist infrastructure is separate from the raster target fixes. |
| Presets/browser/editor | partial | Partial | Existing common controls work; advanced lifecycle/editor remains. |
| Tablet capabilities | partial | Partial | Pressure, tilt, twist, altitude, azimuth, and pointer identity are normalized where provided. |

## Validation Expectations

Changes to pixel reuse, target transforms, input lifecycle, or brush compositing
require both deterministic tests and a real browser interaction. Visual review
should include at least a hard round stroke, soft/eraser parity, a transformed
raster layer, zoom changes, a tile-boundary stroke, undo, and save/reopen.

The authoritative validation policy is in
`docs/quality/validation-strategy.md`. This document records capability status;
it is not a claim that deferred capabilities are production-ready.
