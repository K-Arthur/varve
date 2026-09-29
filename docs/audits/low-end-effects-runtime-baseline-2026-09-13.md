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
| Effects and preview | `packages/editor/src/canvas/renderPipeline.ts` has in-flight shared work, and the effect-bearing whole-scene worker path remains behind the pixel-fidelity guard recorded in the canvas audit. `packages/engine/src/liveEffects/dispatch.ts` has no production caller; its provider chain is not yet an application rendering path. | Wire expensive RGBA effect work into actual preview/export consumers. Preserve canonical source capture and prove exact or contract-tolerant results with the independent full-redraw oracle before enabling a provider. |
| Export completeness | `exportNodeAsRaster` records image settlement failures as warnings and can continue with missing images. A timed-out image can be absent from the completed file. The raster safety fit can reduce dimensions and return the smaller result with a warning. | Make required missing resources and unavailable requested output dimensions blocking states. Generate another file only after an explicit user choice accepts changed dimensions or quality. |
| Model working set | The browser downloader retains chunks, assembles another full-size buffer, and hashes/writes that assembled artifact. IndexedDB loading materializes an `ArrayBuffer`; the generic Tauri adapter serializes bytes as a number array. | Measure before/after peak memory. Prefer native streaming on desktop and staged, verified chunk storage in browser runtimes without breaking existing installed-model reads. |
| Admission and budgets | Inference admission and platform-derived-work admission have separate active counts. Inference's default aggregate byte limit is unbounded, while image, effect, and export surface reservations are not part of that ledger. | Test shared peak reservations and refusal before decode/allocation, including resident sessions and effects competing with explicit export. |
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

The lifecycle milestone is committed as `8fcdfeb34`. This task's next scope is
the existing platform admission gate and its inference adapter; the platform
memory implementation is excluded while its shared-tree diff remains owned by
another writer.

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
