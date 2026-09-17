# Adjustments tab review — Ownership (2026-09-17)

**Task (user-scoped):** review the app's **Adjustments** inspector tab and the
dialogs it contains — all sections, components, copy, and spacing — and land
verified repairs on `master`.

**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (no branch,
no worktree created). Tested HEAD: `a06a0c02a` plus this session's changes.

**Research/decision ledger:** `docs/research/adjustments-tab-2026-09-17.md`
(evidence E1–E14, decisions D1–D13).

**Baseline evidence:**
- `reports/ui-review/front-facing-adjustments/01-empty-adjustment-scope.png`
  (2026-09-13 tree) — shows the pre-change layer opacity as a bare `1`, the
  `Explicit (0 targets)` scope label, and the `Est. pixel area 0.0 MPix` row.
- `reports/ui-review/adjustments-tab-2026-09-17/` — this session's captures of
  the running app (light theme, 1280×720, default density).
- axe-core 4.12 report in the E2E log for the adjustment-layer composition.

## Owned paths (this task)

| Path | Change |
|---|---|
| `packages/editor/src/components/AdjustmentLayer/AdjustmentPanel.tsx` | Layer opacity → percent `NumberField`; `Auto WB` → `Tooltip` with `disabledReason`; Add-adjustment picker → canonical `Menu` (modal `Dialog`, grid CSS and hand-rolled arrow handling deleted); header duplicate readout and both inline styles removed |
| `packages/editor/src/components/AdjustmentLayer/adjustment.css` | `.adj-panel__add-row` class (inline `position: relative` removed); stale `.insp-select` duplicate and dead `.insp-overlay*` rules deleted; `.insp-warning` → `--color-feedback-warning-strong` |
| `packages/editor/src/components/AdjustmentLayer/AdjustmentPanel.test.tsx` | Opacity assertion updated to the percent field |
| `packages/editor/src/components/Inspector/sections/AdjustmentScopeSection.tsx` | Impact preview → shared `Dialog`; one `SCOPE_MODE_LABELS` vocabulary feeding readout/selector/dialog; pluralized counts; zero-area row hidden; label wrap; inline styles removed |
| `packages/editor/src/components/Inspector/sections/AdjustmentScopeSection.test.tsx` | New modal-dialog regression test (open preview, Escape cancel, Apply commits) |
| `packages/editor/src/components/Inspector/sections/PaletteSection.tsx` | Title `Palette` → `Extract Palette` (matches the Object menu and the section registry) |
| `packages/editor/src/components/Inspector/sectionRegistry.ts` | `ocr` title `OCR / Recognize Text` → `Recognize Text` (matches the rendered section) |
| `packages/editor/src/components/Inspector/inspector.css` | `.adjustments-object-panel` gets the same flex/gap rhythm as `.insp-panel` so the vector composition's section spacing matches the raster composition |
| `packages/editor/src/components/Inspector/panels/AdjustmentsPanel.tsx` | Vector composition passes `sectionId="effects"` so Layer Effects shares one identity with the Design composition |
| `packages/editor/src/components/Inspector/sections/imageTuning.css` | Seven usages of three undefined tokens (`--color-accent`, `--color-focus`, `--color-warning`) replaced with canonical tokens; fixes the axe AA failure (3.6:1) on the On/Off toggles and the unthemed focus rings |
| `packages/editor/src/components/Inspector/sections/ImageEnhancementSection.tsx` | Button "Open Vectorize Dialog…" → "Vectorize image…" (matches its dialog title and the section's other buttons) |
| `tests/e2e/inspector/adjustments-tab-audit.spec.ts` | New audit spec: empty/Photo, raster, vector, and adjustment-layer states; screenshots; axe assertions; clipped-label assertion; scope-dialog modal assertions; picker type-ahead assertion |
| `tests/e2e/effects/{color-effects,new-effects,verify-effects,gradient-map}.spec.ts` | Migrated the old `.adj-panel__add-menu-item` lookups to role/name lookups; gradient-map's bounds assertion now targets the anchored menu |
| `docs/research/adjustments-tab-2026-09-17.md` | Research + decision ledger |

## Coordination

The checkout carried extensive uncommitted work from other sessions at task
start (font pipeline, generative editing, effects, export surfaces, home
interface, Cargo/desktop files, website docs). No file owned by another session
was staged, reverted, or reformatted. `git status`/`git diff` were re-checked
immediately before each edit; `git add` is path-scoped to this table.

Notable cross-session observations (reported, not touched):
- `pnpm audit:emoji` is currently red on three `packages/editor/src/components/Export/*.test.tsx`
  assertions containing `×` — those files are modified in the working tree by
  another session and the characters are absent at `HEAD`.
- The `interface-density-2026-09-17` work (same day) changes `--space-*` scale
  factors; captures here use the app's default density.

## Validation

```text
Changed scope: packages/editor/src/components/{AdjustmentLayer (3 files), Inspector (6 files)},
  tests/e2e/{inspector/adjustments-tab-audit.spec.ts,effects/*4 specs},
  docs/{research,agents} (2 new records)
Validation plan: pnpm verify:plan
  → Tier 0-1 on the touched files; Tier 2-4 including e2e:file:…/adjustments-tab-audit.spec.ts
  → "FULL-SUITE ESCALATION: YES — workspace/toolchain/validation-infrastructure change"
    (driven by OTHER sessions' uncommitted Cargo.lock/desktop/validation files in the
    shared checkout, not by this change)
Commands actually run:
  1. npx biome check <12 changed files>                            → formatted; 9 pre-existing
                                                                     inspector.css warnings
  2. pnpm --filter @varve/editor typecheck                          → no errors in changed files
                                                                     (pre-existing errors elsewhere)
  3. npx vitest run AdjustmentPanel | AdjustmentScopeSection |
       AdjustmentsPanel | sectionRegistry tests                     → 89 passed (4 files)
  4. npx vitest run AdjustmentPanel | AdjustmentScopeSection        → 17 passed (post-Menu)
  5. pnpm typecheck:e2e                                             → clean
  6. pnpm audit:docs                                                → clean (1000 docs, 567 links)
  7. pnpm audit:tokens                                              → 201/201 across 3 themes
  8. pnpm audit:emoji                                               → 3 violations, all in
                                                                     OTHER sessions' modified
                                                                     Export test files (× sign)
  9. npx playwright test tests/e2e/inspector/adjustments-tab-audit.spec.ts
       --project=chromium (isolated port 1549, heavy-lease)        → 4 passed; axe violations
                                                                     [] in BOTH the raster and the
                                                                     adjustment-layer compositions;
                                                                     clipped labels []; add menu
                                                                     240×666 non-modal with 25 items;
                                                                     scope dialog modal + Escape cancel
 10. npx playwright test tests/e2e/effects/gradient-map.spec.ts
       tests/e2e/effects/new-effects.spec.ts
       tests/e2e/effects/verify-effects.spec.ts -g "gradient map|halftone"
       --project=chromium                                          → 3 + 1 + 2 passed
 11. (isolation) VARVE_E2E_PORT=1544-1549, heavy-lease acquired around each run
Passed: unit tests 3+4 (89 + 17); typecheck:e2e; audits 6+7; E2E 9 (4/4), 10 (6 passed)
Skipped as unrelated: duotone ×4, posterize ×3, threshold ×4, svg export ×1 — the
  new-effects file is `describe.configure({ mode: 'serial' })` and aborts after the
  pre-existing blackAndWhite toggle failure (selector `.adj-panel__adjustment-row`
  does not exist anywhere in the codebase; verified with git log -S across the repo).
  Duotone/serial skips predate this change: those tests look for studio-only kinds
  ('Duotone', 'Tritone', 'Color Halftone') in the adjustment-layer picker, which
  commit e13d39248 removed when it split the effect surface catalogs.
Escalations: none from this change. `pnpm verify:full` deliberately NOT run: the
  planner's escalation is caused by other sessions' uncommitted workspace/toolchain
  changes (Cargo.lock, apps/desktop, validation scripts) in the shared checkout;
  running the full gate here would exercise half-finished code from other agents and
  contend for the shared machine, and its result would not certify this change.
Full suite run: no (reason above).
Pre-existing failures observed: new-effects blackAndWhite toggle (broken selector);
  color-effects/verify-effects picker lookups for studio-only effects.
Unavailable lanes: real-device touch, screen reader, macOS/Windows native,
  Chromebook hardware.
```


### Files explicitly NOT touched (other sessions' uncommitted work)

`packages/editor/src/components/Export/**`, `packages/editor/src/editor.css`,
`apps/desktop/**`, `crates/**`, `tests/e2e/canvas/**`,
`tests/e2e/helpers/editor-helpers.ts`, `tests/e2e/shared.ts`,
`docs/agents/*-ownership.md` (other tasks), `Cargo.lock`, `pnpm-lock.yaml`.

## Remaining / not claimed

- `content-aware-fill` naming drift (menu/section "Generative Edit" vs dialog
  title/registry "Content-Aware Fill") is recorded but not renamed.
- The Adjustments tab's AI cluster is not workspace-gated even though the
  equivalent registry sections are Photo-mode-only; the intended
  `AiToolsHintSection` is wired only into Properties. This is deliberate for
  quick-bar reachability today and needs a product decision, not a drive-by
  change.
- `ImageEnhancementSection`'s four raw numeric inputs and their silent
  `|| default` coercion are recorded as the next bounded slice.
- Other warning-token text usages in the same tab were not independently
  measured in the light theme (only `.insp-warning` was).
- No real-device touch or screen-reader session was run.
