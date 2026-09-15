# Minimap Repair Audit — 2026-09-05

## Scope

This audit reviewed the minimap against the live canvas, page-placement
system, workspace/document switching, display resize behavior, pointer
lifecycle, accessibility, and the marketing claims for canvas navigation.
The work was performed on `master`; unrelated pre-existing worktree changes
were preserved.

## Confirmed findings and corrections

| ID | Severity | Finding | Correction |
|---|---|---|---|
| MM-01 | High | Viewport size came from a global `.editor-canvas canvas` query and fell back to fabricated 800×600 geometry. Sidebars, drawers, auxiliary surfaces, or zero-size layout states could draw and navigate against the wrong canvas. | `Shell` passes the actual `.editor-canvas` owner ref. ResizeObserver and window/display events update live CSS dimensions; zero-size means no indicator and no navigation. |
| MM-02 | High | The viewport outline was axis-aligned and ignored `cameraRotation`; minimap navigation used an unrotated pan formula. | Project all four corners through shared camera helpers and navigate with the inverse centre-preserving camera transform. |
| MM-03 | High | Page documents traversed only the active page, so the overview could omit other placed pages and empty pages. | Use `multipageRootNodes`, `buildPlacedScene`, resolved page bounds, and explicit canvas/active-page/pasteboard scopes. |
| MM-04 | High | Outlier culling removed legitimate oversized or distant objects from content bounds. | Keep all finite geometry in the union; retain outlier markers only as diagnostics. |
| MM-05 | Medium | Zero-width/zero-height geometry was discarded, hiding lines and point-like objects. | Normalize degenerate display bounds to a one-world-unit footprint without mutating document geometry. |
| MM-06 | Medium | Resize handling watched only the minimap container, ignored zero widths, and redrew without recomputing the viewport. | Observe the minimap slot, parent panel, and canvas owner; recompute the footprint from current measurements. |
| MM-07 | Medium | Every draw assigned canvas backing-store dimensions, reallocating/clearing the bitmap during camera pan. | Assign device-pixel dimensions and CSS dimensions only when values actually change. |
| MM-08 | Medium | Viewport fill color parsed six-digit hex manually, misreading `rgb()`/`hsl()` tokens and zero-valued channels. | Use resolved CSS colors directly with alpha on the path fill/stroke. |
| MM-09 | Medium | `pointerleave` ended a captured drag; there was no robust cancel/blur/visibility/unmount cleanup, and the initial state was committed before pointer mapping succeeded. | Require the primary button, map first, capture the pointer, handle up/cancel/lost-capture, and cancel on blur, visibility, surface changes, and unmount. Preserve grab offset while dragging. |
| MM-10 | Medium | Minimap visibility had no durable recovery path and was not clearly separated from workspace panel state. | Persist `panel.minimapVisible` through the existing settings store and expose one action through View, command palette, and `Ctrl+Shift+M`; Show All Panels restores it. |

## Behavior contract after repair

- Minimap interaction changes only camera pan. It does not alter artwork,
  selection, dirty state, tool, or document undo history.
- A workspace switch preserves document, selection, camera, and minimap
  preference; the displayed scene follows the new workspace's surface scope.
- A document switch preserves the global minimap preference but recomputes
  scene bounds and the viewport footprint for the selected document.
- Page placement remains scene metadata. The minimap never writes page or node
  transforms.
- The minimap is discoverable through its docked Layers location, View menu,
  command palette, keyboard shortcut, and Fit button.

## Validation record

Commands run for this repair:

- `pnpm verify:plan` — affected plan selected the touched-file format/lint
  checks, editor/site/UI closures, the minimap unit/E2E paths, and keyboard
  coverage; full-suite escalation: **NO**.
- `pnpm exec vitest run packages/editor/src/components/Minimap packages/editor/src/settings.test.ts packages/editor/src/context/sessionBaseline.test.tsx packages/editor/src/menu/__tests__/menuSnapshot.test.ts --maxWorkers=1 --reporter=dot` — **120 tests passed**.
- `pnpm exec tsc -p tests/e2e/tsconfig.json --noEmit --pretty false` — passed.
- `pnpm --filter @varve/editor typecheck` — passed.
- `VARVE_E2E_PORT=1451 pnpm exec playwright test tests/e2e/canvas/minimap.spec.ts --project=chromium --workers=1 --reporter=list` — **1 browser test passed**. The visual capture was inspected at `/tmp/varve-minimap-visual.png`; it shows the rendered object overview and viewport outline.
- `pnpm audit:docs` — clean; `pnpm audit:emoji` — clean; `pnpm audit:tokens` — all 153 pairs passed across Light, Dark, and High Contrast.
- `node scripts/audit-architecture.mjs --ci` — no layer violations and the repository remains at its existing 15-cycle baseline; existing hub-budget/instability warnings remain unchanged.
- `pnpm verify:affected` — stopped at `format:touched` on unrelated concurrent changes in `apps/website/src/lib/changelog.ts`, `apps/website/src/test/changelog.test.ts`, and `packages/ui/src/components/ScrollArea.tsx`; the minimap files were clean in the same formatter selection.

Deliberately skipped: Rust workspace tests and the full visual suite, as the
plan found no native dependency change or global rendering-surface change.
The full repository suite was not run because the planner did not escalate.
