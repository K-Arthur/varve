# GPU Acceleration System

Status: current-state documentation (2026-09-25). Companion to
[render-pipeline.md](render-pipeline.md), [canvas2d-system.md](canvas2d-system.md),
[native-acceleration.md](native-acceleration.md), ADR-0003, and ADR-0237.

This document defines what "GPU acceleration" means in Varve, which parts of
it are real today, what each platform can expect, and which failure modes the
design avoids. It exists because the honest answer to "does Varve use my GPU?"
is layered: a WebGPU scene path exists and now draws real solid-paint content,
GPU compute kernels for effects exist but are not wired to a consumer yet, and
the Canvas2D replay remains the authoritative production path everywhere.

---

## 1. The four distinct layers

| Layer | What it is | State |
|---|---|---|
| Display rendering | How the webview presents pixels (browser-composited Canvas2D/WebGPU under the hood) | Not inferred, not claimed. Status text never equates a backend name with hardware execution |
| Scene GPU path | `WebGPUBackend` in `packages/compositor`: solid rect/oval runs rendered offscreen via WebGPU, composited onto the Canvas2D present surface | Implemented, opt-in (`settings.render.preferWebGpu`, default off), draws real solid-paint documents since 2026-09-25 |
| GPU compute effects | `GpuEffectRunner` + nine WGSL kernels (bloom, caustics, CRT, VHS, light shafts, lens flare, light leak, palette snap, RGB split) behind the live-effect provider chain | Implemented and tested in isolation; **no application consumer yet** (see §7) |
| Native acceleration | `varve-accel` wgpu compute with truthful capability stages (discovered → runtime-loadable → device-usable → execution-verified) | Per ADR-0237; consumer is the (unwired) effect chain; see [native-acceleration.md](native-acceleration.md) |

## 2. Architecture

### 2.1 Canvas ownership (the 2026-07-13 invert)

The *present* canvas is always Canvas2D. GPU work renders to an offscreen
`<canvas>` carrying a `webgpu` context, and completed GPU runs are blitted to
the present surface with an identity transform. A browser canvas's context
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

## 3. Capability and coverage matrix

Evidence classes: **automated** (unit/golden tests), **browser** (Playwright,
headless Chromium), **hardware** (real-adapter browser run — CI has none,
see the manual checklist), **unverified** (no evidence on this class yet).

| Content / operation | Path | Status | Evidence |
|---|---|---|---|
| Solid rect (legacy fill or single-solid stack) | WebGPU run | Reachable; pixel parity within golden tolerance | automated + browser |
| Solid circle / ellipse | WebGPU run (shared oval stage) | Reachable; same coverage math as circles | automated + browser |
| Solid paint on mixed z-order documents | Ordered runs + islands | Reachable; islands preserve stacking | automated |
| Gradient / image / pattern / stacked fills | Canvas2D island | Verified fallback by design | automated |
| Strokes, text, paths, rounded rects | Canvas2D island | Verified fallback by design | automated |
| Blend modes, masks, group isolation, effects | Structural replay (main thread) | Verified fallback by design | automated + browser |
| Worker-rendered frames | Worker Canvas2D replay + bitmap present | Verified fallback (compositor bypassed) | automated + browser |
| Device loss mid-session | Canvas2D continuity + bounded recovery | Implemented; simulated-loss tests only | automated |
| GPU compute effects (9 kernels) | `GpuEffectRunner` | Implemented, **unwired consumer** (§7) | automated (harness + golden) |
| Native wgpu compute | `varve-accel` capability stages | Per ADR-0237; consumer unwired | automated (self-test) |
| Native scene presentation | — | Not implemented; no measured need (§8) | — |
| WebGL backend | — | Not implemented by decision (§8) | — |

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

## 5. GPU compute effects — implemented, deliberately unwired

The runner, kernels, harness (`compareGpuCpu` agreement), provider chain
(native GPU → native → WebGPU → CPU), and capability report are complete and
tested. **No application code calls the chain yet**: interactive replay and
export apply effects through the synchronous CPU kernels in the engine's
filter compositor, which are the byte-level reference the previews match.

Wiring the chain into export is scoped work with a clear shape: an async
variant of the filter compositor that dispatches each live-effect filter
through the chain at the point where the CPU kernel would run, keeping
opacity/blend compositing identical, falling back per effect on any failure,
and recording the serving provider in export diagnostics. It is gated on that
consumer — the kernels stay unreachable infrastructure until then, and the
website says so.

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

## 8. Decision record

- **Canvas2D present + offscreen WebGPU target (2026-07-13, reaffirmed
  2026-09-25).** In-place fallback beats a "pure" full-GPU presentation that
  cannot degrade without remounting. Revisit only with evidence that blit
  cost of GPU runs is a measured bottleneck (it has not been).
- **No WebGL backend.** WebGPU covers the GPU-capable runtimes Varve ships
  to; a second GPU backend doubles shader/safety surface for a shrinking
  legacy set. Revisit only if a supported target cannot run WebGPU but can
  run WebGL *and* shows a measured Canvas2D bottleneck.
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

1. **Effect-chain consumer** (§5): async filter-compositor dispatch for
   export with provider recording; then the website's "explicit asynchronous
   effect consumers" becomes an in-app reality rather than a boundary note.
2. ~~**Resume/DPR-triggered full redraw**~~ — **done 2026-09-26.** The DPR
   half was already live (`subscribeToDevicePixelRatio` → `displayDpr` frame
   dep → `surfaceMatchesBackingStore('surface-resized')`); the resume half
   landed as `subscribeToSystemResume` (canvasSurface.ts) wired in
   CanvasArea to the painted-surface invalidator. The Krita 490641 sleep
   class now has an in-app mitigation; real sleep/wake hardware verification
   remains on the manual checklist.
3. **Oval edge quality**: the oval stage discards hard edges while Canvas2D
   antialiases; coverage parity passes today, but edge-quality parity would
   need a distance-based blend — benchmark before adopting.
4. **Worker WebGPU**: OffscreenCanvas + WebGPU in the render worker is
   Chromium-only today and WebKitGTK has none; revisit after the platform
   matrix changes.
5. **Hardware lane**: run `tests/e2e/webgpu/circle-transform-parity.spec.ts`
   and the manual checklist on real adapters (Linux/Windows/macOS) before the
   next release that touches this path; headless SwiftShader cannot certify
   hardware behavior.
