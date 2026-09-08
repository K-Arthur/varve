# Canvas Responsiveness Audit and Contract

**Date:** 2026-09-08  
**Status:** Implementation in progress  
**Scope:** editor canvas geometry, camera resizing, input lifecycle, and related marketing claims

## Executive finding

Varve already has the important rendering foundations: one keyed latest-wins
canvas scheduler, viewport culling, selective IR invalidation, DPR-aware
backing stores, rotation-aware shared camera conversions, and a full-redraw
oracle for pixel-reuse paths. This pass does not replace those systems.

The remaining correctness gap is the boundary between browser layout geometry
and canvas-world input. The cached canvas position is refreshed by
`ResizeObserver` and at pointer-down, but a position-only layout change is not a
resize. Wheel, pinch, and native pinch input could therefore use an old
client-to-canvas offset. A second gap is that a size change changes the camera's
rotation centre without preserving the world point at the usable viewport
centre (or the active gesture anchor).

## Finding table

| Symptom | Reproduction | Source | Root cause | Runtime | Severity | Repair | Acceptance |
|---|---|---|---|---|---|---|---|
| Wheel or pinch lands at a shifted world point after a panel/ancestor moves the canvas | Move/scroll an ancestor without changing canvas dimensions, then zoom at a known landmark | `CanvasArea.tsx`, `inputPipeline.ts` | Cached `left/top` is only updated by resize and pointer-down; wheel/native pinch read it without a synchronous input-boundary refresh | Chromium, WebKitGTK, WebView2, WKWebView | Major | Shared geometry observer plus wheel/pinch refresh | Landmark remains under the pointer after the layout move and anchored zoom |
| Artwork appears to move when the usable canvas changes size | Resize a docked panel or window while idle at a non-default pan/rotation | `CanvasArea.tsx`, `shared/viewport.ts` | Canvas dimensions change the camera's rotation centre, but no anchor-preserving camera patch is applied | All editor runtimes | Major | Preserve viewport-centre world anchor; preserve active gesture anchor when present | World anchor maps to the same CSS point before/after resize; document and history are unchanged |
| Tool cleanup is incomplete when pointer capture is lost | Start a drag, remove/reparent the canvas or force capture loss before pointer-up | `inputPipeline.ts` | `lostpointercapture` forwards cancellation but does not clear the local pointer/interaction bookkeeping | Pointer, touch, pen | Major | Route capture loss through one idempotent cancellation path | No stuck tool, auto-pan loop, or deferred background lane; one coherent undo result |
| Existing marketing copy presents a historical FPS number without the runtime/fixture qualifier | Open Canvas & Rendering feature page | `apps/website/src/pages/features/canvas.astro` | Benchmark context is separated from the product claim | Website readers | Moderate | Add the responsive contract and qualify benchmark evidence | Page explains geometry fidelity, input behavior, and measurement limits at mobile and desktop widths |

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
| Coordinate correctness | Unit tests for rotation-aware centre/gesture anchor preservation and position-only geometry refresh |
| Document integrity | Browser assertion that viewport resize changes camera view state only, not document JSON or history depth |
| Interaction lifecycle | Browser drag/resize and pointer-cancel/capture-loss checks |
| Visual behavior | Chromium screenshots at desktop and narrow editor layouts; inspect artwork/overlay alignment and absence of blank flashes |
| Website | Build, mobile/no-overflow check, and a Canvas & Rendering feature-page visual capture |
| Platform limits | Linux Chromium is executable evidence here; native WebKitGTK, WebView2, WKWebView, physical pen/trackpad, and mobile hardware remain separately labeled |

## Measurement honesty

The repository's active performance contract uses display interval `T`, with
separate interaction (`0.5 × T`), authoritative viewport render (`0.9 × T`),
and background (`0.25 × T`) budgets. The retained 86fps/IR-replay and
interaction-latency numbers are historical fixture evidence, not a fresh claim
for every device. This pass will report fresh local runs with runtime, viewport,
DPR, renderer path, fixture, cold/warm condition, sample count, and diagnostic
overhead; missing native or physical-device evidence will remain explicitly
unverified.
