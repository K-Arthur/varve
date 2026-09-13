# ChromeOS Stage 7 integrated acceptance

**Status:** in progress; automated and host-route evidence is being collected
**Research access date:** 2026-09-13
**Branch:** `master`
**Base SHA at start:** `ceb6c3962af1cfd7ce5acbd06a80c90a509a1b4f`
**Reference device:** Lenovo Chromebook Duet 11M889, 8 GB primary target — not attached
**Ownership:** [`chromeos-stage7-ownership.md`](../agents/chromeos-stage7-ownership.md)

This is an integration and acceptance record, not a claim that a synthetic
Chromium run is a Chromebook run. It separates official platform guidance,
repository implementation, local test results, upstream complaint signals,
and hypotheses. The final candidate SHA and build mode will be appended after
the last owned commit; no release, tag, deployment, or DNS mutation is part of
this gate.

## 1. Research ledger

Access date for this Stage 7 pass is 2026-09-13 unless a row says otherwise.
The complaint rows identify realistic failure modes to test; they are not
compatibility or security evidence by themselves.

| Question | Source URL / title | Publisher and date | Applicable versions / platform | Finding and confidence | Implementation consequence | Unresolved conflict |
|---|---|---|---|---|---|---|
| What can Playwright emulate? | [Emulation](https://playwright.dev/docs/emulation) | Playwright, current documentation accessed 2026-09-13 | Playwright 1.62.1 in this lockfile; Chromium projects | Contexts can set viewport, DPR, touch, locale, color scheme, and permissions. **High** for test mechanics; not hardware fidelity | Keep the device matrix synthetic and label it; do not call it a Duet run | OSK, USI digitizer, ChromeOS compositor, battery, and pen-to-photon behavior remain unmeasured |
| Which pointer behaviors are normative? | [Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/) | W3C Recommendation, 2026-06-30 | Browser Pointer Events; current Chromium target | Pointer events unify mouse, pen, and touch; coalesced/predicted events, capture, and `pointercancel` have defined behavior. **High** | Use the existing normalizer and cancellation tests; retain non-pointer keyboard/a11y coverage | Device/browser support for coalesced or predicted events and USI metadata is unknown |
| What happens when a page is hidden, frozen, or discarded? | [Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) | Chrome for Developers, current page accessed 2026-09-13 | Chrome/ChromeOS lifecycle | Hidden pages may be frozen or discarded; `document.wasDiscarded` identifies a discard after reload; unload is not a reliable persistence boundary. **High** | Treat visibility/pagehide/freeze and committed checkpoints as recovery evidence; test discard/reload separately | ChromeOS memory pressure and exact discard timing are device-dependent |
| What do web performance numbers mean? | [Web Vitals](https://web.dev/articles/vitals) | Google web.dev, updated 2024-10-31 | Current Chrome field/lab terminology | LCP 2.5 s, INP 200 ms, CLS 0.1 are 75th-percentile field thresholds; lab TBT is not field INP. **High** | Report lab timing proxies and editor interaction timing with their method; do not turn them into field claims | No Varve field telemetry or controlled Duet timing exists |
| What are the browser file-write and permission boundaries? | [File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) and [Persistent permissions](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api) | Chrome for Developers, current page / 2024-02-20 article, accessed 2026-09-13 | Chromium secure contexts; installed web apps receive persistent permission behavior from Chrome 122 | Pickers require a user gesture; write permission must be checked/requested; `createWritable()` commits on close; handles can persist in IndexedDB. **High** | Keep explicit permission/error UI and download/Blob fallback; never imply silent overwrite or universal persistence | Files-app/Drive handle prompts on the actual Duet remain unverified |
| What does browser quota tell us? | [Storage Standard](https://storage.spec.whatwg.org/) | WHATWG Living Standard, accessed 2026-09-13 | Browser origin storage | Quota and usage are UA-managed estimates, not free physical eMMC and not a promise of capacity. **High** | Show estimates as estimates, simulate quota failures in disposable storage, and retain recovery copies | ChromeOS eviction policy and available eMMC space require device measurement |
| What does a Chrome web app install promise? | [Use web apps](https://support.google.com/chrome/answer/9658361?hl=en) | Google ChromeOS Help, current page accessed 2026-09-13 | Chrome on ChromeOS | Installation is browser/platform-dependent and a web app may not work completely offline; uninstall may offer deletion of site data. **High** | Keep PWA experimental; document one complete online setup and the delete-data warning | Managed policy and launcher surface need a real ChromeOS run |
| What is the Linux-on-ChromeOS boundary? | [Linux on ChromeOS FAQ](https://chromeos.dev/en/linux/linux-on-chromeos-faq), [Set up Linux](https://support.google.com/chromebook/answer/9145439?hl=en) | ChromiumOS.dev / Google Support, accessed 2026-09-13 | ChromeOS Linux container; Debian architecture varies by device | Linux is a separate sandboxed route; Google Support documents GPU/video-decode limitations and managed-device restrictions. **High** for separation, **medium** for graphics because docs differ | Keep Crostini separate from native Chrome and conservative about graphics; verify `uname -m`, `dpkg`, WebKitGTK, and GUI on hardware | ChromeOS developer material describes graphics capabilities more positively than the support page; no acceleration claim is made |
| What does Tauri actually run on Linux? | [Webview versions](https://v2.tauri.app/reference/webview-versions/) and [Debian distribution](https://v2.tauri.app/distribute/debian/) | Tauri, current v2 docs accessed 2026-09-13 | Tauri 2; Linux system WebKitGTK | Tauri does not bundle the Linux webview; runtime depends on system WebKitGTK and Debian packages include `libwebkit2gtk-4.1-0` and GTK dependencies. **High** | Package evidence and a host launch do not prove Crostini GUI parity; record container library versions | The Duet's ChromeOS Linux image and WebKitGTK version are unknown |
| What does the Duet specification establish? | [Lenovo Chromebook Duet 11M889 PSREF](https://psref.lenovo.com/syspool/Sys/PDF/Lenovo/Lenovo_Chromebook_Duet_11M889/Lenovo_Chromebook_Duet_11M889_Spec.pdf) | Lenovo, spec dated 2025-10-21, accessed 2026-09-13 | 11M889 variants | Kompanio 838, Mali-G57 MC3, NPU 650 up to 4 TOPS, 4/8 GB LPDDR4X, 64/128 GB eMMC, 1920x1200 panel, USB-C display, 29 Wh battery, USI Pen 2 support. **High** as product specification | Optimize for 8 GB, degrade safely at 4 GB, and do not infer browser/Linux NPU use or runtime refresh/latency | Installed RAM, CSS viewport/DPR, free space, ChromeOS channel, renderer, and power state need measurement |
| What failed for users in other local-first/PWA editors? | [Excalidraw cache invalidation issue #2099](https://github.com/excalidraw/excalidraw/issues/2099) and [Figma offline help](https://help.figma.com/hc/en-us/articles/360040328553-What-can-I-do-offline-in-Figma) | Excalidraw maintainers / Figma Help, issue and guide accessed 2026-09-13 | PWA/offline editor behavior | Excalidraw reports stale-cache/divergent-client problems; Figma documents that only loaded pages work offline and discard recovery cannot be undone. **High** as failure-pattern evidence, not Varve support evidence | Preserve versioned SW update prompts, offline setup boundary, recovery copies, and no silent overwrite; test stale jobs and discard | These products have different architectures and cannot establish Varve behavior |
| What tablet-editor interaction problems are reported? | [Excalidraw touch meta issue #9705](https://github.com/excalidraw/excalidraw/issues/9705), [Figma touch compatibility](https://forum.figma.com/suggest-a-feature-11/figma-touch-screen-compatibility-20698), [Photopea Chromebook Alt-click](https://www.photopea.com/tuts/alt-click-problem-on-chromebooks/) | Upstream issue reporters / Photopea, accessed 2026-09-13 | Touch/stylus/ChromeOS editor use | Reports include pinch creating strokes, missing palm rejection, coordinate offsets, hidden modifier/right-click behavior, and ChromeOS Alt-click conflicts. **Medium** as complaint signals | Test pointer ownership/cancel, screen-space geometry, alternatives to modifiers, and document OS-reserved shortcuts; do not promise platform-level Alt-click changes | Actual USI palm/tilt/AltGr behavior is device-only |
| What breaks on very large files or weak networks? | [Photopea issue #5941](https://github.com/photopea/photopea/issues/5941), [Photopea issue #5756](https://github.com/photopea/photopea/issues/5756), [tldraw issue #9775](https://github.com/tldraw/tldraw/issues/9775) | Upstream user issue trackers, accessed 2026-09-13 | Large raster/save and dense canvas workloads | Reports include stuck/zero-byte saves, weak-network unresponsiveness, and FPS loss with many visible objects. **Medium** as complaint signals | Exercise bounded oversized/corrupt input, cancel/recovery, save/export failure, culling/preview, and memory cleanup; never hide or flatten unsupported content | User hardware, network, and app versions vary; benchmark figures are not transferable |

The official sources establish platform behavior and constraints. Repository
audits establish Varve implementation. The complaint sources establish which
failure modes deserve regression coverage; they do not establish compatibility,
performance, or support tiers.

## 2. Integration boundary and inherited handoffs

The working tree is shared with active agents. At the Stage 7 ownership
checkpoint, `master` was at `ceb6c3962` and had unrelated staged, unstaged, and
untracked changes. The Stage 7 integrator owns only the paths in the ownership
record. Stage 1–6 records are the dependency handoffs:

| Handoff | Exact evidence carried forward | Stage 7 treatment |
|---|---|---|
| Stage 1 baseline | `docs/audits/chromeos-stage1-baseline-2026-09-11.md` | Recheck routes, budgets, device boundary, and source conflicts |
| Stage 2 browser/PWA | `docs/audits/chromeos-stage2-browser-pwa-2026-09-12.md` | Re-run the production-artifact browser/PWA subset where resources permit; retain no-first-visit-offline limitation |
| Stage 3 rendering/recovery | `docs/audits/chromeos-stage3-rendering-ai-2026-09-12.md` | Reuse adaptive-profile and recovery evidence; report timing proxies with method |
| Stage 4 input/responsive | `docs/audits/chromeos-stage4-input-responsive-2026-09-12.md` | Re-run the device matrix or exact affected subset; synthetic only |
| Stage 5 Linux ARM64 | `docs/audits/chromeos-stage5-linux-arm64-2026-09-12.md` | Verify current package metadata/artifacts without claiming Crostini GUI |
| Stage 6 website/support | `docs/audits/chromeos-stage6-website-support-2026-09-12.md` | Rebuild and visually inspect the route/docs surfaces; correct only reproduced copy overclaim |

## 3. Route fidelity matrix

The final state of each row will use one of `IMPLEMENTED +
AUTOMATED-TESTED`, `NATIVE-RUNTIME-TESTED`, `DUET-HARDWARE-VERIFIED`,
`FAILED`, or `NOT RUN`, with a date, version, command, and artifact. The
initial boundary is explicit:

| Route | What can be exercised here | What cannot be inferred |
|---|---|---|
| Native Chrome tab | Production `/try/` build in isolated Chromium, browser storage, WASM, import/export, input emulation, offline-after-setup, update/recovery paths | Native ChromeOS compositor, tablet mode, OSK, USI Pen 2, ChromeOS Files, battery, real free space, physical latency |
| Installed browser app/PWA | Same artifact with standalone display-mode and service-worker/update tests | ChromeOS launcher/install UI, persistent permission prompt, real offline relaunch after OS suspension |
| ChromeOS Linux ARM64 | v0.2.1 package/checksum/dependency evidence and current package scripts; host-side x86 control where available | ARM64 execution on this host, Crostini GUI/WebKitGTK/input/portal/font/printing/display behavior |
| Existing desktop/browser controls | Linux x86-64 Tauri/browser regression controls and existing unit/E2E suites | Any Chromebook support claim |

## 4. Acceptance flows and failure suite

The final evidence table will cover first launch, sample/new document, text,
vector/pen input, image import, selection/multi-select, nested layers/pages,
transforms/snapping, effects/masks, undo/redo, save, close/reopen, export, and
implemented motion/prototype flows. It will also record controlled failures:
WebGPU absence/loss, worker/WASM failure, cross-origin isolation absence,
provider/model failure and interrupted downloads, offline-first launch,
permission/quota/space/input failures, oversized/corrupt assets, missing fonts,
cancelled saves/exports, stale jobs, two-tab edits, external file edits, old/new
service-worker overlap, migration/update rollback, lifecycle discard, and
accessibility recovery. Device-only rows remain `NOT RUN` until the kit is
executed.

## 5. Measurement contract

Use the established small, medium, and bounded stress fixtures from the Stage
1–3 audits. Record startup, first editability, interaction p50/p95, long tasks,
memory peaks and cleanup, worker count, save/export time, idle activity, and
website lab metrics only when the exact command and environment are recorded.
`performance.now()`, rAF cadence, and Playwright timestamps are proxies for the
observed browser process; they are not physical pen-to-photon latency,
standardized battery life, or thermal performance. Do not compare runs made
under simultaneous heavy host load as clean before/after measurements.

## 6. Visual evidence contract

Every captured screenshot, recording, and export must be opened and inspected.
The review checks blank canvas, missing objects/fonts, clipping/blending, tile
seams, blurry overlays, clipped dialogs, hidden actions, scroll traps, target
size, focus/theme errors, and route-specific offline/update messages. Expected
Stage 7 output roots are `/tmp/varve-chromeos-stage7-*`; no generated output is
committed unless it is a deliberately inspected baseline or a small report
artifact.

## 7. Physical Duet kit boundary

No Lenovo Duet is attached. The final section will provide exact UI/command
steps for native Chrome, installed PWA, and ChromeOS Linux ARM64, plus fields
for model/RAM/storage class, ChromeOS/browser/WebKitGTK versions, free space,
CSS viewport/DPR/display scale, renderer/provider, power state, artifacts, and
pass/fail. It will explicitly leave pen, OSK, rotation, external display,
suspend/resume, 30-minute session, and install/update/uninstall rows `NOT RUN`.

## 8. Release decision boundary

The candidate may be described as integrated and automated-tested only for the
routes and fixtures actually run. It cannot be promoted as Chromebook or Duet
support until the physical kit is executed and inspected. A package checksum,
headless ARM runner, or emulated touch/pen event is not a substitute for a
real Duet GUI/input run.
