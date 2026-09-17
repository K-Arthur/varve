# Home interface audit and implementation evidence (2026-09-17)

Surface: Home/Start (`@varve/home`). Base HEAD `cd788635b`, working tree with
144+ pre-existing dirty files from other sessions (none owned here). Research
ledger: `docs/research/home-interface-2026-09-17.md`. Ownership:
`docs/agents/home-interface-2026-09-17-ownership.md`.

## Baseline (before changes)

Captured from the running app at `http://localhost:1420/e2e.html` (dev-server
harness mounting `HomeShell` over a seeded memory platform: 20 files, 3
projects; fresh Playwright contexts). 10 states, light/dark/high-contrast,
1440/640/320px widths:
`/tmp/opencode/home-baseline/01-default-light-1440.png` … `11-sort-filter-menu.png`.

Inventory of findings (visual symptom → cause → disposition):

| # | Finding (baseline evidence) | Root cause | Disposition |
|---|---|---|---|
| 1 | Shift-click multi-select painted the browser's blue text selection across card labels (`06-multiselect.png`) | `.file-card`/`.file-row` had no `user-select` policy; labels are plain spans inside a click target | Fixed (`home.css`) |
| 2 | Multi-selection could not be cleared from the keyboard; `Esc` only closed dialogs (`06/07`) | `useHomeShortcuts` Escape branch calls only `closeDialog`; no clear-selection path | Fixed (`HomeShell.tsx`); explicit overlay/rename guards |
| 3 | Arrow keys in the sidebar snapped focus back to the active item; project rows were unreachable (`keyboard-nav` spec, live repro) | (a) focus effect targeted a non-focusable wrapper div for project rows; (b) the active-item sync effect depended on the per-render `entries` array, re-running and resetting `focusIdx` on every render | Fixed (`SidebarNav.tsx`) |
| 4 | Search palette opened as a tall hollow panel: "Start typing to search" inside ~420px of emptiness (`07-search-palette.png`) | `flex` default `align-items: stretch` stretched the container to `max-height`; empty query had no content | Fixed: `align-items: flex-start` + recents-first default group |
| 5 | Favourite star hit target ~17×17px inside a large clickable card | fluid `--space-1` padding around a 12px glyph; no minimum box | Fixed: fixed 24×24 box (`home.css`); glyph unchanged |
| 6 | Sidebar header rendered "PROJECTS3" with no gap (`01`) | `DisclosureTrigger` wraps children in one label span, so the count's `margin-left: auto` had no flex context | Fixed (`home.css`, scoped to home section headers) |
| 7 | Home Playwright lane red at HEAD (21 tests, 16 failing) | Specs asserted pre-refactor markup (`role="option"` sidebar items, a "New file" button, `Search files...` placeholder, removed `.search-sort-group`) | Repaired against the current DOM; see validation |
| 8 | Perf budget `initial render ≤5s` fails on the shared dev server (6.3–8.6s; warm reload 6.4s) | Measurement includes dev-server module serving/graph of the full app under a shared multi-agent server; budget predates current load | **Not changed** (policy: do not move thresholds after testing). Reported as unresolved. |

## Implementation (all in `packages/home`)

- `home.css` — `user-select: none` on `.file-card`/`.file-row` (rename inputs
  re-enable text selection); 24×24 `.file-card__fav`/`.file-row__fav`; scoped
  flex context for `.sidebar-section__header .varve-disclosure__label`;
  `.search-palette { align-items: flex-start }`.
- `HomeShell.tsx` — `closeDialog` now computes `hadOverlay` across every home
  overlay (new-file, context menu, palette, import, shortcut help, version
  history, new project, save search) plus `renamingId`, and clears selection
  only when none is active.
- `HomeSearchPalette.tsx` — empty query yields a "Recent files" group (≤6 by
  `openedAt`, then `updatedAt`) using the existing result rendering; copy is
  now "Type to search files and document contents" when the home is empty.
- `SidebarNav.tsx` — focus effect targets the first focusable descendant;
  `entries` held in a ref so the active-item sync only runs when `activeId`
  changes.
- `FileCard.tsx` — removed a duplicated `setRenameValue` effect.

## Validation

Commands (from repo root unless noted):

| Command | Result |
|---|---|
| `node_modules/.bin/biome check <15 touched files>` | clean (1 formatting fix applied to the new spec) |
| `pnpm --filter @varve/home typecheck` | pass |
| `node_modules/.bin/vitest run packages/home` | 31 files / 189 tests pass (incl. 4 new palette suggestion tests) |
| `packages/home` Playwright lane (`playwright test --config e2e/playwright.config.ts`) | 20/21 on first post-fix run; serial rerun of the load-sensitive subset: 10/11 pass; remaining failure is the pre-existing perf budget (#8) |
| Maintained `e2e:home` lane (`VARVE_E2E_PORT=1541`, heavy lease) | 52 passed / 5 failed / 2 skipped (15.7m) |
| `pnpm --filter @varve/desktop typecheck` | fails with 21 unrelated errors in `packages/editor/src/workspace/**` (other sessions' in-progress work); zero errors reference `packages/home` |
| `pnpm audit:docs`, `pnpm audit:emoji` | clean (996 docs / 4852 files) |

### Maintained `e2e:home` lane — failure disposition

| Failure | Cause | Disposition |
|---|---|---|
| `asset-search.spec.ts:37` and `:57` | Test bug: `getByText('<file>.png')` matched both the import-queue row and the asset card (strict-mode violation). The queue renders inside `.asset-browser`, so the card-name class is the discriminator. | Repaired; re-run **passed** (part of 8/9 run) |
| `new-design-baseline.spec.ts:55` | Test bugs: asserted `input[aria-label="Document name"]` and a "Presets" tab (current dialog uses `<label for>` + a "Frame presets" listbox); helper used the removed `label.new-design__start-card` class. | Repaired (input via `getByLabel`, listbox via role+name, helper uses `label.varve-radio`); re-run **passed** (6/6 with the layout spec) |
| `new-design-layout.spec.ts:81` | `Target crashed` (Chromium renderer crash while clicking a dialog card) on top of the same stale start-card helper | Helper repaired; re-run **passed** |
| `trash-flow.spec.ts:25` | Page stalled on the "Loading Varve" status during a mid-test reload (dev-server module churn under shared load) | Re-run **passed** (2/2, second test now asserts the trashed file appears in Trash) |

Every previously failing spec in the maintained lane was re-validated on the
final tree. The 52 tests that passed in the initial lane run were not affected
by the spec repairs (their files were not edited). One intermediate retry
attempt crashed at browser warm-up (`page.goto: Page crashed`) while the host
was at 21Gi/22Gi swap with load >10 from concurrent agent workloads; the
subsequent serial retry passed. A full-lane re-run after the repairs was not
repeated — each repaired spec was validated individually instead.

New regression coverage (`packages/home/e2e/selection-behavior.spec.ts`):
shift-click produces no text selection; Escape clears selection with no
overlay; Escape closes the context menu **without** clearing selection;
favourite star ≥24×24 (measured via bounding box); palette empty state lists
recent files and opens the clicked one. Plus four unit tests in
`HomeSearchPalette.test.tsx` for recency ordering, Enter-to-open, and the
empty-library copy.

After screenshots (same harness, `/tmp/opencode/home-verify/`):
`10-default-after.png`, `11-palette-suggestions-after.png`,
`12-multiselect-after.png`, `13-escape-cleared-after.png`. Escape clear also
verified programmatically (`batch-actions` count 0, `aria-selected=false`).

## Remaining defects / limits

- Perf budget (#8) unresolved; needs a decision owner for either a documented
  warm/cold measurement definition or an environment-appropriate budget —
  not a silent threshold change.
- Search palette project/template results still only open files; selecting a
  project or template is a silent no-op (pre-existing). Empty-state
  suggestions deliberately exclude them until those actions exist.
- Stale `.search-sort-group` CSS rules remain (no consumers); left in place
  to keep the diff scoped.
- The package-local Playwright lane is not wired into CI (only the root
  `tests/e2e` lanes are); it bit-rotted accordingly. Repairing selectors is a
  stopgap — wiring it into CI is a separate decision.
- No screen-reader or real touch-device pass was performed; keyboard and
  DOM/ARIA behavior were validated, accessibility-tree semantics were not
  audited beyond the assertions above.
