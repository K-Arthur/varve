# Design-system overhaul — implementation evidence (2026-09-17)

Companion to `docs/research/design-system-overhaul-2026-09-17.md` (research
ledger) and `docs/architecture/design-token-system.md` (contract). Owner
record: `docs/agents/design-system-overhaul-2026-09-17-ownership.md`.

Base HEAD `30cf003dc` → final HEAD `3c5bc907c`. Branch `master`, no push.

## What landed

| Commit | Slice | Content |
|---|---|---|
| `fbedb56c5` | M1 — canvas token separation | 5 canvas overlay tokens in all 3 themes; `CONTRAST_PAIRS` UI pairs (201 → 213); 20 over-artwork overlay painters migrated off the accent/interactive families; two 1.4.11 repairs (guides/drop-targets 1.78:1 → 3:1+; two files rendering hardcoded fallbacks for undefined `--color-accent` now themed) |
| `148c9c2c5` | M2 — document-derived accent | `appearance.accentSource` setting; `appearance/documentAccent.ts` (picker, ramp derivation, runtime AA validation, controller with debounce/abort/generation-token stale rejection); `useDocumentAccent` wiring from StatusBar; Settings Appearance control; 13 unit tests; 3-test Chromium E2E lifecycle; before/after screenshots |
| `3c5bc907c` | M3 — drift repair | Canonical token names for the accent/warning/danger/error/success drift class across 15 CSS files; raw 10/11px labels → `--font-size-2xs`/`-xs` (user-scalable, equal rendered size); 5 raw transition durations → `--duration-*` (now covered by the reduced-motion reset) |

Note: the `settings.ts` `accentSource` field hunks landed inside the
concurrent Inspector session's `0c54ede60` (that session staged the shared
file broadly; the sweep carried this pass's already-written hunks). The
field is this pass's work; the Inspector session's commit message does not
describe it. Recorded here for the integration ledger; no history rewrite.

## Verification actually run

- `packages/ui` `audit:tokens`: **213/213 pairs pass across 3 themes**
  (was 201/201; +12 = the 4 canvas pairs × 3 themes).
- `audit:docs`: clean (1007 docs, 569 links, 174 ADRs). `audit:emoji`: clean.
- `@varve/ui` tokens tests: 7 files / 44 tests pass.
- `tsc --noEmit -p packages/editor`: zero errors in every file this pass
  touched (workspace total fluctuates 43–64 with concurrent sessions'
  in-flight files; the canvas-navigation pass recorded 47 pre-existing).
- `tsc -p tests/e2e/tsconfig.json --noEmit`: clean.
- Vitest: `appearance/documentAccent.test.ts` 13/13; Settings suites
  (settings.ts, SettingsContext, SettingsDialog incl. new accent-source
  case) 96 + 22/22 pass; SettingsDialog full file 22/22.
- Playwright Chromium (isolated port, heavy-lease wrapped):
  `tests/e2e/appearance/document-accent.spec.ts` **3/3 pass** —
  empty-page fixed fallback; saturated page derives an accent with
  byte-identical canvas pixels (in-page ImageData diff), document-only
  undo stack (two undos empty the tree), unchanged save state, derived
  accent surviving undo/redo; preference persistence across reload with
  the real Settings control reflecting it.
- Visual evidence inspected (not just captured):
  `docs/screenshots/2026-09-17-design-overhaul/accent-01-fixed-mode.png`
  (teal shell + teal canvas marks on red artwork) vs
  `accent-03-document-mode.png` (shell accents follow the document hue;
  canvas selection/handles/dimension pill verified teal at pixel level via
  5× crops; workspace identity pills and status colors unchanged);
  `accent-02-settings-appearance.png` (the new control).
- `pnpm verify:plan` at task start: FULL-SUITE ESCALATION: YES — driven by
  the shared tree's 140+ unrelated dirty files (same situation as the
  density pass recorded). Per the validation-economy policy and precedent,
  the inner loop stayed bounded to owned files; the escalation belongs to
  the combined integration checkpoint, not to this slice's commits.

## What is NOT done (honest scope)

- **Inspector proving case (§7 of the mandate):** owned by the concurrent
  Inspector systems session (`0c54ede60`, plus its baseline spec
  `tests/e2e/inspector/inspector-redesign-baseline.spec.ts` and ownership
  record). This pass verified integration only (settings/theme interplay
  via the accent E2E), and did not touch registry/composition paths.
- **93 → remainder of undefined token names:** the ambiguous class (bare
  `--color-surface`, `--color-border*`, `--color-status-*`) still renders
  fallbacks; needs per-usage mapping, not mechanical renaming.
- **LayersPanel/layers.css** retains pre-repair references (active Layers
  session owns the file).
- **packages/ui tooltip** raw 10px label (components.css carries another
  session's uncommitted density hunks).
- **Physical 200% UI text-scale verification** beyond the rem-based
  scaling contract, touch/stylus hardware, and screen-reader passes remain
  unverified lanes (no such hardware/AT in this environment).
- **Performance measurements** for this pass are qualitative only (CSS
  variable substitution + one debounced worker extraction; no new hot-path
  code). The accent E2E's pixel oracle doubles as the no-rerender check on
  the content canvas.

## Agent Validation Report

```text
Changed scope: packages/ui/src/tokens/{color.ts,tokens.css}; 20 editor
  overlay painters + CanvasArea read; settings.ts (accentSource);
  appearance/{documentAccent,useDocumentAccent}.test|ts; Settings dialog
  and context; 16 editor CSS files; new E2E + unit tests; 3 docs + 1
  ownership record + 3 evidence screenshots
Validation plan: pnpm verify:plan at start (escalated due to shared-tree
  dirty state; bounded per-slice validation per policy and prior-pass
  precedent)
Commands actually run: pnpm tokens:generate; audit:tokens; audit:docs;
  audit:emoji; vitest (ui tokens, editor appearance, settings suites);
  tsc editor + ui + e2e; biome check (staged + touched files); 3-test
  Playwright accent lifecycle via heavy-lease on isolated ports
Passed: all of the above (213/213 pairs; unit suites 44/13/96/22; E2E 3/3
  on final run; audits clean)
Skipped as unrelated: cargo suites (no Rust touched), LayersPanel,
  Inspector registry/composition, toolbar surfaces, website, benchmarks —
  all owned or unaffected; full Playwright/Cargo gates deferred to the
  integration checkpoint the planner escalated for
Escalations: verify:plan FULL-SUITE ESCALATION: YES (shared-tree dirty
  state) — not executed locally; belongs to the integration checkpoint
Full suite run: no
If yes, reason: n/a
```
