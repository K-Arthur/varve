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

## 5. Next smallest verification step

Run the new browser acceptance spec against the production demo build on an
isolated port, inspect the captured screenshots, then repeat the offline and
multi-tab checks on the Duet itself before any support-tier wording changes.
