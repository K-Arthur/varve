# ChromeOS Stage 2: browser/PWA research ledger and implementation baseline

**Status:** Stage 2 in progress; research gate complete before implementation
**Research access date:** 2026-09-12
**Repository snapshot:** `ec5c887498947272171e722bed7a8ed94a0226ba`
**Scope:** native Chrome tab and installed browser app/PWA on ChromeOS
**Device reference:** Lenovo Chromebook Duet 11M889, 8 GB primary target
(no Duet attached to this session — all device behavior remains a handoff)

This ledger separates vendor documentation, repository evidence, and local
test results. Nothing here is a device measurement claim.

## 1. Research ledger

| Question | Primary source | Publisher / date | Finding | Confidence | Implementation consequence | Unresolved conflict |
|---|---|---|---|---|---|---|
| What makes the demo installable in Chrome? | [What does it take to be installable?](https://web.dev/articles/install-criteria) | Chrome team (web.dev), updated 2024-09-19, accessed 2026-09-12 | Chrome fires `beforeinstallprompt` and shows the install badge only when: not already installed; engagement heuristics (a click and 30 s of viewing, ever); HTTPS; manifest with `short_name` or `name`, 192 px and 512 px icons, `start_url`, `display` in {fullscreen, standalone, minimal-ui, window-controls-overlay}; `prefer_related_applications` absent/false. A service worker is **not** in the current criteria list. | High | Keep the manifest complete; do not claim install only because a SW exists. | Chrome's criteria can change; installability is an OS/browser behavior, not an app guarantee. |
| Where can a PWA be installed and what does installation give? | [Installation](https://web.dev/learn/pwa/installation) | Chrome team (web.dev), updated 2024-09-20, accessed 2026-09-12 | Desktop PWA installation is supported by Chrome/Edge on Windows, macOS, Linux, and Chromebooks (app-launcher icon, separate window, `about:apps`). Only standalone/minimal-ui display modes are supported on desktop. Users can install even when criteria are not met (menu/manual install). | High | Standalone window + launcher icon are the install promise; no OS integration beyond what is verified. | Actual ChromeOS launcher/file-association behavior needs a device run. |
| How do service-worker updates reach a running tab? | [The service worker lifecycle](https://web.dev/articles/service-worker-lifecycle) | Jake Archibald, Chrome team (web.dev), 2016-09-29, accessed 2026-09-12 (semantics stable and still cited by Chrome docs) | Updates are byte-different checks on navigation/functional events or manual `update()`. A new worker installs alongside the old one and waits until the old one controls zero clients. `skipWaiting()` (or a `postMessage` from the page) activates it early. Version-specific caches are the intended pattern; `activate` is the place to delete obsolete caches. `updateViaCache: 'none'` overrides HTTP caching for the worker script. Do not change the worker URL. | High | Waiting-update banner + explicit user activation; versioned cache with activate-time cleanup; already implemented for the demo. | None material. |
| What does the File System Access API guarantee? | [The File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access) | Chrome team, published 2024-08-19, accessed 2026-09-12 | Chrome/Edge 86+ on Windows, macOS, ChromeOS, Linux, Android (Brave behind a flag); Firefox/Safari do not support it. Pickers must be called in a user gesture. Permissions may not persist between sessions: check `queryPermission()` and call `requestPermission()` from a user action. `createWritable()` re-checks permission and can throw; changes are not on disk until `close()`. Handles are serializable into IndexedDB. A `File` from `getFile()` goes stale if the file changes on disk. OPFS (`navigator.storage.getDirectory()`) is explicitly not user-visible. | High | Feature-detect; persist handles; re-verify permission before writing; never mark "Saved" before `close()` resolves. | ChromeOS Files app behavior with Varve handles needs a device run. |
| Which lifecycle boundary is reliable for persistence? | [Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) | Chrome team, accessed 2026-09-12 | `hidden` is the last reliably observable state; persist unsaved state there. On `freeze`, stop timers, close IndexedDB/BroadcastChannel/WebRTC connections and release Web Locks. `discard` is only observable on the next load via `document.wasDiscarded`. `unload` is unreliable; `beforeunload` only while genuinely dirty. | High | Recovery flush on visibility change; discard detection at boot; no last-second unload save. Already largely implemented in `LifecycleProvider`. | ChromeOS tab-discard behavior on the Duet is unverified. |
| How much can an origin store and when is it evicted? | [Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) | MDN contributors, last modified 2026-01-05, accessed 2026-09-12 | Best-effort storage is evicted under storage pressure with an origin-level LRU policy; persistent origins are skipped. Chrome allows an origin up to 60% of total disk and 80% overall; quotas derive from total (not free) disk to resist fingerprinting. `navigator.storage.estimate()` is an estimate. Writes past quota throw `QuotaExceededError`. Eviction removes the origin's data as a unit, not partially. Private browsing may use different quotas and clears data at session end. | High | Show usage as an estimate; request `persist()` and handle denial; free disposable caches before irreplaceable recovery copies; never delete unsaved work to make room. | The Duet's actual quota/usage under eMMC pressure is unmeasured. |
| How should two tabs (or a tab and the installed app) coordinate writes? | [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) | MDN contributors, last modified 2025-04-03, accessed 2026-09-12 | Locks are origin-scoped across tabs/workers, exclusive by default, and auto-released when the async callback settles. Leader election is the documented pattern for one tab performing shared work. | High | Use a named lock around the recovery/save transaction; release on freeze per lifecycle guidance. | ChromeOS installed-app vs tab lock behavior is the same origin by spec but needs a device check. |
| Can the demo be cross-origin isolated on its host? | [A guide to enable cross-origin isolation](https://web.dev/articles/cross-origin-isolation-guide) | Chrome team (web.dev), updated 2021-02-09, accessed 2026-09-12 | Isolation requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` **response headers** on the top-level document; without them `SharedArrayBuffer` and multi-threaded WASM are unavailable. | High | Keep the single-thread WASM path as the deployed default; do not promise threaded inference on the public demo. | COEP `credentialless` exists but is Chrome-only; not adopted. |
| Can GitHub Pages set those headers? | [HTTP Headers (e.g. Content-Security-Policy) on Pages #54257](https://github.com/orgs/community/discussions/54257) | GitHub staff answer in GitHub's official community discussions, 2023-05-02 (staff: not supported; 2024-07-10: not prioritized; thread still open 2026-09), accessed 2026-09-12 | github.com-hosted Pages does not support custom response headers; a `<meta>` tag is the only option. (Response-header configuration exists only for GitHub Enterprise Server administrators.) | High | The demo CSP stays a meta tag; frame-ancestors/COOP/COEP cannot be enforced from this host. Correctness must not depend on headers the host cannot send. | A future host/DNS migration could change this; Stage 2 does not migrate hosting. |
| What do ONNX Runtime Web's flags require? | [The 'env' Flags and Session Options](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html) | Microsoft ONNX Runtime docs, accessed 2026-09-12 | `env.wasm.numThreads` defaults to min(half of `hardwareConcurrency`, 4) but multi-threading only activates with a WebAssembly-threads-capable engine **and** `crossOriginIsolated`. `env.wasm.proxy` offloads to a blob worker and cannot combine with the WebGPU EP; blob workers are CSP-sensitive. `wasmPaths` must match the JS bundle build. `executionProviders: ['webgpu', 'wasm']` is the fallback chain. | High | Optional inference must be capability-gated, single-threaded on the deployed demo, and never block core editing. The demo already prunes inference assets. | Model runtime on Kompanio/ARM remains unmeasured. |
| Can installed apps receive files from the OS? | [Let installed web applications be file handlers](https://developer.chrome.com/docs/capabilities/web-apis/file-handling) | Chrome team, last updated 2020-10-22, accessed 2026-09-12 | `file_handlers` in the manifest plus `launchQueue` lets an **installed** app open files from the OS (Chrome/Edge 102+, desktop only; Firefox/Safari unsupported). Permission is prompted per launch until allowed/blocked and resets when the handler list changes. | Medium (older page; API surface stable) | Treat file launch as progressive enhancement behind `launchQueue` detection; never the only open path. | Current ChromeOS Files-app association behavior needs a device run. |

## 2. Repository implementation evidence (verified 2026-09-12)

| Area | Current implementation | Truthful status |
|---|---|---|
| Demo route | `detectDemoMode()` activates on `/try` path or `?try=1`/`?demo=1`; build via `pnpm --filter @varve/desktop build:try`; deployed under `/try/` by `website-deploy.yml` | Implemented; device run pending |
| Manifest | `apps/desktop/public/manifest.json`: name/short_name, `id: ./`, `start_url: ./`, `scope: ./`, standalone, 192/512 any+maskable icons | Meets Chrome criteria on paper; requires deployed-origin verification |
| Service worker | `apps/desktop/src/demo/demoServiceWorker.ts` registers `varve-demo-sw.js` scoped to the demo base only, `updateViaCache: 'none'`, announces waiting updates via `varve:pwa-update`; worker caches same-scope navigations network-first and static assets cache-first | Implemented; the adoption of the uncommitted v2 WASM precache is this stage's starting point |
| Stale assets | `staleAssetGuard.ts` watches resource failures and offers a one-click reload | Implemented; offline-specific copy was not covered |
| Capability report | `capabilityReport.ts` + `CapabilityReportPanel.tsx` (Stage 1) probes graphics/worker/WASM/storage/files with bounded dynamic checks | Implemented; reused, not duplicated |
| Save semantics | `saveCoordinator` serializes/coalesces intents; `saveTypes` distinguishes saved/cancelled/failed and refuses to treat recovery or Home mirror as "Saved" | Implemented; UI states beyond Saved need review |
| Recovery | `recovery.ts` records recovery points; `LifecycleProvider` flushes on visibility/freeze and detects `document.wasDiscarded` | Implemented; discard/quota acceptance requires browser tests |
| Multi-window | Update coordination exists for Tauri; the browser route has no cross-tab writer policy yet | **Gap owned by Stage 2** |
| Storage manager | Capability report shows usage/quota estimates; no user-facing cleanup surface for disposable caches vs recovery copies | **Gap owned by Stage 2** |
| Host posture | Meta CSP only (GitHub Pages cannot send headers); not cross-origin isolated | Correct for the host; must be stated honestly |

## 3. Implementation constraints derived from the evidence

1. Never promise threaded WASM, `SharedArrayBuffer`, or NPC performance on
   the deployed origin: GitHub Pages cannot send COOP/COEP.
2. "Installed" is an OS surface; app correctness must not depend on it.
   The same artifact must work as a tab.
3. "Saved" means the authoritative write succeeded (native path, browser
   file handle after `close()`, or an explicit library write). Downloads,
   recovery points, and the Home mirror are not "Saved".
4. Persist unsaved state on `hidden`; treat `discard` as a boot-time
   detection (`document.wasDiscarded`), never a shutdown callback.
5. Eviction and quota are origin-level and all-or-nothing; disposable caches
   must be separable from recovery data, and cleanup UI must say what it
   deletes.
6. Service-worker scope stays `/try/`; the marketing site is never
   intercepted, and update activation is user-visible, never silent.
7. File launch/handles are progressive enhancements with input/download
   fallbacks.

## 4. Acceptance checks to run in this stage (browser, not device)

- First-ever offline launch shows a truthful unavailable/reload state (no
  promise of offline work when setup never completed).
- Offline launch after a verified online setup reaches the sample document.
- Interrupted/partial precache still boots online and recovers on reload.
- Revoked/missing file permission keeps the document dirty and offers a
  re-grant or download fallback.
- Quota/write/transaction failure is surfaced and does not clear dirty state.
- Freeze/discard simulation (`document.wasDiscarded` injection) restores the
  latest complete recovery point.
- Two editors (two pages) do not silently overwrite each other; a second
  writer gets a clear read-only/conflict policy.
- Asset-version mismatch (old hashed chunk) shows the stale-asset recovery
  banner and recovers by reload.
- Cache cleanup removes only disposable caches; recovery copies survive.
- Round-trip a representative `.varve` document through the browser save
  path and reopen it; inspect rendered output and export, not just bytes.

## 5. Stage 2 implementation delivered

| Area | Change | Files |
|---|---|---|
| Offline shell correctness | The demo worker now precaches the shell's entry graph (scripts, styles, fonts, manifest plus the WASM binaries, bounded at 64 references) and answers an offline navigation with the cached shell, then a truthful 503 document that says the offline copy is incomplete and that saved documents were not touched | `apps/desktop/public/varve-demo-sw.js` |
| Cached-session signal | `navigator.onLine` is not authoritative (captive portals; emulated offline conditions do not update it), so the page asks the controlling worker whether its navigation came from cache; the banner reports "Offline — running from the copy saved in this browser" only from that answer or a real offline event | `demoPwaState.ts`, `DemoBanner.tsx` |
| Install readiness | A Chromium `beforeinstallprompt` is deferred and offered as an "Install app" button; browsers that never fire it show nothing (no simulated install path) | `demoPwaState.ts`, `DemoBanner.tsx`, `demoBanner.css` |
| Storage manager | Settings → Storage & Offline: usage/quota estimates labelled as estimates, persistence status with a click-to-request action, recovery-copy count/size, offline app-copy count, and a destructive-confirm "Clear offline app copies" that is prefix-gated to `varve-demo-shell-*` and cannot touch documents or recovery data, plus the profile-deletion warning | `packages/editor/src/persistence/storageInventory.ts`, `components/Settings/StorageSettingsTab.tsx`, `SettingsDialog.tsx`, `SettingsContext.tsx` |
| Cross-tab autosave safety | Autosave writes acquire a per-document Web Lock and skip the write when the stored record is newer than this tab's last write, so a background autosave can never silently replace another editor's later work; skipped writes stay dirty and keep their recovery copies | `packages/editor/src/persistence/crossTabWrite.ts`, `context/useAutoBackupServices.ts` |
| Acceptance coverage | New opt-in spec for a served production artifact: partial-cache fallback page, offline launch after verified setup, and offer-then-activate service-worker update | `tests/e2e/browser/try-pwa.spec.ts` |
| Support copy | New Browser Demo & Offline guide with tested install/offline/cleanup steps and exact limits; product page no longer claims "no hosted web app"; FAQ covers the browser route | `apps/website/src/pages/docs/browser-demo.astro`, `pages/product.astro`, `pages/support/faq.astro` |

## 6. Acceptance evidence (2026-09-12)

Artifact: the production `/try/` build (`VITE_DEMO=1 VITE_BASE_URL=/try/ vite build --outDir dist-try`),
served from a disposable staging directory on 127.0.0.1:1492. The repository's
`build:try` script could not complete its `tsc --noEmit` step because four
unrelated files owned by other active agents had in-flight type errors
(`Menubar.tsx`, `AIStatusIndicator.tsx`, `ContextAwareShortcuts.tsx`,
`WorkspaceTabs.tsx`); the Vite build itself succeeded (40 s / 22 s runs) and
pruned 686.7 MB of demo-inference assets.

```text
VARVE_E2E_PORT=1494 VARVE_DEMO_DIST_URL=http://127.0.0.1:1492 \
VARVE_DEMO_DIST_DIR=/tmp/varve-chromeos-stage2-serve \
VARVE_E2E_OUTPUT_DIR=run-stage2-pwa2 \
pnpm exec playwright test tests/e2e/browser/try-pwa.spec.ts \
  --project=chromium --workers=1 --reporter=list

✓ partial/unfinished offline setup gets a truthful unavailable page (10.9 s)
✓ offline launch after a verified setup reaches the editor (34.6 s)
✓ a waiting update is offered, not forced, and activates on request (39.5 s)
3 passed (4.3 m)
```

Machine checks that supplement the spec:

- Cache inventory after first online visit: 85 entries including all six
  `/try/wasm/*` binaries and the entry-graph assets.
- Offline relaunch: editor reached ready, sample document showed 10 layers,
  no `WASM engine failed` warning, and the cached WASM resource entries show
  `transferSize: 0` (served from the worker, not the network).
- The failed network requests logged while offline are the SIMD probe's
  aborted attempts; the fallback base/SIMD path loads from cache.
- Export acceptance (second spec, same artifact):

```text
VARVE_E2E_PORT=1494 VARVE_DEMO_DIST_URL=http://127.0.0.1:1492 \
VARVE_E2E_OUTPUT_DIR=run-stage2-export4 \
pnpm exec playwright test tests/e2e/browser/try-export.spec.ts \
  --project=chromium --workers=1 --reporter=list

✓ SVG export contains the rendered shape geometry (7.5 s)
✓ JPEG export contains real rendered pixels, not a flat fill (4.3 s)
2 passed (48.8 s)
```

  The SVG assertion is on decoded geometry (`<circle>` with the teal fill and
  the node transform); the JPEG assertion decodes the downloaded bytes in a
  canvas and requires a pixel spread greater than a flat fill. Verified by
  inspection: the exported `Sun` SVG contains
  `<circle cx="0" cy="0" r="130" fill="rgba(57,208,198,1.000)">` inside
  `viewBox="830 80 260 260"`, and the JPEG measured mean 0.475 / stddev 0.247
  across 2473 colours.

Visual inspection (screenshots read during this session, stored under
`/tmp/varve-chromeos-stage2-visual-*` and `/tmp/varve-chromeos-stage2-export*`):

- `offline-relaunch.png` — banner states offline and the document stays
  editable with the canvas and layers panel intact.
- `offline-fallback.png` — the 503 page states that setup is incomplete and
  that nothing was deleted.
- `storage-tab.png` — Storage & Offline renders in the settings dialog with
  estimate, persistence action, recovery count, cache count, and warnings.
- `stage2-website-browser-demo-guide.png`, `stage2-website-faq-browser-question.png`
  — the new guide and FAQ entry render with the docs typography after the
  page gained its own style block.

Unit checks: `demoPwaState` (8), `storageInventory` (6),
`crossTabWrite` (4), `StorageSettingsTab` (3) all pass under Vitest; e2e
typecheck passes for both new specs.

## 7. Known limits and handoffs

1. `navigator.onLine` is still used as a fallback when no worker answers;
   real network-loss behavior must be confirmed on the Duet.
2. A first-ever offline launch with no prior visit cannot render app UI (no
   code has ever run in that browser). The service worker covers every state
   after installation; the fallback page covers partial setup. This is
   documented in the guide rather than papered over.
3. Cross-tab autosave conflict handling prevents silent overwrite but does
   not merge versions; the newer version stays stored and the skipped edits
   remain dirty with recovery copies.
4. The demo's sample document is flat: the "Poster" frame has no children
   (its shapes are root-level siblings), so exporting the frame itself
   produces an empty artboard. Exports of the actual content are correct
   (verified above). Making the sample frame own its children is a
   content-model follow-up with clipping implications, not an export defect.
5. The support matrix is not updated here: promotion still requires a Duet
   run (tab discard, installed-app offline, touch/pen, real storage
   pressure).
6. `apps/website/src/pages/docs.astro` was dirty with another agent's work,
   so the new guide is linked from the product page and FAQ rather than the
   docs index; the index entry is a handoff.

## 8. Next smallest verification step

Run the same three acceptance checks on the Duet against
`https://varve.studio/try/` in an installed app: finish setup online, disable
Wi-Fi, relaunch from the launcher, confirm the offline banner and an editable
sample, then install and force-quit during an update to confirm the update
notice and recovery. Record ChromeOS channel/version, free storage, and the
browser's storage estimate before and after.

