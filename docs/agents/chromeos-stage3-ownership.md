# ChromeOS Stage 3 ownership record

**Task:** `chromeos-stage3-2026-09-12` (rendering, responsiveness, memory, slow
storage, optional AI)
**Coordinator:** opencode (graphics/performance session)
**Started:** 2026-09-12
**Updated:** 2026-09-12
**Base SHA:** `c4e16a7f763887b2f1feb64a20e7c5c621da307e`
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
| `packages/editor/src/canvas/adaptiveProfile.ts` (+ its test) | Truthful adaptive profile |
| `packages/editor/src/canvas/viewportPrefetch.ts` (+ test) | Profile-gated idle prefetch, hidden suspension |
| `packages/editor/src/canvas/memoryBudget.ts` (only if byte budgeting is needed) | Existing budget authority |
| `packages/editor/src/render/offscreenCapabilityProbe.ts` | Probe lifecycle/revalidation if evidence requires |
| `packages/editor/src/performance/capabilityReport.ts` (+ test) | Extend the Stage 1 report, do not duplicate |
| `packages/engine/src/upscaleProviders/aiUpscale.ts` and related provider tests | Real provider gating, cancellation, disposal |
| `packages/editor/src/components/Settings/PerformanceSettingsTab.tsx` + `settings.ts` (only if a user override is required) | Existing settings system |
| `tests/e2e/canvas/` or `tests/e2e/browser/` new spec files | Acceptance + visual evidence |
| `apps/website/src/pages/docs/browser-demo.astro`, `support/faq.astro`, `product.astro` | Evidence-backed marketing copy |

**Deliberately not owned:** `packages/editor/src/CanvasArea.tsx`,
`Shell.tsx`, `context.tsx` (hub import ceilings and active writers); Stage 2
persistence/recovery/service-worker files; Stage 5 website files
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
- Reserve `VARVE_E2E_PORT=1496` for browser runs from this task (1491/1492
  Stage 1/2, 1493 Stage 5, 1494 used by Stage 2 evidence, 1495 occupied;
  1420/1481 other agents). Do not run heavy suites while other agents'
  vitest/Playwright jobs are active.
- Stage 4 (input/responsive) owns `apps/website/src/pages/docs/browser-demo.astro`,
  `apps/website/src/pages/support/troubleshooting.astro`, and
  `tests/e2e/interaction/*`. Stage 3 uses `product.astro`,
  `tests/e2e/canvas/*`, and `docs/audits/chromeos-stage3-*` instead.
- Temporary evidence lives in `/tmp/varve-chromeos-stage3-*`; only distilled
  results are committed.
- Paired measurements only: same build, viewport/DPR, machine load, and power
  state; no comparative numbers taken while another agent's workload runs.

## Handoffs

- Duet hardware run: pen/touch pan/zoom, sustained editing, hidden/freeze
  behavior, real storage-pressure autosave, and installed-app performance.
- Support-matrix tier promotion is not claimed here.
- Stage 5 Linux ARM64 remains independent.
