# Inspector panel review (cross-panel IA + reachability) — Ownership (2026-09-16)

**Task:** General UI/UX review of the app's Inspector panel (all sections,
components, text, spacing), on `master`, including whether any items
currently in the Inspector belong in the Layers panel / left panel instead.

**Context:** this is at least the fourth agent pass at the Inspector in the
last 36 hours (`inspector-review-2026-09-15`, `inspector-design-tab-2026-09-15`
+ its 2026-09-16 continuation, `export-inspector-2026-09-15`,
`typography-insights-review-2026-09-16`, plus `layers-panel-2026-09-15` for
the sibling panel). Those passes already covered Design-tab control
semantics, target sizes, label wrapping, Typography/Insights disclosure and
naming, and the Export tab end to end. This pass does not repeat that work;
it audits section *placement* (the specific question the task added) and
follows the evidence to whatever it actually finds, rather than re-running a
full redesign pass on ~62 already-reviewed sections.

**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (per task
instructions; no branch or worktree created).

**Research ledger:** `docs/research/inspector-panel-cross-panel-ia-2026-09-16.md`
**E2E regression:** `tests/e2e/layers/layer-workflows.spec.ts` — "a captured
state stays visible and applicable after deselecting everything"

## Owned paths (this task)

| Path | Change |
|---|---|
| `packages/editor/src/components/Inspector/panels/DocumentPanel.tsx` | Render `LayerStatesSection` in the empty-selection composition (previously omitted, making saved states unreachable once nothing was selected), placed ahead of the Isometric Grid section |
| `packages/editor/src/components/Inspector/sectionRegistry.ts` | Fixed a stray mojibake character in a doc comment (`Sketch Inspector组织` → `Sketch Inspector organization`) |
| `tests/e2e/layers/layer-workflows.spec.ts` | New regression test proving the reachability bug and the fix (verified red without the fix, green with it) |
| `docs/research/inspector-panel-cross-panel-ia-2026-09-16.md` | Research ledger: what was checked, what moved, what didn't and why |
| This record | Ownership declaration |

## Why nothing else moved

`featureOwnership.ts` already records deliberate placement rationale for
every Inspector section. The cross-panel audit (full detail in the research
ledger) found one place where that rationale's stated behavior ("Layers
offers contextual entry points") was never actually implemented and the
Inspector's own empty-selection path silently dropped the feature it was
supposed to own — fixed above. Every other section category checked
(`canvas`-scoped document sections, the Photo-mode AI tool sections,
`align-distribute`) already has a considered, evidenced placement that a
relocation would not improve. Not touching a large, recently-reviewed
surface without a concrete defect avoids exactly the failure mode the
research ledger documents from Figma's UI3 rollout: moving things around
without an evidenced reason generates complaints, it doesn't prevent them.

## Files explicitly NOT touched (other agents' uncommitted work)

At task start the working tree carried extensive uncommitted changes from
other sessions (font pipeline, generative editing, effects, desktop/Tauri
build files, website docs pages, Cargo lockfiles, and more — see `git
status` at session start). None of those paths are staged or referenced by
this session's commits.

## Validation run

- `pnpm --filter @varve/editor typecheck` — no new errors in
  `DocumentPanel.tsx` or `sectionRegistry.ts` (pre-existing errors in other
  writers' in-flight files unrelated to this change, consistent with prior
  sessions' notes).
- `vitest run packages/editor/src/components/LayersPanel/LayerStatesSection.test.tsx`
  — 6/6 passed (baseline, unmodified by this pass).
- `playwright test tests/e2e/layers/layer-workflows.spec.ts -g "stays visible
  and applicable"` (isolated `VARVE_E2E_PORT`, `--project=chromium`) — passes
  with the fix; confirmed it fails (`.layer-states__item` never appears)
  with the fix reverted via `git stash`, then restored.
- Commit-checkpoint gate (biome/staged lint, emoji/health/contacts/secret
  audits, import-boundary check, `typecheck:e2e`) run before commit.

## Continuation: numeric-field alignment/sizing consistency + Isometric Grid repair (2026-09-16, same day)

**Trigger:** user follow-up reporting (1) visible inconsistency in numeric
input-box alignment/width across the Inspector and (2) specifically broken,
unstyled controls in "the grid section" of the empty-selection Document
panel (screenshot showing a collapsed spinner-like artifact and a
misaligned preset control in Isometric Grid).

### Root causes found

1. **`NumberField` compact-width regression.** A `flex-direction: column`
   wrapper (used to stack an input above its own hint text in the Isometric
   Grid's "Spacing" row) broke `.insp-num__input`'s `width: 0; flex: 1`
   row-axis assumption: with the main axis rotated 90°, the explicit
   `width: 0` became the literal cross-axis size instead of being overridden
   by `flex-grow`, collapsing the input to ~13.5px (screenshotted: an
   unreadable sliver). Separately — found while building the general fix —
   any inline override that sets only `width` without resetting
   `flex-basis` is silently ignored, because the base class's `flex: 1`
   shorthand already pins `flex-basis: 0%`, which wins over `width` on the
   main axis per the flexbox spec. Both are fixed in
   `NumberField.tsx`/`inspector.css` (see commit message for detail);
   `compactFieldWidthCh()` now gives every bounded numeric field (opacity,
   rotation, and — after this pass — Isometric Grid's spacing/major-line/
   rotation) an intrinsic, right-aligned width instead of stretching across
   the whole control column, which was the actual "some input boxes are
   unnecessarily large" complaint: Opacity/Rotation style fields had no
   reason to be full-row width, and now aren't.
2. **Isometric Grid section used raw HTML instead of the shared Inspector
   components**, unlike every other section: plain `<input type="number">`
   instead of `NumberField`, a `<Select>` with no accompanying label span
   (so it fell into the label's 38% grid column instead of the control's
   62% column — the actual "misaligned preset dropdown" the user saw), and
   several multi-word labels missing the `--wrap` treatment other sections
   already received. Migrated Spacing/Major line every/Origin X/Origin Y/
   Rotation to `NumberField`; gave Preset its own label; added
   `insp-field__label--wrap` to Snap Enabled/Construction plane/Fit existing
   artwork/Snap targets; moved hint text out of the field's control column
   and into sibling `.insp-panel__color-mode-note` paragraphs (the
   convention every other section in this file already uses), which
   incidentally removes the fragile `flexDirection: column` pattern
   entirely from this section.

### Owned paths (continuation)

| Path | Change |
|---|---|
| `packages/editor/src/components/Inspector/controls/NumberField.tsx` | `compactFieldWidthCh()` helper; explicit `flex`/`width` override with the correct flex-basis reset |
| `packages/editor/src/components/Inspector/controls/NumberField.test.tsx` | Regression test asserting the explicit flex basis |
| `packages/editor/src/components/Inspector/inspector.css` | `.insp-num__control--compact` (right-align via `justify-content: flex-end`); `box-sizing: border-box` on `.insp-num__input` so declared widths include padding |
| `packages/editor/src/components/Inspector/panels/DocumentPanel.tsx` | Isometric Grid: Preset label fix, wrap labels, `NumberField` migration for Spacing/Major line every/Origin X/Origin Y/Rotation, hint paragraphs moved to siblings |
| `packages/editor/src/components/Inspector/sections/FillSection.tsx` | Unified per-fill blend mode onto the same grouped `Select` Appearance uses (found while fixing the compact-width regression in the same paint rows; the old `insp-blend-chip` + custom `Menu` popup only appeared in some fill states — one control now, always visible, in every state) |
| `packages/editor/src/components/Inspector/sections/__tests__/paintRows.test.tsx`, `tests/e2e/inspector/design-tab-audit.spec.ts` | Updated/added coverage for both fixes above |
| `docs/plans/inspector-design-tab-improvements-2026-09-15.md`, `docs/research/inspector-fill-stroke-research-2026-09-16.md` | Updated to describe the corrected root cause and decision |

### Note on concurrent sessions

This machine ran several other agent sessions against the same working tree
throughout this pass (confirmed via `ps aux` showing other `claude`/
`opencode2` processes and a live `playwright test
design-tab-audit.spec.ts` run that was not this session's). Two commits
landed mid-session with the message `fix(inspector): expose blend mode for
every fill type` and one more (`improve(inspector): clarify alignment
target`, touching `AlignDistributeBar.tsx`) that this session did not
author. `git status`/`git diff --cached` were re-checked immediately before
every commit in this continuation specifically to avoid staging or
reverting another session's concurrent work; no conflicts were found beyond
one compatible, purely-additive test assertion (left unstaged for its
author to commit).

The commit-checkpoint gate (which runs a `tsc` pass over all e2e specs)
failed to complete five times in a row here purely from host memory
pressure (`available` memory dropped as low as ~900MB with multiple
concurrent Vite dev servers and headless Chromium instances running) —
not from any defect in the change. Retried until it passed.

## Remaining / not claimed

- No help or website copy exists anywhere for the Layer States feature
  itself (grepped `packages/help/src/content` and `apps/website/src/pages` —
  zero hits). That predates this session; writing first-time user-facing
  documentation for a previously undocumented feature is a larger scope
  decision than this reachability fix and is left for whoever picks up
  documenting that feature end to end.
- Building an actual Layers-panel "contextual entry point" for Layer States
  (the half of the `featureOwnership.ts` rationale that was never built) is
  a feature addition, not a repair — recorded as a legitimate follow-up, not
  done here.
- The pre-existing `captured states survive an undo of the capture (delete
  via UI)` test in the same file crashed once during this session's local
  run with a Playwright "Target crashed" error unrelated to any change here
  (this machine runs many concurrent agent sessions; see
  `docs/agents/session-history.md`-adjacent notes on shared-machine load).
  Re-run and passed; not modified.
