# ChromeOS Stage 1 ownership record

**Task:** `chromeos-stage1-2026-09-11`
**Coordinator:** Codex
**Started:** 2026-09-11
**Updated:** 2026-09-12
**Base SHA:** `c23e6c8dc44168bc70d1626455154232c65447c1`
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve`

## Scope owned by this task

- Stage 1 research ledger, repository audit, route decision, fixture map,
  acceptance-budget proposal, and implementation handoff.
- Bounded local-only capability reporting and its editor settings surface,
  after the documentation baseline is committed.
- ChromeOS-specific platform-support and performance documentation.

The active worktree already contained an unrelated font/input reliability batch
before this task began. Its modified and untracked paths remain owned by that
work and are not to be staged, reformatted, or committed here. In particular,
avoid `CanvasArea.tsx`, `tests/e2e/shared.ts`, font files/tests/screenshots,
and the current import/drop/menu changes unless the other owner hands them off.

## Shared interfaces and serialization boundaries

These are single-writer surfaces for later stages; Stage 1 only documents the
handoff and does not change them:

| Surface | Proposed owner for follow-up | Stage 1 contract |
|---|---|---|
| Platform capability types and probes | platform/performance owner | Report is bounded, on-demand, local-only, and separates static presence from dynamic success |
| Autosave, recovery, and storage schema | persistence owner | Preserve the existing platform facade and recovery records; no Chromebook-only schema |
| Renderer and input entry points | editor/render owner | Reuse adaptive capability gates; no UA-only route or new canvas hub imports |
| Lockfiles and package manifests | dependency owner | No dependency upgrade is justified by Stage 1 evidence |
| Service worker and PWA metadata | web/deployment owner | Treat `/try` as a deployed demo until offline install/update evidence exists |
| Support matrix and release metadata | release/docs owner | Do not promote ChromeOS or Linux ARM64 beyond evidence-backed tiers |

## Coordination rules

- Before each patch and commit, re-check `git status --short` and the owned
  paths. Stage only explicit paths listed in the current milestone.
- Serialize commits on `master`; do not rebase, reset, stash globally, or
  delete another worktree.
- Active worktrees observed at start included `integrate-brush`,
  `integrate-transform`, and `integrate-validation`, plus prunable temporary
  worktrees. They are not part of this task's ownership.
- Reserve `VARVE_E2E_PORT=1491` for any future browser run from this task.
  Do not run device/performance measurements while another agent owns the
  shared browser or native workload.
- Use `/tmp/varve-chromeos-stage1-*` for temporary reports and screenshots;
  never use a shared generated-output directory.

## Handoffs

The Stage 1 baseline is [the ChromeOS baseline audit](../audits/chromeos-stage1-baseline-2026-09-11.md).
Stages 2–7 must re-check their relevant current sources and must not treat the
proposed budgets or browser observations here as real Duet measurements. The
Duet hardware is not attached to this session, so the hardware checklist and
runtime capability report are the next verification boundary.

## Continuation: browser durability and evidence slices

**Updated:** 2026-09-12
**Current base SHA:** `4cb548cedfad306161929334d45aeac775f0c1d6`
**Current milestone:** add a scoped browser-demo service worker/update path and
close the documented hidden/freeze lifecycle gap before performance and UX
work proceeds.

Additional owned paths for this slice:

- `apps/desktop/public/manifest.json`
- `apps/desktop/public/varve-demo-sw.js`
- `apps/desktop/src/demo/demoServiceWorker.ts` and its tests
- `apps/desktop/src/demo/staleAssetGuard.ts`
- `apps/desktop/src/main.tsx`
- `packages/editor/src/lifecycle/LifecycleProvider.tsx`
- corresponding readiness ledger, support, and marketing documentation

Shared interfaces remain single-writer: the demo bootstrap/service-worker
registration, persistence and recovery entry points, release metadata, and
website support claims. No new dependencies, ports, or shared test/output
directories are reserved by this slice. Before each commit, re-check the
worktree and stage only the paths listed for the milestone; unrelated dirty
font/input work remains untouched.

## Handoff: browser offline evidence and loader boundary

**Updated:** 2026-09-12

The browser/PWA implementation is now owned by the active Stage 2 record at
[`chromeos-stage2-ownership.md`](./chromeos-stage2-ownership.md). Its worker
changes are intentionally not restaged here. The isolated engine/lifecycle
repair landed as [`ec7d3f732`](https://github.com/K-Arthur/varve/commit/ec7d3f732):

- `packages/engine/src/wasmLoader.ts` uses Cache Storage as a worker-safe
  fallback when a network fetch fails, for both the render and trace loaders;
  a missing cache entry still fails and preserves the existing fallback chain.
- `packages/engine/src/wasmLoader.test.ts` covers cached-offline and missing
  asset behavior.
- `packages/editor/src/lifecycle/LifecycleProvider.tsx` marks a non-bfcache
  browser page hide clean only when no session is dirty. This prevents ordinary
  reloads from accumulating false crash-loop failures while retaining recovery
  for dirty/discarded sessions.

Local production-artifact evidence (Linux x86_64 Chromium, localhost, fresh
profile, 2026-09-12) reached the sample document after two online reloads and
then an offline reload; `.editor-canvas` and `.layers-panel` were present and
the browser's offline banner was visible. The inspected screenshot is
`/tmp/varve-chromeos-visual/demo-offline-final.png`. This is not Duet or
ChromeOS hardware evidence. The Stage 2 owner should fold the equivalent
sequence into its isolated browser acceptance spec and repeat it on the Duet.
