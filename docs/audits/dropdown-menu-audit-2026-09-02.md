# Dropdown and menu audit — 2026-09-02

Status: implementation audit and remediation record.

## Scope and method

This audit reviewed the supplied dropdown/menu brief against the repository,
then traced the actual menu primitives, definitions, overlay ownership,
consumer surfaces, tests, Storybook fixtures, and the marketing-site header.
The audit used repository search plus direct source inspection of:

- `packages/ui/src/components/Menu.tsx`, `Menu.test.tsx`, `Menu.stories.tsx`,
  `components.css`, `FloatingPortal.tsx`, and token sources;
- `packages/editor/src/Menubar.tsx`, `menu/defs.ts`, `menu/renderer.ts`,
  `menu/useMenu.ts`, and menu snapshots/integrity tests;
- layers, pages, guide, timeline, inspector, toolbar, breadcrumb, quick-bar,
  adjustment, and home file-context-menu consumers;
- `tests/e2e/menus/**`, canvas toolbar visual coverage, and the Astro
  `apps/website/src/components/SiteHeader.astro` plus navigation tests.

## 1. Inventory and semantic classification

| Area | Existing surface | Classification | Decision |
|---|---|---|---|
| Editor menubar | Custom portaled APG menu | Menubar + command submenus | Keep specialized renderer; align tokens |
| Canvas/layers/pages/guides/timeline | `ContextMenu` | Context menu | Keep; share `Menu` surface contract |
| Inspector command pickers | `Menu` | Command/overflow menu | Keep; use menu for operations |
| Colour, gradient, binding, adjustment editors | Popover/dialog/form controls | Rich editor | Keep non-menu semantics |
| Select and combobox controls | Select/listbox/combobox | Value selection/input | Keep their roles |
| Floating toolbar category flyouts | Contextual anchored menu | Overflow/submenu | Keep; use compact menu styling |
| Home project/file actions | `ContextMenu` | Context menu | Keep target-relative actions |
| Website desktop navigation | Direct links | Primary site navigation | Add selective grouped Learn/Support menus |
| Website mobile navigation | Full-screen disclosure | Responsive navigation | Keep; do not nest application menu roles |

The repository already had a shared menu primitive and shared overlay geometry.
The central issue was not a missing dropdown library; it was an incomplete
visual/data contract and inconsistent metadata propagation.

## 2. Implemented shared contract

The `@varve/ui` menu family now supports:

- semantic `compact`, `default`, and `rich` widths;
- stable menu IDs for `MenuButton`/`aria-controls` wiring;
- label headings and normalization of orphaned separators;
- leading icon, indicator, content/description, and trailing shortcut/badge
  slots;
- destructive treatment, keyboard shortcut metadata, and vertical menu
  orientation;
- shared surface treatment for dropdown and context menus;
- rich and overflow Storybook fixtures;
- tests for slots, normalization, size semantics, and accessibility metadata.

Editor menu definitions now pass their platform-formatted accelerators and
destructive state through the renderer. Destructive definitions are limited to
clear/delete/remove operations; routine actions do not receive danger styling.

## 3. Interaction and accessibility findings

The existing implementation already provided roving focus, type-ahead,
submenu corridors, Escape/Tab handling, owner-document portals, and overlay
tree dismissal. Those behaviors were retained and covered by the existing
focused tests and menu E2E suite. The remediation adds the missing descriptive
and shortcut metadata without changing the role taxonomy.

## 4. Rejected opportunities

- No new application-wide dropdown abstraction was introduced; it would
  duplicate the existing `Menu`/`FloatingPortal` architecture.
- No color picker, gradient editor, binding editor, select, or combobox was
  recast as a menu merely because it floats.
- No broad new actions were added to the menubar, toolbar, or context menus.
- No primary app workflow was hidden behind an ellipsis solely to reduce
  visible controls.
- The static website does not import React application primitives; its grouped
  navigation keeps an Astro-native accessible implementation.

## 5.1 Label readability follow-up

The first implementation review exposed a concrete width regression in the
Home file context menu: its compact surface reserved empty leading and trailing
lanes, leaving longer actions such as “Move earlier in order” visibly
ellipsized. The shared renderer now reserves those lanes only when a menu entry
needs them, while preserving alignment for mixed icon/shortcut menus. The Home
file menu uses the semantic `default` width, and default/rich labels wrap under
viewport pressure instead of being silently clipped. The specialized editor
menubar now follows the same label policy when shortcuts or submenu arrows
reduce its available text width.

## 6. Documentation and design-system changes

The canonical contract is documented in
`docs/architecture/menu-system.md`, indexed from `docs/README.md`, and this
dated audit records the repository classification and decisions. Existing
overlay documentation remains the source for geometry and lifecycle ownership;
the menu document supplies the semantic and visual layer above it.

## 7. Validation evidence

The staged impact plan selected menu/UI/editor checks, E2E typechecking, the
menu visual project, and the affected editor/UI closure; it did not escalate
to the full repository gate. The focused results were:

- `Menu.test.tsx` plus the renderer tests: 42 tests passed;
- menu snapshots plus command-integrity tests: 55 tests passed and 36
  snapshots were regenerated;
- `FloatingPortal.test.tsx`, `Menu.test.tsx`, and renderer tests: 49 tests
  passed;
- editor menubar visual integrity: 5 Chromium tests passed in light, dark,
  and high-contrast themes;
- overlay reliability: 1 Chromium test passed after fixing collision-style
  preservation and measuring a parent anchor after focus scrolling;
- website typecheck, Astro build, and Pages build passed (66 pages);
- focused website navigation E2E passed in both GitHub Pages and custom-domain
  projects (4 tests), including keyboard opening, roving menu focus, Escape
  restore, active state, and group switching.

Fresh screenshots were directly inspected at the Playwright output paths under
`test-results/run-51748-1451/` and the website navigation output paths under
`test-results/navigation-desktop-grouped-*/`. They show no clipping, aligned
shortcut columns, stable submenu placement, readable descriptions, and valid
light/dark/high-contrast treatment. The first broad affected run was blocked
by unrelated in-progress worktree errors in `useSam2Segmentation`,
`HomeShell`, and `context/types.ts`; the scoped commit checkpoints remained
green. The architecture audit also reported the concurrent
`context/types.ts → tools/types.ts` cycle, while the menu changes introduced
no boundary or health-budget violation. Full Vitest, Cargo, native GUI, and
release gates were intentionally not run.
