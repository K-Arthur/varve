# Canvas 2D Rendering System

**Updated:** 2026-07-13

This document is the maintained contract for Varve's Canvas 2D path. It supersedes
older implementation details in `docs/audits/canvas-system-audit.md`.

## Deployment reality

Varve currently has one production editor target: the Vite/React frontend embedded
in Tauri 2. `apps/web` is an unlisted scaffold, not a deployable browser application.
The same frontend can run in a normal browser as a development and compatibility
harness, but that is not an offline production web product.

Tauri does not provide a uniform web engine:

| Platform | Runtime | Version policy |
|---|---|---|
| Windows | WebView2 | Installed evergreen or enterprise-managed runtime |
| macOS | WKWebView | Supplied by the installed operating system |
| Linux | WebKitGTK | Supplied by the distribution; local session used 2.52.5 |

The Tauri Rust engine builds render IR. It does not rasterize live editor pixels.
Canvas 2D in the webview is the default live rasterizer on every platform. WebGPU is
opt-in and falls back to Canvas 2D. The separate Rust `varve-print` renderer writes
PDF and is intentionally guarded by export preflight because it supports a smaller
semantic subset than the live renderer.

## Ownership and frame lifecycle

`CanvasArea` owns the visible content canvas, transparent drawing overlay, compositor,
optional render worker, resource caches, and frame scheduling. Editor-only selection,
guides, rulers, text editing, collaboration cursors, and accessibility representation
are separate DOM/SVG/canvas layers and are never replayed into artwork export.

The frame path is:

```text
Document
  -> flattenSceneToEngine (visibility, variants, styles, variables, world transforms)
  -> native IPC | WASM | TypeScript IR builder
  -> RenderItem[]
  -> structural replay (frames, masks, isolated groups)
  -> Canvas2D compositor
  -> visible backing store
```

One canonical document-to-engine converter lives in
`packages/editor/src/render/sceneToEngine.ts`. Live rendering, raster export, video
export, and specification export use this converter so text and nested transforms do
not drift. Rust/WASM's required text `shape` wire contract is constructed there and
mirrored in `varve-core`, `varve-bridge`, and `varve-engine`; area/path mode,
vertical alignment, paragraph spacing, overflow, lists, rich text, variable axes, and
OpenType features survive the native/WASM round trip.

Animation frames are coalesced with `requestAnimationFrame`. The renderer compares the
last successfully painted document with the next document. Safe leaf-only changes can
produce a dirty union of old and new bounds; structural container changes request a
full redraw. A failed or stale asynchronous frame does not advance the rendered-state
reference.

## Coordinate spaces and transform order

| Space | Unit | Owner |
|---|---|---|
| Object/local | Document pixels | Individual node transform |
| Frame/group | Document pixels | Parent-child transform composition |
| World/document | Document pixels | Flattened scene and hit testing |
| Viewport/CSS | CSS pixels | Camera pan, zoom, and rotation |
| Backing store | Integer device pixels | CSS size multiplied by current DPR |
| Export | Output pixels | World bounds translated to export origin and scaled |

World transforms compose parent before child. The camera composes pan, rotation about
the viewport center, and zoom. DPR is applied outside the camera. Backing dimensions
are rounded to integers, and DPR is observed for monitor/zoom changes rather than
sampled only at startup.

Zoom, pan, and rotation are committed through one `setCamera` transaction. Wheel and
pinch handlers also advance an interaction-local camera reference immediately because
trackpads can deliver several deltas before React renders. This preserves every delta
and keeps the cursor or viewport-center world anchor fixed. Tools must never issue a
separate `setZoom` followed by `setPan`; `setZoom` is reserved for absolute UI input
and anchors around the current viewport center.

The earlier floating-origin implementation subtracted a snapped camera origin without
rebasing scene geometry, which introduced exact 512-unit placement jumps. Floating
origin is therefore semantic zero until geometry and camera are rebased atomically.
The API seam remains so a future precision implementation cannot update only one side.

Text edit and floating text toolbar overlays are portaled to `document.body` and use
the same world transform plus camera matrix as artwork. Area text persists explicit
width and height; point text does not acquire a synthetic fixed box.

## Contexts, surfaces, and recovery

Normal display contexts use the browser defaults: accelerated, alpha-capable, sRGB
Canvas 2D. `willReadFrequently` is reserved for software pixel-processing surfaces.
Optional `OffscreenCanvas` use is capability-detected. `createRasterSurface` falls
back to an HTML canvas when offscreen creation or context acquisition is unavailable.

The visible canvas listens for `contextlost` and `contextrestored`. Loss clears stale
worker bitmaps, announces the state through the editor live region, and schedules a
fresh vector render after restoration. Canvas width/height changes are treated as
surface recreation because they reset context state.

Worker rendering is optional. Messages include zoom, pan, rotation, viewport, DPR, and
document version. Worker canvases resize when viewport or DPR changes. A stale bitmap
is either transformed by the full affine camera delta or discarded for vector replay;
all replaced `ImageBitmap` resources are closed. Worker and main-thread image fills
share the same fit/fill/stretch/tile placement math. Pattern and alpha-mask scenes stay
on structural main-thread replay until the worker can reproduce those semantics; this
is an explicit capability decision, not a silent approximation.

## Shapes, images, text, and paint

- Each replay item is wrapped in `save()`/`restore()` with `try/finally`; one malformed
  resource cannot poison later transforms or compositing state.
- Compositor-frame and dirty-region clip saves are balanced independently, including
  exceptional exits. Canvas clips survive `setTransform()`, so leaking a partial-redraw
  clip would otherwise make later pan/zoom frames appear blank.
- Image and pattern fills are clipped to the primitive outline. Pattern origin is the
  primitive bounds, not the global origin, and a missing pattern tile starts an image
  cache load rather than remaining a permanent placeholder.
- Frame clipping, vector masks, alpha masks, and isolated groups are structural replay
  operations shared by live and raster export.
- Viewport culling may skip descendants of a clipped frame. It must not skip an
  unclipped frame's overflow children; groups remain safe because their canonical
  bounds union their descendants.
- Isolated groups render at current zoom and DPR with effect-aware padding. They are not
  permanently rasterized at one pixel per world unit.
- Layer blur allocates three radii of padding to prevent kernel clipping.
- A filter belongs to an isolated item surface. It never snapshots, clears, or filters
  previously painted siblings.
- Mixed filter chains advance through intermediate surfaces in order.
- `CanvasRenderingContext2D.filter` is feature-detected. Where absent, portable
  software implementations cover the supported CSS-like adjustments and blur.

The bundled deterministic artwork default is `IBM Plex Sans Variable`, using the same
CSS family name registered by the application. Export gathers the exact used font
faces and representative text, starts `document.fonts.load()` for each request, then
awaits `document.fonts.ready` with a bounded timeout. Existing documents that explicitly
name system fonts remain system-dependent and may rasterize differently by OS.

Imported image fills normally use embedded data URLs, which are offline and
origin-clean in both browser harness and Tauri. The image cache awaits decode. Remote
sources still require successful CORS for serialization; export reports an actionable
tainted-canvas error rather than returning a blank file.

## Color and cross-engine parity

sRGB/unorm8 is the portable live and raster-export baseline. The previous Display-P3
setting was exposed without being connected to context creation or encoding and is now
migrated to sRGB. Wide-gamut export may be added only with context-attribute readback,
encoded-profile verification, and fixtures for WebView2, WKWebView, and WebKitGTK.

Geometry, bounds, transforms, clipping, alpha, item order, and export dimensions are
strict parity requirements. Font edges, hinting, resampling kernels, and profiled-screen
appearance use documented tolerances because the HTML specification leaves parts of
rasterization implementation-defined.

## Export, thumbnails, PDF, and print

Raster export renders the selected subtree from document state, never from the editor
screen. It includes descendants and world transforms, uses declared frame and area-text
bounds plus group descendant unions, pads strokes and outward effects, waits for every
visible image fill, pattern tile, and background-removal mask, excludes editor overlays,
validates the returned MIME type, and applies both dimension and area budgets.

The default single-surface policy is 16,384 pixels per axis and 33,554,432 total pixels
(128 MiB for one RGBA surface). This is a Varve memory policy, not a claim about a
universal browser maximum. Oversized jobs are proportionally clamped with a warning.
True streamed/tiled encoding remains required before the product can promise arbitrary
gigapixel exports.

Home thumbnails use the portable raster surface and include text, frames, nested world
transforms, fills, strokes, effects, visibility, opacity, and blend state supported by
the thumbnail scene contract.

Native PDF export currently accepts the subset that `varve-print` can reproduce:
scale 1, simple translation, opaque normal blending, supported solid paint, no live
filters/effects, no unsupported group opacity/blend/isolation/mask semantics, and no
clipped-frame descendant export. Unsupported requests fail preflight with an
explanation instead of silently changing pixels. There is no common native print API;
interactive printing would use `window.print()`, while deterministic output uses PDF
export.

## Accessibility

The visible canvas is keyboard focusable and named. A viewport-culled semantic tree
represents meaningful objects without exposing every pixel. Selection/tool/context-loss
changes use the shared live region. Keyboard nudge, selection cycling, zoom, and tool
shortcuts provide non-pointer alternatives. Frame clipping is exposed as a named
Inspector checkbox, so overflow behavior is not pointer-only or hidden state.
Forced-color and reduced-motion behavior belongs to surrounding UI; artwork color
semantics are not rewritten.

## Adding a renderable type safely

1. Add the document type and persistence migration in `@varve/scene`.
2. Extend `sceneToEngine.ts` and the strict Rust/WASM bridge contract together.
3. Add primitive bounds, hit testing, replay, export, and thumbnail behavior.
4. Define clipping, opacity, blend, mask, and effect ordering explicitly.
5. Add unit contract tests, a structural export test, and a real pointer/render E2E.
6. Add a visual fixture with cross-engine tolerance justified by raster semantics.
7. Run `pnpm verify:affected` (plus `pnpm format` and `pnpm lint` on the
   changed files). This is a rendering hot path — the planner auto-selects
   the canvas E2E and render benchmark lanes. Reserve the full suite
   (`pnpm verify:full` with a reason) for schema/pipeline migrations.

## Key validation commands

```bash
pnpm verify:plan          # confirm the canvas + bench lanes are selected
pnpm bench:canvas
npx playwright test tests/e2e/canvas/tools.spec.ts --project=chromium
npx playwright test tests/e2e/canvas/frame-text-placement.spec.ts --project=webkit
npx playwright test tests/e2e/canvas/zoom-stability.spec.ts --project=chromium --project=firefox --project=webkit --workers=1
pnpm --filter @varve/desktop build
cargo test -p varve-engine  # scoped crate tests; full workspace at gates
```

Native WebKitGTK execution requires a working Tauri WebDriver dependency graph and a
real display/session. A configured CI job that was not observed is not execution proof.
