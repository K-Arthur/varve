# GPU rendering investigation (2026-09-24)

## Research synthesis and decision

Varve's production desktop editor uses a Tauri webview: WebView2 on Windows,
WKWebView on macOS, and WebKitGTK on Linux. Native Rust builds IR and provides
separate offscreen GPU compute; it does not present the live canvas with native
wgpu. Canvas2D is the default display path. Browser WebGPU is opt-in, draws to
an offscreen surface, and is currently reached only for simple flat content
when the render worker or structural replay does not take the frame. A
successful adapter/device probe is therefore neither proof that a document
used GPU drawing nor proof of a physical GPU speedup.

The immediate decision is to repair the existing WebGPU path's correctness
and report actual execution. Preserve the worker/Canvas2D production path and
Linux gate. Do not promote WebGPU by widening eligibility or add a native
presentation surface until equivalent-fidelity, end-to-end measurements show
a benefit on the target WebViews.

| Source and date | Observed behavior or limitation | Varve response and verification |
|---|---|---|
| [Figma engineering, 2025-09-18](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/) | Readback probes increased startup time; WebGPU could fail during a session, and reacquisition could fail. | Keep a working Canvas2D present surface, avoid launch benchmarking, simulate device loss, and verify redraw/status after fallback. |
| [WebGPU specification, accessed 2026-09-24](https://gpuweb.github.io/gpuweb/) and [GPUDevice.lost, accessed 2026-09-24](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost) | Queue work is asynchronous, GPU resource lifetime is device-scoped, and a requested device may already be lost. | Keep per-draw data stable through submission, invalidate device resources on loss, and test init/draw failure boundaries. |
| [Tauri webview versions, accessed 2026-09-24](https://v2.tauri.app/reference/webview-versions/) and [WebKitGTK 2.52, 2026-03-18](https://webkitgtk.org/2026/03/18/webkitgtk-2.52-highlights.html) | Linux WebKitGTK is distinct from Apple's WKWebView; its Canvas2D batching and damage tracking improved. | Keep Linux Canvas2D and test the packaged/`tauri dev` path separately from Chromium. |
| [Figma user report, 2026-01-09](https://forum.figma.com/report-a-problem-6/afterimage-bug-49435) | A user reported persistent afterimages. The report does not establish prevalence or cause. | Compare the visible surface with the same-state forced full-redraw oracle after interaction. |
| [Photoshop user report, 2026-08-28](https://community.adobe.com/bug-reports-711/p-photoshop-27-10-ga-gpu-accelerated-canvas-rendering-shows-incorrect-color-warm-red-color-cast-that-does-not-match-camera-raw-print-preview-exported-files-or-any-external-viewer-1639194) | A GPU canvas reportedly showed a warm cast versus preview/export. | Compare opaque and transparent swatches and inspect exported output independently; retain an explicit color/alpha contract. |
| [Krita bug 490006, 2024-07-10](https://bugs.kde.org/show_bug.cgi?id=490006) | Brush marks were absent in the accelerated display but present in the saved image on one Mali/Android setup. | Keep live/saved/export parity as distinct checks; do not infer the same cause on the Duet's Mali GPU. |
| [Affinity user report, 2025-03-29](https://forum.affinity.serif.com/index.php?%2Ftopic%2F230059-affinity-photo-260-converting-document-to-16-bit-causes-all-kinds-of-artifacts%2F=) | Search-index excerpt reports mask artifacts with acceleration, removed by disabling it. The forum page returned 403 to direct inspection. | Keep mask/group content on structural Canvas2D replay; compare mixed-boundary artwork rather than generalizing the reported cause. |

## Baseline reachability and coverage

`CanvasArea.tsx` requests the backend once at initialization. The flat frame
may go through the worker, and structural groups/masks go through recursive
Canvas2D replay. No current editor caller supplies
`CompositorFrame.structure` to the backend. The compositor's structural plan
therefore cannot establish GPU coverage for normal structural documents.

| Content or operation | Current display path | Evidence/status |
|---|---|---|
| Plain solid rectangle/circle in eligible flat frame | Opt-in WebGPU when device init succeeds and worker is bypassed; otherwise Canvas2D | Partial; multi-circle repair browser-verified |
| Rounded rectangle | Ordered Canvas2D island because GPU emits only a square quad | Fallback browser-verified |
| Text, paths, images, gradients, strokes, effects, blends | Canvas2D or render worker | Verified fallback routing in predicate/plan; visual parity still scenario-dependent |
| Masks, isolation, group compositing | Structural Canvas2D replay | GPU coverage currently unreachable in normal editor workflow |
| Export/print | Separate authoritative output path | WebGPU display setting does not accelerate export |
| Native resampling/explicit asynchronous effect consumers | Separate native GPU compute when qualified | Not live canvas presentation; execution must be reported per operation |
| Inference/NPU | Separate provider policy | No inference or NPU claim follows from compositor availability |

## Ranked reproduced or code-proven defects

1. `WebGPUBackend.drawGpuItems` queues writes for every circle into one
   vertex buffer and one circle-uniform buffer before the command submission.
   Earlier draws can consume the final circle's data. A real-adapter
   multi-circle pixel fixture is the acceptance oracle.
2. `isGpuBatchSupported` and the structural planner accept a rectangle with
   corner radius/smoothing, while `buildVertices` emits an unrounded quad.
   A rounded-rectangle fallback test and pixel comparison are required.
3. The router probes a device, then backend init probes again. Init failures
   are swallowed, so the backend ID can say `webgpu` while drawing on Canvas2D.
   Status currently labels Canvas2D as `(cpu)`, which cannot be inferred from
   the browser API. Active path and failure reason need distinct reporting.

The starting tree contains unrelated staged E2E/visual work. Validation plans
against the whole dirty tree include those files; final evidence must identify
any unrelated failures separately from task-owned tests.

## Correctness reproduction and first repair

At base `3b223b5d3`, the existing single-circle Chromium test passed on this
host's browser-exposed hardware adapter. A new two-circle fixture failed:
the GPU image contained only the second circle, with a bounding-box width
ratio of `0.2449` versus Canvas2D. The PNGs under
`/tmp/varve-gpu-two-circles-before/` were opened and inspected. Unit tests
also showed rounded rectangles were incorrectly classified as GPU-safe.
The reference contained 2,934 pixels with alpha above 8; the GPU image
contained 1,020 and omitted the first circle.

The repaired circle path stores center and radius as vertex attributes, uses
a six-vertex covering quad, and bounds each ordered upload to a rounded 4 MiB
device-safe buffer. Chunks submit before the pooled buffer is rewritten. The
same two-circle E2E passed afterward;
the two circles in `/tmp/varve-gpu-two-circles-after/` were visually inspected
against the Canvas2D reference. Rounded rectangles now use an ordered
Canvas2D island; the reference and fallback PNGs under
`/tmp/varve-gpu-rounded-after/` are pixel-identical (`magick compare -metric
AE` returned 0). These are Chromium browser results with explicit test flags,
not WebKitGTK or packaged Tauri hardware validation. No frame-rate gain is
claimed from this correctness repair.

For the same two-circle fixture after repair, both reference and GPU bounding
boxes are `(16,16)–(162,102)` and the whole-image mean absolute RGBA channel
difference fell from 11.207 to 0.618. Edge antialiasing accounts for most
remaining differences. The 11,651-circle chunk-boundary fixture retained both
chunks and the correct translucent overlap: center pixel `RGB (128,118,135)`
in Canvas2D versus `(128,117,135)` in WebGPU. Its screenshots under
`/tmp/varve-gpu-chunk-final/` were inspected. This is a coverage/color
comparison, not a frame-latency benchmark.

Remaining scope: rectangle vertex preparation/pooling is still unbounded;
WebGPU circle edges are more aliased than Canvas2D; the backend/status and
marketing claims need the next milestone. Those are not implied to be fixed
by the circle repair.
