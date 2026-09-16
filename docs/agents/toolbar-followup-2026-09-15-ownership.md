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

Progressive, docs-first, one commit per coherent slice:

| SHA | Subject |
|---|---|
| `8bae3f14e` | docs(toolbar): follow-up ownership and research evidence |
| `8e54eb924` | feat(toolbar): persisted top/bottom palette placement |
| `f256e2052` | fix(menubar): group View into submenus so the root fits one screen |
| `b62f98c3e` | fix(quick-bars): toolbar keyboard contract; stop duplicate text controls |
| `83bce5031` | fix(status-bar): row/token agreement and the 24px target minimum |
| `471c679dd` | test(toolbar): spec alignment, ownership/screenshots |
| `52a3beda5` | fix(status-bar): score-badge width; spec flow hardening |
| `2e93d1c97` | fix(text-bar): keep the edit session alive when a size is confirmed |
| `082de695e` | docs(toolbar): final browser results and refreshed evidence |
| `43dcf70f2` | test(toolbar): affected specs for grouped View/single surface |
| `bb3782ecf` | fix(menubar): share one item role/checked helper |
| `39a658609` | test(toolbar): stabilize regression specs; batch triage |
| `c8c4b1f2b` | fix(menubar): retry the focus handoff until the portal layer is focusable |
| `ac804fdcb` | test(toolbar): forced colors + 200% text; scroll focused row into view |

Staged paths were always a subset of the table above; the pre-commit hook ran
the affected closure per commit. The popover review's two additive lines on
the text bar's More `FloatingPortal` (`initialFocus`, `yieldTabToAnchor`) are
present in HEAD (committed with the quick-bars slice) as their note requested.

## Concurrency incident (recorded for the integration pass)

At ~16:10, while this session was running its final E2E, the shared real
index was observed to contain staged **reversions of exactly this session's
five commits** (26 paths: old versions of every touched file, plus staged
deletions of the three new files). The working tree and `HEAD` were correct;
only the index was affected. The pattern is consistent with another session
popping an old `git stash --index` that had captured these files while they
were uncommitted.

The staged reversion was snapshotted
(`/var/tmp/varve-toolbar-commit/index-reversions-evidence.patch`) and the
index was restored for those 26 paths only (`git restore --staged -- <paths>`;
worktree and other sessions' files untouched; staged count returned to 0).
No unique staged work was present in those paths — each entry was an older
copy of a file already committed. If another session intended that staged
state, nothing was lost from the worktree and it can be re-staged.
