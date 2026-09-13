# ChromeOS Stage 3: rendering, responsiveness, memory, slow storage, and optional AI

**Status:** Stage 3 implementation delivered; browser acceptance evidence
recorded below; Duet device validation remains a handoff
**Research access date:** 2026-09-12
**Repository snapshot at stage start:** `c4e16a7f763887b2f1feb64a20e7c5c621da307e`
**Scope:** browser route (native Chrome tab and installed PWA) on the 8 GB
Lenovo Chromebook Duet 11M889, with graceful behavior for 4 GB and x86
Chromebooks
**Coordination:** `docs/agents/chromeos-stage3-ownership.md` (task
`chromeos-stage3-2026-09-12`)

This document separates vendor documentation, repository evidence, local test
results, and hypotheses. Nothing here is a Duet measurement claim; no Duet was
attached to this session.

## 1. Research ledger

### 1.1 Seed sources requested for this stage

| Question | Source | Publisher / date | Access | Applicable versions | Finding | Confidence | Implementation consequence | Unresolved conflict |
|---|---|---|---|---|---|---|---|---|
| What does WebGPU availability actually prove? | [Overview of WebGPU](https://developer.chrome.com/docs/web-platform/webgpu/overview) | Chrome for Developers, published 2023-07-20, updated 2025-08-11 | 2026-09-12 | Chrome 113+; ChromeOS devices with Vulkan support | WebGPU shipped on ChromeOS only where the platform graphics path (Vulkan) supports it. API presence is a necessary but not sufficient condition. | High | Capability probes must attempt adapter and device creation and provide a Canvas2D fallback. | Mali-G57 driver behavior on the Duet remains unmeasured. |
| Which lifecycle boundary is reliable for pausing work and persisting? | [Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) | Chrome for Developers | 2026-09-12 | Chrome 68+ | `hidden` is the last reliably observable state; frozen pages stop freezable tasks and must not hold IndexedDB/BroadcastChannel/Web Locks; discard is only observable at next load via `document.wasDiscarded`; UI updates and background tasks should stop when hidden. | High | The shared frame scheduler stops scheduling while hidden; the settled-refinement timer is not a polling loop. Do not select faster render paths that poll in the background. | ChromeOS tab-discard timing on the Duet is unmeasured. |
| What are ONNX Runtime Web thread/proxy constraints? | [The 'env' Flags and Session Options](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html) | ONNX Runtime docs (Microsoft) | 2026-09-12 | onnxruntime-web 1.27.x | Multi-threading activates only with WebAssembly threads and cross-origin isolation; `env.wasm.proxy` creates a blob worker (CSP-sensitive) and cannot combine with the WebGPU EP; `wasmPaths` must match the JS bundle build exactly; execution providers form a fallback chain. | High | Keep the deployed demo single-threaded and non-proxy; keep ORT assets version-matched; never rely on threads for core editing. | None material. |
| Is the WebNN execution provider a practical default? | [Using WebNN](https://onnxruntime.ai/docs/tutorials/web/ep-webnn.html) | ONNX Runtime docs (Microsoft) | 2026-09-12 | onnxruntime-web 1.27.x | WebNN is available in current Chrome/Edge on Windows, Linux, macOS, Android, and ChromeOS **behind a flag**; device types are hints; unsupported operators fall back to WASM. | High | Do not select WebNN as a default provider or claim NPU acceleration; the repository has no WebNN provider path. | Whether the Duet exposes a usable WebNN context is unknown and not required. |
| What is the WebNN specification status? | [Web Neural Network API, Editor's Draft](https://webmachinelearning.github.io/webnn/) | W3C Web Machine Learning WG, Editor's Draft 2026-09-10 | 2026-09-12 | CR snapshots 2024-04-11, 2026-01-22 | The API is in active standardization with substantial changes between snapshots; device selection is a hint with no enumeration, and `opSupportLimits()` is the supported query surface. | High | Treat WebNN as optional future investigation; no support claim. | Spec churn means implementation-specific behavior may change. |
| Can Chrome's built-in Prompt API run on this Chromebook? | [The Prompt API](https://developer.chrome.com/docs/ai/prompt-api) | Chrome for Developers, published 2025-05-20, updated 2026-08-26 | 2026-09-12 | ChromeOS from Platform 16389 on **Chromebook Plus** devices only | Foundation-model APIs require a Chromebook Plus device, ≥22 GB free profile storage, and either >4 GB VRAM or 16 GB RAM with 4+ cores; the model is not available in Web Workers; the Duet 11M889 (8 GB, Kompanio 838, 29 Wh) is not a Chromebook Plus device. | High | Do not gate any Varve feature on built-in AI; do not describe the NPU or Gemini Nano as available; Varve's optional models remain ONNX assets it manages itself. | None: this is a documented unavailability, not a pending capability. |

### 1.2 Focused follow-up research (before AI and device-lifecycle changes)

| Question | Source | Publisher / date | Access | Applicable versions | Finding | Confidence | Implementation consequence | Unresolved conflict |
|---|---|---|---|---|---|---|---|---|
| What must a WebGPU consumer do when the device is lost? | [GPUDevice: lost](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost) | MDN contributors, last modified 2025-06-18 | 2026-09-12 | WebGPU implementations | `requestDevice()` never returns `null`; it can resolve to an already-lost device. Devices can be lost at any time (resource management, driver update); most losses are transient and the correct recovery is to request a new device and recreate resources. `destroy()` marks a deliberate, non-retryable loss. An adapter can become permanently unavailable (GPU disabled/unplugged). | High | Allocation/probe code must not cache an adapter/device forever, must destroy temporary devices, and must treat loss as recoverable. The Stage 1 capability probe already requests and destroys a real device; ORT's WebGPU EP has its own device recovery path (`WebGPURecovery`). | ChromeOS/Mali loss frequency is unmeasured. |
| What does the ORT WebGPU EP require on import and cleanup? | [Using the WebGPU Execution Provider](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html) | ONNX Runtime docs (Microsoft) | 2026-09-12 | onnxruntime-web 1.27.x | WebGPU requires the `onnxruntime-web/webgpu` build entry; graph capture needs static shapes; GPU tensors must be disposed with `buffer.destroy()`/`tensor.dispose()` to avoid leaks; zero-sized tensors are always CPU-side. | High | Keep the dedicated worker/EP path bounded and dispose device resources on cancellation; do not enable graph capture without static-shape evidence. | The repository's WebGPU EP usage on the Duet remains untested. |
| What is pinned in the repository? | Repository manifests and lockfile: `package.json`, `pnpm-lock.yaml`, `crates/varve-wasm/Cargo.toml`, `justfile`, `scripts/fetch-onnxruntime.mjs` | Varve repository | 2026-09-12 | actual checkout | `onnxruntime-web` resolves to 1.27.0 for web; the native ORT dylib is pinned to 1.27.1 with per-platform SHA-256 verification; `wasm-bindgen` is `0.2` built with `wasm-pack --target web`, with a separate SIMD artifact; the demo build prunes `models/` and `ort-wasm/` assets. | High | Do not upgrade ORT or `wasm-bindgen` in this stage; keep the single-thread, non-proxy WASM defaults and the version-matched asset layout. | Rust `wasm-bindgen` minor is unpinned within 0.2. |
| What does the WebGPU specification require around adapter/device lifetime? | [GPUWeb specification](https://gpuweb.github.io/gpuweb/) | GPU for the Web Community Group | 2026-09-12 | current WebGPU draft | Adapter/device objects can become invalid; a device may be lost and resources become unusable. Temporary probe devices must be destroyed, and a consumer must recreate resources after loss. | High | Keep the probe bounded and disposable; make the compositor/effect runner recover to Canvas2D or a fresh device without changing document data. | Driver-specific loss reasons and recovery time on ChromeOS/Mali remain unmeasured. |
| Which cooperative scheduling APIs are safe to call conditionally? | [Scheduling APIs](https://wicg.github.io/scheduling-apis/) and [scheduler.yield()](https://developer.chrome.com/blog/use-scheduler-yield) | WICG / Chrome for Developers; draft 2025-05-30, article 2025-03-06 | 2026-09-12 | Chrome 129+ for `scheduler.yield`; other browsers vary | `scheduler.yield()` and `scheduler.postTask()` are feature-detectable; a fallback is required because the Scheduling API is not universal. Aborted tasks should not resume stale work. | High | Admitted thumbnail, raster-pyramid, and semantic jobs yield at chunk boundaries with a MessageChannel/timer fallback; this is not used to hide synchronous inference. | Exact scheduler behavior on ChromeOS release channels is unmeasured. |

### 1.3 Stage 1/2 evidence reused (not re-derived)

- Cross-origin isolation (and therefore WASM threads) is not available on the
  GitHub Pages demo host, so the single-thread path is correct
  ([Stage 2 ledger](chromeos-stage2-browser-pwa-2026-09-12.md) §1).
- Storage quotas and eviction are origin-level and all-or-nothing, so recovery
  data must be separable from disposable caches and must never be deleted to
  make room ([Stage 2 ledger](chromeos-stage2-browser-pwa-2026-09-12.md) §1).
- Frame budgets use a bounded, measured `requestAnimationFrame` cadence (with a
  conservative fallback) and per-work-class multipliers (`frameBudget.ts`);
  the adaptive profile consumes rolling cost and over-budget counts
  (`adaptiveProfile.ts`).

## 2. Repository diagnosis

### 2.1 Adaptive profile truthfulness (before)

`packages/editor/src/canvas/adaptiveProfile.ts` declared a `PerformanceProfile`
with eleven fields, but only four reached a hot path:

| Field | Runtime consumer before | Status |
|---|---|---|
| `tier` | diagnostics only (`drawDiagnostics`, settings display) | truthful |
| `cacheMultiplier` | `getAdaptiveCacheLimits` -> subtree IR cache + engine-node memo | truthful |
| `enableWorker` | worker paint gate in `renderPipeline` | truthful |
| `enablePartialRedraw` | dirty-prune gate in `renderPipeline` | truthful |
| `renderScale` | none | false configuration |
| `enableCulling` | none (culling is always on via the spatial index) | false configuration |
| `backdropBlurQuality` | none | false configuration |
| `prefetchEnabled` / `prefetchDepth` | none; `viewportPrefetch.ts` is unreferenced outside its own test | false configuration |
| `imageDecodeQuality` | none; image LOD is already governed by `selectRasterRepresentation` / `workerSourceCapFor` | false configuration |
| `effectQuality` | none | false configuration |
| `compositor` | none (ADR-0003 keeps Canvas2D authoritative) | false configuration |

The false fields are removed and `renderScale` is now consumed by the render
loop. `viewportPrefetch.ts` remains in the tree, documented here as
unreferenced; it is not presented as an optimization.

### 2.2 Hidden/idle behavior (verified, unchanged)

- The shared frame scheduler cancels the scheduled frame and stops scheduling
  while `document.visibilityState === 'hidden'`
  (`performance/editorFrameRuntime.ts`), and image settled-refinement is a
  one-shot quiet timer, not a polling loop (`render/imageRefinement.ts`).
- Thumbnail work defers while an interaction is open
  (`thumbnail/scheduler.ts`) and runs under a concurrency-1 scheduler.
- Raster pyramid and semantic-index jobs use the same bounded admission gate,
  with stale-result rejection and cooperative yields at chunk boundaries.
- The app-wide page-lifecycle adapter pauses derived work while hidden, frozen,
  or page-hidden, then resumes it on visibility/resume/pageshow. It does not
  claim that a hidden tab will always receive a final callback.

### 2.3 Memory and slow-storage findings

| Finding | Evidence | Action |
|---|---|---|
| Worker image admission had `maxEntries = Infinity` as its default | `render/collectImageBitmaps.ts` | Bounded to 64; tests added |
| Recovery points were capped at 20 sessions but had no byte cap | `recovery.ts` | 64 MiB total cap with newest-point-per-tab protection; tests added |
| `platform/web.ts touchFile` rewrites the full document record; autosave writes a recovery copy per save | `packages/platform/src/web.ts`, `context/useAutoBackupServices.ts` | Stage 2's v6 web database now stores large document content in a separate content-addressed store, keeps file metadata small, and records logical document/content writes. Autosave cadence is unchanged; physical eMMC throughput is not inferred from logical counters. |
| Persistent-history DAG has no compaction | `packages/history`, `context/usePersistentHistory.ts` | Out of scope for this slice; recorded as a bounded follow-up (retention policy must preserve undo semantics). |

### 2.4 Optional AI findings

| Finding | Evidence | Action |
|---|---|---|
| A rejected `onnxruntime-web` dynamic import was cached forever, permanently disabling optional inference after one transient failure | `engine/src/inference/SessionManager.ts` | Rejected attempts are dropped so the next call retries; regression tests added |
| `runPrecisionBenchmark` released its two sessions only on the success path | `engine/src/backgroundRemoval/precisionCapabilities.ts` | Both sessions release in a `finally`; regression tests added |
| WebGPU provider selection needed a real device check, not only an adapter check; WebNN is absent | `backgroundRemoval/environmentCapabilities.ts`, `inference/core/RuntimeCapabilities.ts` | Both inference capability surfaces now reuse the real adapter+device probe; temporary devices are destroyed and failed creation reports WASM/Canvas2D fallback. No `navigator.ml` reference exists anywhere in the repository |
| Adapter presence alone was too coarse for diagnostics and GPU effects | `editor/performance/webGpuProbe.ts`, `engine/gpuAdapter.ts`, `backgroundRemoval/gpuEffectRunner.ts`, `compositor/WebGPUBackend.ts` | A low-power adapter/device probe now reports supported/unavailable/failed, destroys its temporary device, and invalidates effect resources after `device.lost`; the Canvas2D path remains authoritative when the probe or runtime fails. |
| Cloud background removal is disabled by default and has no editor UI caller | `backgroundRemoval/providers/cloudProvider.ts`, `cloudConfig.ts` | Verified; no silent fallback to a paid endpoint |
| `session.run` is not cancellable; worker restart is the only true stop | `inference/inferenceWorkerHost.ts` | Documented limit; cancellation remains bounded by one inference/tile |
| Model file size did not communicate working-set cost | `packages/editor/src/modelRequirements.ts`, model settings tabs, `ModelDownloadDialog.tsx` | Optional model surfaces now show download/storage bytes separately from estimated peak working memory, with an explicit estimate caveat; core editing remains model-free. |

## 3. Implementation delivered

| Commit | Change | Files |
|---|---|---|
| `7eb32ac76` | Interactive preview render scale: the current tier's `renderScale` (0.75 performance, 0.5 constrained) applies to the content canvas backing store only while an editor interaction is open; settled frames and exports stay at full device resolution. `presentWorkerFrame` matches bitmaps against the actual backing store so the cheap present path works at preview scale and refuses a stale preview bitmap after promotion. False profile fields removed. `?perf=1` handle exposes tier/renderScale for acceptance. | `adaptiveProfile.ts` (+test), `renderPipeline.ts`, `presentWorkerFrame.ts` (+new test), `perfRuntime.ts` |
| `342546dab` | Session lifecycle: a rejected ORT import is retryable, and the precision benchmark releases both sessions on every path. | `SessionManager.ts` (+new test), `precisionCapabilities.ts` (+new test) |
| `f1e86c4d9` | Memory/storage bounds: worker image admission defaults to 64 sources; recovery evicts the oldest redundant point beyond a 64 MiB total while protecting the newest point per tab. | `collectImageBitmaps.ts` (+test), `recovery.ts` (+test) |
| `d9093c07f` | Measured rAF cadence (with a conservative 60 Hz fallback) now drives frame budgets; hidden/gapped samples reset and hysteresis prevents tier thrash. | `frameCadence.ts` (+test), `frameScheduler.ts`, `editorFrameRuntime.ts`, `frameBudget.ts` |
| `d7c722d65` | Shared derived-work admission bounds pending/concurrent thumbnails, raster pyramids, and semantic indexing, with priorities, cancellation, stale-result rejection, lifecycle pause/resume, and cooperative yielding. | `derivedWorkAdmission.ts`, `scheduling.ts`, thumbnail/semantic/raster schedulers (+tests) |
| `5f6a11cc6` | Web database v6 separates large file content from metadata, deduplicates content by hash, lazily migrates legacy inline JSON, and records logical write amplification without pretending to measure eMMC throughput. | `web-db.ts`, `web.ts`, `storageWriteMetrics.ts` (+tests) |
| `f9eca85e4` | Adaptive profile uses a bounded real WebGPU device probe and throttled memory-pressure signal; residency and diagnostics degrade conservatively without vendor hard-coding. | `webGpuProbe.ts`, `adaptiveProfile.ts`, `memoryPressure.ts`, `memoryBudget.ts`, `renderPipeline.ts`, `perfRuntime.ts` (+tests) |
| `cd23ec748` | Derived work pauses across page lifecycle transitions; admitted jobs yield between chunks; GPU effect resources are released and retried after device loss. | `pageLifecycle.ts` (+test), `App.tsx`, worker schedulers, `gpuAdapter.ts`, `GpuEffectRunner`, `WebGPUBackend` (+tests) |
| `23c7238d4` | Optional model dialogs and settings disclose download/storage bytes and estimated peak working memory separately, including unknown values when the catalog has no measurement. | `modelRequirements.ts` (+test), model settings tabs, `ModelDownloadDialog.tsx` (+tests) |
| `f74c03d99` | Corrects adaptive pressure type narrowing and imports for the settings/capability surfaces; preserves the bounded runtime probe contract under strict TypeScript checks. | `renderPipeline.ts`, `PerformanceSettingsTab.tsx`, `capabilityReport.ts`, `webGpuProbe.ts` |

Design constraints preserved:

1. One adaptive authority (`computeProfile`) — no second quality manager.
2. No new hub imports (`Shell.tsx`, `CanvasArea.tsx`, `context.tsx`
   untouched), and import counts are unchanged.
3. Preview degradation is measured (rolling frame time, 30-frame cooldown,
   10-frame observation) and reversible; it never alters the document.
4. Exports, print, and saved originals render through their own surfaces and
   keep full fidelity.
5. Optional AI stays on-device, capability-gated, and non-blocking for core
   editing.

Two deliberate non-changes:

- **No user-facing quality override was added.** Tier selection stays
  automatic; the existing Performance settings already expose diagnostics and
  reduced motion, and a manual render-scale control would duplicate the
  measured-profile authority. Revisit only if device data shows the automatic
  selection is wrong for a real workflow.
- **No full-scene `scheduler.yield`/`postTask` retrofit was made.** The shared
  derived-work lanes now yield at bounded thumbnail, pyramid, and semantic
  chunks, but inference and the renderer remain synchronous at their measured
  boundaries. The helper is feature-detected with a fallback and is not used
  to imply that a single async function makes CPU work non-blocking.

## 4. Acceptance evidence

### 4.1 Browser acceptance and visual inspection (local x86_64 Chromium)

Spec: `tests/e2e/canvas/adaptive-preview-scale.spec.ts`. It seeds a rectangle,
zooms to 200%, forces the performance tier through the `?perf=1` seam, pans
with the Hand tool, and asserts: settled frames at full backing resolution;
mid-drag backing at exactly `round(cssWidth x DPR x 0.75)` with
`tier === 'performance'`; full resolution restored after the interaction
quiets; and canvas-pixel equality with a `forceFullRedraw` oracle.

Command and result (production artifact, no watcher):

```text
pnpm --filter @varve/desktop exec vite build --outDir dist-stage3
pnpm --filter @varve/desktop exec vite preview --outDir dist-stage3 --port 1497 --strictPort
node scripts/quality/heavy-lease.mjs e2e-stage3-static -- \
  pnpm exec playwright test tests/e2e/canvas/adaptive-preview-scale.spec.ts \
  --config=/tmp/varve-stage3-pw.config.ts

✓ interactive previews degrade at the tier scale and settle at full resolution (15.4s)
1 passed (18.4s)
```

The temporary config is a throwaway `/tmp` file (no `webServer`, no
global setup) pointed at the static artifact. Two earlier attempts against the
Vite dev server failed in `page.evaluate` with "Execution context was
destroyed" because other active agents' file writes triggered HMR reloads
mid-test; that is shared-worktree churn, not a product failure, and the static
artifact removes the variable.

The same production-artifact test was re-run on the final Stage 3 working tree
after the lifecycle/GPU and model-requirement commits, using the reserved
fallback port:

```text
pnpm --filter @varve/desktop exec vite build --outDir dist-stage3
pnpm --filter @varve/desktop exec vite preview --outDir dist-stage3 --port 15000 --strictPort
pnpm exec playwright test tests/e2e/canvas/adaptive-preview-scale.spec.ts \
  --config=/tmp/varve-stage3-pw.config.ts --reporter=list

✓ interactive previews degrade at the tier scale and settle at full resolution (6.1s)
1 passed (7.3s)
```

Visual inspection (screenshots read at full size; stored under
`/tmp/varve-chromeos-stage3-visual/`):

- `preview-scale-drag.png` — interaction open at the forced performance tier;
  the canvas shows the rectangle mid-pan with the selection outline and corner
  handles tracking it. The preview scale is active (asserted numerically); the
  `?perf=1` diagnostics HUD is visible because the flag enables it.
- `preview-scale-settled.png` — after release and the 180 ms quiet delay, the
  rectangle and its selection handles sit at the panned position at full
  backing resolution; no stale preview pixels, no misaligned overlay, and the
  pixel oracle (settled hash === `forceFullRedraw` hash) passed.
- `product-desktop.png`, `product-mobile.png`, and
  `browser-demo-mobile.png` — current static Astro output at 1440px and
  390px widths. The Chromebook route note and constrained-device section are
  visible, readable, and contained within the viewport; a scripted check found
  no horizontal overflow (`scrollWidth === clientWidth`).

Limits of this evidence: it is headless Chromium with a software rasterizer
(no GPU), a single rectangle, and DPR 1, so it proves correctness and the
backing-scale contract, not device frame rates on the Duet's Mali GPU. The
diagnostics HUD's interaction-total numbers in these screenshots are not a
performance claim.

A unit-level validation of the same contract runs in
`presentWorkerFrame.test.ts`: a 0.75 bitmap presents on a 0.75 surface and is
refused once the surface returns to full resolution.

### 4.2 Machine checks (unit)

| Command | Result |
|---|---|
| `pnpm exec vitest run packages/editor/src/canvas/__tests__/adaptiveProfile.test.ts packages/editor/src/canvas/presentWorkerFrame.test.ts` | 18 passed |
| `pnpm exec vitest run packages/engine/src/inference/SessionManager.test.ts packages/engine/src/backgroundRemoval/precisionCapabilities.test.ts` | 5 passed |
| `pnpm exec vitest run packages/editor/src/recovery.test.ts packages/editor/src/render/collectImageBitmaps.test.ts` | 56 passed |
| `VARVE_TEST_WORKERS=1 pnpm exec vitest run packages/editor/src/modelRequirements.test.ts packages/editor/src/components/Settings/BgRemovalModelsTab.test.tsx packages/editor/src/components/BackgroundRemoval/ModelDownloadDialog.test.tsx packages/editor/src/components/Settings/__tests__/ColorizationModelsTab.test.tsx packages/editor/src/components/Settings/SemanticSearchTab.test.tsx` | 32 passed |
| `pnpm --filter @varve/engine typecheck` | clean |
| `pnpm --filter @varve/website typecheck` | 0 errors (5 pre-existing hints) |
| `pnpm --filter @varve/website build` | 86 static routes built; 0 errors (bundler warnings recorded in handoff) |
| `pnpm --filter @varve/editor typecheck` | Stage 3 files clean; blocked by unrelated in-flight `ContentAwareFillDialog.tsx` missing-`platform` fields and `packages/import/src/service.ts` errors (`ImportResult` missing and an implicit-any callback) |
| `pnpm --filter @varve/desktop typecheck` | blocked by the same unrelated workspace errors |

The final shared-worktree validation was intentionally recorded separately from
the owned-scope checks above. An earlier final-gate snapshot selected 63 changed
files (101% of repository tests); the last recheck selected 60 changed files
(still 101%) because concurrent agents left unrelated edits in the checkout.
Both plans reported **no** full-suite escalation. `pnpm verify:affected`
therefore stopped at Tier 0 on the same unrelated formatting diagnostic in
`packages/editor/src/components/AIStatusIndicator/AIStatusIndicator.tsx`.
The explicitly escalated `pnpm verify:full` reached workspace typechecks and
stopped on the unrelated import errors above; the later editor typecheck also
reported three missing-`platform` fields in the concurrently edited
`ContentAwareFillDialog.tsx`. The required docs, emoji, token, and architecture audits passed (architecture
reported 14 distinct cycles, below its enforced ceiling, with existing hub and
instability warnings). The root `pnpm bench` command was stopped after
discovery showed 108 benchmark files under existing sibling worktrees and
report snapshots; a bounded spatial-index invocation inherited the same
include path and was stopped for the same reason. No benchmark output is used
as a device-performance or before/after claim.

## 5. Known limits and handoffs

1. No Duet hardware run: preview-scale behavior, pen/touch drags, real GPU
   loss, sustained editing, and real eMMC write behavior remain unmeasured on
   the target device.
2. `renderScale` applies only while an interaction is open. A permanently slow
   device still renders settled frames at full resolution; this is deliberate
   (fidelity over steady-state cost) and should be revisited with device data.
3. `viewportPrefetch.ts` is unreferenced. The profile no longer claims to
   control it. Wiring or deleting it is a follow-up decision, not an
   optimization claimed here.
4. Autosave write amplification (full-document rewrite plus recovery copy) is
   documented but not changed: it crosses the Stage 2 persistence contract and
   needs its own migration/rollback tests.
5. `session.run` cancellation still waits for the in-flight tile/inference;
   worker termination remains the only hard stop.
6. Built-in browser AI (Gemini Nano / Prompt API) is unavailable on this device
   class per Chrome's documented requirements; no Varve feature depends on it.
7. WebNN is not implemented or claimed; the ONNX provider chain remains
   WebGPU (only after a real device probe), then WebGL/WASM according to the
   runtime report.
8. The repository's `wasm-bindgen` minor version is not pinned; this stage did
   not change the WASM toolchain.

## 6. Duet run kit (missing real-device evidence)

No Duet was attached to this session. This kit is the smallest bounded
procedure that turns the open handoffs into measured evidence. It is written
for the installed browser app route, which Stage 2 verified can run offline.

### Before starting

1. Record: ChromeOS channel and Platform version (`chrome://version`), Chrome
   version, free eMMC space, battery/power state, display scale, and whether an
   external display is attached. Do not scale measurements from another
   device or session.
2. Install the app from `https://varve.studio/try/` (Chrome menu → Install),
   finish one online setup so the service worker cache is complete, then
   relaunch from the launcher.
3. Open the capability report in Settings and save the JSON. It must include a
   successful WebGPU adapter+device probe or an honest unavailable state;
   record which. Do not treat an advertised NPU as usable.

### Sustained editing and preview-scale check

1. Seed the medium mixed fixture: append `?perf=1` to the installed app URL
   and call `__varvePerf.fixtures.apply('vector-1k')` in DevTools once, or
   import an equivalent document. Record the fixture id and node count.
2. Pan/drag continuously for at least 10 seconds. On release, wait 1 second and
   confirm the canvas returns to full sharpness (no permanently blurred text).
3. Read `__varvePerf.profile.tier()` and `__varvePerf.frameBudget.summary()`
   before, during, and after the gesture. Save the JSON. The expected shape:
   an interaction-frame p95 at or below the Stage 1 budget (50 ms) with the
   preview active, and no leftover partial-region artifacts in the settled
   frame.
4. Screenshot the drag and the settled frame at 100% zoom; inspect strokes,
   text edges, masks, gradients, and selection handles. A blurred settled
   frame or misaligned overlay is a failure, not a measurement.

### Memory, discard, and storage

1. Repeat open/close of the medium fixture 10 times and record tab memory from
   Chrome Task Manager after each cycle. The post-cycle value must plateau;
   report the peak and the plateau.
2. Force a discard from `chrome://discards` while the document has unsaved
   edits, reload, and confirm the latest recovery point restores. Then repeat
   with less than 1 GB free space if achievable without deleting user data.
3. Confirm the recovery byte cap never removes the current tab's newest
   recovery point; the app must not delete unsaved work to satisfy a cap.

### Optional AI

1. Without downloading any model, confirm the core editing steps above all
   work.
2. Start one optional model operation and record download bytes, time, peak
   memory, and whether cancellation stops the work. Record the provider the
   session actually used (WASM vs WebGPU) if the diagnostics expose it, and
   state explicitly if they do not.
3. WebNN and built-in Gemini Nano must remain unavailable/unused; do not
   enable Chrome flags to make a claim.

### What this kit does not cover

Native Linux ARM64 (Stage 5), x86 Chromebook variants, thermal throttling over
30+ minutes, and pen-pressure-specific behavior (Stage 4). Report those as
unmeasured rather than inferred.
