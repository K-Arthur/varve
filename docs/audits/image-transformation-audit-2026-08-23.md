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
| Image pixel resize | Resize operation/dialog | Object > Resize Image | Derived raster path | Complete | Complete | Raster export | Unit + Playwright | Complete |
| Scene move/scale/rotate | Parent-local affine + rotation | Selection handles | Complete | Complete | Complete | SVG/PDF/raster/codegen | Unit + E2E | Complete |
| Skew/shear | Live warp modifier | Warp overlay/inspector | Complete | Complete | Complete | Structural/raster fallback | Unit + E2E | Complete |
| Flip H/V | Affine/image-fill semantics | Commands/handles | Complete | Complete | Complete | Export parity | Unit | Complete |
| Four-corner perspective image | `ImageFillPerspective.quad` | Object menu, Inspector, tool/handles | `warpedImage` decoration | Codec normalization | One commit | Raster + SVG subdivision + PDF triangles | Geometry + tool + SVG + Playwright | Complete for supported image surfaces |
| Mesh warp | Bounded mesh modifier | Warp overlay | Engine evaluator | Complete | Complete | Bake/fallback | Unit + E2E | Partial |
| Perspective surface/mockup | Persistent mockup surface | Mockup workflow | Flat/quad surfaces | Complete | Complete | Raster/PDF paths | Unit + E2E | Partial |
| Denoise/deblur/upscale | Staged provider pipeline | Enhance dialog | Preview/derived output | Provenance/cache | Complete | Raster export | Unit + visual E2E | Partial |
| Restore + upscale | Pipeline stages | Capability-gated UI | Provider-dependent | Recipe/derived output | Complete | Raster export | Unit | Partial |

“Complete” here means the repository has evidence across the listed columns;
“Partial” means at least one column still needs an explicit contract or
feature-specific verification. No row is marked complete solely because a
type or function exists.

## Changes in this milestone

The image resize and perspective paths now:

- expose pixel resize from Object > Resize Image, with linked/free aspect
  controls, nearest/bilinear/bicubic/Lanczos resampling, a 64 MP safety cap,
  source-asset preservation, crop/mask adjustment, one-step undo and Escape/
  backdrop-close behavior;

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
  cache; generated surfaces are retained through the image-cache ownership
  pass so the live canvas cannot remain on a placeholder frame;
- provides a focused M6 Inspector section with numeric X/Y controls, Edit on
  Canvas, Reset Perspective, accessible labels, Enter/Escape/Apply/Cancel,
  and explicit Object-menu reachability;
- emits SVG piecewise-affine triangle subdivision and direct Rust PDF output
  as an 8×8 grid (128 clipped triangles) for valid four-corner image quads;
  the PDF path reuses one embedded image XObject and preserves opacity; and
- adds focused tool, homography, persistence, SVG/PDF, resize, and real-browser
  coverage.

## Visual verification

The Chromium run exercised the public entry points and generated screenshots
under reports/ui-review/:

- image-resize/01-open.png, 02-configured.png, 03-applied.png;
- perspective/01-collapsed.png, 02-entry.png, 03-canvas-edit.png,
  04-numeric-controls.png.

The post-commit perspective screenshot was pixel-checked, including the
non-blank raster assertion. It verified that the edited lower-right corner
renders in the canvas and that the Inspector displays readable rounded values.
The global drawing toolbar is intentionally hidden while the modal perspective
tool is active so its lower handles remain reachable; Apply/Cancel and
keyboard completion remain available.

## Explicit remaining limitations

- Perspective image decoration currently replaces the image item with a
  raster `warpedImage`; complex alpha masks, effects and non-rectangular shape
  clipping still use the compositor/raster fallback and need a dedicated
  export-quality compositing pass for direct vector parity.
- The SVG path uses bounded piecewise-affine triangle subdivision because SVG
  has no general projective image primitive. Direct PDF vector parity is now
  present for valid image quads through Rust triangle subdivision; unsupported
  complex compositing continues through the documented raster fallback.
- Mesh warp is present as a separate modifier system; it is not merged with
  the image-fill projective model, intentionally.
- Perspective-aware painting/clone/heal, linked planes, content-aware
  resizing, and generative expansion remain deferred P2/P3 work.
- Perspective rendering is deliberately main-thread/compositor-backed while
  the DOM canvas bake is active; the worker path is disabled for these scenes.
  The real-image Chromium flow and screenshot inspection cover the live path;
  no worker parity claim is made.
