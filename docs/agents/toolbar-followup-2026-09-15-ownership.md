# Toolbar follow-up review — ownership (2026-09-15, session B)

**Task:** continue the 2026-09-15 toolbar review. The first session
(`docs/audits/toolbar-review-2026-09-15.md`) fixed palette roving focus,
priority-based overflow, and shape quick controls. This session owns the
remaining surfaces and the defects that session explicitly deferred:
palette placement, the over-tall View menu, the status bar, the text quick
bar, and the context/text `role="toolbar"` keyboard contract.

**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (per the
task instruction; no branch or worktree created).
**Base HEAD at start:** `dd9af24a6`.

## Owned paths (this session edits)

| Path | Planned change |
|---|---|
| `packages/editor/src/components/FloatingToolbar/**` | Top/bottom placement from effective workspace config; CSS |
| `packages/editor/src/Menubar.tsx` (+ test) | View menu restructured into submenus; toolbar-position radio entries |
| `packages/editor/src/StatusBar.tsx` (+ test) | Height/token consistency, duplicate rotation readout, narrow-tier verification |
| `packages/editor/src/components/FloatingTextBar/**` | APG toolbar roving contract via shared `Toolbar` |
| `packages/editor/src/components/ContextControlBar/**` | APG toolbar roving contract; suppress duplicate text controls during an active text edit session |
| `packages/editor/src/workspace/workspaceTypes.ts`, `workspaceStore.ts`, `toolbarComposition.ts` (+ tests) | `toolbarPlacement` config + persisted per-mode override |
| `packages/editor/src/actions/createActionHandlers.ts` (+ test) | `viewToolbarTop` / `viewToolbarBottom` commands |
| `packages/editor/src/context/textEditSession.ts` (new, if the duplication fix lands) | Tiny module-level session flag for cross-surface consumers |
| `packages/ui/src/components/Toolbar.tsx` (+ test) | Optional class name; arrows yield to text-entry/select widgets |
| `tests/e2e/canvas/toolbar-*.spec.ts` | Placement, menu-fit, status-bar, keyboard regression specs |
| `docs/architecture/toolbar-system.md`, `docs/audits/toolbar-*`, `docs/research/toolbar-*`, `docs/screenshots/2026-09-15-toolbar-followup/**` | Contract, evidence, visuals |
| `apps/website/src/pages/docs/**` | Toolbar/status copy where behavior changed |

## Not touched (other writers, active at task start)

- `packages/editor/src/components/SelectionQuickBar/**` — active session
  (modified 13:39–13:51; also owns the `CanvasOverlays.tsx` containerWidth
  prop change). The quick bar's positioning/profile behavior is theirs; this
  session only documents it.
- `packages/editor/src/components/LayersPanel/**` — active session per
  `docs/agents/layers-panel-2026-09-15-ownership.md`.
- `packages/editor/src/menu/**` and
  `packages/editor/src/menu/__tests__/__snapshots__/nativeAdapter.test.ts.snap`
  — another session's in-flight clipboard menu entries (+450 snapshot lines).
  The HTML menubar and the native menu are separate sources; this session
  changes only the HTML menubar.
- `context.tsx`, `CanvasArea.tsx`, `Shell.tsx` — hub files with import
  budgets and other writers' staged/deferred changes. Only consumed.

## Commits

Progressive, docs-first, one commit per coherent slice. Staged paths are
always a subset of the table above; the pre-commit hook runs the affected
closure.
