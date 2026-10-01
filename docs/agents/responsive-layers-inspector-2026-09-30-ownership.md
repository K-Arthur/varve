# Ownership — responsive Layers/Inspector audit and repair (2026-09-30)

**Branch:** `master` (no branch created, per instruction).
**Scope:** responsive behavior of the two docked rails — the Layers panel
(including the Design Canvas navigator it hosts) and the Inspector — plus the
shell grid tracks that size their chrome rows, across desktop widths, short
windows, the ≤899px drawer/sheet presentation, and text-only enlargement.
**Evidence:** `docs/audits/responsive-layers-inspector-2026-09-30.md`
(defects, before/after measurements, validation runs, coverage matrix).
**Spec:** `tests/e2e/responsive/layers-inspector-panels.spec.ts` (7 tests).

## Repository state at start (recorded before any edit)

- Branch `master` at `54b9f1369`, ~8 ahead of `origin/master`; HEAD moved to
  `1ed07a96f` mid-session from other sessions' commits.
- Shared dirty tree: ~400 modified/staged/untracked paths belonging to
  concurrent sessions (dock/workspace layout, pattern system, text-enlargement
  fix, failure sweep, GPU work). None were reverted, staged, or rewritten.
- No git operation was run by this session against the shared index; all
  attribution reversions were exact inverse edits, restored byte-for-byte
  from saved copies (markers verified absent after restore).

## Files edited by this session

| File | Change |
|---|---|
| `packages/editor/src/editor.css` | Short-height tiers scoped to `.layers-panel-workspace` (D1); shell grid panel tracks → `minmax(0, var(--…))` (D3). Two hunks, disjoint from the concurrent menubar hunks in the same file (re-read immediately before each edit) |
| `packages/editor/src/components/PagesPanel/pages-panel.css` | Canvas row actions same-line reveal; add-button 24px target floor (D2/D5). File was clean before this session |
| `packages/editor/src/components/Inspector/inspector.css` | Align-target cluster wrap; inspector segmented wrap + `flex: 1 0 auto`; field-label wrap in the 13rem container tier (D4). Three hunks, disjoint from the concurrent pattern-session hunks (re-read immediately before each edit) |
| `tests/e2e/responsive/layers-inspector-panels.spec.ts` | New regression spec (new directory, no overlap) |
| `docs/audits/responsive-layers-inspector-2026-09-30.md` | This task's audit/evidence record |
| `docs/agents/responsive-layers-inspector-2026-09-30-ownership.md` | This record |

**Not edited although in scope of the findings** (see the audit's O1–O8):
dock geometry (`useEditorDockGeometry.ts`, `dockGeometry.ts`, `dockOps.ts`),
`Shell.tsx`, `WorkspaceBottomPanels.*` (all under active concurrent edit),
`InspectorTabBar.tsx` (concurrent tab-overflow work — this task's segmented
fix deliberately does not touch the tab bar), `docs/architecture/responsive-workspace.md`
(concurrent uncommitted edits by the tablet-mode/text-enlargement sessions),
and the stale visual baseline (O4).

## Concurrent-session intersections (both re-read; hunks disjoint)

- `editor.css` also carries the text-enlargement session's uncommitted
  `.editor-menubar__left` containment hunks (lines ~551/3132/3276/3294).
  This task's hunks are at ~345 and ~2466. Committing this task's work must
  be path-scoped **and hunk-scoped** (`git commit -F <msg> -- <path>` is NOT
  sufficient for `editor.css`; use an isolated index + hunk selection, per
  the incident recorded in `pre-existing-failures-2026-09-30.md`).
- `inspector.css` also carries the pattern session's uncommitted changes.

## Handed off to other owners (with evidence in the audit)

1. **Dock chrome covers the document tab strip at 200% text** (audit O1) —
   fix belongs in the dock geometry (derive the top offset from the live
   header box or anchor the absolute layer to the grid rows). Repro:
   1280×800, root font 32px; tab hit test returns
   `workspace-dock-panel-chrome__title`.
2. **Legacy `PanelResizeHandle` under the dock splitter** (O2) — remove the
   legacy handle or move its keyboard/pointer contract into the splitter;
   this also clears the Layers aside's +7px `scrollWidth` residue.
3. **Pre-existing spec failures on this tree** (O3/O5, reproduced with this
   task's changes fully reversed): `layers-header-solo-overflow:58`,
   `layers-row-badge-overflow:114/144/212`, `inspector-responsive-surface-audit`
   ×4 (`setRail` writes `--inspector-width`; the dock's inline px width wins),
   `name-labels:5`, `layers-panel-real-world:41`, `layers-panel-visual:5`
   (bulk bar 773.34 > panel 666.61, byte-identical with/without this work).
4. **Stale baseline** `design-canvas-navigation.spec.ts-snapshots/design-canvas-navigator-chromium-linux.png`
   (expects 288×143; actual 316×149 — committed dock-ratio rail invalidated
   it independently of this work). Regenerate at the integration checkpoint
   after reviewing the diff; not regenerated here deliberately.
5. **Text proposed for `docs/architecture/responsive-workspace.md`** (file not
   edited here because it carries others' uncommitted changes) — add to the
   "Breakpoints"/"Text enlargement" sections:

   > **Panel rails contain their interactive content.** The Layers rail's
   > inner content tracks the rail width at every height (the short-height
   > tier's no-shrink rule applies only to the outer workspace wrapper), so
   > the filter bar and its "Show filter options" toggle stay inside the
   > panel and clear of the dock splitter's 24px edge band. The Design Canvas
   > row's actions are `display: none` at rest — the canvas name gets the
   > whole row and nothing hidden hit-tests — and reveal on the same flex
   > line on hover/focus-within, a state that changes no row's height, so
   > revealing one row can never move another row under a pointer mid-click.
   > Asserted by `tests/e2e/responsive/layers-inspector-panels.spec.ts`.

   Also correct the portrait sheet figure: the doc's "25–36dvh" does not match
   the shipped `height: min(72dvh, 560px)` (audit O7).

## Validation status

- New spec: 7/7 pass (official Playwright config, heavy lease, `VARVE_E2E_PORT=1541`,
  `--workers=1`).
- `chromeos-device-matrix.spec.ts`: all tests pass (includes the text
  enlargement contract and the 15-entry viewport matrix — the D3 gate).
- Affected suites: `a11y/responsive-panels`, `workspace/consolidated-panels-responsive`,
  `workspace/dock-layout-geometry` (4/4), `inspector-responsive-surface-audit`
  sticky-header test, `design-canvas-navigation` interaction tests,
  `name-labels:30`, `layers-panel-visual` + `layers-panel-real-world` minus the
  pre-existing failures listed above.
- `pnpm typecheck:e2e` pass; `audit:docs`, `audit:tokens`, `audit:emoji`,
  `audit:radius`, `audit:spacing`, `audit:sizing`, `audit:inspector-css`,
  `biome check` on the new spec: all pass.
- `pnpm verify:affected` **escalated to the full gate** (shared-tree
  validation-infrastructure/dependency changes from concurrent sessions —
  468 dirty paths) and did not run lanes; `pnpm verify:full` was not run
  because the full suite on this shared tree is unattributable (the failure
  sweep's ledger documents its known red groups) and is an explicit-escalation
  operation. Targeted affected suites were run instead and are listed above.

## Commit status

**No commit was made** — the task did not carry explicit commit
authorization, and `editor.css`/`inspector.css` mix this task's hunks with
other sessions' uncommitted work. The deliverable is this documented working
diff (files above) plus the audit record. Before any commit: use an isolated
index with hunk-level selection for the two shared stylesheets, and verify
the index contains only this task's hunks.
