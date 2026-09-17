# Toolbar + contained dialogs review — ownership (2026-09-17)

**Task:** precision-first review of the editor toolbar surfaces — the floating
tool palette, context control bar, floating text bar, selection quick bar,
status bar, and the dialogs/popovers the toolbar opens (ToolOptionsPopover
with its marquee / magic-wand / text / retouch / liquify panels, crop options,
table-from-data). Scope is text, spacing, geometry, state, and behavior of
these surfaces only. Inspector composition, Layers panel, and shell layout are
other sessions' territory.

**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (no new
branch or worktree, per task instruction).
**Base HEAD at start:** `65da81887`.

## Prior work read

- `docs/audits/toolbar-review-2026-09-15.md` (session A) and
  `docs/agents/toolbar-followup-2026-09-15-ownership.md` (session B, 14
  commits) — palette roving focus, overflow retention, top/bottom placement,
  View-menu grouping, status-bar row/token agreement, text-bar session
  persistence, keyboard contract. This session verifies the results still hold
  and covers what those sessions deferred or did not own.
- `docs/architecture/interface-sizing-system.md` — density/font-size
  preferences landed 2026-09-17 (`ae6563fd1`, `a06a0c02a`). The toolbar must
  behave under both densities; that interaction is new since the 09-15 review.
- Popover-system contract (2026-09-15 session C) — FloatingPortal rules.

## Owned paths (this session edits)

| Path | Planned change |
|---|---|
| `packages/editor/src/components/FloatingToolbar/**` | Findings from the review; CSS/text/spacing fixes |
| `packages/editor/src/components/ContextControlBar/**` | Same |
| `packages/editor/src/components/FloatingTextBar/**` | Same |
| `packages/editor/src/components/SelectionQuickBar/**` | Same (no active owner today) |
| `packages/editor/src/StatusBar.tsx` | Only if review finds a defect |
| `docs/audits/toolbar-surface-review-2026-09-17.md` | Review evidence |
| `docs/screenshots/2026-09-17-toolbar-review/**` | Baseline + after captures |
| `tests/e2e/canvas/toolbar-*.spec.ts` | Regression specs for fixed defects |

## Not touched (other writers active at task start)

- `packages/editor/src/components/Export/**`, `FontBrowser/**` — export
  session in flight (`docs/agents/export-surfaces-review-2026-09-17-ownership.md`).
- `packages/home/**` — home session in flight.
- `packages/editor/src/components/Inspector/**` — a heavy inspector session
  landed through `65da81887` today; shared controls consumed read-only.
- `context.tsx`, `CanvasArea.tsx`, `Shell.tsx` — hub files, import budgets.

## Commit plan

Progressive, evidence-first; staged paths limited to the table above.

| SHA | Subject |
|---|---|
| pending | feat(density): command surfaces follow the density contract |
| pending | fix(toolbar): targets, labels, and state truth in the toolbar family |
| pending | test(toolbar): surface-review regressions + after evidence |
|---|---|
