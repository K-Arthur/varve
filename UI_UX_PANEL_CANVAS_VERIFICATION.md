# Varve Panels and Canvas Information UI/UX Verification

Date: 2026-08-29

## Scope

This verification covers the progressive UI/UX remediation documented in
`UI_UX_PANEL_CANVAS_AUDIT.md` and `UI_UX_PANEL_CANVAS_TARGET.md`:

- logical sibling metadata for the virtualized Layers tree;
- accessible current value and controlled-pane semantics for panel splitters;
- Escape, backdrop, and focus restoration for responsive Layers, Inspector, and
  Resources drawers;
- named selection information and concise, non-geometry live announcements;
- the pre-existing `MockupsPanel` missing `Icon` import that otherwise crashed
  the shared panel shell during browser verification.

No engine, render-pipeline, file-format, or native-window changes were made.

## Progressive commits

| Commit | Change |
|---|---|
| `3fb344ea` | audit and target architecture |
| `fa6d618b` | logical Layers tree positions |
| `ab44b773` | splitter semantics |
| `ce969dd7` | responsive drawer dismissal/focus |
| `12379739` | selection information semantics |

## Visual evidence

Ignored local artifacts are under:
`artifacts/ui-ux-panels-canvas/2026-08-29-baseline/` and
`artifacts/ui-ux-panels-canvas/2026-08-29-after/`.

After-state captures were opened and inspected at:

- Home, 1440×900, empty state;
- editor, 1440×900, blank and one selected rectangle;
- editor, 900×700, blank;
- editor, 640×700, blank responsive drawer/FAB layout.

Observed after-state: the shell remains visually balanced at desktop and
compact desktop widths; the selected rectangle agrees across canvas overlay,
Layers, Inspector, and the persistent strip; at 640px the closed drawers are
off-screen while the three FAB triggers remain available. The capture script
reported no console or page errors. The semantic probe returned:

```text
Selection information
Rectangle 1, Rectangle selected.
Resize layers panel: 288px → editor-layers-panel
Resize inspector panel: 320px → editor-inspector-panel
```

No recording was captured; screenshots and real-browser interaction coverage
were sufficient for this scope.

## Commands run

Passed:

- `pnpm verify:plan` and staged `pnpm verify:plan --staged` for each slice;
- focused Biome checks for all changed TypeScript/TSX/CSS files;
- `pnpm exec vitest run packages/editor/src/components/LayersPanel/useFlatTree.test.ts packages/editor/src/components/LayersPanel/LayersRow.test.tsx` — 45 passed;
- `pnpm exec vitest run packages/editor/src/components/PanelResizeHandle.test.tsx packages/editor/src/components/LayersPanel/useFlatTree.test.ts packages/editor/src/components/LayersPanel/LayersRow.test.tsx` — 47 passed;
- `pnpm exec vitest run packages/editor/src/components/Mockups/MockupsPanel.test.tsx` — 6 passed;
- `pnpm exec vitest run packages/editor/src/components/SelectionInfoBar/SelectionInfoBar.test.tsx` — 3 passed;
- `pnpm typecheck:e2e`;
- `VARVE_E2E_PORT=1493 pnpm exec playwright test tests/e2e/a11y/responsive-panels.spec.ts --project=chromium --workers=1 --reporter=list` — 1 passed;
- `VARVE_E2E_PORT=1494 pnpm exec playwright test tests/e2e/layers/axe.spec.ts tests/e2e/layers/accessibility.spec.ts --project=chromium --workers=1 --reporter=list` — 11 passed;
- `pnpm audit:docs`;
- `pnpm audit:emoji`;
- `pnpm audit:tokens` — 135 pairs passed across 3 themes;
- pre-commit health, import-boundary, secret, contact, and emoji checks for
  each implementation commit.

Known failures or limitations:

- `pnpm --filter @varve/editor typecheck` reports pre-existing errors in mask
  replay types, nudge/export-region tests, selection arrangement, NodeEditTool,
  and the missing `MockupsPanel` `Icon` import that was fixed in this work.
  The command was run before the import fix; the focused Mockups test and
  browser run pass after it.
- `node scripts/audit-architecture.mjs --ci` was started because `Shell.tsx`
  was touched. Its partial output reported existing engine/scene dependency
  cycles, then the repository-wide complexity scan exceeded six minutes and
  was terminated. No new Shell import was added; the pre-commit health gate
  passed on the touched Shell file.
- The first responsive E2E attempt exposed a shared-helper assumption that
  Layers must be visible at mobile width; the test now navigates at desktop and
  switches to 640px before exercising the mobile drawer. The second attempt
  exposed React's `data-visible="true"` serialization and an existing
  `MockupsPanel` crash; both were corrected, and the final run passed.

## Coverage boundary

Actually exercised: Linux/CachyOS, Chromium via the Vite desktop entry point,
DPR 1, light theme, 1440×900, 900×700, and 640×700, blank and selected
documents, keyboard drawer dismissal, focus restoration, Layers keyboard
navigation, and axe-core Layers scanning.

Not freshly exercised: real Tauri window management, Wayland compositor icon or
window behavior, Firefox, Safari/WebKit, Windows/macOS, physical touch/pen
input, screen readers, RTL/localization, forced colors, DPR 2, and 200% browser
or OS scaling. The report does not claim those environments are verified.

## Preserved unrelated work

Only explicit paths were staged for the progressive commits. Existing dirty
changes in Rust sync, platform/recent-files, Home, unrelated inspector/mockup
CSS, Bézier helpers/tests, layout tooling, and the scratch Playwright config
were left untouched and are not part of these commits.

## Acceptance result

The scoped remediation is implemented and browser-verified for the supported
local environment above. The remaining repository-wide typecheck and
architecture-audit limitations are recorded rather than attributed to these
UI changes. The final impact-aware validation result is appended below after
`pnpm verify:affected` completes.
