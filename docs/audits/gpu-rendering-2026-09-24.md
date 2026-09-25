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

| Route | Present benefit and cost | Decision |
|---|---|---|
| Canvas2D plus render worker | Established full-document semantics and portable fallback; worker transfer and main-thread preparation still cost time | Keep as the production baseline and measure input-to-paint before changing scheduling |
| Opt-in WebGPU compositor | Can draw simple flat fills, but pays geometry upload and offscreen-to-Canvas2D presentation costs; normal worker frames often bypass it | Repair correctness, bound uploads, and report actual per-frame use before any default change |
| Native GPU compute | Existing qualified offscreen resampling/effect consumers can benefit without owning the editor canvas; transfer cost depends on operation size | Keep operation-specific dispatch and CPU reference results |
| Native GPU presentation overlay | Would require surface embedding, DPI/input/overlay alignment, accessibility, and likely copies across the WebView boundary | Defer until measured complete-frame gains justify those integration costs |

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

At this first repair, rectangle vertex preparation was still unbounded and
WebGPU circle edges were more aliased than Canvas2D. The later milestones
below address the upload bound and backend/status claims. Circle edge parity
remains open.

## Backend selection, status, and published copy

The next regression reproduced two initialization problems in unit tests. The
Canvas2D default requested an adapter twice even though no GPU was selected;
an opted-in route requested a device for detection and then requested another
for the real backend. When the second request failed, the router returned a
`webgpu` backend that was internally drawing on Canvas2D. The router now
initializes the requested backend once, returns a genuine Canvas2D backend on
failure, and keeps a fixed reason in its diagnostics across later frames.
The default route makes no GPU request. This is request-count evidence, not a
measured startup-time claim.

The editor's status now separates `WebGPU ready`, `WebGPU + Canvas2D` (eligible
items submitted in the last completed frame), `Canvas2D · GPU ready`
(worker or fallback frame), initialization fallback, and device loss. A worker
bitmap presentation publishes zero GPU items even after a prior GPU frame;
submission is not presented as proof of asynchronous GPU completion. It no
longer labels the Canvas2D API as CPU execution. A lifecycle adapter discards
late initialization after unmount and publishes device loss immediately before
requesting an authoritative redraw. Fallback reasons are exposed as a live
status for assistive technology and as visible text in the Performance tab,
without requiring pointer hover. The tab includes frame-item count, fallback
reason, and pipeline init time in its local, user-triggered diagnostics copy.

The Chromium software-adapter E2E changed the actual Settings preference,
reopened the editor, and verified the persisted setting plus visible
`GPU unavailable · Canvas2D` label and software-adapter reason. Screenshots
`/tmp/varve-gpu-status-fallback.png` and
`/tmp/varve-gpu-performance-fallback.png` were opened and inspected. The
Performance reason is readable above the controls without scrolling. This is a
software-adapter rejection test, not proof of physical GPU drawing. The
independent hardware-browser circle fixtures above remain the drawing evidence.

Marketing copy in `apps/website` now describes the opt-in, narrow drawing
eligibility and separate native compute. The custom-domain website built 105
pages with zero Astro diagnostics; the GitHub Pages variant built 105 pages.
Section screenshots under `/tmp/varve-gpu-website-2026-09-24/` were inspected
in light, dark, and narrow layouts. The product-page visual baselines changed
only after that inspection and passed again without snapshot updates. The
narrow Settings dialog snapshot was inspected, updated for the revised
description, and passed again without snapshot updates.

The combined affected run later exposed stale Settings E2E assumptions rather
than a popup rendering defect: the listbox becomes visible before its floating
position settles, and the shared `NumberInput` is a labeled textbox. The
browser regression now waits for the final matched width and uses the actual
accessible role. Both exact cases passed, and the open-list screenshot at
`/tmp/varve-gpu-settings-select-stable.png` was inspected.

The affected website run passed 569 browser checks and initially failed the
changed performance-page image plus two unrelated checks under shared load.
The performance image was inspected and refreshed. A single-worker rerun of
that image, the typography image, and the button-geometry checks passed all
four selected cases without further changes.

## Bounded solid geometry and synchronous draw recovery

A hardware-browser A→B→A rectangle fixture passed before the final repair:
the pooled buffer receives a fresh upload even when a cached render bundle is
reused. This ruled out a suspected stale-bundle cause without changing that
working path. Its final frame is saved at `/tmp/varve-gpu-rect-reuse.png`.

A separate unit regression failed before repair because a simulated command
encoder error escaped `WebGPUBackend.drawVectorItems`. That could abort the
frame instead of replaying the affected ordered run on the already-owned 2D
presentation canvas. The backend now tears down that GPU device, replays the
failed and subsequent runs through Canvas2D, and records a fixed draw-failure
reason. The test also checks that an unsupported island between two eligible
runs keeps its paint order and that no stale GPU run is retried.

Plain rectangles now use the same 4 MiB rounded vertex-allocation ceiling as
circles. Each chunk is submitted before its pooled buffer is rewritten;
device limits smaller than one item route the whole run to Canvas2D. The
hardware-browser fixture drew 14,564 rectangles across the 14,563-item chunk
boundary. At their translucent overlap, Canvas2D produced
`srgba(93,20,166,0.752941)` and WebGPU produced
`srgba(93,20,167,0.74902)`. The two PNGs at
`/tmp/varve-gpu-rect-chunk-{reference,gpu}.png` were opened and inspected:
both retain the overlap and paint order. These are pixel and upload-bound
checks; no frame-latency improvement is claimed.

## Native Linux visual evidence and limits

The current frontend was opened through a fresh `tauri dev` rebuild under
WebKitGTK in an isolated Xvfb/X11 session. A pointer drag created a 150×150
rectangle, visible in the editor and layer list. The status read `Canvas2D`
without a CPU claim, and General Settings described Linux's Canvas2D route.
The inspected screenshots are under
`/tmp/varve-gpu-native-current-2026-09-24/` (`editor.png`, `rect.png`,
`settings.png`). This validates the native WebKitGTK UI and 2D interaction on
this host, not Wayland presentation, GPU hardware execution, or a packaged
release. Xvfb reported no DRI3 device. The first cold Vite dev load exceeded
the app's 20-second startup watchdog; after the module graph warmed, Reload
opened the editor. That development-server timeout is a separate limitation,
not evidence that a packaged build fails to start.

## Inspected visual evidence retained in the repository

These PNGs are copies of the captures opened during the investigation. The
small compositor fixtures isolate coverage, overlap, and paint order; the UI
captures show the actual editor, native WebKitGTK session, and website copy.
They do not replace a mixed-document, export, or real-display color check.

| Scenario and revision | Inspected captures |
|---|---|
| Missing first circle at baseline `3b223b5d3` | [Canvas2D reference](../screenshots/gpu-rendering-2026-09-24/before-two-circles-canvas2d.png), [WebGPU defect](../screenshots/gpu-rendering-2026-09-24/before-two-circles-gpu.png) |
| Two-circle repair at `c8d3b3dd1` | [Canvas2D reference](../screenshots/gpu-rendering-2026-09-24/after-two-circles-canvas2d.png), [WebGPU result](../screenshots/gpu-rendering-2026-09-24/after-two-circles-gpu.png) |
| Rounded rectangle ordered fallback at `c8d3b3dd1` | [Canvas2D reference](../screenshots/gpu-rendering-2026-09-24/rounded-fallback-canvas2d.png), [WebGPU-selected compositor result](../screenshots/gpu-rendering-2026-09-24/rounded-fallback-gpu-selected.png) |
| Circle upload boundary at `c8d3b3dd1` | [Canvas2D reference](../screenshots/gpu-rendering-2026-09-24/circle-chunk-canvas2d.png), [WebGPU result](../screenshots/gpu-rendering-2026-09-24/circle-chunk-gpu.png) |
| Rectangle upload boundary at `faa25f3a5` | [Canvas2D reference](../screenshots/gpu-rendering-2026-09-24/rect-chunk-canvas2d.png), [WebGPU result](../screenshots/gpu-rendering-2026-09-24/rect-chunk-gpu.png) |
| Fallback/status and native UI after `3bf2582c1` | [Browser status](../screenshots/gpu-rendering-2026-09-24/editor-gpu-unavailable.png), [Performance settings](../screenshots/gpu-rendering-2026-09-24/settings-gpu-unavailable.png), [native WebKitGTK rectangle](../screenshots/gpu-rendering-2026-09-24/native-webkitgtk-rect.png) |
| Narrow marketing docs after `b530c866e` | [Rendering explanation](../screenshots/gpu-rendering-2026-09-24/website-rendering-mobile.png) |
| Transparent cutout, reopened and exported on 2026-09-25 | [Reopened editor canvas](../screenshots/gpu-rendering-2026-09-24/alpha-cutout-reopened.png), [1× PNG output](../screenshots/gpu-rendering-2026-09-24/alpha-cutout-export.png) |
| Panoramic 3000×600 mask proxy on 2026-09-25 | [Before application](../screenshots/gpu-rendering-2026-09-24/panoramic-mask-before.png), [after application](../screenshots/gpu-rendering-2026-09-24/panoramic-mask-applied.png) |
| Separate masked-image transform history failure on 2026-09-25 | [Redo disabled after Undo](../screenshots/gpu-rendering-2026-09-24/masked-transform-redo-disabled.png) |

## Verification boundary and remaining work

The changes above close three reproduced correctness defects in the optional
simple-shape compositor: a missing earlier circle, square GPU output for an
authored rounded rectangle, and an exception that could interrupt an ordered
frame instead of replaying it. They also make a failed initialization and a
worker-presented frame visible as Canvas2D execution. The 4 MiB per-upload
ceiling is a bound on this compositor's vertex allocations, not a measurement
of total graphics memory. These repairs carry no measured frame-latency or
battery-life improvement.

The large-image browser workflow exposed a separate Canvas2D cache ownership
bug: mask preparation produced a bounded 2048×410 live-canvas proxy, but image
retention tracked only the full-resolution mask URL and immediately evicted the
proxy. The replay then drew the unmasked image. Retention now includes both
URLs while the document mask is active and evicts their decoded entries when
it closes. The bounded URL lookup remains separate from the decoded cache. A unit
test checks that lifecycle; the exact panoramic Playwright case passed with a
same-state full-redraw pixel oracle.
The inspected captures above show the blue source background before application
and the editor's light canvas background through the masked area afterward.

The separate `background-removed-transform.spec.ts` edge-resize case still fails:
after Undo, Redo remains disabled and the selection clears. It failed before
this cache repair and failed again in an exact Chromium run afterward. This
remains an open history/selection investigation; the panoramic cache result
does not resolve it. An earlier bounded canvas slice also found an unrelated
auto-layout flow-child reorder failure, so the broad canvas E2E lane is not
recorded as passing.

| Risk area | Evidence in this investigation | Still required before a broader claim |
|---|---|---|
| Simple-shape visual correctness | Inspected before/after Chromium adapter pixels for two circles, rounded fallback, and both upload boundaries; ordered-run and failure unit tests | Fractional DPR, extreme transforms, edge antialiasing parity, and a mixed creative document through the editor |
| Failure and resource handling | Unit-injected initialization/draw failures and device-loss status; bounded vertex chunks at 11,651 circles and 14,564 rectangles | Real driver reset, out-of-memory recovery, owned-resource profiling, and constrained-device runs |
| Native desktop | Fresh WebKitGTK `tauri dev` under Xvfb/X11 drew and displayed a rectangle with Canvas2D status | Wayland, packaged Linux, Windows/WebView2, macOS/WKWebView, and actual hardware GPU presentation |
| Browser and Chromebook | Chromium adapter fixtures and software-adapter fallback/status tests | ChromeOS browser/PWA and Linux ARM64/Crostini on the Lenovo Duet 11; its GPU specifications alone establish no supported path |
| Documents and output | Browser cutout test passed undo/redo, save/reopen, forced full redraw, and 1× PNG alpha checks (0 and 128) on a 2100×300 source; panoramic mask test passed at 3000×600 with same-state full-redraw pixel equality; the editor and PNG captures above were inspected | Mixed-document save/reopen, print output, and managed-color/HDR display comparison |
| Performance | Correctness comparisons and upload-size bounds only | Same-hardware, equivalent-fidelity cold/warm input-to-visible-paint and resource measurements before considering WebGPU default eligibility |

The default remains Canvas2D, the Linux WebGPU gate remains in place, and the
website describes those limits. Do not infer physical GPU execution from an
adapter name, software headless test, or the status label `WebGPU ready`.

### Local validation record for the mask-cache repair

- `pnpm verify:plan --staged` selected the editor and desktop closures, the
  background-removal browser file, canvas E2E, and the render benchmark; it did
  not request a full repository gate.
- `pnpm verify:affected --staged` passed touched-file checks, E2E typecheck,
  and the focused mask-cache unit test (6/6). Its browser file reached 7/8;
  the remaining case used two obsolete mask-editor labels. Both labels were
  corrected and that exact case then passed. The panoramic case separately
  passed with the same-state full-redraw oracle.
- Direct editor, desktop, and E2E typechecks passed. Desktop unit tests passed
  80/80; two load-sensitive inspector failures in a broad editor run passed
  together on a one-worker exact rerun (31/31). `pnpm bench:canvas` passed its
  six threshold checks; these are not before/after latency measurements.
- `node scripts/audit-architecture.mjs --ci` passed after one host-load timeout:
  14 existing dependency cycles, zero layer violations, and no unused exports.
  Docs, emoji, and token audits passed. The full suite was not run.
- The broad canvas E2E gate remains incomplete because its bounded earlier
  slice hit the flow-child reorder failure; the exact masked-transform history
  case also remains red as described above.
