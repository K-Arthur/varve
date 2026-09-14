# ChromeOS Stage 7 integrated acceptance

**Status:** acceptance recorded; promotion blocked by shared-integrator failures and missing Duet hardware
**Research access date:** 2026-09-13
**Branch:** `master`
**Base SHA at start:** `ceb6c3962af1cfd7ce5acbd06a80c90a509a1b4f`
**Reference device:** Lenovo Chromebook Duet 11M889, 8 GB primary target — not attached
**Candidate version:** `0.2.1`
**Candidate code SHA (frozen):** `614bc7a79ca60e047fd2bc3831d0e2bc41fa0ac0` (master at the final evidence snapshot; build mode: `VITE_DEMO=1`, `pnpm --filter @varve/desktop build:try`)
**Evidence record commit:** added by the final owned-path commit below; the shared `master` ref may advance independently
**Ownership:** [`chromeos-stage7-ownership.md`](../agents/chromeos-stage7-ownership.md)

This is an integration and acceptance record, not a claim that a synthetic
Chromium run is a Chromebook run. It separates official platform guidance,
repository implementation, local test results, upstream complaint signals,
and hypotheses. No release, tag, deployment, or DNS mutation is part of this
gate. Because other agents continued committing on `master`, every result
below is scoped to the exact command, source snapshot, and artifact named in
its row.

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

Key handoff commits were independently resolved on `master` with
`git show -s --format='%h %aI %s'`:

| Stage | Commits consumed | Scope carried forward |
|---|---|---|
| 1 | `8546eb28f` | Baseline routes, fixtures, budgets, and hardware boundary |
| 2 | `74c88b178`, `da5071a88`, `a53245d61`, `aaa459fe5`, `410d4ae07` | Browser/PWA service worker, persistence, file handles, exports, and demo nesting |
| 3 | `7eb32ac76`, `342546dab`, `f1e86c4d9`, `d9093c07f`, `d7c722d65`, `5f6a11cc6`, `f9eca85e4`, `cd23ec748`, `23c7238d4`, `f74c03d99` | Adaptive rendering, memory/recovery bounds, lifecycle, GPU loss, and optional-model gating |
| 4 | `69bb8a8a7`, `fc40b5633`, `d323b8f2b`, `fb34beb5d`, `52e1f94a0` | Responsive viewports, touch/pen emulation, keyboard alternatives, rotation, and overlay checks |
| 5 | `e2bb6970b`, `c07d7cab5`, `3403b3694`, `682922ea7` | ARM64 package metadata, install/runner evidence, and Linux route documentation |
| 6 | `b98cb9072`, `a6139d9fc`, `a76b0e669`, `fe517ecdf`, `35416f2d6`, `649eabac9` | Website routing, support copy, performance/input guides, and suite classification |
| 7 | `93328f39b`, `d690e30a4` | Stage 7 ownership/audit scaffold and the reproduced marketing truth correction |

## 2a. Integrated evidence collected so far

These are interim results from the shared `master` working tree. They are not
the final candidate until the last Stage 7 evidence commit freezes one SHA.

| Surface | Exact command / method | Result | Status boundary |
|---|---|---|---|
| Website build, GitHub Pages variant | `pnpm --filter @varve/website build:pages` | 100 static pages, exit 0; Astro reported 0 errors and 5 existing hints | `IMPLEMENTED + AUTOMATED-TESTED` for the host build; not a deployment check |
| Website build, custom-domain variant | `pnpm --filter @varve/website build` | 100 static pages, exit 0; Astro reported 0 errors and 5 existing hints | `IMPLEMENTED + AUTOMATED-TESTED` for the host build |
| Marketing truth reproduction | Before the copy fix, isolated `chromeos-stage7-truth.spec.ts` on `ghpages` | 2/2 failed: universal Chromebook wording and unconditional Linux GPU wording were both reproduced | `FAILED` before fix; this is the repair's failing reproduction |
| Marketing truth regression | `VARVE_WEBSITE_E2E_PORT=4339 VARVE_WEBSITE_E2E_PORT_ROOT=4340 node scripts/quality/heavy-lease.mjs chromeos-stage7-website-truth-after -- pnpm exec playwright test -c playwright.website.config.ts apps/website/tests/e2e/chromeos-stage7-truth.spec.ts --project=ghpages --workers=1 --reporter=list` | 2/2 passed in 7.1 s | `IMPLEMENTED + AUTOMATED-TESTED` on static GitHub Pages output; no real Chromebook |
| Native browser readiness | `VARVE_E2E_PORT=1520 VARVE_E2E_OUTPUT_DIR=stage7-browser-readiness-retry node scripts/quality/heavy-lease.mjs chromeos-stage7-browser-readiness-retry -- pnpm exec playwright test tests/e2e/browser/browser-readiness.spec.ts --project=chromium --workers=1 --reporter=line` | 12/12 passed in 10.1 min after one setup-only target crash under host memory pressure | `IMPLEMENTED + AUTOMATED-TESTED` for Chromium on Linux x86-64; synthetic Chromebook route only |
| E2E TypeScript closure | `pnpm typecheck:e2e` | blocked by unrelated `packages/scene/src/shapeBuilder.ts:266` (`ShapeNode.fill` type mismatch) | `NOT RUN` for a clean integrated closure; Stage 7 spec itself produced no type error |
| Website package typecheck | `pnpm --filter @varve/website typecheck` | Astro check reached 0 errors; shared E2E check blocked by unrelated `apps/website/tests/e2e/generative-editing.visual.spec.ts:25` (`naturalWidth` on `HTMLElement | SVGElement`) | `NOT RUN` for a clean package closure |
| Policy audits | `pnpm audit:docs`; `pnpm audit:emoji` | Docs: 832 docs, 458 links, 174 ADRs indexed, clean. Emoji: 4,628 files scanned, clean | `IMPLEMENTED + AUTOMATED-TESTED` |

| Browser demo readiness retry | `VARVE_HEAVY_TASK_PARALLELISM=0 VARVE_E2E_PORT=1522 VARVE_E2E_OUTPUT_DIR=stage7-browser-demo-retry node scripts/quality/heavy-lease.mjs chromeos-stage7-browser-demo-retry -- pnpm exec playwright test tests/e2e/browser/try-demo.spec.ts -g "boots directly into the editor" --project=chromium --workers=1 --reporter=line` | 1/1 passed in 2.5 min after the earlier host-pressure timeout | `IMPLEMENTED + AUTOMATED-TESTED` for that x86 Chromium snapshot only |
| Browser demo plus export integration run | `VARVE_HEAVY_TASK_PARALLELISM=0 VARVE_E2E_PORT=1523 VARVE_E2E_OUTPUT_DIR=stage7-browser-demo-full node scripts/quality/heavy-lease.mjs chromeos-stage7-browser-demo-full -- pnpm exec playwright test tests/e2e/browser/try-demo.spec.ts tests/e2e/browser/try-export.spec.ts --project=chromium --workers=1 --reporter=line` | Stopped with exit 130 after 5/16 observed tests: 2 passed and 3 failed. Vite repeatedly reported parse errors in concurrently edited `packages/editor/src/render/replayScene.ts:1456` and `packages/engine/src/colorization/colorSpace.ts:85`; failed screenshots show the documented startup-timeout recovery UI | `FAILED` as an integrated-tree run; not a Duet result |
| Current production demo build | `pnpm --filter @varve/desktop build:try` | ONNX copy and client-env guard passed; TypeScript gate exited 2 with shared editor/engine errors before Vite emitted a current artifact | `FAILED`; the older Stage 2 artifact must not be relabelled as this candidate |
| Current impact plan | `pnpm verify:plan` | 521 changed files; six affected JS packages and three Rust crates; Tier 4 selected; `FULL-SUITE ESCALATION: YES` for workspace/toolchain/validation-infrastructure impact | `IMPLEMENTED + AUTOMATED-TESTED` planning evidence |
| Current affected validation | `pnpm verify:affected` | Exit 2 after printing the affected closure; it correctly deferred execution to the required full gate | `NOT RUN` for the closure; escalation was required |
| Bounded integration triage | `pnpm verify:triage` | Exit 1 at `format:touched`: Biome checked 333 files and reported 253 errors/9 warnings, including generated `apps/desktop/dist-stage3-cont` output and shared dirty files; downstream lanes were not reached | `FAILED` at Tier 0; no generated output was changed |
| Escalated full gate | `VARVE_FULL_GATE_REASON="Stage 7 integrated ChromeOS acceptance and release-candidate validation across the shared workspace/toolchain changes" pnpm verify:full` | Exit 1. Formatter/lint failed on generated output; architecture reported 13 cycles and instability/budget overages; engine typecheck then stopped on `maskDecode.ts` and three LUT test errors | `FAILED` for the shared candidate; no release promotion |
| Release status helper | `pnpm release:status` | Aborted before status output because its internal `pnpm install` requested removal of modules without a TTY (`PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`) | `NOT RUN`; no dependency removal was authorized or performed |
| Current host | `rustc 1.97.1; cargo 1.97.1; pnpm 11.9.0; node v22.23.2; just 1.58.0; pkg-config webkit2gtk-4.1=2.52.6; uname -a` | CachyOS x86-64, kernel `7.2.3-1-cachyos`; this is not the Lenovo device and is not a ChromeOS/Linux-container runtime | Environment fact only |

The initial browser readiness attempt (`VARVE_E2E_PORT=1519`) crashed in the
shared global setup before the first spec body with `Target crashed`; at that
time the host had about 1.1 GiB available RAM and 72 KiB free swap. It was not
counted as a passing test. The serial retry above completed after host memory
recovered. The configured output suffix was
`stage7-browser-readiness-retry`; no user data was involved.

## 2b. Root causes and fixes

The only Stage 7 implementation change was a truthfulness repair. The
Chromebook guide previously said the browser route “works on any current
Chromebook” and described Linux GPU acceleration as categorically unavailable.
Those claims exceeded the evidence. The page now calls the browser route
experimental, names browser policy/storage/device limits, states that no
physical Chromebook run has occurred, and qualifies the Linux acceleration
statement as current Google guidance whose behavior remains version/device
dependent. `chromeos-stage7-truth.spec.ts` reproduces both old failures and
guards the new wording; the post-fix run is 2/2.

The complaint-driven failure patterns were addressed by earlier owned stages:
versioned service-worker caches and a user-selected update for stale PWA
clients; an explicit incomplete-offline 503 instead of pretending to work;
recovery checkpoints and discard detection; content-hash refusal for external
file edits; bounded image/model work; pointer ownership/cancellation and
screen-space geometry; and decoded export assertions that catch zero-byte or
empty-artboard results. These mitigations are not claims that the comparable
products' architectures or failure rates transfer to Varve.

The current integrated candidate has separate unresolved integration causes:
active shared edits introduced parser errors in `replayScene.ts` and
`colorSpace.ts`, current cross-package type contracts do not close (including
`maskDecode.ts` and LUT tests), and generated `dist-stage3-cont` output is
being included by the formatter/linter. The affected files belong to other
active handoffs; Stage 7 records the proposed handoff and does not overwrite
their work. These failures block a current production demo build and are
release-blocking until reconciled.

## 3. Route fidelity matrix

Statuses are scoped to the route and artifact actually exercised. The host is
Linux x86-64; none of these rows is a physical ChromeOS result.

| Route | Evidence and supported slice | Status on 2026-09-13 | What remains unproven |
|---|---|---|---|
| Native Chrome tab | Stage 2 production `/try/` artifact: browser storage, WASM, import/export, input emulation, offline-after-setup and recovery tests; Stage 7 isolated current-tree readiness retry 1/1 passed; current shared-tree full run hit startup failures and the current `build:try` cannot compile | `IMPLEMENTED + AUTOMATED-TESTED` for the named Chromium/artifact snapshots; current integrated candidate `FAILED` | Native ChromeOS compositor, tablet mode, OSK, USI Pen 2, Files, real quota/free space, battery, and physical latency |
| Installed browser app/PWA | Stage 2 production artifact: partial-cache 503, verified offline relaunch, waiting update, file-launch/rebinding; actual browser install UI was not run | `IMPLEMENTED + AUTOMATED-TESTED` for the disposable production artifact; Duet install `NOT RUN` | ChromeOS launcher/install persistence, permission prompts, OS suspension/discard, uninstall/delete-data choice |
| ChromeOS Linux ARM64 | Stage 5 published v0.2.1 ARM64 `.deb`/AppImage checksums, metadata, Debian 12/13 dependency resolution, native ARM runner install/headless launch | `IMPLEMENTED + AUTOMATED-TESTED` for package/runner evidence only; Crostini GUI `NOT RUN` | ARM Duet container, WebKitGTK GUI, portal/files, fonts, printing, display transitions, graphics, input, model execution |
| Existing desktop/browser controls | Current x86 browser readiness 12/12 passed in an earlier integrated snapshot; current full candidate build/typecheck and gate failed | `IMPLEMENTED + AUTOMATED-TESTED` for the passing browser snapshot; current clean desktop control `NOT RUN` | Tauri/WebKitGTK release-like launch at this candidate and any Chromebook claim |

### Feature-flow coverage

| Flow | Browser/PWA evidence | Linux ARM64 / Duet evidence |
|---|---|---|
| First launch and sample/new document | `browser-readiness.spec.ts` 12/12 and Stage 2 `try-demo.spec.ts` 13/13 on the named snapshots; Stage 7 current isolated boot 1/1 passed, but the later shared-tree run is `FAILED` | ARM package smoke only; GUI first launch `NOT RUN` |
| Text entry, vector/pen drawing, image import, selection/multi-select, layers/pages, transforms/snapping | Stage 2 demo plus Stage 4 synthetic Chromium matrix; Stage 4 effective result 27/27 after six resource-flake reruns; no current clean integrated replay | Synthetic only; real keyboard, touch, pen and import portal `NOT RUN` |
| Effects, masks, undo/redo, motion/prototype paths | Existing package/E2E and Stage 1–4 handoffs; no Stage 7 clean integrated run because the current build fails before Vite | Crostini and real Duet `NOT RUN` |
| Save, close/reopen, serialization round-trip | Stage 2 IndexedDB/Blob/file-handle checks and browser readiness persistence test; actual downloaded export bytes were decoded and inspected | Package install does not prove document save; GUI round-trip `NOT RUN` |
| Export | Stage 2 3/3 export acceptance: SVG geometry, JPEG pixel spread, and 1200×800 frame PNG; inspected `/tmp/varve-e2e-export-poster.png`, `/tmp/varve-e2e-export-sun.jpg`, and SVG bytes | Crostini export/printing `NOT RUN` |
| Authored motion/prototype flows | Existing motion implementation is inherited; no Stage 7 route-specific authored-motion acceptance was run | `NOT RUN` |

The browser and PWA rows are capability evidence, not a support promotion. The
current release matrix remains Tier 3 Experimental for all ChromeOS routes.

## 4. Acceptance flows and failure suite

The following distinguishes current direct evidence from inherited evidence and
device-only work. A status of `NOT RUN` is intentional; it is not a pass.

| Failure / edge case | Evidence status and scope | Recovery or limitation |
|---|---|---|
| No WebGPU / null adapter / failed device | Stage 2/browser-readiness headless Chromium passed Canvas2D fallback and reported no WebGPU; Stage 3 unit/probe evidence covers failed device creation | Canvas2D/WASM fallback; Duet adapter/device still `NOT RUN` |
| Context/device loss | Stage 3 lifecycle/GPU tests and recovery contract inherited; no current candidate E2E | Recreate/retry and authoritative redraw are implemented by contract; real Mali loss `NOT RUN` |
| Failed worker/WASM load | Browser readiness passed the missing-WASM pure-TS fallback; Stage 2 offline cache tests passed | App remains usable with degraded engine; current candidate build failure prevents a fresh run |
| Cross-origin isolation unavailable | Browser readiness network-posture test passed on x86 Chromium; ORT thread policy is gated | Core editing does not require isolation; no model-thread claim |
| Provider/model init failure or interrupted download | Stage 3 unit/gating evidence; no model download on the Duet | Optional AI stays non-blocking and falls back/records failure; Duet model behavior `NOT RUN` |
| Offline after setup / never-cached first visit | Stage 2 PWA 3/3: truthful 503 for incomplete cache and editable offline relaunch after verified setup | First-ever offline launch cannot show editor code and is explicitly unavailable |
| Permission denial / quota failure / low space | Browser readiness IDB denial and Stage 2 file-handle/conflict units; physical free-space test `NOT RUN` | Ephemeral/in-memory warning and explicit save failure; no destructive cleanup |
| Corrupt persisted state / oversized or corrupt input / missing font | Browser readiness corrupt-state and bundled-font checks; oversized/corrupt image and missing-font device workflows `NOT RUN` | Boot recovery and bounded input admission exist; no claim of stress-fixture support |
| Cancelled/interrupted save or export | Stage 2 save status/export tests; cancellation under a real suspended device `NOT RUN` | Save states distinguish cancelled/failed from Saved; user retries or exports again |
| Stale jobs after undo/document switch | Stage 3 derived-work admission/stale-result tests inherited; no clean Stage 7 closure | Generation/cancellation guards are covered by implementation tests; current candidate closure blocked |
| Two tabs/PWA windows or external file edits | Stage 2 Web Lock/content-hash units and launch/rebinding test | Newer external content is not silently overwritten; real ChromeOS Files/Drive conflict `NOT RUN` |
| Old/new service-worker overlap or failed update/rollback | Stage 2 waiting-update test passed on a disposable served artifact | User-selected update/reload and versioned cache cleanup; real launcher rollback `NOT RUN` |
| Lifecycle hidden/freeze/discard and last checkpoint | Stage 2/3 lifecycle tests and offline/recovery screenshots; ChromeOS discard `NOT RUN` | Checkpoint before hidden/freeze; `document.wasDiscarded` recovery is mitigation, not a loss-proof claim |
| Accessibility/keyboard recovery from visible errors | Stage 4 keyboard-free alternatives and Stage 7 marketing truth spec passed; screen-reader/ChromeVox and French IME `NOT RUN` | Visible reload/update/offline controls are keyboard reachable in synthetic Chromium; hardware AT remains open |

## 5. Measurement contract

The fixtures and budgets remain those defined by Stage 1: `vector-100`/`vector-500`
small controls, `vector-1k`/`multi-page`/`many-small` medium controls,
`text-heavy`, and bounded `raster-heavy`. Stage 7 has no clean paired
before/after benchmark because the current integrated tree cannot complete
`build:try` or the affected closure, and the host was under active-agent load.

| Measure | Reference budget / method | Before | Stage 7 candidate | Result |
|---|---|---|---|---|
| Cold/warm startup and first editable frame | Stage 1: cold p95 ≤6 s, warm p95 ≤3 s; 10 paired runs on a release artifact | No numeric baseline artifact in Stage 1–3 handoff | No valid current release artifact; one isolated boot test passed, but later shared runs timed out | `NOT MEASURED`; Playwright timestamps are not a Duet claim |
| Interaction p50/p95, long tasks | Stage 1: command p95 ≤150 ms; pan/zoom/drag p95 ≤50 ms; browser trace and long-task observer | No clean p50/p95 baseline | No paired current run; Stage 4 synthetic matrix was effective 27/27 only | `NOT MEASURED` |
| Memory peak and cleanup | Repeated medium open/close, tab/process memory, worker/image counts; no growth after cleanup | Stage 3 bounds/unit evidence only; no physical memory baseline | No current candidate run; Duet/4 GB route not available | `NOT MEASURED` |
| Worker count and idle activity | Capability report plus lifecycle/worker diagnostics; no persistent worker from capability probe | Stage 2/3 implementation and test evidence | Current build did not reach runtime | `NOT MEASURED` |
| Save/export | Stage 1 save p95 ≤1 s; record separate export time and bytes; decode/reopen output | Stage 2 export suite 3/3 passed: SVG 46.1 s, JPEG 30.1 s, frame 11.2 s in the named production-artifact run | No current build; inspected downloaded frame/JPEG from the inherited artifact | `AUTOMATED-TESTED` for inherited artifact, not a paired performance result |
| Website lab metrics | Report LCP/INP/CLS only from a named lab/field method; web.dev thresholds are not app guarantees | No field data | No Web Vitals run; static builds were 100 pages, 0 Astro errors, 5 hints | `NOT MEASURED`; build count is not a Web Vitals result |

These values deliberately do not claim battery life, thermals, refresh rate, or
physical pen-to-photon latency. A later Duet run must collect ten paired cold
and warm samples and the same fixture/measurement definitions before any
performance tier changes.

## 6. Visual evidence contract

Every captured screenshot and export was opened and inspected. Durable website
captures are in
[`docs/screenshots/chromeos-stage7-2026-09-13/`](../screenshots/chromeos-stage7-2026-09-13/):

- `chromebook-800x1280.png`: route cards, support callout, requirements,
  feature table, limitations, and footer are present; no blank canvas-like
  region, clipped card, or hidden primary action was observed.
- `chromebook-360x800.png`: narrow portrait cards and tables stack; no
  horizontal drift, clipped support text, or scroll trap was observed.
- `download-1440x1024.png`: browser/Linux notices, package cards, checksums,
  install instructions, and footer are visible; no blank panel or clipped
  download action was observed.

The inherited editor/PWA artifacts inspected during this pass were:

- `/tmp/varve-chromeos-stage2-nested-sample.png` and
  `/tmp/varve-chromeos-stage2-nested-sample-nudged.png`: sample content,
  layers, selection handles, and inspector remained visible; no missing text or
  clipping was observed.
- `/tmp/varve-chromeos-stage2-visual-offline-fallback.png`: the incomplete
  setup page says the demo is not available offline yet and that saved data was
  not deleted.
- `/tmp/varve-chromeos-stage2-visual-offline-relaunch.png`: the offline banner,
  editable canvas, and layers panel are visible.
- `/tmp/varve-e2e-export-poster.png` and `/tmp/varve-e2e-export-sun.jpg`:
  decoded output contains the authored headline, text, teal circle, pink
  shape, and frame border. `/tmp/varve-e2e-export-sun.svg` was checked as text
  for the circle/viewBox/teal geometry. The unrelated
  `/tmp/varve-chromeos-stage2-export.png` is a flat white debug capture and is
  not used as export evidence.
- `test-results/stage7-browser-demo-full/.../test-failed-1.png` (failed
  cases): the visible startup-timeout recovery UI is rendered with a usable
  Reload button; the earlier `stage7-browser-demo` failure captured only the
  branded loading screen. These are failure-state observations, not a product
  success claim.

No visual baseline was regenerated. The current editor screenshots could not be
recaptured after the shared tree acquired parser/type errors, so current
editor-route visual acceptance is `NOT RUN`.

## 7. Physical Duet kit boundary

No Lenovo Duet was attached to this session. Every row below is therefore
`NOT RUN`. This kit is the smallest bounded procedure that turns the open
handoffs into measured evidence and keeps the native Chrome, installed PWA,
and Linux ARM64 routes separate.

### Before starting

1. On the Duet, record only model, RAM/storage class, free space, ChromeOS
   version/channel, Chrome version, Linux/WebKitGTK versions when applicable,
   route, CSS viewport, `devicePixelRatio`, display scaling, renderer/provider,
   and power state. Use `chrome://version`, ChromeOS Settings, and the in-app
   capability report. Do not record serial numbers, account data, or private
   document paths.
2. Use an isolated test profile and disposable `.varve` fixtures. Record the
   exact candidate artifact/version and checksum before opening it. Keep normal
   ChromeOS security settings; do not enable flags to create an acceleration
   claim.
3. For native Chrome, open `https://varve.studio/try/`. For PWA, complete one
   online visit before selecting Chrome menu → Install Varve, then verify the
   standalone window. For Linux, enable Linux only if policy allows, share an
   isolated Files folder with Linux, and verify `uname -m`,
   `dpkg --print-architecture`, `pkg-config --modversion webkit2gtk-4.1`,
   `df -h`, and `free -h`.
4. Open Settings → Performance → Platform capability report and save the JSON
   to the disposable evidence folder. A product NPU specification is not
   execution evidence; record discovered, loadable, usable, and verified
   stages separately.

### Route checklist and expected evidence

| Route / step | Procedure | Expected observation | Status |
|---|---|---|---|
| Native Chrome first launch | Open `/try/`; load sample, create a new document, type text, draw vector/freehand, import a small PNG/SVG, select/multi-select, nest layers/pages, transform/snap, apply effects/masks, undo/redo, save, close/reopen, export | No Home detour; status distinguishes saved/cancelled/failed; serialized round-trip preserves structure and the opened/exported image preserves visible objects | `NOT RUN` |
| Native Chrome input | Use USI Pen 2 for strokes/pressure/tilt, touch for tap/pinch/pan, trackpad/mouse for selection and wheel, keyboard detached/attached, French/English input and IME, onscreen keyboard | Pen-plus-touch does not create accidental strokes; pointer cancellation leaves no history artifact; text remains editable; no geometry jump | `NOT RUN` |
| PWA install/offline | Install from the completed online visit, close/reopen from launcher, enter offline after recording cached assets, edit/save/export, test no-first-visit offline, then trigger a waiting update | Offline relaunch is editable only after verified setup; incomplete cache gives the documented unavailable page; update is offered, not forced; user data is not deleted | `NOT RUN` |
| PWA permissions/conflicts | Deny/revoke file permission, edit the file externally in an isolated folder, open in a second tab/window, cancel save/export, uninstall with and without deleting site data | Clear permission/conflict/cancel state; newer external content is not silently overwritten; last committed/recovery point remains | `NOT RUN` |
| Linux ARM64 package | Verify published v0.2.1 SHA-256, install the `.deb` with `sudo apt install ./Varve-0.2.1-linux-aarch64.deb`, launch, exercise GUI/save/import/export, inspect WebKitGTK, then `sudo apt remove varve` | ARM64 package installs and launches in the actual Crostini GUI; documents remain after uninstall; no unsupported GPU/AI/printing claim is shown | `NOT RUN` |
| Linux shared files and display | Save only to the isolated shared Files folder; test fonts, file portal, external USB-C display, rotation/resize, suspend/resume, and Linux app removal recovery | Shared-folder and portal behavior is explicit; external display/rotation does not lose geometry or work | `NOT RUN` |
| Recovery and sustained session | Reload/discard an unsaved document from `chrome://discards` if available, repeat medium open/close/model-cancel cycles, run a bounded stress fixture, then edit for 30 minutes | Latest committed checkpoint is recoverable; worker/bitmap memory plateaus; cancellation is bounded; note responsiveness/resource trend only | `NOT RUN` |

### Measurement record form

Record cold/warm startup, first editability, interaction samples and p50/p95,
long tasks, peak/plateau memory, worker count, save/export time, idle activity,
and website LCP/INP/CLS only when their method and environment are attached.
Repeat the same small/medium/stress fixture definitions. `performance.now()`,
rAF, Chrome Task Manager, and Playwright times are process-level proxies, not
physical pen-to-photon, battery, thermal, or refresh-rate measurements.

## 8. Release decision boundary

Decision: **DO NOT PROMOTE / NOT RELEASE-READY for Chromebook or Duet support.**

The website correction is ready for its scoped static-host evidence:
`IMPLEMENTED + AUTOMATED-TESTED` (`d690e30a4`, 2/2 truth tests, both website
builds, and inspected captures). Browser/PWA capabilities remain
`IMPLEMENTED + AUTOMATED-TESTED` only for the named x86/production-artifact
runs. Linux ARM64 is `IMPLEMENTED + AUTOMATED-TESTED` for package and native
runner evidence only, not Crostini GUI. The current integrated master candidate
is `FAILED` because its affected closure, current `build:try`, and full gate
fail, and all Duet-only rows are `NOT RUN`.

Do not publish, tag, deploy, change support tiers, or claim NPU acceleration,
PWA offline availability on every Chromebook, Linux GPU acceleration, printing
or ICC parity, or automatic updating from this record. The smallest next
verification is to freeze a clean master SHA after the active shared agents
reconcile the formatter/parser/type errors, rebuild `VITE_DEMO=1`, then run the
physical Duet kit on the 8 GB device with the normal security settings and
inspect every saved artifact.
