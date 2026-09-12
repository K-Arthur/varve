# ChromeOS Stage 2 ownership record

**Task:** `chromeos-stage2-2026-09-12` (browser/PWA delivery, offline
operation, document safety)
**Coordinator:** opencode (browser platform / PWA / reliability session)
**Started:** 2026-09-12
**Updated:** 2026-09-12
**Base SHA:** `ec5c887498947272171e722bed7a8ed94a0226ba`
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve`

## Scope owned by this task

Stage 2 of the user-requested ChromeOS decomposition: the native Chrome
browser tab and installed browser app/PWA route.

- Browser capability and core-feature parity: trace the browser build end to
  end, repair native-only paths through existing platform adapters, and give
  feature-specific unavailable states instead of silent drops.
- Installability and deployment: manifest identity/scope/start URL, the
  demo service worker and its bounded caches, offline behavior, and honest
  response-header posture.
- Saving, recovery, and low-space behavior: save-status truthfulness,
  recovery points, storage visibility/cleanup, and quota/denial handling.
- Updates and multiple windows: SW update control, deferral while dirty, and
  cross-tab/installed-app single-writer coordination.
- Browser acceptance E2E and visual evidence for the states above.
- Documentation of exact runtime limits and tested install/offline steps,
  plus the marketing-website copy that depends on them.

This is the browser route only. Linux ARM64 on ChromeOS Linux remains the
Stage 5 task; Duet hardware validation remains a handoff (no Duet is attached
to this session).

## Files owned (one writer at a time)

| Path | Purpose |
|---|---|
| `docs/agents/chromeos-stage2-ownership.md` | This record |
| `docs/audits/chromeos-stage2-browser-pwa-2026-09-12.md` | Research ledger, findings, acceptance evidence, remaining gaps |
| `apps/desktop/public/manifest.json` | PWA identity/scope/start URL/icons |
| `apps/desktop/public/varve-demo-sw.js` | Demo-scoped service worker |
| `apps/desktop/src/demo/demoServiceWorker.ts` and its test | Registration/update wiring |
| `apps/desktop/src/demo/staleAssetGuard.ts` | Stale-asset/offline recovery surface |
| `apps/desktop/src/main.tsx` | Only if demo wiring requires it |
| `packages/editor/src/components/StatusBar/SaveStatusIndicator.tsx` | Save-status truthfulness |
| `packages/editor/src/persistence/**` | Save/recovery state machine if needed |
| `README.md` | Browser route wording if it contradicts tested behavior |
| `tests/e2e/browser/try-pwa.spec.ts` (new) | Offline/install/update acceptance |
| `tests/e2e/browser/browser-readiness.spec.ts` | Comment correction only |
| `apps/website/src/pages/docs/browser-demo.astro` (new) | Tested install/offline steps |
| `apps/website/src/pages/support/faq.astro` | Browser/PWA answers |

**Deliberately not owned:** `packages/editor/src/Shell.tsx`,
`CanvasArea.tsx`, `context.tsx` (hub import ceilings and active writers);
`docs/release/platform-support-matrix.md` and the Stage 5 website files
(`docs/chromeos-linux.astro`, `download.astro`,
`support/troubleshooting.astro`, `docs/getting-started.astro`) belong to the
Stage 5 record; the modified font/clipboard/generative/UI-visual paths in the
worktree belong to their active agents.

## Shared interfaces and single-writer surfaces

| Surface | Stage 2 contract |
|---|---|
| Service worker + PWA metadata | One writer (this task). Scope stays `/try/`; no marketing-route interception. |
| Save semantics and recovery records | Preserve the existing platform facade and `saveCoordinator`/`recovery` contracts; no Chromebook-only schema or key. |
| Platform capability probes | Reuse `capabilityReport.ts` (Stage 1 output); no second probe system. |
| Hub files | No new imports to `Shell.tsx`/`CanvasArea.tsx`/`context.tsx`. |
| Release/support wording | Evidence-tier updates to the support matrix are a handoff, not an edit; website copy may state only what was tested. |
| Lockfiles/package manifests | No dependency upgrade in Stage 2 unless a verified platform requirement forces it. |

## Coordination rules

- Other agents are active in this worktree (font lifecycle, clipboard,
  workspace layout, UI visual optimization). Before each patch and commit,
  re-check `git status --short`, preserve their changes, and stage only the
  paths listed above.
- Serialize commits on `master`; no rebase, reset, global stash, history
  rewrite, force-push, or worktree removal.
- The worktree contained an uncommitted Stage 1 continuation change to
  `apps/desktop/public/varve-demo-sw.js` (bounded WASM precache, cache v2).
  Stage 2 adopts that change as its PWA starting point rather than
  overwriting or discarding it; it is committed as part of the service-worker
  milestone.
- Reserve `VARVE_E2E_PORT=1492` for browser runs from this task. Do not use
  1420/1481/1491 (other agents) and do not run heavy suites while their
  vitest/Playwright jobs are active.
- Temporary evidence lives in `/tmp/varve-chromeos-stage2-*`; only distilled
  results are committed.

## Handoffs

- Duet hardware run: first-ever offline, installed-app offline, pen/touch,
  and tab-discard behavior must still be confirmed on the device.
- Support-matrix tier promotion is not claimed here.
- The Stage 5 Linux ARM64 route remains independent.
