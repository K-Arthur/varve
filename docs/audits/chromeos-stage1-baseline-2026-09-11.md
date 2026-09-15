# ChromeOS Stage 1 baseline: research, audit, and route decision

**Status:** Stage 1 complete; implementation baseline, not a support claim
**Research access date:** 2026-09-11
**Repository snapshot:** `c23e6c8dc44168bc70d1626455154232c65447c1`
**Device reference:** Lenovo Chromebook Duet 11M889, 8 GB primary target

This document freezes what was known before ChromeOS-specific implementation.
It separates vendor documentation, repository evidence, deployed-site
observations, measurements, and hypotheses. No real Duet was available during
this stage; all device measurements remain pending.

## 1. Research ledger

| Question | Primary source and date | Finding and confidence | Implementation consequence | Unresolved conflict |
|---|---|---|---|---|
| What is the Linux-on-ChromeOS boundary? | [Linux setup](https://support.google.com/chromebook/answer/9145439?hl=en), Google, current page accessed 2026-09-11 | Linux apps run in a sandboxed Debian environment. Google documents cameras, non-Android USB devices, hardware acceleration including GPU, and video decode as not supported yet. **High** | Treat Crostini Linux as a separate ARM64 route. Do not assume GPU/video decode, camera, USB, or native Chrome parity. | Actual ChromeOS channel and Linux container versions on the Duet are pending. |
| What can an installed Chrome web app mean? | [Chrome web apps](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DDesktop&hl=en), Google, current page accessed 2026-09-11; [PWA installation](https://web.dev/learn/pwa/installation?hl=en), Chrome team, accessed 2026-09-11 | Installability is browser/platform dependent. Web apps can work offline and use storage/file APIs, but an app may not fully work offline. **High** | PWA is a packaging route over the browser build, not evidence of feature parity or offline durability. | ChromeOS install criteria and current app state need a device run. |
| What does WebGPU prove? | [WebGPU overview](https://developer.chrome.com/docs/web-platform/webgpu/overview), Chrome for Developers, published 2023-07-20, updated 2025-08-11 | ChromeOS WebGPU support is tied to device/platform graphics paths, including Vulkan; API presence is not a successful adapter/device probe. **High** | Probe adapter/device creation dynamically, capture only an allowlist of limits, destroy the device, and retain Canvas2D fallback. | Kompanio/Mali browser exposure and driver state are pending. |
| What is the Linux ARM packaging evidence? | [Tauri Debian distribution](https://v2.tauri.app/distribute/debian/), Tauri, accessed 2026-09-11 | Tauri provides Debian packaging guidance; packaging/install success does not establish GUI runtime success on a Chromebook container. **Medium** | Keep Linux ARM64 as a separate candidate and use the existing `.deb`/AppImage/`.rpm` release path. | Crostini GUI, portals, WebKitGTK, and display behavior need real-device testing. |
| What hardware should be targeted? | [Lenovo PSREF 11M889 specification PDF](https://psref.lenovo.com/syspool/Sys/PDF/Lenovo/Lenovo_Chromebook_Duet_11M889/Lenovo_Chromebook_Duet_11M889_Spec.pdf), Lenovo, 2025-10-21, accessed 2026-09-11 | Kompanio 838 (2x A78 + 6x A55), Mali-G57 MC3, NPU 650 up to 4 TOPS, 4 GB or 8 GB soldered LPDDR4X-3733, 64/128 GB eMMC 5.1, 1920x1200 panel, USB-C display support. **High** | Optimize for the 8 GB model while keeping bounded behavior on 4 GB and x86 Chromebooks. NPU TOPS is not treated as browser/Linux availability. | Actual free storage, display scale, refresh rate, and memory pressure are pending. |
| What is the lifecycle durability requirement? | [Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api), Chrome for Developers, accessed 2026-09-11 | Hidden is often the last reliably observable state; persist unsaved work on hidden. Freeze requires closing selected resources. Discard is only observable on next load via `document.wasDiscarded`; unload/beforeunload is unreliable. **High** | Later persistence work must flush on visibility changes and recovery must detect discarded tabs. Do not use unload as the sole save boundary. | Existing recovery behavior has not been exercised on ChromeOS tab discard. |
| What are the browser file/storage constraints? | [File System Access API](https://wicg.github.io/file-system-access/), WICG, accessed 2026-09-11; [Chrome web apps](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DDesktop&hl=en), Google | File System Access is capability-based; browser fallbacks still need to work. **High** | Report API presence and use the existing `web-fs.ts` File System Access plus input/Blob fallback chain. | Permission persistence and quota behavior on the Duet are pending. |
| Which input contract applies to pen/touch/keyboard? | [Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/), W3C Recommendation 2026-06-30, accessed 2026-09-11 | Pointer events unify mouse, pen, and touch and expose pressure/tilt; pointer capture and `touch-action` matter for reliable gestures. **High** | Reuse existing pointer normalization and test real USI pen/touch later. Do not add a Chromebook-only input path. | USI Pen 2 browser event details and ChromeOS keyboard layout are pending. |
| What makes a PWA installable/offline? | [Installable manifest](https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest/), Chrome for Developers, accessed 2026-09-11; [Service worker overview](https://developer.chrome.com/docs/workbox/service-worker-overview), Chrome for Developers, accessed 2026-09-11 | Manifest name/icons/start URL are necessary but not sufficient. A service worker must control the page for the normal offline-cache path. **High** | Existing manifest is recorded as metadata only; service-worker/offline/update work is a later handoff. | Current `/try` install prompt and offline reload behavior were not tested. |
| Can optional AI assume GPU/WebNN? | [ONNX Runtime WebGPU EP](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html), [execution providers](https://onnxruntime.ai/docs/execution-providers/), and [WASM build](https://onnxruntime.ai/docs/build/web.html), ONNX Runtime, accessed 2026-09-11 | WebGPU is dynamic; WASM SIMD/threads have browser and cross-origin-isolation requirements. WebNN is experimental/limited in current Chrome guidance. **High** | AI must remain optional, capability-gated, and CPU/WASM-fallback aware; no NPU or WebNN claim. | Model memory and execution time on Kompanio remain unmeasured. |
| What is the deployed truth? | [Varve repository](https://github.com/K-Arthur/varve), [live `/try/`](https://varve.studio/try/), [live `/download/`](https://varve.studio/download/), [live `/product/`](https://varve.studio/product/), accessed 2026-09-11 | Repository README calls `/try` a bounded development demo and `apps/web` is scaffold/deferred. The live download page says desktop-only/no mobile or tablet and publishes v0.2.1 ARM64 Linux installers. The product page says there is no hosted web app yet. `/try` presence alone is not proof. **High** | Keep the browser/PWA route experimental and update support wording only after direct device evidence. | Live cache check for `/releases/latest` resolved to GitHub v0.2.0 while the site and local manifest say v0.2.1; this is recorded as a stale/unreconciled observation, not release evidence. |
| What is the deployment provider? | [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), GitHub, accessed 2026-09-11 | Pages hosts the static site; the repository workflow builds the `/try` artifact and deploys it with the website. **High** | Validate the exact deployed artifact separately from local `master`; no browser support claim from a successful Pages deployment. | Live cache and published asset freshness need a release-time check. |

The ledger was completed before the implementation approach was selected. Later
stages must repeat focused research when they change lifecycle, PWA, graphics,
AI, packaging, or security behavior.

## 2. Repository audit and call paths

### Runtime and build paths

| Route | Current path | Evidence | Truthful Stage 1 status |
|---|---|---|---|
| Native Chrome tab | `apps/desktop` with `VITE_DEMO=1`; `main.tsx` -> `App.tsx` -> `detectPlatform()` / `createWebPlatform()` -> `@varve/platform` IndexedDB and `web-fs.ts`; WASM is built into public assets | `pnpm build:try` exists; demo seeds a deterministic 9-node poster; deployed `/try/` exists; browser-facing E2E and local storage code exist | Experimental bounded demo only. Full browser product support is not established. |
| Installed browser app/PWA | Same browser artifact plus `apps/desktop/index.html` manifest link and `apps/desktop/public/manifest.json` | Manifest has standalone display and 192/512 icons. No service-worker registration or offline-cache implementation was found in the audited paths | Candidate packaging route; installability, offline reload, update, and recovery are unverified. |
| Linux ARM64 through ChromeOS Linux | Tauri desktop shell, native engine/IPC, WebKitGTK; release workflow produces ARM64 `.deb`, AppImage, and `.rpm` | `docs/release/platform-support-matrix.md` records native ARM runner install tests and headless AppImage launch for v0.2.1 | Tier 2 release packaging evidence, not ChromeOS GUI or feature-parity evidence. Crostini GPU/video-decode limitations remain applicable. |
| Existing desktop control | Tauri + native engine; Linux x86-64 is the local reference, macOS Apple Silicon and Windows have runner smoke evidence | Platform matrix and native profiling runbook document supported/best-effort desktop paths | Control route for comparisons; it must not be used as a substitute for the Chromebook routes. |

### Feature matrix

The table describes implementation evidence, not an assertion that every
feature works on every route.

| Feature | Native Chrome tab / PWA | Linux ARM64 desktop | Existing desktop control |
|---|---|---|---|
| Core editing and scene model | Shared editor/scene tree is present; `/try` demo restricts scope | Native engine and editor path build; GUI interaction pending | Real launch evidence on Linux x86-64; broader controls have runner evidence |
| Text and fonts | Bundled Fontsource faces and stored-font restore run in browser; local-font capability is optional | Native fontconfig path exists; ARM GUI/font smoke pending | Local font behavior is part of desktop path, with current unrelated font work excluded from this baseline |
| Images and effects | Canvas2D authoritative; image admission/lifecycle limits and WebGPU fallback exist; demo is not full product | Native path exists; accelerated graphics and image decode on Crostini unverified | WebKitGTK profiling and image lifecycle docs provide the control baseline |
| Motion | Demo restrictions withhold motion; shared motion package exists | Shared motion package exists; native GUI validation pending | Motion workspace is implemented and is the control feature path |
| Local files and storage | IndexedDB plus File System Access/input/Blob fallbacks; quota and permission behavior unmeasured | Native file dialogs and paths; ChromeOS portal behavior pending | Native file/save/recovery path is the control |
| Autosave and recovery | Recovery manager and web stores exist, but lifecycle/discard/reload evidence is missing | Native recovery exists; ChromeOS GUI/run duration untested | Existing desktop tests and launches are the control evidence |
| Import/export and printing | Browser export is bounded; print production is explicitly desktop-only in demo messaging | Native print/CUPS path exists; Crostini printer/portal behavior pending | Desktop print/export path is the control |
| Optional AI | ONNX Runtime Web is bundled/gated; model availability and memory cost are not a browser support claim | Native provider chain exists; ARM64 inference not explicitly covered by CI | Native model path is the control |
| Updates | Static Pages deployment and stale-asset recovery exist; no browser update contract is established | Tauri updater feeds are for supported desktop installs; ChromeOS Linux update behavior pending | Release/update feed and package metadata are the control |

### Audited paths and gaps

- `README.md`, `docs/release/platform-support-matrix.md`,
  `docs/development/setup.md`, and `docs/quality/validation-strategy.md`:
  support wording, release tiers, setup, and affected validation rules.
- `apps/desktop/src/main.tsx`, `apps/desktop/src/App.tsx`,
  `apps/desktop/vite.config.ts`, `apps/desktop/index.html`, and
  `apps/desktop/public/manifest.json`: browser/demo boot, platform selection,
  build modes, manifest, CSP, and cross-origin-isolation opt-in.
- `packages/platform/src/runtime.ts`, `web.ts`, and `web-fs.ts`: static
  capability detection, IndexedDB stores, File System Access, and fallbacks.
- `packages/editor/src/canvas/adaptiveProfile.ts`,
  `render/workerEligibility.ts`, and `render/offscreenCapabilityProbe.ts`:
  adaptive tiers, worker policy, and bounded worker pixel verification.
- `packages/editor/src/recovery.ts`, backup/storage call paths, and the
  image-lifecycle architecture: recovery boundaries, local data, decoded image
  limits, and Canvas2D/WebGPU fallback semantics.
- WASM build scripts, `packages/engine`, ONNX Runtime Web dependency,
  `apps/desktop/src-tauri`, and `.github/workflows/website-deploy.yml`:
  native/WASM separation, optional models, Tauri commands, demo deployment,
  and release artifact flow.
- `packages/editor/src/performance/workloadCorpus.ts`, its tests, and
  `apps/desktop/src/demo/sampleDocument.ts`: deterministic benchmark inputs and
  the deployed demo poster.
- `apps/web/package.json`: separate web app remains an explicit scaffold with
  build/typecheck/test deferred; it is not a second working browser product.

## 3. Contradictions that must remain explicit

1. Local README language says `/try` is a bounded development demo and the
   full product is native desktop; the live site links `/try/`, but the product
   page says no hosted web app exists. The link is not support evidence.
2. `apps/desktop/public/manifest.json` makes the artifact PWA-shaped, but no
   service worker or offline update contract was found. It must not be called a
   production PWA yet.
3. The live download page explicitly describes a desktop application and no
   mobile/tablet builds, while the Chromebook target is a browser or Linux
   environment. Android and other mobile artifacts are out of scope.
4. The local/site release truth is v0.2.1, but the live cache check of GitHub
   `/releases/latest` returned v0.2.0. The release page/API must be rechecked at
   the next release checkpoint; neither observation is silently overwritten.
5. Linux ARM64 has package and headless-runner evidence and is correctly Tier 2
   in the matrix, but that is not a Chromebook GUI run. Google’s Crostini
   limitations make GPU/video decode a separate risk.

## 4. Reproducible fixtures and measurement baseline

The existing corpus is deterministic (`PERFORMANCE_WORKLOAD_VERSION = 2`,
stable FNV-1a fixture checksums, and unit tests for exact counts). It is reused
before adding a parallel Chromebook corpus.

| Coverage | Existing fixture and exact metadata | Stage 1 interpretation |
|---|---|---|
| Small object-count control | `vector-100`: 100 shape nodes, no text/image/effect; `vector-500`: 500 shape nodes | Reproducible count control, not the requested mixed small document |
| Existing demo poster | `buildDemoSampleDocument()`: 9 nodes, 1 frame, 5 shapes including outline, 3 text nodes, 1200x800 frame; no image and no timeline | Real-world-style visual smoke only; not a performance tier |
| Medium object-count control | `vector-1k`: exactly 1,000 shape nodes; `multi-page`: 183 nodes across 3 pages; `many-small`: 1,000 nodes | Reproducible controls, but a mixed approximately 1,000-node fixture still needs to be added |
| Text and shaping | `text-heavy`: 600 text nodes; each uses a deterministic multilingual paragraph and 640x72 box | Separate text stress dimension; record loaded-font set on the device |
| Raster memory | `raster-heavy`: 48 image nodes, 4096x4096 source dimensions, 3,221,225,472 theoretical RGBA decoded bytes, displayed at 512x512 | Deliberate decoded-pixel pressure; never combine with every worst case by default |
| Path complexity | `vector-heavy`: 256 paths, 128 points per path (32,768 points total) | Separate path-depth/point-count dimension |
| Effects and masks | `effects-masks`: 120 frames and 120 shapes, each frame has layer blur, drop shadow, and vector mask | Separate effect-depth dimension |
| Motion | `motion`: 240 nodes, 240 tracks, three keyframes per track, 10,000 ms timeline | Use only where motion is enabled on the route |
| Camera scale | opt-in `viewport-1k`, `viewport-10k`, `viewport-100k`: fixed 100 visible nodes with exact total counts | Isolates culling/camera scaling from visible complexity |

Fixture gaps to hand to Stage 2: add one deterministic mixed small fixture of
approximately 100 visible nodes with several text blocks, one licensed or
bundled image, and basic effects; add one mixed approximately 1,000-node
multi-page fixture with editable text, a few decoded images, masks/clips, and
layered effects. Record exact node/path/text/image/page/effect counts, image
dimensions and decoded bytes, serialized file bytes, bundled font names, and
the seed/checksum in the corpus test. Keep the 5,000-node, large-image,
high-point-path, and effect-depth dimensions separate.

### Measurement protocol

All measurements must use a production/release build, an isolated browser
profile, one workload at a time, and paired repeated samples. Record at least
10 cold and 10 warm runs for startup/first frame and enough interaction samples
to report p50/p95 rather than a selected average. Record device/runtime/ChromeOS
channel, CSS viewport, DPR/display scale, renderer/provider, power mode,
background work, workload checksum/file bytes, and instrumentation overhead.

Required measures: cold/warm startup, first editable frame, command feedback,
pan/zoom/drag latency distribution, typing and layer operations, save/autosave,
export, peak and post-workload memory, worker count, and idle activity. Use
Chrome Task Manager or an equivalent documented runtime measurement for tab
memory; installed RAM is not tab/WASM/GPU/container memory. Synthetic CPU
throttling or reduced viewport is a test technique and must be labelled as such.

## 5. Proposed acceptance budgets

These are numeric goals to test, not measured results or support limits. P0
budgets are release-blocking; P1/P2 budgets are optimization targets.

| Priority | User-visible budget on the 8 GB Duet | Evidence |
|---|---|---|
| P0 | No document loss after reload, hidden/frozen transition, browser discard/reopen, or failed save; recovery must identify and restore the latest complete version | Automated lifecycle tests plus manual ChromeOS run |
| P0 | Cold launch to editable shell p95 <= 6 s; warm launch p95 <= 3 s on the small mixed fixture | 10 paired cold/warm runs on release build |
| P0 | Core edit command acknowledgement p95 <= 150 ms; no uncaught error or blank canvas during 30-minute small/medium session | Interaction trace and browser console capture |
| P1 | First editable frame p95 <= 4 s cold / 2 s warm for small; <= 8 s cold / 4 s warm for medium | Same paired runs, with WASM/model fetch excluded and reported separately |
| P1 | Pan/zoom/drag presentation p95 <= 50 ms, with no sustained >100 ms stalls; typing/layer feedback p95 <= 150 ms | Pointer/keyboard traces on real DOM, frame diagnostics |
| P1 | Save p95 <= 1 s and idle autosave completion p95 <= 2 s after the configured debounce; no unbounded worker or bitmap growth | Storage/recovery instrumentation and repeat workload |
| P1 | Small and medium workflows remain usable on 4 GB with graceful tier reduction; no claim of stress-fixture support | 4 GB device or bounded constrained-runtime test, labelled accordingly |
| P2 | Dynamic capability report completes in <= 2 s in a healthy tab, creates no persistent worker, and exposes no document/user-content fields | Unit tests plus manual report review |
| P2 | Optional AI never blocks core editing; unsupported WebGPU/WebNN/SIMD/threads produce a visible fallback state | Capability matrix and model-provider tests |

The budgets intentionally avoid a device refresh-rate assumption. The actual
Duet viewport, DPR, ChromeOS version, free eMMC space, renderer, and power mode
must be recorded with every accepted result.

## 6. Route decision

**Primary candidate:** native Chrome browser tab, with installed PWA as a
follow-on packaging of the same verified artifact. This has the lowest setup
and maintenance cost, preserves local-first storage, avoids Crostini’s
documented hardware-acceleration limitations, and can use browser-native
touch/pen/file APIs. It is not a support decision: the current repository and
site still describe `/try` as a bounded or unfinished browser experience.

**Secondary candidate:** Linux ARM64 desktop through ChromeOS Linux. Keep it
available as a best-effort package route because ARM64 artifacts exist, but do
not promote it to Chromebook support until GUI launch, input, storage portals,
fonts, printing, WebKitGTK rendering, and optional-model behavior are tested on
the actual environment. Crostini is not native ChromeOS Chrome.

Android, Play Store, Windows/macOS substitutes, Electron, cloud processing,
and remote streaming are rejected as out of scope for this stage.

## 7. Staged implementation and dependency handoff

1. **Stage 2, platform report:** add bounded on-demand dynamic probes and a
   readable/downloadable report. Keep it independent of render-path selection.
2. **Stage 3, persistence:** test visibility/discard/recovery and quota warning
   behavior through the existing platform facade; no Chromebook-only schema.
3. **Stage 4, renderer/input:** run the existing adaptive profile and worker
   probe on ChromeOS; validate pen/touch capture and Canvas2D/WebGPU fallback.
4. **Stage 5, fixture/perf harness:** add mixed deterministic fixtures and the
   paired p50/p95 capture protocol; keep stress dimensions separate.
5. **Stage 6, PWA/deployment:** decide service-worker scope, install/update,
   offline migration, and exact deployed artifact verification.
6. **Stage 7, support/release:** update support tiers only from device evidence,
   refresh public claims, and publish a frozen acceptance report.

### Dependency graph

```text
release/deployment artifact
        -> browser/demo build
        -> App runtime selection
        -> platform facade -> IndexedDB/File System Access + WASM
        -> editor renderer/input -> adaptive worker/Canvas2D/WebGPU policy
        -> optional ONNX provider (capability and memory gated)

Tauri package -> WebKitGTK/native engine/IPC -> Linux ARM64 GUI and portal checks
```

The Stage 2 capability report attaches to the platform/performance layer and
does not become a new Chromebook mode, a user fingerprint, a polling loop, or
a render decision hub.

## 8. Baseline commands and evidence

Commands run before this document was authored:

```text
git status --short --branch
git rev-parse HEAD
git worktree list --porcelain
pnpm verify:plan
```

The planner ran successfully on the shared worktree and selected broad JS
coverage because unrelated font/input changes were already present: 83 changed
files, affected `@varve/editor`, `@varve/website`, and `@varve/engine`, and a
98% test-file affected warning. It reported no full-suite escalation and
deliberately skipped Rust workspace tests and the full visual suite for that
current change set. This task has not used those unrelated results as ChromeOS
evidence.

No real-device benchmark, PWA install, ChromeOS tab-discard run, Linux ARM64
GUI run, or screenshot inspection was available in Stage 1. Those are explicit
next checks, not skipped claims.

## 9. Next smallest verification step

Run the capability report on the actual Duet in a clean native Chrome tab and
installed PWA profile, save both local JSON reports, then repeat the same report
inside the ARM64 Linux desktop route. Compare only the recorded API health,
viewport/DPR, storage, worker, WASM, and graphics results; do not infer support
from the model name or user-agent string.
