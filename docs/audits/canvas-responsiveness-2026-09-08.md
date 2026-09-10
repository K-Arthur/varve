# Canvas Responsiveness Audit and Contract

**Date:** 2026-09-08
**Status:** Implemented and browser-validated for the scoped geometry/lifecycle repairs
**Scope:** editor canvas geometry, camera resizing, input lifecycle, and related marketing claims

## Executive finding

Varve already has the important rendering foundations: one keyed latest-wins
canvas scheduler, viewport culling, selective IR invalidation, DPR-aware
backing stores, rotation-aware shared camera conversions, and a full-redraw
oracle for pixel-reuse paths. This pass does not replace those systems.

The remaining correctness gap was the boundary between browser layout geometry
and canvas-world input. The cached canvas position was refreshed by
`ResizeObserver` and at pointer-down, but a position-only layout change is not a
resize. Wheel, pinch, and native pinch input could therefore use an old
client-to-canvas offset. A second gap was that a size change changes the
camera's rotation centre without preserving the world point at the usable
viewport centre (or the active gesture anchor). Both are now repaired in the
shared canvas geometry lifecycle and input boundary.

## Finding table

| Symptom | Reproduction | Source | Root cause | Runtime | Severity | Repair | Acceptance |
|---|---|---|---|---|---|---|---|
| Wheel or pinch lands at a shifted world point after a panel/ancestor moves the canvas | Move/scroll an ancestor without changing canvas dimensions, then zoom at a known landmark | `CanvasArea.tsx`, `inputPipeline.ts` | Cached `left/top` is only updated by resize and pointer-down; wheel/native pinch read it without a synchronous input-boundary refresh | Chromium, WebKitGTK, WebView2, WKWebView | Major | Shared geometry observer plus wheel/pinch refresh | Landmark remains under the pointer after the layout move and anchored zoom |
| Artwork appears to move when the usable canvas changes size | Resize a docked panel or window while idle at a non-default pan/rotation | `CanvasArea.tsx`, `shared/viewport.ts` | Canvas dimensions change the camera's rotation centre, but no anchor-preserving camera patch is applied | All editor runtimes | Major | Preserve viewport-centre world anchor; preserve active gesture anchor when present | World anchor maps to the same CSS point before/after resize; document and history are unchanged |
| Tool cleanup is incomplete when pointer capture is lost | Start a drag, remove/reparent the canvas or force capture loss before pointer-up | `inputPipeline.ts` | `lostpointercapture` forwards cancellation but does not clear the local pointer/interaction bookkeeping | Pointer, touch, pen | Major | Route capture loss through one idempotent cancellation path | No stuck tool, auto-pan loop, or deferred background lane; one coherent undo result |
| Existing marketing copy presents a historical FPS number without the runtime/fixture qualifier | Open Canvas & Rendering feature page | `apps/website/src/pages/features/canvas.astro` | Benchmark context is separated from the product claim | Website readers | Moderate | Add the responsive contract and qualify benchmark evidence | Page explains geometry fidelity, input behavior, and measurement limits at mobile and desktop widths |

## Implemented repairs

- `packages/editor/src/canvas/canvasSurface.ts` now owns a coalesced geometry
  observer for the drawable canvas and its parent, captured scroll, window and
  visual-viewport changes, plus a synchronous refresh seam for input boundaries.
  It preserves a rotation-aware world anchor through non-zero size changes and
  safely defers camera adjustment for zero-sized surfaces.
- `packages/editor/src/CanvasArea.tsx` consumes that one geometry contract for
  backing-store sizing, tool context, and overlays. The document/history path
  is not involved in viewport-only changes.
- `packages/editor/src/canvas/inputPipeline.ts` refreshes geometry before a new
  pointer or wheel event becomes an active anchor, retains the latest anchor
  during an existing gesture, and clears pointer/gesture/auto-pan state on lost
  capture, blur, visibility loss, and cancellation.
- `packages/editor/src/canvas/renderPipeline.ts` keeps a delayed camera frame in
  the interaction work class when its camera differs from the last painted
  camera. This preserves honest diagnostics and interactive image policy when
  a slow draw outlives the wheel quiet period.
- The scoped adjustment replay in `renderPipeline.ts` now allocates its source
  surface from the projected target bounds instead of the full drawable
  viewport. The filter/mask coordinate contract remains device-space, but
  large canvases no longer pay for unrelated transparent pixels for every
  adjustment layer.
- `apps/website/src/pages/features/canvas.astro` now explains the responsive
  contract, the authoritative fallback, and the limits of the historical
  benchmark instead of presenting that fixture as a universal FPS promise.

## Coordinate contract

| Space | Meaning | Owner |
|---|---|---|
| World/document | Authored node coordinates after parent transforms | Scene and engine IR |
| Camera viewport | CSS pixels relative to the drawable canvas, after pan/zoom/rotation | Shared camera helpers |
| Browser client | CSS pixels relative to the viewport, including the canvas's current `DOMRect.left/top` | Input boundary |
| Backing store | Integer device pixels (`CSS size × DPR`, rounded once) | Canvas surface lifecycle |
| Export/print | Output pixels derived from document bounds, never from the screen | Export pipeline |

`clientX/Y` are first converted to canvas-local CSS pixels using the current
geometry. Camera zoom and rotation are applied only by the shared
`screenToWorld`/`worldToScreen` helpers. DPR is not part of pointer conversion.
Viewport-only geometry changes may patch camera view state, but must not mutate
the document, mark it dirty, or add an undo entry.

The resize policy is:

1. If idle, preserve the world point at the old usable viewport centre at the
   new centre.
2. If a navigation or pointer gesture is active, preserve its latest client
   anchor at the same client location.
3. If the canvas is zero-sized or hidden, update geometry and wait for the next
   non-zero measurement; never divide by zero or allocate a huge backing store.
4. A resize never auto-fits a manually positioned camera.

## Existing behavior retained

- Canvas 2D remains the correctness fallback; worker/WebGPU paths are optional.
- Backing-store changes continue to invalidate incompatible painted surfaces and
  trigger a fresh authoritative frame.
- Pointer-move paths remain free of unconditional layout reads. Geometry is
  observed/coalesced and refreshed at input boundaries where a stale position
  would change coordinate meaning.
- The render pixel oracle remains the acceptance check for any change to
  partial redraw, worker reprojection, or painted-surface reuse.

## Acceptance matrix for this pass

| Area | Check |
|---|---|
| Coordinate correctness | Passed: unit tests plus Chromium tests for size changes and a position-only ancestor transform |
| Document integrity | Passed: viewport resize leaves serialized document JSON unchanged; camera-only state is not a document transaction |
| Interaction lifecycle | Passed: existing interaction/diagnostics suite and focused cancellation paths; native physical capture loss remains platform-limited |
| Visual behavior | Passed: Chromium resize screenshot inspected at 1160×760; website desktop/mobile captures inspected |
| Website | Passed: both Pages and root-domain builds, mobile/no-overflow assertions, and feature-page captures |
| Platform limits | Linux Chromium is executable evidence here; native WebKitGTK, WebView2, WKWebView, physical pen/trackpad, and mobile hardware remain separately labeled |

## Measurement honesty

The repository's active performance contract uses display interval `T`, with
separate interaction (`0.5 × T`), authoritative viewport render (`0.9 × T`),
and background (`0.25 × T`) budgets. The retained 86fps/IR-replay and
interaction-latency numbers are historical fixture evidence, not a fresh claim
for every device.

Fresh local evidence for this pass:

| Evidence | Runtime / conditions | Result | Interpretation |
|---|---|---|---|
| `pnpm bench:canvas` | Linux, Vitest engine replay benchmark harness, 6 benchmark cases | 6/6 passed | Harness health only; this command does not establish browser input-to-present latency |
| `performance-diagnostics.spec.ts` | Linux Chromium, dev Vite runtime, default Desktop Chrome viewport, DPR 1, `?perf=1`, 60 Hz reported interval | 6/6 diagnostics/latency cases passed after late-camera classification repair; interaction p50/p95/p99 `0.8/0.8/0.8 ms` over 2 samples; the single initial authoritative sample was `140.4 ms`; background 0 samples | The authoritative sample is the cold editor baseline, not the wheel response; it exceeds the 15.0 ms viewport-render budget and is retained as an honest dev-startup caveat. Not a production-build or physical-device certification |
| `responsive-geometry.spec.ts` | Linux Chromium, DPR 1, 1440×900 → 1160×760 resize, plus a 44×22 CSS-pixel ancestor transform | 3/3 passed; resize, wheel-anchor, and lost-capture assertions stayed within 3–4 CSS px / canceled cleanly | Direct geometry/camera acceptance evidence; resize screenshot was inspected |
| `many-image-render.spec.ts` | Idle Linux Chromium, 1280×800, DPR 1, 12 generated 900×700 images, one browser worker, `?perf=1` | 1/1 passed in 2.3 min; fit-all coverage and colour diversity passed; two scroll bursts matched `forceFullRedraw()` at the same camera | Confirms the stale-worker/frozen-surface regression is absent in the over-budget image case |
| `performance-soak.spec.ts` | Idle Linux Chromium, one browser worker, 24 alternating middle-button pans, `?perf=1` | 1/1 passed in 46 s; pending/in-flight worker bytes returned to zero and bounded diagnostics/heap assertions passed | Resource-bound evidence; not an RSS or physical 4 GB-device certification |
| `mask-unrelated-images.spec.ts` | Linux Chromium, one browser worker, raster masks plus scoped adjustment replay | 1/1 passed after the projected adjustment-surface change | Pixel/target-isolation regression evidence; this run overlapped the dependency gate and is not used as a timing measurement |
| `image-tuning.spec.ts` | Idle Linux Chromium, four real image-finishing workflows including Grain and Highlight Glow | 4/4 passed in 3.5 min with repeated full-redraw pixel comparisons | Closest existing user workflow to the supplied treatment-stack screenshot; no stale or missing final pixels observed |
| website feature E2E | Linux Chromium, Pages and root-domain static servers, 1280×900 and 375×812 | 2/2 passed; no page-level overflow; 3 cards → 1 column | Marketing layout evidence, not editor rendering evidence |

There is no paired pre-change runtime capture for these exact fixtures. The
closest retained reference is the 2026-08-03 121-node drag (frame p50 2.5 ms,
p95 5.1 ms), which is historical and not directly comparable to the fresh
geometry/diagnostics run. Native Tauri/WebKitGTK, WebView2, WKWebView, physical
trackpad/pen, fractional/2×/3× DPR, browser zoom, and low-memory hardware
remain explicitly unverified here. The cold authoritative sample above is an
observed responsiveness caveat rather than evidence of an input-lane stall;
the dedicated interaction samples stayed below budget on the same run. A
production editor build and a native low-memory run are still needed before
making a hard hardware-performance promise.
