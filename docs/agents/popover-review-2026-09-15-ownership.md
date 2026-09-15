# App-wide popover review — ownership and handoff (2026-09-15)

**Task:** review and repair every popover in the app — all sections and
components — on `master`, with real-world documents, measured evidence,
progressive commits, docs and website alignment, and visual validation.

**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (per the
task instruction; no branch or worktree created).
**Base HEAD at start:** `8bae3f14e`.
**Research/evidence ledger:** `docs/research/popover-review-2026-09-15.md`.
**Rendered spec:** `tests/e2e/popovers/popover-contract.spec.ts`.

## Why this record exists

The working tree contains many other writers' uncommitted changes (font
pipeline, generative edit, selection routing, SAM2, background removal,
export inspector, layers panel, toolbar follow-up). This record names the
paths this task owns so a later integration pass can tell them apart. Commits
from this session stage only popover-owned paths.

## Popover surfaces in scope

| Surface | Implementation | Consumers |
|---|---|---|
| `Popover` primitive | `packages/ui/src/components/Popover.tsx` (native Popover API + Floating UI) | Home `FilterDropdown`, Home workspace-filter popover in `HomeToolbar`, `WorkspaceSwitcher`, editor `FloatingTextBar` text-colour picker |
| `FloatingPortal` popovers | `packages/ui/src/components/FloatingPortal.tsx` + `OverlayRegistry` | `ToolOptionsPopover` (+ area/magic-wand/text/retouch/brush/liquify/crop sections), `InspectorColorPopover`, `VariableModifierPopover`, `SectionManagerTrigger`, `AlignDistributeBar` distribution/tidy popovers, `FloatingTextBar` More popover, `InspectorFocusedEditor` |
| Home rich popovers | Home package | `FilterDropdown`, workspace-filter listbox, `WorkspaceSwitcher` (currently test-only) |

Menus (`Menu`, `ContextMenu`, submenus), `Select`/`Combobox`/`MultiSelect`
listboxes, `Tooltip`, and `Dialog` are **separate semantic families**; this
task touches them only where a popover defect is root-caused inside shared
overlay code and the fix is popover-scoped.

## Owned paths (this session edits)

| Path | Planned change |
|---|---|
| `packages/ui/src/components/Popover.tsx` (+ tests/stories) | Trigger semantics, keyboard entry, dismissal/focus contract, nested-overlay safety, a11y wiring |
| `packages/ui/src/components/OverlayRegistry.ts` (+ tests) | Only if a popover dismissal defect is root-caused in shared registry logic |
| `packages/ui/src/components/components.css` | Popover surface tokens/states |
| `packages/home/src/FilterDropdown.tsx`, `HomeToolbar.tsx`, `WorkspaceSwitcher.tsx` (+ tests, CSS) | Keyboard operability, label/role correctness, popover behaviour |
| `packages/editor/src/components/FloatingToolbar/ToolOptionsPopover.tsx` (+ CSS/tests) | Open/focus policy, section header semantics |
| `packages/editor/src/components/Inspector/controls/InspectorColorPopover.tsx`, `VariableModifierPopover.tsx` (+ tests) | Focus/role/dismissal parity |
| `tests/e2e/popovers/**` | New real-world specs (new directory) |
| `docs/research/popover-review-2026-09-15.md`, `docs/audits/popover-*`, `docs/architecture/menu-system.md` (popover rows only) | Evidence + contract |
| `packages/help/src/content/**` | Help copy where popover behaviour is user-visible |
| `apps/website/src/pages/**` | Marketing copy only where it describes popover behaviour |

## Not touched (other writers, active at task start)

- `packages/editor/src/components/LayersPanel/**` — active session per
  `docs/agents/layers-panel-2026-09-15-ownership.md`.
- `packages/editor/src/components/SelectionQuickBar/**` — active session.
- `packages/editor/src/Menubar.tsx`, `packages/editor/src/menu/**` — toolbar
  follow-up session owns the menubar; snapshot churn belongs to another
  in-flight clipboard-menu change.
- `packages/editor/src/components/FloatingToolbar/FloatingToolbar.tsx` and
  `FloatingTextBar` layout — consumed; only popover behaviour inside them is
  changed, and only if root-caused.
- `context.tsx`, `CanvasArea.tsx`, `Shell.tsx` — hub files with import
  budgets. Consumed, not modified.
- `.health-baseline.json`, `Cargo.lock`, font/selection/caf files — other
  sessions' uncommitted work.

## Commits

Progressive, docs-first, one commit per coherent slice. Staged paths are
always a subset of the table above; the pre-commit hook runs the affected
closure.
