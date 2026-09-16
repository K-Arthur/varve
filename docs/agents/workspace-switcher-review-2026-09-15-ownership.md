# Workspace switcher review — ownership (2026-09-15, session G)

**Task (user directive):** "focus on all the actual apps workspace buttons
reviewing all its sections and components, text, spacing etc." — research,
diagnose, repair, and verify the workspace switcher (dock) and its overflow
menu in `apps/desktop`, update docs and the marketing website, and commit
progressively on `master`.

**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (per the
task instruction; no branch or worktree created).
**Base HEAD at start:** `969739124`.

## Interpretation of the directive (recorded, not hidden)

"Workspace buttons" is read as the workspace switcher surface in the menubar:
the dock (`packages/editor/src/components/WorkspaceTabs.tsx` +
`.workspace-dock*` recipes in `packages/editor/src/editor.css`), its overflow
"More workspaces" menu, the mode labels it renders, and the copy about it in
`docs/` and `apps/website`. Toolbar buttons ("Toolbar System") are a separate
surface with its own review (`docs/audits/toolbar-review-2026-09-15.md`) and
are not re-opened here.

## Owned paths (this session edits)

| Path | Planned change |
|---|---|
| `packages/editor/src/components/WorkspaceTabs.tsx` (+ `.test.tsx`) | Remove per-frame fisheye magnification, fix ARIA ownership (More outside the radiogroup), measure the real CSS gap for the layout math, count in the More accessible name, label = command label |
| `packages/editor/src/workspace/workspaceOverflow.ts` (+ `.test.ts`) | Gap-aware icon-tab math from one measured gap; remove the duplicated 5/6/33px constants |
| `packages/editor/src/workspace/workspaceTypes.ts` | `WORKSPACE_LABELS.codegen` → `'Codegen'` (matches the shortcut registry, View menu, website) |
| `packages/editor/src/editor.css` | Dock recipes tokenized (no hardcoded hex/oklch), single accent, AA-verified active pill, CSS-only hover cue, forced-colors/HC behavior |
| `tests/e2e/workspace/switcher-review.spec.ts` | Real-app contract spec: rendered-contrast assertions per mode and theme, ARIA ownership, no-JS-magnification, label fit, overflow reachability |
| `tests/e2e/editor/workspace-nav.spec.ts`, `tests/e2e/editor/workspace-navigation-contracts.spec.ts`, `tests/e2e/canvas/image-mode.spec.ts`, `tests/e2e/canvas/workspace-toolbar-visual.spec.ts` | Label lookups updated to the renamed Codegen workspace |
| `tests/e2e/workspace/visual.spec.ts-snapshots/*` | Reviewed `workspace-tabs-*.png` baselines after the token change |
| `docs/audits/workspace-switcher-review-2026-09-15.md` (new), `docs/architecture/workspace-system.md`, `docs/screenshots/2026-09-15-workspace-switcher-review/**` | Review record, switcher contract, rendered evidence |
| `apps/website/src/pages/docs/workspaces.astro`, `apps/website/src/pages/docs/getting-started/interface.astro` | Switcher copy matches the shipped behavior; canonical mode name |

## Not touched (other writers, active or recently active)

- `packages/editor/src/Menubar.tsx`, `packages/editor/src/menu/**` — another
  session's in-flight clipboard/menu work (menu-submenu-contract ownership).
- `packages/editor/src/components/Shell/index.ts` — another session's
  uncommitted `FrequencySeparationDialogHost` export; never staged here.
- `packages/ui/src/components/Menu.tsx` / `components.css` — shared menu
  system owned by the menu-contract session. The dock's overflow menu keeps
  the shared `size="default"` wrapping behavior; the wrap is resolved by the
  label change, not by editing the shared primitive.
- `packages/editor/src/components/Menubar/*` toolbar surfaces, `FloatingToolbar/**`,
  `ContextControlBar/**` — toolbar-review session's scope.
- `CHANGELOG.md` — holds another session's uncommitted entries; a changelog
  entry for this session waits until that work lands (same convention as the
  separator review, `docs/agents/separator-review-2026-09-15-ownership.md`).

## Pre-existing uncommitted state carried into this commit

`WorkspaceTabs.tsx` already had one uncommitted line from an earlier
session adding `compactActive: false` to `INITIAL_LAYOUT` — required for the
file to typecheck against the committed `WorkspaceOverflow.ts` interface.
It is kept and included, because the owned file cannot compile without it.

## Commits

Progressive, one commit per coherent slice; staged paths are always a subset
of the table above. Other sessions' uncommitted work is never staged,
reverted, or reformatted.

| Commit | Slice |
|---|---|
| `0bed515ba` | Tokenized switcher, ARIA ownership, roving-focus fix, measured gap, renamed label, real-app contract spec, reviewed baselines |
| `bad5884f6` | Review record, switcher contract, doc/help/website copy |
| `9e58d574f` | `workspace-nav.spec.ts` menuitemradio assertion repair (verified) |
| `c8ef7150e` | Forced-colors / 480px / enlarged-text verification + production-bundle build record |
| `14cf5f59e` | `min-height` + bar observation so enlarged text grows the chrome and re-runs the math |

## Applicability decisions (prompt Sections 6A–6D)

- **6A dense chrome: applied.** Typography (2xs → xs), single-accent token
  palette, spacing tokenization for the gap, measured geometry contract.
- **6B numeric scrubbing: not applicable.** The switcher has no numeric input.
- **6C hierarchy virtualization: not applicable.** Eight fixed items, no tree.
- **6D menus: partially applied** to the overflow menu only (role ownership,
  reachability, real switching, focus return, hidden-count name). The shared
  Menu primitive and the menu-contract session's work were not touched.

## Status: complete (2026-09-15 session G)

Delivered: the switcher repair and its real-app contract spec (9 tests),
rendered before/after evidence in
`docs/screenshots/2026-09-15-workspace-switcher-review/`, the review record
(`docs/audits/workspace-switcher-review-2026-09-15.md`), the switcher contract
in `docs/architecture/workspace-system.md`, and doc/help/website copy updates.
Deferred: the CHANGELOG entry (another session's uncommitted entries occupy the
file), View-menu workspace deduplication, and the browser-zoom /
assistive-technology matrices recorded in the review's remaining work.
