# Low-end effects and model runtime baseline (2026-09-13)

Status: implementation checkpoint. This audit records the evidence used for
the low-end rendering and inference work; it is not a claim that the physical
reference device has been validated.

## Scope and evidence

The reference product configuration is the Lenovo Chromebook Duet 11 M889:
Kompanio 838, Mali-G57 MC3, 8 GB RAM, 1920 × 1200 touch display. Lenovo's
current PSREF confirms that configuration, but no physical Duet is attached to
this workspace. Browser/PWA and Debian/Crostini results therefore remain
pending until each runtime is measured separately. The development control is
the CachyOS/Wayland checkout described by `AGENTS.md`.

The following baseline was run before this milestone's changes:

```text
Command:
  pnpm exec vitest run packages/engine/src/replay-filter.test.ts \
    packages/engine/src/spatialBlur.test.ts \
    packages/engine/src/inference/core/__tests__/DownloadManager.test.ts \
    packages/engine/src/inference/SessionManager.test.ts
Result: 4 files passed, 36 tests passed, 0 failed
Environment: Linux development checkout; no physical Chromebook measurement
```

This is synthetic/unit evidence. It does not establish touch-to-photon
latency, WebKitGTK behavior, ChromeOS memory pressure, Mali execution, GPU
availability, or Crostini graphics acceleration.

## Current code observations

| Priority | Observation | Evidence and affected consumers | Intended correction |
| --- | --- | --- | --- |
| P1 | `contentEffectPadding` takes the maximum support of a content-effect stack. | `packages/engine/src/replay.ts` allocates one intermediate for the whole stack. Sequential local effects can sample pixels produced by the previous stage, so a later halo can be clipped. This reaches live replay, thumbnails and export paths that use the replay IR. | Sum validated local support across the ordered stack, with finite-input guards and regression fixtures. |
| P1 | A complex item filter uses a full canvas-sized isolated surface. | `replayItemOnIsolatedSurface` and `filterCompositor` use `canvas.width × canvas.height` even for a small filtered item. Every such item can cause large temporary surfaces and readbacks. | Use a clipped region for non-expanding pointwise filters; retain the full path for spatial/global filters until their bounds contract is proven. |
| P1 | A provider timeout can fall through while the provider still owns the request. | `packages/engine/src/inference/ProviderChain.ts` creates an abort controller but passes the caller's signal to providers. A timed-out provider can therefore overlap a fallback attempt. | Propagate the attempt signal and make timeout fallback conservative unless completion/cancellation is known. |
| P1 | Resumed downloads do not validate `Content-Range`. | `packages/engine/src/inference/core/DownloadManager.ts` accepts any `206` response for a partial file. A wrong start offset can corrupt an otherwise valid artifact. | Validate the range start/total and preserve validators; reject incomplete or oversized responses before installation. |
| P0 guard | The documented raster policy was not enforced by every portable surface constructor, and an oversized content-effect surface could abort the whole replay. | `packages/engine/src/rasterSurface.ts`, `compositeCanvas.ts`, `replay.ts`, filter and effect callers. A valid base surface can still be followed by several simultaneous RGBA/intermediate/readback allocations. | Enforce axis/area guards before construction and fall back to authoritative base content when an optional effect surface cannot be allocated. Aggregate byte reservations across effects and inference remain a separate follow-up. |

These are code observations, not runtime measurements. The existing adjustment
pipeline already sums filter expansion in `totalEffectExpansion`; the content
effect path should follow the same ordered-support rule rather than introduce
a second semantic convention.

## Implemented checkpoints

The following changes are committed on `master` and have targeted synthetic
coverage. They do not promote the browser/PWA or Crostini support tier without
device-specific evidence:

- `3170349e1` — cumulative content-effect support bounds, with finite-input
  guards and ordered-stack fixtures.
- `71680122e` — pointwise post-filter regions, including transformed painted
  bounds, stroke coverage, viewport clipping, and conservative full-surface
  routing for spatial/global/effect-bearing filters.
- `604b22b2b` — provider timeout fail-closed behavior unless hard cancellation
  is declared, plus conservative `Content-Range`, ETag, size, HTML-response,
  and multipart component validation for model downloads.
- `61df5d4d3` — pre-construction raster/composite guards and authoritative base
  replay fallback for unallocatable content-effect surfaces.
- `53af2922b` — website E2E coverage for the constrained Image Treatments
  workflow, including desktop/mobile screenshots and both production base-path
  modes.
- The current effects E2E also follows the inspector's responsive Export
  overflow menu when the tab row cannot keep Export inline.

## Checkpoint measurements and visual evidence

The following evidence was collected after the implementation checkpoints. It
is host-control evidence, not a Lenovo or Crostini qualification:

```text
Website build: pnpm build:website
  92 static pages built; 0 errors; 5 TypeScript hints
Website Pages build: pnpm build:website:pages
  92 static pages built; 0 errors; 5 TypeScript hints
Website E2E:
  VARVE_WEBSITE_E2E_PORT=4335 VARVE_WEBSITE_E2E_PORT_ROOT=4336
  pnpm exec playwright test -c playwright.website.config.ts \
    apps/website/tests/e2e/image-treatments-feature.spec.ts \
    --project=ghpages --project=custom-domain --workers=1 --reporter=list
  2 tests passed (14.6 s)
Editor effects E2E:
  TMPDIR=<isolated> VARVE_E2E_PORT=1515 VARVE_DISABLE_HMR=1
  VARVE_E2E_WORKERS=1 pnpm exec playwright test
    tests/e2e/effects/filter-strength.spec.ts --project=chromium --reporter=list
  1 test passed (3.9 min); import, filter edit/reset, undo/redo, responsive
  inspector Export navigation, PNG download, and independent alpha checks ran.
Render control benchmark:
  isolated jsdom replay bench, one worker
  100 rectangles: p50 7.90 ms, p95 23.09 ms
  1,000 rectangles: p50 23.24 ms, p95 25.21 ms
  3 tests passed
```

Inspected artifacts from the website run:

- `test-results/image-treatments-feature-i-aa34f-and-preserves-mobile-reflow-ghpages/image-treatments-desktop-light.png`
- `test-results/image-treatments-feature-i-aa34f-and-preserves-mobile-reflow-ghpages/image-treatments-mobile-light.png`

The captures show the new low-end preview explanation, readable attachment
choices, and a mobile single-column reflow without page-level overflow. Three
earlier full-editor effects E2E attempts were stopped before editor setup by
unrelated, transient shared-worktree syntax/module-resolution failures in
other agents' in-flight colorization and WebGPU files. A subsequent fresh run
reached the real editor and passed the full effect/export workflow. The server
still logged a transient parse warning from another agent's in-flight
`workspaceStore.ts`; the browser run recovered and completed successfully.
Inspected artifacts from that run:

- `reports/effects-repair/strength-before.png`
- `reports/effects-repair/strength-inspector.png`
- `reports/effects-repair/strength-after.png`
- `reports/effects-repair/strength-export.png`

The before/after canvas captures were identical after the neutral reset. The
independently decoded exported PNG was 200 × 161, with non-transparent bounds
`[20, 20, 179, 140]` and alpha values `{0, 64, 128}`. Physical touch, ChromeOS
browser, PWA, and Crostini effects evidence remains pending.

## Research record

Access date for all links below: 2026-09-13. Version applicability is checked
against the pinned repository/runtime versions where the repository exposes
them; behavior that depends on a device or host remains explicitly uncertain.

| Source | Decision supported | Remaining uncertainty |
| --- | --- | --- |
| [Lenovo PSREF: Chromebook Duet 11 M889](https://psref.lenovo.com/Product/Lenovo/Lenovo_Chromebook_Duet_11M889?tab=model) | Use M889 as the supplied 8 GB reference SKU and keep it distinct from representative 4 GB profiles. | Exact ChromeOS build, browser flags, display scale, viewport/DPR, battery state and thermal state require the device. |
| [Google: Linux development environment](https://support.google.com/chromebook/answer/9145439?hl=en-GB) | Treat ChromeOS browser/PWA and Debian/Crostini as separate targets; managed-device availability and Linux graphics limitations must be probed. | Crostini Debian release, WebKitGTK version, ABI libraries and actual graphics path are device-specific. |
| [Tauri: Webview versions](https://v2.tauri.app/reference/webview-versions/) | Do not infer Tauri Linux behavior from Chrome: Linux uses the installed WebKitGTK provider. | The installed Chromebook container stack is not present here. |
| [W3C Filter Effects](https://www.w3.org/TR/filter-effects-1/) and [SVG filter regions](https://www.w3.org/TR/SVG11/filters.html) | Filter regions and primitive subregions are clipping contracts; expanded bounds must include all sampled/generated pixels. | Varve's application-specific effect stages still require fixture-level verification. |
| [ONNX Runtime Web session options](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html) | Proxy-worker restrictions, CSP and WebGPU incompatibility are runtime policy inputs; a provider label is not proof of execution. | Exact browser/WebKitGTK support and operator partitioning need runtime probes. |
| [ONNX Runtime Web large models](https://onnxruntime.ai/docs/tutorials/web/large-models.html) and [deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html) | Account for loading memory, external data, correct WASM/worker assets and browser addressability; streaming download alone is not zero-copy inference. | Actual per-tab/container limits vary by browser and device. |
| [ONNX Runtime thread management](https://onnxruntime.ai/docs/performance/tune-performance/threading.html) and [cross-origin isolation](https://web.dev/articles/cross-origin-isolation-guide) | Bound total thread use and gate threaded WASM on actual isolation/SAB support. | Thread count and thermal behavior on Kompanio/Mali are unmeasured. |
| [MDN: `GPUDevice.lost`](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost) | Device-loss recovery must recreate device-owned resources and invalidate capability caches. | Physical adapter-loss behavior remains untested here. |
| [MDN: storage quota and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) | Model caches are disposable, quota is approximate, and install state cannot be treated as durable without validation. | Quota and private/managed-browser policy are host-specific. |
| [W3C WCAG 2.2 target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | Keep frequent touch targets at the repository's approximately 44 CSS-pixel goal and at least satisfy the 24 CSS-pixel AA minimum or spacing exception. | Final touch acceptance requires a real device and narrow/split layouts. |

## Comparable product failure signals

These reports are investigation leads, not compatibility claims or a basis for
copying another product's implementation.

| Reported failure | Realistic Varve response |
| --- | --- |
| [Figma users report pan/page/export lag](https://forum.figma.com/ask-the-community-7/figma-has-become-very-slow-22519) and [large-file memory waits](https://forum.figma.com/report-a-problem-6/figma-running-very-slow-42811) | Keep pointer/control work separate from expensive evaluation, bound previews, admit intermediate bytes before allocation, and preserve a committed document when a job fails. |
| [Photopea filter gallery can become unresponsive on a large image](https://www.reddit.com/r/photopea/comments/11nqi3n) and [large documents can exhaust browser memory](https://www.reddit.com/r/photopea/comments/1izaq5d) | Do not render every gallery thumbnail at full resolution; use ROI surfaces for pointwise filters and explicit size/quality choices for final work. |
| [Photopea users report browser crashes/reload loss](https://www.trustpilot.com/review/photopea.com) | Make downloads, drafts and committed derived resources distinguishable; never report a successful incomplete effect/export. |
| [Adobe Neural Filters can stall at 0 KB](https://community.adobe.com/questions-712/downloading-neural-filters-on-mac-os-latest-version-of-ps-download-stays-at-0kb-1162608) or [crash during filter activation](https://community.adobe.com/questions-712/photoshop-latest-update-crashes-when-loading-neural-filters-1108138) | Use explicit consent/status, resumable verified downloads, lazy sessions, bounded retries and honest unavailable/fallback states. |
| [Krita AI users report UI input lag while inference is active](https://github.com/Acly/krita-ai-diffusion/issues/2534) | Keep inference and postprocessing out of input handlers, coalesce superseded work, and prevent timed-out work from overlapping fallback work. |

## Milestone and validation contract

1. Correctness contracts and P0 allocation guards: stage order, alpha/color,
   effect bounds, masks and stale-result rejection.
2. Shared derived-work admission and async lifecycle: atomic reservations,
   bounded heavy concurrency, session leases, cancellation and recovery.
3. Preview/render work reduction: ordered halos, safe ROI/tile decisions,
   cache keys and measured frame/queue behavior.
4. Runtime/model/storage hardening: provider probes, model contracts, download
   resume/integrity, quota/offline/recovery paths.
5. Existing inspector/touch surfaces and honest progress/fallback states.
6. Browser/PWA, Tauri/WebKitGTK and export/save/reopen visual/performance
   acceptance, with the marketing site describing only verified behavior.

Every rendering change requires numerical fixtures plus an inspected screenshot
or exported artifact. Browser automation is labeled separately from physical
hardware evidence. The Duet and Crostini rows remain pending until the supplied
runtime can be measured.

## Continuation checkpoint — 2026-09-28

This review was made on `master` at `b39129198`; the shared worktree also held
unrelated staged and unstaged work. Those changes were preserved. The installed
`onnxruntime-web` artifact remains pinned to 1.27.0 in `pnpm-lock.yaml`; current
ONNX Runtime Web guidance confirms that the JavaScript bundle and WASM files
must come from the same build and that the proxy worker does not support the
WebGPU execution provider. The runtime has not been upgraded as part of this
review ([environment flags and session options](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html),
[WebGPU provider](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)).

Current source inspection identifies these remaining correctness and ownership
gaps:

| Area | Reproduced from source | Required acceptance |
| --- | --- | --- |
| Inference cancellation | Fixed in the current continuation: `InferenceWorkerHost.cancel` now rejects the caller promptly while retaining the worker request, deadline, and admission lease. Result/error, timeout-driven worker termination, and host disposal are the only terminal release paths. | Focused tests verify late results are discarded, replacement requests remain queued, timeout terminates the owner, and disposal kills it before releasing its lease. |
| Session creation timeout | Before this continuation, accelerated `InferenceSession.create` timed out into the provider loop while its underlying promise could continue. A late session was released best-effort without awaiting confirmation. | The current continuation waits for late creation and confirmed release before provider fallback. If cleanup cannot be confirmed, the worker sends a fatal response and the host terminates it. Tests cover late success, late rejection, and failed release. |
| Effects and preview | `packages/editor/src/canvas/renderPipeline.ts` has in-flight shared work, and the effect-bearing whole-scene worker path remains behind the pixel-fidelity guard recorded in the canvas audit. M4 adds an opt-in engine worker lane and a synthetic canonical-kernel sample in the existing effect controls. The sample is not the selected artwork preview; interactive art filters and scene replay remain on their current path. The main scene pipeline/compositor files are actively modified by other owners. | Integrate at a separately reviewed artwork consumer boundary, preserve masks/order, and prove output with the independent full-redraw oracle before enabling a provider. Add a release-bound surface cache only when its owner can confirm disposal. |
| Export completeness | `exportNodeAsRaster` records image settlement failures as warnings and can continue with missing images. A timed-out image can be absent from the completed file. The raster safety fit can reduce dimensions and return the smaller result with a warning. | Make required missing resources and unavailable requested output dimensions blocking states. Generate another file only after an explicit user choice accepts changed dimensions or quality. |
| Model working set | The browser downloader retains chunks, assembles another full-size buffer, and hashes/writes that assembled artifact. IndexedDB loading materializes an `ArrayBuffer`; the generic Tauri adapter serializes bytes as a number array. | Measure before/after peak memory. Prefer native streaming on desktop and staged, verified chunk storage in browser runtimes without breaking existing installed-model reads. |
| Admission and budgets | Fixed for the gate/adapter in this continuation: inference and derived work now share a 400 MB conservative default ledger, with an explicit 600 MB reference-8-GB profile, transfer-to-resident leases, eviction confirmation, export aging, and shared snapshots. Legacy derived-work callers can still omit estimates, so their allocations are not yet represented. | M3 focused tests prove cross-kind contention, resident transfer/eviction, over-ceiling refusal, and export ordering. Continue wiring estimates before every decode, tensor, transfer, session, surface, and export allocation; calibrate profiles on target hardware. |
| UI/model dispatch | The existing `dispatchLiveEffect` is exercised by unit tests only. Runtime provider support remains a capability signal rather than proof that a representative model graph executes correctly. | Keep UI status truthful and qualify an accelerated provider with the actual graph and output comparison; leave unqualified providers unavailable. |

The inference lifecycle correction was validated with the following focused
checks before its milestone commit:

```text
node scripts/quality/heavy-lease.mjs 'inference lifecycle regression suite' -- \
  pnpm exec vitest run \
    packages/engine/src/inference/__tests__/workerHostMessages.test.ts \
    packages/engine/src/inference/core/__tests__/sessionCreation.test.ts \
    packages/engine/src/inference/admission.test.ts \
    packages/engine/src/inference/sessionRegistry.test.ts \
    packages/engine/src/inference/core/__tests__/DownloadManager.test.ts \
    --maxWorkers=1
Result: 5 files passed, 45 tests passed, 0 failed.
pnpm --filter @varve/engine typecheck
Result: passed.
```

Repository-wide affected validation and the frozen-SHA final gate remain
outstanding; the shared-tree planner currently selects unrelated work across
the workspace and escalates to the full suite. No hardware or visual claim is
made by these lifecycle tests.

```text
pnpm verify:plan
  469 changed files observed in the shared checkout; all workspace packages
  and broad UI/E2E lanes selected. FULL-SUITE ESCALATION: YES because of
  shared validation-infrastructure and dependency/toolchain changes.
pnpm verify:affected
  Stopped with exit 2 at the required full-suite escalation and printed
  `pnpm verify:full`; no affected test lane was started by that command.
```

The inference lifecycle milestone is committed as `8fcdfeb34`, and the shared
byte-admission milestone is committed as `0112de9a8`. The platform memory
implementation remains excluded while its shared-tree diff is owned by another
writer.

Shared admission validation against the current implementation diff:

```text
pnpm exec vitest run \
  packages/platform/src/derivedWorkAdmission.test.ts \
  packages/engine/src/inference/admission.test.ts \
  packages/engine/src/inference/__tests__/workerHostMessages.test.ts \
  packages/engine/src/generativeEdit/nativeProvider.test.ts \
  packages/engine/src/contentAwareFill/nativeProvider.test.ts \
  packages/editor/src/components/AIStatusIndicator/AIStatusIndicator.test.tsx \
  packages/editor/src/performance/pageLifecycle.test.ts --maxWorkers=1
Result: 7 files passed, 60 tests passed, 0 failed.
pnpm --filter @varve/platform typecheck
Result: passed.
pnpm --filter @varve/engine typecheck
Result: blocked by two type errors in the shared dirty
packages/engine/src/bench/tonalControls.bench.ts (ImageData-returning callbacks
do not satisfy BenchFunction); no admission-related type errors were reported.
```

After these edits, `pnpm verify:plan` selected 512 shared-tree changes across
all workspace packages and again reported `FULL-SUITE ESCALATION: YES` for
shared validation-infrastructure/dependency-toolchain changes. The required
`pnpm verify:affected` stopped with exit 2 at that escalation and recommended
`pnpm verify:full`; it did not start affected lanes. `pnpm audit:docs` passed
(1101 docs, 679 links, 177 ADRs), `pnpm audit:emoji` passed after a transient
failure on generated pages from another task, and `pnpm audit:tokens` passed
all 303 contrast pairs plus the usage scan. No generated report files were
changed by this task. The platform typecheck and 60 focused tests pass; the
engine typecheck remains blocked only by the two unrelated
`tonalControls.bench.ts` callback errors recorded above.

The shared-admission commit also passed its normal scoped commit checkpoint:
Biome, emoji, health, impact-config, secret, contacts, docs and import-boundary
checks, followed by 47 tests across the four admission/provider suites. This
is additional evidence; it does not replace the seven-suite, 60-test focused
run above.

The fresh source/runtime baseline was verified on 2026-09-28 local time; it is
not a hardware profile. The same-day research refresh reopened the four
reported competitor issues. Photopea's individual report describes a 3692×4800
PNG with 20–30 second filter and slider waits, and says reducing it to
1000×1300 made little difference. The Krita issue reports a plugin-version
regression while connected to remote ComfyUI; its proposed GUI-thread event-loop
explanation is explicitly a hypothesis. Adobe's official known-issues page
lists model downloads that can fail after starting, Colorize transparency
artifacts, loss of detail in JPEG-artifact removal, and pauses when Landscape
Mixer is combined with other filters. A Figma forum user reports lag while
space-panning, switching pages, and exporting SVG; support asks for more
information but does not identify a cause. These reports motivate focused
acceptance cases; they do not establish population rates or compare products.
See the source links in the ownership record above.

The first responsive-effects change is deliberately only an opt-in worker job
lane. It splits the canonical CPU provider into a shared module, captures a
single transferable surface only after the 400/600 MB shared gate grants a
three-buffer estimate, serializes expensive work through one worker, and keeps
one replaceable pending job per owner. Current identity checks cover document,
target, source, parameters, mask, time, and generation. Worker failure or a
five-second missing-response deadline retires the worker before the lease is
released. The live-effect controls now include a separate synthetic kernel
sample as the first UI consumer. It demonstrates the shared canonical kernel
with checker detail and translucent edges; it does not display or replace the
selected artwork's preview. The lane is not wired to the synchronous canvas,
artwork treatments, thumbnail, comparison, animation, or export path; no
performance improvement is claimed, and the independent full-redraw pixel
oracle has not been run for artwork output.

```text
pnpm exec vitest run \
  packages/engine/src/liveEffects/__tests__/dispatch.test.ts \
  packages/engine/src/liveEffects/__tests__/effectPreviewRunner.test.ts --maxWorkers=1
Result: 2 files passed, 16 tests passed, 0 failed.
pnpm --filter @varve/engine typecheck
Result: passed after fixing a constructor-default annotation found by typecheck.
pnpm exec vitest run packages/editor/src/components/AdjustmentLayer/EffectKernelPreview.test.tsx packages/engine/src/liveEffects/__tests__/effectPreviewRunner.test.ts packages/engine/src/liveEffects/__tests__/dispatch.test.ts --maxWorkers=1
Result: 3 files passed, 19 tests passed, 0 failed.
pnpm --filter @varve/editor typecheck
Result: failed only in the unchanged `packages/editor/src/components/Inspector/controls/CurveEditor.test.tsx` (two existing `getByRole` `exact` option type errors). No diagnostics remained in this task's editor component after correction.
pnpm typecheck:e2e
Result: passed after adding the real-worker kernel-preview browser spec.
pnpm exec biome check packages/editor/src/components/AdjustmentLayer/LiveEffectEditors.tsx packages/editor/src/components/AdjustmentLayer/EffectKernelPreview.tsx packages/editor/src/components/AdjustmentLayer/EffectKernelPreview.test.tsx packages/editor/src/components/AdjustmentLayer/effectKernelPreview.css
Result: passed; `git diff --check` passed for those paths.
```

The unit runner tests use a fake worker. The lease-wrapped Chromium case also
passed with the real module worker; it saved and I inspected the light, dark,
and high-contrast screenshots at
`test-results/low-end-effects-m4-themes-0929a/effects-live-effect-kernel-a4022--sample-in-all-three-themes-chromium/`.
The sample is legible in all three themes and keeps its checker detail,
translucent border, and ready state. An exploratory extension that resized the
full editor to 360px and enabled forced colors stopped progressing after the
theme captures and was interrupted; that narrow forced-colors case remains
pending the dedicated touch/portrait integration milestone. WebKitGTK,
navigation during an artwork effect, a full-redraw pixel oracle for artwork,
and matched-build performance measurements have not passed. The sample is
synthetic and no selected-artwork performance improvement is claimed.

```text
VARVE_LEASE_TIMEOUT=1800000 VARVE_E2E_PORT=1693 VARVE_E2E_OUTPUT_DIR=low-end-effects-m4-themes-0929a \
  node scripts/quality/heavy-lease.mjs "e2e: live effect kernel preview three-theme worker acceptance" -- \
  npx playwright test tests/e2e/effects/live-effect-kernel-preview.spec.ts --project=chromium --workers=1 --reporter=list
Result: 1 test passed; real module worker; 40.2s total. Three screenshots saved and visually inspected.
```

The latest planner sees 535 changes across ten JS packages and `varve-bridge`
in the shared checkout and reports `FULL-SUITE ESCALATION: YES` for unrelated
workspace/validation-infrastructure changes. `pnpm verify:affected` exits 2 at
that escalation before starting lanes; the full gate remains a later frozen-SHA
checkpoint. The docs audit passes (1105 docs, 698 links, 177 ADRs); emoji audit
passes (5122 files); token audit passes all 303 theme pairs and the usage scan.

The fresh source/runtime baseline was verified on 2026-09-28 local time; it is
not a hardware profile:

```text
HEAD: b39129198, branch master
Runtime: onnxruntime-web 1.27.0 (locked)
Host: Linux x86_64; WebKitGTK 2.52.6
Command:
  node scripts/quality/heavy-lease.mjs 'low-end effects planning baseline' -- \
    pnpm exec vitest run \
      packages/engine/src/inference/admission.test.ts \
      packages/engine/src/inference/sessionRegistry.test.ts \
      packages/engine/src/inference/__tests__/workerHostMessages.test.ts \
      packages/engine/src/inference/core/__tests__/DownloadManager.test.ts \
      --maxWorkers=1
Result: 4 files passed, 38 tests passed, 0 failed
```

The other worktree processes and dirty paths were left untouched. In particular,
the GPU qualification notes own `packages/editor/src/canvas/renderPipeline.ts`
and related rendering files; the canvas-fluidity notes reserve that path's
stale-frame and worker-oracle changes. This continuation must not claim or
commit those shared-file changes without a clean ownership boundary.

The Photopea user reports were refreshed as failure leads: users describe
multi-second waits and stalled tool/input changes on complex files, while
other reports attribute some slowdowns to browser or page conditions. They do
not establish a product-wide failure rate or root cause. Varve's cases remain
specific: parameter scrubbing during expensive previews, navigation during
work, and mixed model/export pressure ([long filter waits](https://www.reddit.com/r/photopea/comments/11nqi3n/photopea_is_unbearably_laggy/),
[tool and input stalls](https://www.reddit.com/r/photopea/comments/1cfim22)).
These reports support prioritizing bounded work and responsive controls; they
do not support advertising a device-level latency guarantee.

## M5 — Runtime/session residency and compact depth registration (`b6727dfe5`)

The 1.27.0 ONNX Runtime worker now has one single-flight module loader. It
selects the WebGPU-flavored entrypoint when capability detection requests that
provider set, falls back to the matching WASM module if the WebGPU module
cannot be imported, clears failed initialization for retry, and refuses to
switch entrypoints under an initialized worker. WASM remains single-threaded
inside the dedicated worker. These loader tests verify module selection and
recovery; they do not execute a representative installed graph or prove
WebGPU operator support on a device.

Inference session requests reserve the catalog's conservative working-set
estimate alongside transient buffers. A correlated worker message transfers
the session portion into the shared resident ledger only when key and estimate
match the request. Confirmed worker evictions/releases free that resident
lease; failed release remains tracked, and worker termination is the confirmed
reclamation boundary. Session identity separates artifact and sidecar revision,
precision, requested provider profile, runtime settings, and worker/device
generation; `InferenceSessionRegistry` records the actual provider selected by
the runtime. Catalog estimates remain estimates, not observed RSS. The cache
key uses the requested provider profile and does not yet independently key on
the actual provider; hardware graph qualification is still required.

Depth resources now remain at the model output grid and persist their source
registration, including letterbox padding. Inspector and group compositor
surfaces sample through that registration rather than first persisting a
source-sized field. All four grid-resampling paths now update normalization's
valid-sample count, which fixed a browser-visible Depth Mask histogram failure
when a 518×518 model map was aligned to a 200×160 source. A later rerun also
found that the pre-existing E2E helper functions returned JavaScript source
but had been passed as callbacks, so the seeded model and worker stub were not
installed. The spec now evaluates those returned scripts, checks for the
stub's result, and supplies the same integer letterbox geometry as production.

M5 focused validation so far:

```text
pnpm exec vitest run packages/engine/src/inference/core/__tests__/ortRuntime.test.ts packages/engine/src/inference/sessionKeys.test.ts packages/engine/src/inference/__tests__/workerHostMessages.test.ts packages/engine/src/inference/inferenceWorker.test.ts packages/engine/src/inference/sessionRegistry.test.ts packages/engine/src/depthMap.test.ts --maxWorkers=1
Result: 6 files passed, 59 tests passed, 0 failed (including confirmed resident release, no-double-charge reuse, over-estimate worker retirement, and generation rekey after queue wait).
pnpm --filter @varve/engine typecheck
Result: passed after the inference-host generation-rekey change.
pnpm typecheck:e2e
Result: passed after the final setup-script and compact-resource assertions.
VARVE_LEASE_TIMEOUT=1800000 VARVE_E2E_PORT=1699 VARVE_E2E_OUTPUT_DIR=low-end-depth-m5-0929f \
  node scripts/quality/heavy-lease.mjs "e2e: compact depth Save and raster mask persistence" -- \
  npx playwright test tests/e2e/canvas/depth-blur.spec.ts --project=chromium --workers=1 --reporter=list
Result: 2 Chromium tests passed (51.4s). Save persisted a 518x518 map with its source-to-map affine; the second test persisted a raster mask on its image node. The saved-state capture was visually inspected at `test-results/low-end-depth-m5-0929f/canvas-depth-blur-Depth-Bl-5f52a--picks-focus-and-removes-it-chromium/depth-resource-saved.png`.
```

The two preceding attempts failed before acceptance: one exposed the stale
normalized sample count and one exposed the unexecuted setup scripts. Both
causes are fixed; the passing repeat asserts the worker-stub response and
persisted model-grid dimensions plus affine registration. The inspected first failure image is
`test-results/low-end-depth-m5-0929b/canvas-depth-blur-Depth-Bl-5f52a--picks-focus-and-removes-it-chromium/test-failed-1.png`;
the missing-stub capture is
`test-results/low-end-depth-m5-0929d/canvas-depth-blur-Depth-Bl-5f52a--picks-focus-and-removes-it-chromium/test-failed-1.png`.

## M6 — Bounded model artifacts and verified publication

Before M6, inference and background-removal used separate IndexedDB Blob
writers, generic downloads concatenated every response chunk into one large
buffer, and legacy localStorage storage could serialize model bytes as JSON
number arrays. Tauri's generic storage adapter also exposed byte arrays through
JSON IPC even though the desktop already has a streaming Rust downloader.
Those paths could duplicate a large artifact in memory, publish components
before their siblings had passed verification, or leave a graph installed
without its external ONNX weights.

ModelStorage now shares one staged artifact contract across both download
systems. It hashes incrementally and checks expected byte count before
publication. Browser writes prefer OPFS and fall back to 256 KiB IndexedDB
chunks; stats and bounded-prefix reads do not assemble the full artifact.
Existing IndexedDB Blob/ArrayBuffer and localStorage JSON records remain
readable, while all new model writes avoid localStorage. Tauri's byte-array IPC
write path is disabled and the existing native streaming installer remains the
desktop path. The generic downloader and background-removal loader now stream
directly into staged storage, and partial data remains private until a later
verified completion.

Multipart model components now install under private staging IDs. After every
component passes its recorded size and SHA-256, one IndexedDB transaction
publishes the complete set and removes the staging references. If an install is
interrupted, fully verified staging artifacts can be reused only when their
stored metadata still matches. External-data graphs use the same publication
boundary for the graph and sidecar. SCUNet's sidecar had no checksum and used a
mutable main URL; its source now pins repository revision
[6d11417ee2fbcc73783c502a238ac115097754fe](https://huggingface.co/Heliosoph/scunet-onnx/tree/6d11417ee2fbcc73783c502a238ac115097754fe),
with the 73,138,176-byte weights digest recorded in both the fallback catalog
and shipped manifest.

Validation for M6:

- Biome checked 12 exact engine/model manifest and test paths; no fixes were
  required on the final run.
- Focused Vitest run: 6 files passed, 382 tests passed, 0 failed. Coverage
  includes staged writes, legacy reads, valid and invalid resume paths,
  incomplete batch rollback, component staging and reuse, atomic graph/weights
  publication, and manifest contracts.
- Engine typecheck passed.

The SCUNet checksum and content length were read from the Hugging Face Hub's
artifact response metadata at the pinned repository revision; the source page
is linked above. No model weights were downloaded during this check. M6 makes
download-time storage bounded but does not make every ONNX consumer
stream-native: feature paths may still create a Blob URL or ArrayBuffer for
session creation. The external-data path resumes only after matching URL,
ETag, range start, total, and chunk length; physical browser/device behavior is
not established by these Node tests. OPFS browser qualification and the Duet
device-kit checks remain pending.

## M7 — Touch workflow and user-visible recovery states

The model dialog now distinguishes connection, byte transfer, verification,
publication, cancellation cleanup, and completion. A cancel during transfer
keeps the dialog in a truthful cleaning-up state until the loader has stopped
and resolved its private partial artifact. The dialog cannot be dismissed while
digest verification or atomic multipart publication is still running. The
browser loader reports these phases at the actual stream/commit boundaries;
native Tauri still has byte progress only and is intentionally not described as
exposing verifier internals. Focused tests cover both the stage order and the
wait-for-cleanup behavior.

Frequent Effect Studio controls and model-download actions receive 44 CSS-pixel
minimum targets on coarse-pointer devices, and the filter list no longer traps
touch users in a short nested scroll region. A Chromium mobile/touch E2E was
added to exercise portrait reachability, numeric entry, preview cancel, apply,
reorder target dimensions, and the intended save/reopen/export sequence. Its
first run did not reach the spec: global setup waited three minutes for the
editor home control, then the browser reported that the engine barrel lacked
`MAX_AREA_SELECTION_PIXELS`, imported by the shared, untracked
`packages/editor/src/tools/artworkSampling.ts`. That path is outside this
milestone's ownership and was preserved. The control geometry and save/reopen
flow therefore remain unverified in the app browser. A post-M9 lease-wrapped
retry at isolated port 1723 also stopped in global setup before the spec: Vite
did not answer `http://localhost:1723/` within the setup's 60-second warm-up
window, and no screenshot was generated. The separate M9 adjustment preview
E2E did start the app and pass on port 1722, but it does not cover this longer
touch/save/reopen/export journey. Host emulation also does not establish
physical Duet keyboard occlusion, pen behavior, or suspend and resume.

The retry command was:

```bash
VARVE_LEASE_TIMEOUT=1800000 VARVE_E2E_PORT=1723 VARVE_E2E_OUTPUT_DIR=low-end-touch-final-0929 node scripts/quality/heavy-lease.mjs "e2e: retry touch workflow after app startup recovery" -- npx playwright test tests/e2e/effects/low-end-touch-workflow.spec.ts --project=chromium --workers=1 --reporter=list
```

Result: exit 1 in global setup with “dev server not reachable at
http://localhost:1723 after 60000ms”; the test body and screenshot assertions
did not run.

The enhancement feature/help pages now explain explicit downloads, verified
installation, the difference between storage and inference memory, and durable
materialized results. Lower-memory and Chromebook guidance links these flows
while continuing to mark physical browser/PWA and ARM64 Crostini checks pending.
Release and package claims were cross-checked against `docs/release/website.md`;
installation guidance was not changed. Current complaint evidence was
rechecked against the linked Adobe, Photopea, Krita AI Diffusion, and Figma
reports. These are failure leads from individual users or vendor feedback,
with unconfirmed root causes; they are not comparative Varve measurements.

M7 validation:

```text
pnpm exec vitest run packages/engine/src/backgroundRemoval/__tests__/modelLoader.test.ts packages/editor/src/components/BackgroundRemoval/ModelDownloadDialog.test.tsx --maxWorkers=1
Result: 2 files passed, 40 tests passed, 0 failed.
pnpm --filter @varve/engine typecheck
Result: passed.
pnpm --filter @varve/editor typecheck
Result: failed on two pre-existing TS2769 errors in unchanged packages/editor/src/components/Inspector/controls/CurveEditor.test.tsx:23–24 (`getByRole` options); no diagnostic names an M7 file.
pnpm typecheck:e2e
Result: passed, including the new portrait touch workflow spec.
pnpm --filter @varve/website typecheck
Result: passed; Astro reported 0 errors, 0 warnings, and 0 hints across 164 files; the E2E TypeScript check passed.
pnpm build:website
pnpm build:website:pages
Result: both production builds passed; each generated 112 pages and a search index for 109 pages with 1,154 heading anchors.
VARVE_LEASE_TIMEOUT=1800000 VARVE_WEBSITE_E2E_PORT=1712 VARVE_WEBSITE_E2E_PORT_ROOT=1713 VARVE_E2E_OUTPUT_DIR=low-end-effects-m7-site-0929b node scripts/quality/heavy-lease.mjs "e2e: inspect mobile model-install section on both website base paths" -- npx playwright test -c playwright.website.config.ts apps/website/tests/e2e/low-end-effects-marketing.spec.ts --project=ghpages --project=custom-domain --workers=1 --reporter=list
Result: 2 tests passed (5.0s), covering root and `/varve` base paths, desktop and portrait-mobile layouts, no horizontal overflow, expected internal links, enhancement claims, and readable help content.
pnpm verify:plan
Result: 504 changed files across 10 JS packages and `varve-bridge`; FULL-SUITE ESCALATION: YES for shared workspace/validation-infrastructure and dependency/toolchain changes.
pnpm verify:affected
Result: exit 2 with the same 504-file plan at the full-suite escalation before any affected lanes started; it requests `pnpm verify:full`.
```

The following selected policy audits passed: docs (1107 documents, 710 links,
177 ADRs), emoji (5143 files), token contrast/usage (303 pairs across three
themes; 585 defined properties), radius, spacing, interface sizing, and
Stylelint for both edited application CSS files. The inspector CSS audit is
clean under its hard rules and reports existing debt-inventory warnings,
including in `effectStudio.css`; these are advisory and were not introduced by
the added coarse-pointer rule.

The new site screenshots were all inspected. Desktop and mobile captures for
both deployment bases are at:

```text
test-results/low-end-effects-marketing--c36e3--both-deployment-base-paths-ghpages/ghpages-enhancement-desktop.png
test-results/low-end-effects-marketing--c36e3--both-deployment-base-paths-ghpages/ghpages-enhancement-mobile.png
test-results/low-end-effects-marketing--c36e3--both-deployment-base-paths-ghpages/ghpages-model-install-mobile.png
test-results/low-end-effects-marketing--c36e3--both-deployment-base-paths-custom-domain/custom-domain-enhancement-desktop.png
test-results/low-end-effects-marketing--c36e3--both-deployment-base-paths-custom-domain/custom-domain-enhancement-mobile.png
test-results/low-end-effects-marketing--c36e3--both-deployment-base-paths-custom-domain/custom-domain-model-install-mobile.png
```

The CUA browser also inspected the local feature and help pages at desktop
viewport size. The separate M4 worker-sample screenshots were inspected in
light, dark, and high-contrast themes; the new touch CSS could not receive an
app screenshot because of the unrelated startup error above. No performance
improvement is claimed from the CSS or download-state changes. The frozen-SHA
full gate remains outstanding at this entry's creation. The [physical device
kit](../quality/low-end-effects-device-kit-2026-09-29.md) is the remaining
acceptance route for ChromeOS browser/PWA and ARM64 Crostini, including actual
keyboard, pen, suspend, offline reopen, and device memory behavior.

## Frozen-M7 integration checkpoint and architecture repair

The planned shared-tree integration checkpoint froze `master` at
`727927c99f6efc880ca735f761115832adda0703`. The workspace still contained
hundreds of unrelated staged, unstaged, and untracked paths. The triage planner
selected the full suite and stopped at Tier 0 because a separate untracked
generated file, `packages/compositor/src/webgl2/native-webgl2-2026-09-28T10-16-25-630Z.json`,
was missing its final newline. The required full-gate attempt used the stated
reason for this frozen SHA. Its touched-file formatter found that same error;
the repository-wide architecture audit then identified the M4 provider cycle
recorded below. It also reported shared-tree editor typecheck failures in the
unchanged `CurveEditor.test.tsx` and untracked `artworkSampling.ts`.

The architecture audit caught a task-owned dependency cycle:
`liveEffects/cpuProvider.ts → liveEffects/dispatch.ts`. The provider needed only
type contracts, so those interfaces now live in the leaf module
`liveEffects/contracts.ts`; `dispatch.ts` re-exports them to preserve existing
imports. The worker and dispatcher continue to use the same canonical CPU
kernels. This boundary change does not wire the worker into selected-artwork
rendering or change effect output.

The final gate did not pass. It stopped before unit, browser, native, and
benchmark lanes because shared formatting failed; its architecture check also
reported the new cycle before this follow-up repair. The remaining full gate
must be rerun after task-owned checks against the new exact `master` SHA.
Shared unrelated failures remain attributed to their owners.

| Check | Result |
| --- | --- |
| `pnpm verify:triage` | Failed in touched-file formatting on the unrelated untracked WebGL2 JSON described above. |
| `VARVE_FULL_GATE_REASON="Final integration checkpoint for low-end effects and model runtime milestones at master SHA 727927c99; triage found a shared generated WebGL2 JSON formatting failure." pnpm verify:full` | Failed: shared formatter error; architecture audit found the task-owned cycle; editor typecheck also reported unchanged `CurveEditor.test.tsx` `getByRole` typing errors and untracked `artworkSampling.ts` errors. It did not reach unit/E2E/benchmark lanes. |
| `pnpm verify:plan` / `pnpm verify:affected` after M8 edits | The shared plan selected 496 changed files and escalated to the full suite for workspace/toolchain/validation-infrastructure changes. `verify:affected` exited 2 at the escalation before starting lanes. |
| `pnpm --filter @varve/engine typecheck` | Passed after the final import cleanup. |
| `pnpm exec vitest run packages/engine/src/liveEffects/__tests__/dispatch.test.ts packages/engine/src/liveEffects/__tests__/effectPreviewRunner.test.ts --maxWorkers=1` | 2 files, 16 tests passed. |
| `pnpm exec biome check packages/engine/src/liveEffects/contracts.ts packages/engine/src/liveEffects/cpuProvider.ts packages/engine/src/liveEffects/dispatch.ts packages/engine/src/liveEffects/effectPreviewRunner.ts` | Passed after import-order correction. |
| `pnpm audit:docs`, `pnpm audit:emoji`, `pnpm audit:tokens` | Passed: 1,107 docs / 710 links / 177 ADRs; 5,144 files; 303 contrast pairs in 3 themes and clean token usage. |
| `node scripts/audit-architecture.mjs --ci` after M8 repair | Completed with no new cycle regression. The former M4 cycle is gone; it reports 2 existing engine cycles, 11 scene cycles, and 1 shared editor render-worker cycle. Layer boundaries and dead-code checks are clean; existing hub-budget warnings remain. |
| Architecture repair | Commit `0540e343c` extracted effect request/provider contracts to a leaf module; dispatcher public type re-exports remain compatible. |

The final full gate remains unpassed because the shared generated JSON formatting
error and shared editor typecheck failures are outside this task's ownership.
No follow-up full browser/native/benchmark lane ran after triage. The app touch
flow, physical Duet and Crostini checks, actual-artwork worker integration,
full memory soak, mixed production benchmark, and export blocking acceptance
remain open as described above.

### Final post-repair gate — frozen master SHA `f5647aa864ad88ee9de8cd6b56b2ef1d1c4e7da7`

The required `pnpm verify:full` rerun after the architecture repair used this
reason:

```text
Final integration gate for low-end effects/runtime implementation at frozen master SHA f5647aa86; triage already collected shared formatting and editor typecheck blockers.
```

The gate still failed on the unrelated untracked WebGL2 JSON formatter error.
The architecture audit no longer reports the effect-provider cycle; it sees
the existing 2 engine, 11 scene, and 1 editor render-worker cycles, with layer
boundaries and dead-code checks clean. Workspace typecheck passed every
package before `@varve/editor` failed on the two `CurveEditor.test.tsx`
`getByRole` typing errors and three diagnostics in untracked
`packages/editor/src/tools/artworkSampling.ts`. Because recursive typecheck
stopped there, E2E source typecheck and the full suite's unit, browser, native,
and benchmark lanes did not run.

The shared-tree planner continues to select the full suite (496 changed files
at the post-repair plan snapshot). `pnpm verify:affected` exits at that
escalation before starting lanes. The task-owned final evidence remains the
focused engine typecheck, 16 live-effect dispatch/preview unit tests, docs,
emoji and token audits, M4 and M7 website screenshots, and the M4 worker
sample's inspected light/dark/high-contrast captures. The M7 app touch E2E and
all physical device checks remain pending or blocked as stated above.

### M9 — selected-adjustment source in the worker preview

The live-effect preset row in the Adjustment panel now submits its bounded
upstream adjustment input to the shared effect-preview worker. The input is the
same `ImageData` sample already built for the selected stack position's
histogram, with document-space scale and origin preserved for document-anchored
patterns. Source capture into the worker buffer remains after byte admission.
The display caps each dimension at 256 pixels and labels the result as a
reduced upstream-input preview; the synchronous canvas remains authoritative.
When the selected input is unavailable, the existing synthetic kernel sample
remains clearly labeled. This is inspector feedback, not evidence that live
canvas filtering, whole-scene replay, thumbnails, treatments, or exports have
moved off their synchronous paths.

The first portrait E2E attempt found that the app closes the inspector panel at
390 pixels. The test now reopens it through the accessible “Show inspector
panel” control, scrolls the preview into view, and verifies the reduced source
preview fits the portrait viewport. The final Chromium run passed. Inspected
screenshots:

```text
test-results/low-end-source-preview-m9-0929b/effects-adjustment-source--dc538-ng-the-canvas-authoritative-chromium/upstream-source-light.png
test-results/low-end-source-preview-m9-0929b/effects-adjustment-source--dc538-ng-the-canvas-authoritative-chromium/upstream-source-dark.png
test-results/low-end-source-preview-m9-0929b/effects-adjustment-source--dc538-ng-the-canvas-authoritative-chromium/upstream-source-high-contrast.png
test-results/low-end-source-preview-m9-0929b/effects-adjustment-source--dc538-ng-the-canvas-authoritative-chromium/upstream-source-portrait.png
```

M9 checks before its commit:

| Check | Result |
| --- | --- |
| `pnpm exec vitest run packages/editor/src/canvas/adjustmentHistogramSource.test.ts packages/editor/src/components/AdjustmentLayer/EffectKernelPreview.test.tsx --maxWorkers=1` | Passed: 2 files, 7 tests. |
| `pnpm typecheck:e2e` | Passed. |
| `pnpm exec biome check` on the 10 exact M9 code/style/E2E files | Passed with no fixes. |
| `VARVE_LEASE_TIMEOUT=1800000 VARVE_E2E_PORT=1722 VARVE_E2E_OUTPUT_DIR=low-end-source-preview-m9-0929b node scripts/quality/heavy-lease.mjs "e2e: selected adjustment source worker preview" -- npx playwright test tests/e2e/effects/adjustment-source-worker-preview.spec.ts --project=chromium --workers=1 --reporter=list` | Passed: 1 Chromium test, including a real adjustment-layer source, desktop, light/dark/high contrast, and portrait 390×844. |
| `pnpm --filter @varve/editor typecheck` | Failed only in unchanged `CurveEditor.test.tsx` (`getByRole` option typing) and the shared untracked `tools/artworkSampling.ts` (three type errors). No diagnostic points to an M9 file. |
| `pnpm verify:plan` | Reported 492 shared changed paths, nine affected JS packages, and `varve-bridge`; selected Tier 0–4 checks and `FULL-SUITE ESCALATION: YES` for shared workspace/toolchain/validation-infrastructure changes. |
| `pnpm verify:affected` | Exited 2 at the full-suite escalation before starting lanes. |
| `pnpm verify:plan` / `pnpm verify:affected` after M9 documentation edits | Reported 498 shared changed paths, nine affected JS packages, and `varve-bridge`; full-suite escalation remained required and `verify:affected` exited 2 before starting lanes. |
| `pnpm audit:docs`, `pnpm audit:emoji`, `pnpm audit:tokens` | Passed: 1,107 docs / 710 links / 177 ADRs; 5,147 files scanned; all 303 contrast pairs across 3 themes and token usage clean (585 custom properties). |
| `node scripts/audit-architecture.mjs --ci` | Exited 0. No M9 dependency cycle or layer violation; the shared tree still reports 14 known cycles (2 engine, 11 scene, 1 editor) and existing Shell/Menubar/context hub-budget warnings. |
| `pnpm exec stylelint packages/editor/src/components/AdjustmentLayer/effectKernelPreview.css` | Passed. |

The required post-commit frozen-master full-gate attempt is recorded in the
next integration checkpoint below. No performance improvement
is claimed: there are no matched production rounds, interaction-latency data,
100-cycle soak, WebKitGTK run, or full-redraw oracle for this separate inspector
preview. Physical Duet/browser/PWA/Crostini checks remain pending.

### Final integration attempt after M9 — gate started from `531323765`

The frozen-M9 gate used this reason:

```text
Final integration gate for low-end effects and model runtime implementation after M9 on frozen master SHA 531323765; shared-tree validation already escalated and focused M9 checks passed.
```

`pnpm verify:full` did not pass. At gate start `master` was
`5313237652060fb73eb8f27cb8a24326f21db99b`; while the long-running gate was
still scanning, another task advanced `master` to `53c14b0da` with a
documentation-only presentation research commit. No M9 source path changed in
that commit. This was a shared-worktree integration run, not an isolated clean
checkout.

The whole-tree formatter stopped on two shared changes outside M9:
`native-webgl2-2026-09-28T10-16-25-630Z.json` is untracked and lacks a final
newline, and `packages/editor/src/tools/__tests__/ToolManager.test.ts` has a
formatting difference. The full-gate architecture phase then timed out in
`npx ts-prune -p "packages/editor/tsconfig.json" ...`; the separate
`node scripts/audit-architecture.mjs --ci` run completed with exit 0 and no M9
cycle or layer violation. Recursive workspace typecheck reached the editor and
failed on two unchanged `CurveEditor.test.tsx` `getByRole` option errors and
three errors in the shared untracked `tools/artworkSampling.ts`. Because that
typecheck command failed, `typecheck:e2e` and the remaining full-suite unit,
Playwright, native, and benchmark lanes did not run in this gate. The direct M9
E2E, its E2E-source typecheck, 7 focused unit tests, editor-scoped Biome/CSS
lint, and the normal commit checkpoint did pass as listed above.

M9 source and UI changes are in commit `531323765` on `master`; the final gate
evidence is recorded in a follow-up documentation commit. No push or
publication was performed.

The follow-up documentation review ran on `master` after the presentation
research docs-only commit `53c14b0da`: `pnpm audit:docs` was clean (1,113 docs,
715 links, 177 ADRs), `pnpm audit:emoji` scanned 5,155 files cleanly, and
`pnpm audit:tokens` passed all 303 pairs across three themes with clean token
usage. That snapshot's planner reported 510 changed paths with the same
full-suite escalation; `pnpm verify:affected` exited 2 before starting lanes.

After recording the M7 touch-workflow retry, the shared tree changed again
while validation ran: `pnpm verify:plan` reported 527 paths and
`pnpm verify:affected` then reported 528 paths, ten affected JS packages, and
`varve-bridge`; both still required the full suite, and affected exited 2 before
starting lanes. The latest docs audit remained clean (1,115 docs, 720 links,
178 ADRs). No full-gate rerun was started for these documentation-only updates:
they did not alter the M9 code or the blockers recorded above.
