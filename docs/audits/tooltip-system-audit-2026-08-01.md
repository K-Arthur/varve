# Tooltip System Audit — 2026-08-01

## Executive Summary

This audit completed the tooltip standardization effort begun on 2026-07-27.
The shared `Tooltip` primitive in `@varve/ui` (APG tooltip pattern, Floating
UI positioning, portaled to `document.body`) is now the single tooltip
implementation across the product. The home app — previously 100% native
`title` attributes — was migrated wholesale, the editor's remaining
native-title controls were converted, and the design-system package's own
competing native-title implementation (`ToggleButton.tooltip`) was removed.

The audit also discovered and fixed a real **shortcut-truth bug**: the
workspace-mode buttons advertised `Ctrl+Shift+D/P/R/I/M` in their tooltips,
but those bindings are actually taken by Repeat Duplicate, Present, Invert
Selection, and Preview Mode, and workspace switching really executes on
`Ctrl+Shift+1..5/9` from the shortcut registry. All workspace shortcut
displays now resolve from the registry.

## Audit Matrix

| Area | Trigger | Old content | New content | Placement | Keyboard access | Screen-reader behaviour | Issue resolved |
| ---- | ------- | ----------- | ----------- | --------- | --------------- | ----------------------- | -------------- |
| Home toolbar sort toggle | hover | native `title` | Tooltip "Sort ascending/descending" | top | focus | aria-describedby | a11y + consistency |
| Sidebar New Project | hover | native `title` | Tooltip "New project" | top | focus | aria-describedby | a11y + consistency |
| File/asset/template names | hover | native `title` | truncationOnly Tooltip | top | focus | aria-describedby | redundant-tooltip elimination |
| Batch move-to-project | hover | native `title` | Tooltip "Move to X" | top | focus | aria-describedby | consistency |
| Menubar home | hover | `title="Home (Ctrl+Shift+H)"` | Tooltip "Home" + registry shortcut | bottom | focus | aria-describedby | hard-coded shortcut drift |
| Menubar workspace modes | hover | `title="Design workspace (Ctrl+Shift+D)"` | Tooltip + `workspaceShortcutLabel()` (Ctrl+Shift+1) | bottom | focus | aria-describedby | **wrong-shortcut bug** |
| ShortcutPalette export/import/reset/remap | hover | `title` only, **no accessible name** | Tooltip + aria-label | top | focus | aria-describedby | missing accessible names |
| IntelligencePanel dismiss/suppress | hover | `title` only, **no accessible name** | Tooltip + aria-label | top | focus | aria-describedby | missing accessible names |
| IntelligencePanel select-node (no node) | hover | enabled no-op or disabled | Tooltip + disabledReason (focusable) | top | focus | aria-describedby | disabled explanation |
| AssetExportControls desktop-only format | hover | `title="Requires desktop app"` | disabledReason Tooltip | top | focus | aria-describedby | disabled explanation |
| Timeline mute/solo | hover | `title="Unmute"/"Mute"` | state-aware Tooltip "Unmute track" | top | focus | aria-describedby | stale state wording |
| LayersRow badges | hover | native `title` + role=img | Tooltip + role=img/aria-label | top | focus | aria-describedby | double-tooltip removal |
| Layer names | hover | native `title` (always) | truncationOnly Tooltip | top | focus | aria-describedby | redundant tooltip |
| Status badges (Debt, Audit, Preflight, Layout, Contrast, Cognitive) | hover | native `title` | Tooltip (content also in aria-label) | top | focus | aria-describedby | consistency |
| ui ToggleButton | hover | `title` via `tooltip` prop | none (aria-label is the name) | — | — | — | removed competing impl |

## Root Causes

1. **No global provider.** `TooltipProvider` was mounted per-toolbar/panel
   (11 local mounts), so warm-up timing never spanned surfaces and there was
   no single place to add it. Fixed by mounting one provider in `App.tsx`.
2. **Native `title` proliferation.** ~120 real tooltip instances across
   home and editor used browser-native titles: no delay control, no
   keyboard access, no ARIA association, no theming.
3. **Missing accessible names.** Icon-only buttons (ShortcutPalette,
   IntelligencePanel, SelectionSetsSection) relied on `title` as their only
   accessible name; migrating to Tooltip + explicit `aria-label` fixed this.
4. **Hard-coded shortcut drift.** `WORKSPACE_SHORTCUTS` claimed
   `Ctrl+Shift+D/P/R/I/M/9` while the registry executes
   `Ctrl+Shift+1..5/9`; the ShortcutPalette already showed the registry
   binding, so tooltips and reality disagreed.
5. **Competing implementations.** `ToggleButton.tooltip` rendered a native
   `title` inside the design system itself.

## Migration Status

| Area | Status |
|------|--------|
| Global provider | Done (`apps/desktop/src/App.tsx`) |
| Home app | Done — zero native tooltips remain |
| Editor icon-only a11y gaps | Done |
| Menubar (home + workspace shortcuts) | Done — registry-sourced |
| ShortcutPalette | Done |
| IntelligencePanel | Done |
| Layers / Selection Sets / Filter bar | Done |
| Timeline (tracks + ruler markers) | Done |
| Inspector (mask, contrast, cognitive, palette, sections) | Done |
| ui package (ToggleButton, swatches, eye-dropper) | Done |
| `matchWorkspaceShortcut`/`getWorkspaceShortcutHint` dead APIs | Deferred (see Deferred Work) |

## Testing

- Unit: `@varve/ui` Tooltip suite (22 tests) + home/editor suites pass.
- E2E: `tests/e2e/canvas/tooltip-system.spec.ts` (9 tests) and
  `tests/e2e/home/tooltips.spec.ts` (4 tests) pass on Chromium.
- Fixed a pre-existing E2E strict-mode failure in the canvas-drag test
  (locator resolved to 5 elements).

## References

- [Contributor Guide](../development/tooltip-guide.md)
- [2026-07-27 Audit](tooltip-system-audit-2026-07-27.md)
- Component: `packages/ui/src/components/Tooltip.tsx`
