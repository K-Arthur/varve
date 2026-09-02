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

## 5. Documentation and design-system changes

The canonical contract is documented in
`docs/architecture/menu-system.md`, indexed from `docs/README.md`, and this
dated audit records the repository classification and decisions. Existing
overlay documentation remains the source for geometry and lifecycle ownership;
the menu document supplies the semantic and visual layer above it.

## 6. Validation evidence

The final report for this change records the exact affected plan, focused unit
tests, website tests, Playwright menu/visual runs, screenshot paths, direct
image inspection, and the required audits. A visual result is not considered
verified from a green assertion alone: captured menu states are inspected for
clipping, alignment, contrast, submenu placement, and unexpected chrome.
