# Architecture Health Remediation — Round 2

**Project:** Strata architecture health
**Started:** 2026-07-26
**Purpose:** Context-recovery tracker for the second triage→remediation cycle. Previous
round (2026-07-14, `docs/plans/triage-remediation.md`) broke 13 dependency cycles,
extracted MotionContext/PrototypeContext/CanvasOverlays/DnDShell, added COMPLEXITY
comments, and installed the identity-based cycle ratchet. This round addresses what
remains: the 4-file scene runtime cycle, EditorProvider complexity reductions,
CanvasArea overlay/handler extraction, Menubar trim, secondary hotspots, and the
broken architecture baselines.

---

## Phase 0 — Tooling repair & re-baseline ✅ COMPLETED

**Date:** 2026-07-26~27
**Status:** Done

- [x] Merge `perf/canvas-responsiveness` (6 perf commits) into master via fast-forward
  — EF987FABEF987FAB
- [x] Repair `.architecture-baseline.json`: re-run `--cycles --complexity --update` to
  populate previously-empty cycles/complexity sections (was corrupted by bare `--update`)
- [x] Update `.health-baseline.json` hub file budgets to current values
- [x] Sync `audit-architecture.mjs` hardcoded budgets to match aligned values
- [x] Record Menubar (14 imports vs budget 13) and context.tsx (64 vs budget 60) as
  over-budget known violations
- [x] Update AGENTS.md baseline tables to current measurements
- [x] Create this tracker doc
- [x] Full regression gate passes

**Key decisions:**
- CanvasArea max_imports set to 42 (at limit — zero headroom for new imports)
- Menubar budget set to 13 (current 14 is over — will be fixed in Phase 5)
- context.tsx max_complexity ceiling reduced (jcodemunch per-function 1289 vs repo
  file-total 844); AGENTS.md updated to reflect file-total as the canonical measure

**Files Modified:**
- `.architecture-baseline.json` — regenerated with proper cycles/complexity data
- `.health-baseline.json` — updated hub file lines/imports/max values
- `scripts/audit-architecture.mjs` — hub file budgets aligned with .health-baseline
- `AGENTS.md` — baseline tables, instability data, branch recovery note
- `docs/plans/architecture-health-remediation-2026-07-26.md` — created (this file)

**Commit:** `chore(audit): repair architecture baselines, align budget sources, update AGENTS.md`

---

## Phase 1 — Safe cleanup

**Status:** ⏳ PENDING

- [ ] `git rm -r apps/desktop/ui/spike/` (tracked, zero references — verified)
- [ ] Delete `scripts/diagnostics/*.mjs` (untracked/gitignored scratch — verified safe)
- [ ] **Do NOT touch** `apps/desktop/public/models/quantized/*` (model reports are
  CI-consumed provenance artifacts, not dead code)
- [ ] Verify: `pnpm typecheck && pnpm test --filter @strata/editor` passes
- [ ] Gate: `pnpm format && pnpm typecheck && pnpm lint && pnpm test && pnpm audit:emoji && pnpm audit:tokens`

**Files Modified:**
- `apps/desktop/ui/spike/index.html` — deleted
- `apps/desktop/ui/spike/spike.css` — deleted
- `apps/desktop/ui/spike/spike.js` — deleted
- `scripts/diagnostics/*.mjs` — deleted (if gitignored, just rm from filesystem)

**Commit:** `chore(cleanup): remove spike prototype and diagnostic scratch scripts`

---

## Phase 2 — Break the real scene runtime cycle

**Status:** ⏳ PENDING

**Problem:** The only genuine runtime cycle: `document.ts` ↔ `document-components` /
`document-nodes` / `document-pages`. `document.ts` value-re-exports from all three
submodules; they value-import helpers back (`cryptoId`, `makeGroupNode`, `devValidate`,
`getParent`, `removeNode`).

**Fix:**
1. Extract the shared helpers into `packages/scene/src/document-internal.ts` (leaf —
   imports `types.ts` / `node-id.ts` only)
2. The three submodules import from `document-internal.ts` instead of `./document`
3. `document.ts` keeps its value re-exports (public API unchanged — 36+ importer files
   unaffected)

- [ ] Create `packages/scene/src/document-internal.ts`
- [ ] Update `document-components.ts`, `document-nodes.ts`, `document-pages.ts` imports
- [ ] Verify: `pnpm typecheck && pnpm test --filter @strata/scene` + madge scene ≤0 cycles
- [ ] Update `docs/quality/cycles.md` with new edge map
- [ ] Run `node scripts/audit-architecture.mjs --cycles --update` to shrink the allowlist
- [ ] Full gate + `node scripts/audit-architecture.mjs --ci`

**Note:** This fixes the scene's 4 reported cycles at once (they're all variants of the same
document-submodule import pattern).

**Files Modified:**
- `packages/scene/src/document-internal.ts` — created
- `packages/scene/src/document-components.ts` — imports repointed
- `packages/scene/src/document-nodes.ts` — imports repointed
- `packages/scene/src/document-pages.ts` — imports repointed
- `docs/quality/cycles.md` — edge map updated

**Commit:** `refactor(scene): break document.ts 4-cycle runtime submodule cycle`

---

## Phase 3 — EditorProvider continued extraction

**Status:** ⏳ PENDING

**Problem:** context.tsx file-total 844 vs ceiling 847 (99.7% — effectively frozen). 39
caller test files. 64 imports vs budget 60.

**Approach:** Continue the established patterns (hook-ordering invariance for hook
extractions; `onReady` pattern for sub-context extractions), one extraction per commit.
Each extraction must reduce file-total or import count.

**Candidates (verify at execution time — pick the largest cohesive cluster not yet
extracted):**
- Workspace-mode logic (activeMode, mode switching, workspace state)
- Audit/Intelligence state (findings, action tracker, cognitive load)
- AI/Actions state (AI panel, generative fill, action logging)
- Export state (export format, quality, config)

**Per-extraction protocol:**
1. Identify all hook dependencies (must be called after all hooks it depends on,
   before `value` useMemo)
2. Create hook in `context/useX.ts` or sub-context in `context/XContext.tsx`
3. Add to `context/index.ts` barrel
4. Move return values into `value` useMemo deps
5. Update COMPLEXITY header comment after each extraction
6. Gate: `pnpm typecheck && pnpm test --filter @strata/editor` (39 caller files)
7. If sub-context: follow the `onReady` pattern from MotionContext.tsx

- [ ] Extraction 1: [workspace mode / intelligence / AI — verify largest cluster at runtime]
- [ ] Update COMPLEXITY header
- [ ] Gate passes
- [ ] Extraction 2: [next largest]
- [ ] Gate passes

**Target:** context.tsx file-total ≤700, imports ≤60. EditorProvider per-function
(repo-count) under 200 component ceiling.

**Commit:** one per extraction — `refactor(editor): extract X from EditorProvider`

---

## Phase 4 — CanvasArea extraction (perf-gated)

**Status:** ⏳ PENDING

**Problem:** CanvasArea 964 jcodemunch / ~780 repo file-total vs 630 ceiling (124% —
significantly over). 42 imports at hard limit (zero headroom). 2,819 lines.

**Extractions (verify which are still inline at execution time):**
1. `buildToolCtx` → `canvas/buildToolCtx.ts` (pure data, no hooks — low risk, high value)
2. Remaining inline overlays → `CanvasOverlays.tsx` (pure JSX extraction)
3. `replaySubtreeToCtx` → **ONLY if benchmark-proven.** Protocol:
   - Baseline: `renderPath.bench.ts` at 100/1k/10k/50k nodes, full-frame + incremental
   - Extract with explicit `ReplayContext` parameter
   - Re-benchmark; if any metric regresses beyond 1.5x ratio gate — **revert commit**
   - Playwright E2E `tests/e2e/canvas/tools.spec.ts` before and after

- [ ] Extraction 1: buildToolCtx verification/extraction
- [ ] Playwright E2E canvas tools spec passes
- [ ] Extraction 2: overlay consolidation
- [ ] [If attempted] replaySubtreeToCtx: benchmark evidence in commit message
- [ ] Gate: standard + `audit-architecture.mjs --ci` + Playwright E2E

**Target:** CanvasArea file-total ≤700, imports ≤42 (removal-for-removal rule).

**Commit:** one per extraction — `refactor(canvas): extract buildToolCtx / overlays from CanvasArea`
(+ `perf:` prefix if replay extraction lands with benchmarks)

---

## Phase 5 — Menubar trim

**Status:** ⏳ PENDING

**Problem:** 240 complexity, 14 imports vs budget 13, component over ceiling (275
jcodemunch / component ceiling 200). OverBudget in CI.

**Fix:** Extract one cohesive menu-section or dialog into `menu/` module. Verify
ActionRegistry delegation is complete (handleAction residual switch fully migrated).

- [ ] Verify/extract dialog or menu-section module
- [ ] Verify ActionRegistry covers all handles
- [ ] Gate: `pnpm test --filter @strata/editor` (Menubar.test.tsx)
- [ ] Run `--update` to shrink baseline (imports ≤13, overBudget=false)

**Files Modified:**
- `packages/editor/src/menu/*` (extracted section)
- `packages/editor/src/Menubar.tsx` (imports reduced)
- `packages/editor/src/actions/registerAll.ts` (if unfinished migration)

**Commit:** `refactor(menubar): trim import count and complete ActionRegistry migration`

---

## Phase 6 — Secondary hotspots

**Status:** ⏳ PENDING (as capacity allows — each independent)

Each commit targets one function; same extraction discipline.

- [ ] HomeShell (cyclo 150) — extract sub-sections
- [ ] createMemoryPlatform (cyclo 177) — split factory into domain modules
- [ ] createWebPlatform (cyclo 155)
- [ ] BackgroundRemovalSection (cyclo 151)
- [ ] replayIr (cyclo 112) — **ONLY with benchmark** (same protocol as Phase 4)
      If skipped, record decision here.

**Commit:** one per function — `refactor(home): extract X from HomeShell`, etc.

---

## Phase 7 — Closeout

**Status:** ⏳ PENDING

- [ ] Re-run full 9-step triage (fresh jcodemunch index)
- [ ] Diff before/after; record improvement in tracker
- [ ] Regenerate baselines:
  - `node scripts/audit-architecture.mjs --update --all`
  - `node scripts/audit-health.mjs --update`
  - [If relevant] `scripts/audit-render-perf.mjs` → `.render-perf-baseline.json`
- [ ] Update `docs/agents/session-history.md` with round-2 entry
- [ ] Update `AGENTS.md` threshold table with final values
- [ ] Run `just gate` as final full check
- [ ] Mark all phases ✅, update Context Recovery Notes footer

**Commit:** `docs: close out architecture health remediation with re-triage results`

---

## Risks

| Risk | Mitigation |
|---|---|
| Render-path regression from CanvasArea extraction | Benchmark-gated; revert protocol if 1.5x ratio breached |
| Pre-commit blocking over-ceiling files | Phase 0 budget alignment lands first; extractions only reduce complexity |
| Scene API breakage (36 importers of document.ts) | Public re-exports preserved; full scene test filter + madge verify |
| Session context loss mid-plan | Tracker committed first; updated every commit; footer says "start here" |
| replayIr too dangerous to extract | Skip — decision recorded in Phase 6, hot path preserved as-is |

## Context Recovery Notes

**If this session is interrupted, to restart:**
```bash
git checkout master
git log --oneline -10 -- docs/plans/architecture-health-remediation-2026-07-26.md
# Read this tracker and pick up from first unchecked box.
# After each phase, run the full regression gate before committing.
```

**Last Updated:** 2026-07-26
**Last Action:** Created tracker
**Next Immediate Action:** Phase 1 — safe cleanup (spike/ and diagnostics/)
