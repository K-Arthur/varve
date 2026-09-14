# ChromeOS Stage 3 ownership record

**Task:** `chromeos-stage3-2026-09-12` (rendering, responsiveness, memory, slow
storage, optional AI)
**Coordinator:** codex /root
**Started:** 2026-09-12
**Updated:** 2026-09-12
**Base SHA:** `0a1ef3d9010f4f4a117c01453c8ef7f498bdd9eb`
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (explicit
user instruction: work on `master`, not a new branch)

## Scope owned by this task

Stage 3 of the user-requested ChromeOS decomposition: rendering,
responsiveness, memory, slow storage, and optional AI for the browser route on
the 8 GB Lenovo Chromebook Duet 11M889 (and graceful behavior on 4 GB / x86
Chromebooks).

- Diagnose startup and benchmark operations through input, state, geometry,
  renderer, compositing, image decode, background work, autosave, and export
  on a production build before optimizing.
- Make the adaptive profile's declared render-scale / cache / prefetch / decode
  fields truthful: wire them to the real hot path or remove/mark them.
- Safe adaptive rendering: capability-gated probes, correct no-WebGPU path,
  reversible degradation, full-fidelity settled output and export.
- Scheduling and memory: bounded background work, cancellation, stale-result
  rejection, hidden/idle suspension, byte-bounded caches.
- Slow storage: measure and reduce unnecessary write amplification in the
  existing persistence contract (Stage 2 owns the durability contract itself).
- Optional AI: lazy informed downloads, real provider capability tests, no
  silent cloud fallback, cancellation and disposal, honest unavailable states.

This is the browser route only. Linux ARM64 on ChromeOS Linux is the Stage 5
task; Duet hardware validation remains a handoff (no Duet attached to this
session). No second performance manager: all changes extend the existing
`adaptiveProfile` / `frameScheduler` / `capabilityReport` / persistence systems.

## Files owned (one writer at a time)

| Path | Purpose |
|---|---|
| `docs/agents/chromeos-stage3-ownership.md` | This record |
| `docs/audits/chromeos-stage3-rendering-ai-2026-09-12.md` | Research ledger, diagnosis, evidence, limits |
| `packages/editor/src/performance/frameCadence.ts` (+ test) | Conservative visible-rAF cadence estimator |
| `packages/editor/src/performance/frameScheduler.ts`, `editorFrameRuntime.ts` | Dynamic frame budgets and lifecycle wiring |
| `packages/editor/src/canvas/frameBudget.ts`, `adaptiveProfile.ts` (+ tests) | Class-tail adaptive policy |
| `packages/platform/src/derivedWorkAdmission.ts` (+ test) | Shared bounded disposable-work admission |
| `packages/editor/src/thumbnail/`, `packages/engine/src/rasterPyramid/`, `packages/platform/src/semanticEmbeddingQueue.ts` | Lease integration; preserve queue semantics |
| `packages/editor/src/render/adaptiveResidency.ts`, image/worker budget adapters, compositor GPU cleanup | Actual resource accounting and release |
| `packages/platform/src/web-db.ts`, `packages/platform/src/web.ts` (+ tests) | Browser metadata sidecar and lazy DB lifecycle |
| `packages/editor/src/recovery.ts`, `autoSaveService.ts` (+ tests) | Indexed recovery index and serialized recovery path |
| `packages/engine/src/inference/` and provider tests | Qualification, bounded fallback, session disposal (after handoff) |
| `packages/editor/src/components/Settings/` (only if existing controls need wiring) | Existing settings integration |
| `tests/e2e/canvas/`, `tests/e2e/browser/` new specs | Acceptance, pixel oracle, visual evidence |
| `apps/website/src/pages/product.astro`, clean performance/support docs | Evidence-backed marketing copy |

**Deliberately not owned:** `packages/editor/src/CanvasArea.tsx`,
`Shell.tsx`, `context.tsx` (hub import ceilings and active writers); service
worker files; Stage 5 website files
(`docs/chromeos-linux.astro`, `download.astro`, `support/troubleshooting.astro`);
the modified font/clipboard/generative/UI paths in the worktree belong to their
active agents. AI model registry paths under `packages/ai` and
`packages/engine/src/generativeEdit` may be read, but edits there require a
checked-in first-writer handoff because other agents have uncommitted work in
that area at this snapshot.

## Shared interfaces and single-writer surfaces

| Surface | Stage 3 contract |
|---|---|
| Adaptive profile | One authority (`computeProfile`); new fields must be consumed by a hot path or removed. No parallel quality manager. |
| Frame scheduler | Extend `frameScheduler`/`editorFrameRuntime`; no new rAF loop, no new polling timer. |
| Capability reporting | Extend `capabilityReport.ts` (Stage 1); no second probe system or fingerprint. |
| Persistence/recovery | Preserve Stage 2 durability contract; no Chromebook-only schema. |
| Hub files | No new imports to `Shell.tsx`/`CanvasArea.tsx`/`context.tsx`. |
| AI providers | Native-first chain unchanged; no silent paid/cloud fallback; no NPU claim. |
| Lockfiles/package manifests | No dependency upgrade unless a verified platform requirement forces it. |

## Coordination rules

- Other agents are active in this worktree. Before each patch and commit,
  re-check `git status --short`, preserve their changes, and stage only the
  paths listed above.
- Serialize commits on `master`; no rebase, reset, global stash, history
  rewrite, force-push, or worktree removal.
- Reserve `VARVE_E2E_PORT=1498` for browser runs from this task when free;
  otherwise use the first free port in `15000-15009`. Do not run heavy suites
  while another workload is active.
- Stage 4 owns `apps/website/src/pages/docs/browser-demo.astro`,
  `apps/website/src/pages/support/troubleshooting.astro`, and
  `tests/e2e/interaction/*`. Stage 3 uses clean performance/product paths,
  `tests/e2e/canvas/*`, and `docs/audits/chromeos-stage3-*` only after handoff.
- Temporary evidence lives in `/tmp/varve-chromeos-stage3-<base-sha>/`; only
  distilled results are committed.
- Paired measurements only: same build, viewport/DPR, machine load, and power
  state; no comparative numbers taken while another agent's workload runs.

## Handoffs

- Duet hardware run: pen/touch pan/zoom, sustained editing, hidden/freeze
  behavior, real storage-pressure autosave, and installed-app performance.
- Support-matrix tier promotion is not claimed here.
- Stage 5 Linux ARM64 remains independent.
- The v6 browser database is forward-only. A v6-aware legacy mode is the
  rollback path; an unmodified v5 client cannot open a higher-version IDB.

## Stage 3 continuation (2026-09-13)

**Task:** `chromeos-stage3-continuation-2026-09-13`
**Coordinator:** opencode (graphics/performance continuation session)
**Base SHA:** `fbfb56f38`
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (explicit
user instruction: work on `master`, not a new branch)
**Updated:** 2026-09-13

Scope: close the Stage 3 open items that can be resolved without Duet
hardware, add the user-requested failure-mode research (what comparable
products get wrong on constrained devices), refresh the marketing and
performance-guide copy that depends on rendering/storage behavior, and re-run
browser visual acceptance with the pixel oracle actually enabled.

Newly owned (one writer at a time):

| Path | Purpose |
|---|---|
| `packages/editor/src/backupService.ts` (+ new test) | Skip identical automatic backups; record the saved snapshot on `markSaved` |
| `packages/editor/src/context/useAutoBackupServices.ts` (+ new test) | One recovery write per untitled autosave |
| `packages/platform/src/storageWriteMetrics.ts` | Extend logical write counters to recovery and backup writes |
| `packages/platform/src/web.ts` (+ new test) | Reclaim orphaned `fileContent`/`versionContent` on permanent delete |
| `packages/editor/src/canvas/viewportPrefetch.ts` (+ test) | REMOVE dead code (decision recorded) |
| `apps/website/src/pages/product.astro`, `apps/website/src/pages/docs/performance.astro` | Evidence-backed performance copy |
| `docs/architecture/image-lifecycle.md` (one row) | Prefetch row status |
| `docs/audits/chromeos-stage3-rendering-ai-2026-09-12.md` | Continuation ledger and evidence |

Still not owned: `context.tsx`, `CanvasArea.tsx`, `Shell.tsx`; other agents'
in-flight font/clipboard/shape/colorization paths (including the uncommitted
`packages/engine/src/inference/*` edits, which are read-only to this
continuation); Stage 5 website files.

Decisions recorded in this continuation:

- `viewportPrefetch.ts` is deleted rather than wired: it has no consumer and
  no measured benefit, and a real prefetch must be designed against the
  residency byte budget (`adaptiveResidency.ts`) and the finite worker image
  budget. `adaptiveProfile` no longer claims prefetch fields.
- Automatic backups are deduplicated by content. The prior behavior rewrote a
  full-document backup every five minutes for unchanged JSON because
  `markSaved` had no caller. Dedup fixes the write amplification without a
  new hub-file import.
- The per-edit `serializeDocument()` in `context.tsx` (the backup snapshot
  feed) stays as a checked-in follow-up: a lazy `markDirty(() => string)`
  change belongs in that file with its active writers, not in this run.
- `adaptive-residency.spec.ts` is corrected to enable `?perf=1`; its
  `forceFullRedraw` oracle previously compared a hash to itself because the
  perf handle was never installed.

Reserved port remains `VARVE_E2E_PORT=1498`, fallback the first free port in
`15000-15009`.

### Continuation progress (2026-09-13)

Delivered on `master`:

- `88b581e1d` — one recovery write per untitled autosave (previously two
  full-document writes per cycle); recovery/backup writes are counted and
  exposed through `__varvePerf.storageWrites()`.
- `1f0fe5c3c` — identical automatic backups are skipped; `markSaved` records
  the saved snapshot. Direct BackupService tests added.
- `04a626bec` — `purgeFile`/`deleteVersionInfo` reclaim orphaned
  `fileContent`/`versionContent` once the last reference is gone.
- `cc5e5f52c` — removed the unreferenced `viewportPrefetch.ts` helpers;
  image-lifecycle status corrected.
- `40d942efa` — product-page performance copy on constrained-device failure
  modes plus regenerated, inspected visual baselines.
- `f7535e09b` (another writer's commit) — the lower-memory performance
  guide's "Failure modes Varve deliberately avoids" section was captured
  while that shared file was committed for accelerator copy; content verified
  present.
- Pending: `tests/e2e/canvas/adaptive-residency.spec.ts` enables `?perf=1`
  and asserts the seam exists so its `forceFullRedraw` oracle is real; the
  change passed the production-artifact E2E run recorded in the audit §8.2,
  but its commit is blocked by the shared-tree `typecheck:e2e` gate failing
  on another writer's in-flight `packages/engine/src/backgroundRemoval/maskDecode.ts`
  (`Uint8Array<ArrayBufferLike>` vs `BlobPart`, TS2322). Retry after the
  owning writer lands.

Validation actually run, exact commands, and the shared-worktree blockers are
recorded in the audit's §8.
