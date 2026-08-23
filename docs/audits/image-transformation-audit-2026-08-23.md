# Image transformation system audit — 2026-08-23

This audit records repository evidence for the image enhancement, crop,
transform, perspective and warp brief. It is intentionally scoped to the
current Varve architecture; competitor references are treated as capability
research only.

## Initial state

The repository already has a source-preserving image crop model
(`ImageFillData.crop` in source-pixel coordinates), canonical scene/editor
world-coordinate helpers, affine transform tools, a separate `rotation`
field, a repeat-transform state, a page-resize command, a staged restoration
pipeline, bounded enhancement caches, and an existing projective
`warpedImage` renderer used by mockups.

Relevant history includes:

- `25a875d2` — non-destructive image-crop commit math;
- `5f94ed6d` — crop interactions switched to canonical image placement;
- `4acd3f89` — crop ratios/guides/straighten, repeat transform and image
  resize foundations;
- `15c9df45` — warp grid overlay and bake command;
- `f40a7357` — tiled restoration and provider-routing hardening.

The worktree also contains pre-existing, uncommitted selection/layer changes
and an in-progress image perspective path. Those edits are preserved.

## Capability matrix

| Capability | Model | UI | Live render | Save/reopen | Undo | Export | Tests | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Source crop | Complete | Complete | Complete | Complete | Complete | Complete | Unit + Playwright | Complete |
| Crop pan/zoom/fit | Complete | Complete | Complete | Complete | Complete | Complete | Unit + Playwright | Complete |
| Crop ratios/guides | Complete | Complete | Complete | View state | Undoable commit | Preview parity | Unit | Complete |
| Straighten | Image-fill rotation metadata | Crop UI | Existing image replay | Complete | Complete | Existing exporters | Unit coverage | Partial |
| Image pixel resize | Resize operation/dialog | Inspector/dialog | Derived raster path | Complete | Complete | Raster export | Unit | Partial |
| Scene move/scale/rotate | Parent-local affine + rotation | Selection handles | Complete | Complete | Complete | SVG/PDF/raster/codegen | Unit + E2E | Complete |
| Skew/shear | Live warp modifier | Warp overlay/inspector | Complete | Complete | Complete | Structural/raster fallback | Unit + E2E | Complete |
| Flip H/V | Affine/image-fill semantics | Commands/handles | Complete | Complete | Complete | Export parity | Unit | Complete |
| Four-corner perspective image | `ImageFillPerspective.quad` | Perspective tool/handles | `warpedImage` decoration | Codec normalization | One commit | Raster + SVG approximation | Geometry + tool + SVG unit | Partial → repaired in this change |
| Mesh warp | Bounded mesh modifier | Warp overlay | Engine evaluator | Complete | Complete | Bake/fallback | Unit + E2E | Partial |
| Perspective surface/mockup | Persistent mockup surface | Mockup workflow | Flat/quad surfaces | Complete | Complete | Raster/PDF paths | Unit + E2E | Partial |
| Denoise/deblur/upscale | Staged provider pipeline | Enhance dialog | Preview/derived output | Provenance/cache | Complete | Raster export | Unit + visual E2E | Partial |
| Restore + upscale | Pipeline stages | Capability-gated UI | Provider-dependent | Recipe/derived output | Complete | Raster export | Unit | Partial |

“Complete” here means the repository has evidence across the listed columns;
“Partial” means at least one column still needs an explicit contract or
feature-specific verification. No row is marked complete solely because a
type or function exists.

## Changes in this milestone

The image perspective path now:

- keeps corner edits in tool-local session state until commit, so a gesture
  produces one document update and cancel cannot partially mutate the source;
- publishes tool-state changes to the React overlay instead of relying on an
  incidental parent render;
- uses the shared camera/floating-origin conversion for rotated and panned
  views, plus screen-space deltas for pointer movement;
- rejects non-finite, crossed, concave or degenerate quads before they reach
  the renderer;
- validates persisted perspective data before live decoration;
- bakes source content with the same crop/fit/pan/scale/rotation/flip
  placement contract as ordinary image replay, while retaining a byte-bounded
  cache; and
- adds focused tool, homography, persistence and SVG coverage.

## Explicit remaining limitations

- Perspective image decoration currently replaces the image item with a
  raster `warpedImage`; masks, effects and non-rectangular shape clipping need
  an export-quality compositing pass before being called complete.
- The SVG path uses bounded piecewise-affine triangle subdivision because SVG
  has no general projective image primitive. PDF fallback policy still needs a
  dedicated verification row.
- Mesh warp is present as a separate modifier system; it is not merged with
  the image-fill projective model, intentionally.
- Perspective-aware painting/clone/heal, linked planes, content-aware
  resizing, and generative expansion remain deferred P2/P3 work.
- Browser/worker perspective rendering needs a visual Playwright run with a
  real image fixture and screenshot inspection; unit tests alone do not prove
  overlay/render parity.
