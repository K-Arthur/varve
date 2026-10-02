# GPU Acceleration System

Status: current-state documentation (2026-10-01). Companion to
[render-pipeline.md](render-pipeline.md), [canvas2d-system.md](canvas2d-system.md),
[native-acceleration.md](native-acceleration.md), ADR-0003, and ADR-0237.

This document defines what "GPU acceleration" means in Varve, which parts of
it are real today, what each platform can expect, and which failure modes the
design avoids. It exists because the honest answer to "does Varve use my GPU?"
is layered: WebGPU and WebGL2 scene paths are opt-in experiments with bounded
content admission and Canvas2D fallback; GPU compute kernels for effects are
measured 3–64× faster than CPU but are not wired to a consumer yet; and
Canvas2D remains the default renderer and authoritative fallback.

---

## 1. The four distinct layers

| Layer | What it is | State |
|---|---|---|
| Display rendering | How the webview presents pixels (browser-composited Canvas2D/WebGPU under the hood) | Not inferred, not claimed. Status text never equates a backend name with hardware execution |
| Scene GPU paths | `WebGPUBackend` and experimental `WebGL2Backend` in `packages/compositor`, rendering admitted content offscreen and compositing onto the Canvas2D present surface | Both are opt-in; Canvas2D is the default. WebGPU admits selected solid rectangles/ovals; WebGL2 admits a narrower set of device-pixel-aligned rectangles and simple stretched images. Unsupported content falls back to Canvas2D. |
| GPU compute effects | `GpuEffectRunner` + nine WGSL kernels (bloom, caustics, CRT, VHS, light shafts, lens flare, light leak, palette snap, RGB split) behind the live-effect provider chain | Implemented and tested in isolation; **no application consumer yet** — but measured 3–64× faster than CPU end-to-end on this host (see §5) |
| Native acceleration | `varve-accel` wgpu compute with truthful capability stages (discovered → runtime-loadable → device-usable → execution-verified) | Per ADR-0237; consumer is the (unwired) effect chain; see [native-acceleration.md](native-acceleration.md) |

## 2. Architecture

### 2.1 Canvas ownership (the 2026-07-13 invert)

The *present* canvas is always Canvas2D. GPU work renders to an offscreen
`<canvas>` carrying either a `webgpu` or `webgl2` context, and completed GPU
runs are blitted to the present surface with an identity transform. A browser canvas's context
type is fixed for its lifetime, so the earlier design — binding `webgpu` on
the content canvas — could never fall back without a remount. With the
invert, device loss, init failure, and unsupported content all degrade to the
working Canvas2D path in place, on the same canvas, in the same frame.

### 2.2 Ordered-run planning

`buildStructuralRenderPlan` partitions paint-ordered IR into `webgpu-run` and
`canvas2d-island` segments. Two sources feed it:

1. **Declared boundaries.** Structural producers mark subtrees whose
   semantics (group blend, isolation, mask, adjustment, filter) cannot be
   reproduced per-item. Boundaries are honored unconditionally — supported-
   looking leaves inside an unsupported group stay on the island — and
   descendant islands collapse into the boundary.
2. **Per-item admission.** Items not covered by a boundary are admitted only
   when the GPU pipelines reproduce them exactly (§2.3).

Paint order is never reordered. A failed GPU run mid-frame keeps earlier
ordered runs on the 2D surface and replays the failed run and everything
after it there (`gpu-draw-failed` telemetry).

### 2.3 Admission contract

`resolveGpuSolidPaint` (packages/compositor/src/solidPaint.ts) decides what
the GPU can paint: an item is eligible when its paint collapses to **exactly
one visible solid fill with normal blending** — either the legacy singular
`fill` or a `fills` stack entry — and the fill's own opacity is folded into
the vertex color to match `replayIr`'s `itemAlpha * fill.opacity`. Ovals are
one pipeline class: circles and ellipses share a stage whose fragment test is
normalized in object-local space (`(d/rx)² + (d/ry)² > 1`), which stays exact
under non-uniform item scale and skew. Everything else — stacked paints,
gradients, images, patterns, strokes, effects, filters, item blending,
rounded rects, text, paths — fails closed to the Canvas2D island.

The gate reads the same fills stack the island replays. Before 2026-09-25 it
required an *empty* stack instead, so every real filled node fell back as
`unsupported-paint` and the pipelines only ever saw synthetic legacy-fill
fixtures; the reachability spec (`tests/e2e/webgpu/solid-fill-reachability.spec.ts`)
guards that seam end to end (scene nodes → engine IR → plan).

### 2.4 Adapter policy

Adapter selection (`@varve/engine` `selectWebGpuAdapter`) declines
software-emulated adapters (SwiftShader, llvmpipe, lavapipe, "fallback")
under `requireHardwareAdapter: true`: the hand-tuned CPU/Canvas2D replay
outperforms software-rendered WebGPU, so a machine without a usable hardware
adapter gets Canvas2D — not a degraded GPU mode. The probe and the backend
share one policy so they cannot disagree about the same machine.

### 2.5 Device loss and bounded recovery

`GPUDevice.lost` resolves for driver resets, GPU process crashes, memory
pressure, and driver updates. The backend handles it without user-visible
data risk:

1. Mark loss, tear down every device-owned resource, keep painting via the
   untouched Canvas2D present surface, publish diagnostics, and trigger a
   host redraw.
2. Rebuild the GPU side in place — fresh adapter, new device, reconfigured
   context — following the spec's expected recovery shape. At most **two**
   automatic attempts per backend lifetime; exhaustion leaves a truthful
   "reload to retry" status instead of a retry loop.
3. `destroy()` during an in-flight recovery drops whatever the rebuild
   created; a deliberately destroyed backend is never resurrected.

Simulated-loss unit tests cover recovery, failed recovery, and the destroy
race. These are simulations: they prove the TypeScript recovery path, not
driver-reset resilience on real hardware — the
[manual verification checklist](webgpu-manual-verification.md) covers the
latter before releases that touch this path.

### 2.6 Presentation self-test and pipeline warm-up

`initGpuResources` validates more than API presence before `gpuReady`:

1. **Pipelines** are created once, at init, with
   `createRenderPipelineAsync` — never in the frame loop — so compilation
   cannot stall a frame; `pipelineInitMs` reports the init cost (a null
   value means no pipeline initialized, not zero milliseconds).
2. **Presentation probe** (`defaultPresentationProbe`): clear the offscreen
   surface to a known premultiplied color, submit, await queue completion,
   and read the result back through `drawImage` on a 2D probe canvas — the
   exact cross-context path every GPU frame uses to reach the present
   surface. Failure (unsupported `drawImage`, wrong alpha handling, channel
   swap, incomplete implementation) declines WebGPU *before any frame draws*
   with `initFailureReason: 'WebGPU presentation probe failed'`, and device
   loss recovery re-runs the probe on the replacement device. jsdom cannot
   rasterize WebGPU output, so mock-device unit tests inject probe success
   and one unit test pins the fail-closed behavior; the success path is
   proven on hardware by `tests/e2e/webgpu/circle-transform-parity.spec.ts`,
   which reads real pixels back through the same path (a probe failure there
   skips with the adapter message).

## 3. Capability and coverage matrix

Evidence classes: **automated** (unit/golden tests), **browser** (Playwright,
headless Chromium), **hardware** (real-adapter browser run — CI has none,
see the manual checklist), **unverified** (no evidence on this class yet).

| Content / operation | Path | Status | Evidence |
|---|---|---|---|
| Solid rect (legacy fill or single-solid stack) | WebGPU run | Reachable; analytic edge coverage parity vs Canvas2D — mean channel diff ≤0.40 on aligned/rotated/fractional-zoom fixtures (aliased baseline 0.00–3.84), tightened spec thresholds | automated + hardware (AMD adapter, this host, 2026-09-26) |
| Solid circle / ellipse | WebGPU run (shared oval stage) | Reachable; same analytic coverage math — mean 0.01–1.00 (aliased baseline 2.74–5.81), coverage ratios 0.999–1.011 | automated + hardware (AMD adapter, this host, 2026-09-26) |
| Device-pixel-aligned solid rectangles and simple stretched images | Experimental WebGL2 run | Reachable only for the admitted subset; fractional, rotated, unsupported, or uncached content stays on Canvas2D. This is not a platform-support or hardware-performance claim. | automated + browser; see [`../perf/webgl2-qualification.md`](../perf/webgl2-qualification.md) for the separate hardware promotion gate |
| Solid paint on mixed z-order documents | Ordered runs + islands | Reachable; islands preserve stacking | automated |
| Gradient / image / pattern / stacked fills | Canvas2D island | Verified fallback by design | automated |
| Strokes, text, paths, rounded rects | Canvas2D island | Verified fallback by design | automated |
| Blend modes, masks, group isolation, effects | Structural replay (main thread) | Verified fallback by design | automated + browser |
| Worker-rendered frames | Worker Canvas2D replay + bitmap present | Verified fallback (compositor bypassed) | automated + browser |
| Device loss mid-session | Canvas2D continuity + bounded recovery | Implemented; simulated-loss tests only | automated |
| Presentation self-test (offscreen → present `drawImage`) | Init + recovery gate | Implemented; passes on this host's hardware adapter (parity runs do not skip), fails closed in mock env | automated + hardware (AMD adapter, this host, 2026-09-26) |
| GPU compute effects (9 kernels) | `GpuEffectRunner` | Implemented; **measured 3–64× faster than CPU end-to-end** at 512²–2048² (§5, perf ledger); consumer still unwired — wiring is now justified by measurement and scoped | automated + hardware (AMD adapter, this host, 2026-09-26) |
| Native wgpu compute | `varve-accel` capability stages | Per ADR-0237; consumer unwired | automated (self-test) |
| Native scene presentation | — | Not implemented; no measured need (§8) | — |
| Other WebGL2 content | Canvas2D island | Verified fallback by admission tests; no general GPU coverage claim | automated |

Diagnostics (`CompositorDiagnostics`) back this matrix at runtime:
`lastFrameGpuItems`, `fallbackIslandCount/NodeCount/Reasons`, `deviceLost`,
`adapterIsFallback`, `initFailureReason`, `pipelineInitMs`.

## 4. Truthful status

`formatCompositorStatus` (packages/editor/src/render/compositorDiagnosticsStore.ts)
maps diagnostics to the status bar and Performance settings tab:

| Diagnostics | Status | Class of claim |
|---|---|---|
| `fatalError` | Renderer unavailable | Presentation itself failed; no fallback active |
| `deviceLost` | GPU lost, Canvas2D keeps drawing; automatic retry noted | Warning; requested vs active separated |
| `initFailureReason` | GPU unavailable, Canvas2D + fixed reason | Warning; carries the non-identifying reason |
| `gpuActive` + `lastFrameGpuItems > 0` | WebGPU + Canvas2D (N items submitted last frame) | **Active** GPU drawing, with mixed-backend honesty |
| `gpuActive` + `lastFrameGpuItems === 0` | Canvas2D, GPU ready | **Ready is not active** — nothing drew through WebGPU |
| otherwise | Canvas2D | "Browser or webview hardware acceleration is not inferred" |

The preference (`preferWebGpu`, default off) is exactly that: a preference.
Enabling it never displays an unconditional success state, and backend
identity is never equated with hardware execution. Diagnostics are local by
default and carry fixed, non-identifying failure reasons; no exact-VRAM
numbers are claimed anywhere.

## 5. GPU compute effects — measured, wiring justified, execution scoped

The runner, kernels, harness (`compareGpuCpu` agreement), provider chain
(native GPU → native → WebGPU → CPU), and capability report are complete and
tested. **No application code calls the chain yet**: interactive replay and
export apply effects through the synchronous CPU kernels in the engine's
filter compositor, which are the byte-level reference the previews match.

**The measured-need gate is now satisfied** (2026-09-26,
`tests/e2e/effects/gpu-agreement.spec.ts` timing test, real AMD adapter, end-to-end samples
including upload + readback — full table in `docs/perf/ledger.md`):
GPU medians beat CPU medians by **3–64×** across all nine kernels at
512²–2048² (e.g. crt at 1024²: 1014 ms CPU → 15.9 ms GPU; bloom at 2048²:
1.34 s → 44 ms), with cold first-use pipeline compilation of only 6–106 ms.
CPU cost scales linearly with pixels while GPU stays under ~71 ms at 2048² —
so effect-heavy exports are the operation where this consumer matters.

**Integration shape (execution scoped, not yet landed):** an async variant of
`applyFilterWithCompositing` (packages/engine/src/filterCompositor.ts:108) that
dispatches each live-effect filter through `dispatchLiveEffect` at the point
the CPU kernel would run, keeping opacity/blend compositing identical,
falling back per effect on any failure, and recording the serving provider in
export diagnostics. The ripple is the reason it has not landed: all four
call sites live inside the synchronous 1,100-line
`replayStructuredSceneInner` closure tree (render/replayScene.ts:386), whose
five external callers include a **synchronous** `renderSubtree` callback
contract (render/mockup/mockupExport.ts:210 → `decorateMockupIr`). Making
that tree async without breaking the callback contract (TypeScript's
void-return assignability would *not* catch an unawaited promise there) is a
dedicated milestone requiring the full export E2E/visual gate — not a
side-quest inside a renderer change. Until it lands, the website's "explicit
asynchronous effect consumers" boundary note stays accurate, and the kernels
remain measured, harness-validated infrastructure.

## 6. Platform reality (researched 2026-09-25/26)

| Runtime | WebGPU for Varve | Notes |
|---|---|---|
| Chromium/ChromeOS (113+, 2023) | Yes, hardware-gated | ARM Android supports Mali-class GPUs from Chrome 121; ChromeOS/Mali-G57-specific behavior unverified — feature-probe, fall back |
| WebView2 / Edge (Windows) | Yes (Chromium engine; x86-64) | Windows ARM64 behind a flag; adapter info is redacted by browsers, so Varve reports unknowns as unknowns |
| WebKitGTK (Linux desktop) | **No, by default, through 2.54** (Sept 2026) | `WebGPUEnabled` defaults false upstream; Skia/Vulkan compositing work is not WebGPU. Canvas2D stays the Linux desktop path; re-check per WebKitGTK release notes |
| WKWebView (macOS/iOS) | Safari 26+ (Sept 2025) | Older macOS reachability not explicitly documented — verify at runtime |
| Firefox | Windows 141+ (July 2025); macOS 26+ from 145; Linux Nightly | Not a Varve target runtime today; relevant to the browser demo |

Sources: web.dev WebGPU overview (2025-11), WebKitGTK 2.48/2.52/2.54 release
notes (2025-04 through 2026-09), WebKit Safari 26.0/26.2 posts, MDN Firefox
141 release notes, gpuweb implementation wiki, MDN GPUDevice.lost /
GPUCanvasContext.configure / GPUAdapter.info. WebKitGTK flag-on capability,
Dawn-on-Mesa behavior, and worker/OffscreenCanvas support remain unverified
upstream — none of them are relied on.

## 7. External failure research → Varve mitigations

Firsthand reports of GPU-accelerated canvas failures in creative tools
(2022-2026), with what Varve does about each class. Symptom evidence, not
controlled studies; confirmed causes marked.

| Failure class (source, date, status) | Observed in | Varve's mitigation |
|---|---|---|
| Stale texture-buffer tiles that occasionally fail to update; content vanishes to checkerboard on zoom (Krita bug 398689, 2018→2023, maintainer-confirmed display-only error; 7 duplicates over 8 years) | Krita macOS OpenGL | "Never show pixels no fresh frame will replace": retained pixels are loans against an authoritative frame; the full-redraw oracle hashes the surface against a forced redraw at the same camera; partial-redraw admission is decided synchronously |
| Sub-pixel seams/flicker at image edges under fractional zoom (tldraw issue 8482, 2026-04, maintainer-investigated, reopened) | tldraw macOS Chrome | Partial-redraw rects snap to whole device pixels before clear/fill/clip (the 2026-09-25 seam fix); replay candidates carry slack so rounding never paints unpainted bands |
| DPR-2-specific repaint bugs where all shapes disappear on zoom (Penpot issue 8092, 2026-01, triaged) | Penpot DPR 2 | `surfaceMatchesBackingStore` gates partial redraw on the exact backing-store identity (w/h/dpr); resize and DPR changes invalidate |
| Black canvas at launch on context-creation failure (Krita bug 522400, 2026-07; Photoshop's "switch GPU mode" folklore) | Krita NVIDIA/Wayland | Canvas ownership invert: presentation is Canvas2D for life, so GPU init failure cannot blank the canvas — it degrades with a named reason |
| Hue shift / blink after system sleep, fixed only by restart (Krita bug 490641, 2024) | Krita M1 Sonoma | Device-loss recovery rebuilds resources and republishes truthful status without losing edits. System-resume invalidation (`subscribeToSystemResume`) now drops the painted-surface identity and forces an authoritative full redraw on back/forward-cache restore, Page Lifecycle resume, and a visible-page timer gap ≥45 s (the heartbeat covers OS sleep, which delivers no web event at all); a gap observed while hidden is parked until the tab is visible again so ordinary tab switches redraw nothing |
| Acceleration silently degrading per platform with no user signal (Krita bug 515658, 2026-02 WONTFIX: OpenGL unavailable on M1+) | Krita macOS | Status text distinguishes requested preference, GPU-ready, actually-drew, and named fallback reasons; capability is reported per operation, never as a binary "GPU: on" |
| "Turn off Hardware Acceleration" as the universal support answer (Affinity staff advice across forum threads, 2022+) | Affinity suite | The fallback is automatic, bounded, and observable (diagnostics + status), not a hidden checkbox users must discover |
| Export output differing from preview when an accelerator serves the export | Various | Unwired consumer (§5): previews and export share the CPU kernels byte-for-byte today; the future GPU export path is gated on provider recording and per-effect fallback |
| Device loss under interleaved upload/submit bursts — a real app lost the device seconds in; app-side coalescing to one upload per frame eliminated the repro (WebKit PR #71563, 2026-08-17, reviewer-confirmed *mitigation* rather than cure) | macOS WKWebView (Safari 26.3) | Uploads are bounded (4 MiB chunks) and each chunk submits before its pooled buffer is rewritten; device loss is already recoverable with bounded retries (§2.5). Full per-frame write coalescing is **not** implemented — verifying it needs a macOS soak, on the manual checklist |
| The spec clears/blanks a WebGPU canvas when its device is lost mid-frame, and `drawImage` may return blank afterwards (gpuweb #4859 WG resolution + Chromium clearing the last frame) | Chromium et al. | The present surface is Canvas2D and keeps the last good pixels; the loss handler publishes diagnostics and requests an authoritative redraw before anything else, so a blanked offscreen blit cannot persist |
| `alphaMode` affects `drawImage`/`toDataURL` output, not just compositing (gpuweb PR #2905, 2024); WebKit's `rgba16float` offscreen read back as opaque (bug 318726, confirmed) | All browsers | One fixed configuration: `alphaMode: 'premultiplied'` matched to vertex premultiplication and the one/one-minus-src-alpha blend; the init presentation probe verifies a premultiplied color survives the readback exactly |
| WebKit implemented `drawImage` *from a WebGPU canvas* only in 2026 (PRs #71628/#72118), and a working WebGPU view simply stopped rendering after a Safari update (bug 315186, confirmed with regression test) | macOS WKWebView | Presentation probe at init (§2.6): a broken blit path declines WebGPU with a named reason instead of painting holes while diagnostics report submission; the Canvas2D present surface stays authoritative |
| Pipeline compilation stalls first use; per-frame pipeline creation can peg the CPU (Khronos WebGPU best practices; Apple WWDC25; Chrome 135/136 WGSL compiler notes) | All browsers | Both scene pipelines are created once at init with `createRenderPipelineAsync`, never in the frame loop; effects-runner pipelines are created lazily per kernel and cached by key |
| DPR-2 and unrounded viewport math produce blurry/stale canvases; maintainer-confirmed thumbnail-instead-of-live causes (Penpot #7751/#8092/#9775) and repeated upstream Chromium DPR bugs found by a canvas maintainer (tldraw #1575, #8482) | Chrome/Firefox | DPR changes invalidate the backing store and force a full redraw (`subscribeToDevicePixelRatio` → `surfaceMatchesBackingStore('surface-resized')`); partial-redraw clips snap to whole device pixels (2026-09-25 seam fix) |

## 8. Decision record

- **Canvas2D present + offscreen WebGPU target (2026-07-13, reaffirmed
  2026-09-25).** In-place fallback beats a "pure" full-GPU presentation that
  cannot degrade without remounting. Revisit only with evidence that blit
  cost of GPU runs is a measured bottleneck (it has not been).
- **WebGL2 remains an experimental opt-in backend.** It currently admits a
  narrower scene subset than WebGPU and is not the default. It stays
  experimental until exact-frame correctness, fallback, startup, packaging,
  resource-soak, and paired native performance gates pass on a specific
  hardware profile. The qualification contract is in
  [`../perf/webgl2-qualification.md`](../perf/webgl2-qualification.md).
- **No native scene presentation.** Native computation (wgpu kernels) can
  win for bounded raster work; native presentation adds surface embedding,
  DPI, input alignment, and packaging costs across three webviews. Full-frame
  readback + IPC would not beat in-process Canvas2D replay for scene
  rendering. Per ADR-0237, native acceleration stays compute-only with
  truthful capability stages.
- **Fail-closed admission over GPU-coverage counters.** A wider GPU path is
  not a win if it changes pixels. Admission widens only when the pipeline
  reproduces the Canvas2D result (fills-stack solids and ellipses qualified
  on 2026-09-25); everything else islands, visibly and by design.

## 9. Remaining work

1. **Effect-chain export consumer** (§5): the measurement gate is satisfied
   (3–64× GPU speedups on this host) and the integration shape is specified
   in §5; the remaining work is executing the async conversion of
   `replayStructuredSceneInner` *with* its synchronous callback contracts
   (notably `mockupExport`'s `renderSubtree`) under the full export
   E2E/visual gate, plus per-effect CPU fallback and provider recording in
   export diagnostics. This is the highest-value open item.
2. ~~**Resume/DPR-triggered full redraw**~~ — **done 2026-09-26.** The DPR
   half was already live (`subscribeToDevicePixelRatio` → `displayDpr` frame
   dep → `surfaceMatchesBackingStore('surface-resized')`); the resume half
   landed as `subscribeToSystemResume` (canvasSurface.ts) wired in
   CanvasArea to the painted-surface invalidator. The Krita 490641 sleep
   class now has an in-app mitigation; real sleep/wake hardware verification
   remains on the manual checklist.
3. ~~**Oval/rect edge quality**~~ — **done 2026-09-26.** Both stages now
   derive analytic ~1 device-pixel coverage from `fwidth` (the oval's hard
   `discard` is gone), with the vertex stage expanding its quad ~1 px so the
   outside band has geometry. Before/after numbers, screenshots, and the
   tightened parity thresholds: `docs/perf/ledger.md` → "Edge antialiasing
   parity (2026-09-26)".
4. **Worker WebGPU**: OffscreenCanvas + WebGPU in the render worker is
   Chromium-only today and WebKitGTK has none; revisit after the platform
   matrix changes.
5. **Hardware lane**: `circle-transform-parity.spec.ts` (with the tightened
   edge-parity thresholds), the presentation probe, and the timing report now
   run green against this host's real AMD adapter — a first hardware data
   point, not coverage. Run the manual checklist on Windows/WebView2,
   macOS/WKWebView, and an ARM/ChromeOS device before the next release that
   touches this path; headless SwiftShader cannot certify hardware behavior.
6. **macOS soak for upload coalescing** (§7): the Safari 26.3
   interleaved-upload device-loss class needs a WKWebView soak before any
   claim that Varve's bounded chunk submits avoid it.
