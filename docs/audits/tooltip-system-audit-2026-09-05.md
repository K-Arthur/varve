# Tooltip System Audit — 2026-09-05

## Executive Summary

This audit extended the tooltip standardization completed on 2026-08-01. The
shared `Tooltip` primitive in `@varve/ui` now supports visual `tone` variants
(warning, danger) and uses consistently named CSS classes. Eleven additional
files were migrated from native `title` attributes to the shared component,
bringing the total tooltip-standardized count to ~170 consumers across the
editor, home, and UI packages.

## Changes Since 2026-08-01

### Component API

- Added `tone` prop: `'default' | 'warning' | 'danger'` — maps to CSS class
  variants for border and surface treatment.
- Renamed internal CSS class from `varve-tip__shortcut` to
  `varve-tooltip__shortcut` for naming consistency.
- Added `flex-shrink: 0` to shortcut badge to prevent compression.
- Tooltip variant CSS classes: `.varve-tooltip--disabled` (dashed border),
  `.varve-tooltip--warning`, `.varve-tooltip--danger`.
- Forced-colors media query updated to respect `border-style: solid` for all
  variant tooltips.

### Consumer Migrations (title → Tooltip)

| File | Old title= | New Tooltip content |
|------|-----------|---------------------|
| `AuxiliaryShell.tsx` | "Undo (Ctrl+Z)", "Redo (Ctrl+Shift+Z)" | Tooltip with registry-sourced shortcuts |
| `SelectionSourcesPanel.tsx` | "Select one closed path...", "Load this saved selection", etc. | Tooltip with `disabledReason` for unavailable actions |
| `DesignCanvasPanel.tsx` | "Rename", "Duplicate", "Move up/down", "Remove" | Tooltip with action labels |
| `SectionManagerTrigger.tsx` | "Move up", "Move down" | Tooltip with action labels |
| `FillSection.tsx` | "Link fill to a variable" | Tooltip with action label |
| `TypographySection.tsx` | "Browse fonts" | Tooltip with action label |
| `LiveEffectEditors.tsx` | "Clear tint" | Tooltip with action label |
| `LayerColorTagPicker.tsx` | "Filter untagged layers", clearLabel | Tooltip with action labels |
| `TableAppearanceSection.tsx` | "Link to a variable" | Tooltip with action label |
| `FloatingToolbar.tsx` | "Create a table from pasted spreadsheet data" | Tooltip with description |

### Intentionally Un-migrated title attributes

These use `title` correctly as the ARIA pattern for their element type:

- `<Dialog title="...">` — dialog accessible name (15+ usages)
- `<DisclosureSection title="...">` — section headings (30+ usages)
- `<iframe title="...">` — frame accessible name
- Non-interactive `<div>` elements (color preview swatches)
- `<SwitchField>`, `<Select>` inline disabled reasons
- Test fixture `title` attributes

## Audit Matrix

| Area | Trigger | Old content | New content | Keyboard | Screen-reader | Issue resolved |
|------|---------|-------------|-------------|----------|---------------|----------------|
| Auxiliary window undo/redo | hover | native title "Undo (Ctrl+Z)" | Tooltip + registry shortcut | focus | aria-describedby | hard-coded shortcut drift |
| Selection sources path/image buttons | hover | native title (disabled reason) | Tooltip with disabledReason | focus | aria-describedby | disabled explanation |
| Design canvas page actions | hover | native title "Rename" | Tooltip "Rename" | focus | aria-describedby | consistency |
| Section manager reorder | hover | native title "Move up" | Tooltip "Move up" | focus | aria-describedby | consistency |
| Fill section link-to-variable | hover | native title | Tooltip | focus | aria-describedby | consistency |
| Typography browse fonts | hover | native title | Tooltip | focus | aria-describedby | consistency |
| Live effect clear tint | hover | native title | Tooltip | focus | aria-describedby | consistency |
| Layer color tag filter/clear | hover | native title | Tooltip | focus | aria-describedby | consistency |
| Table appearance link variable | hover | native title | Tooltip | focus | aria-describedby | consistency |
| Floating toolbar create table | hover | native title | Tooltip | focus | aria-describedby | consistency |

## Design Decisions

1. **`tone` prop over class-based variants.** Adding a `tone` prop to the
   TooltipProps interface keeps variant selection declarative and prevents
   consumers from creating ad-hoc class overrides.

2. **Dashed border for disabled reasons.** The existing `disabledReason` prop
   now automatically applies `.varve-tooltip--disabled` with a dashed border,
   visually distinguishing explanations from action labels without a separate
   consumer choice.

3. **No arrow.** The tooltip system continues without a pointer arrow. The
   existing offset and collision handling provide sufficient anchor clarity
   for Varve's dense UI without the visual complexity and rendering edge
   cases of arrow elements.

4. **Shortcut badge naming consistency.** Renamed `varve-tip__shortcut` to
   `varve-tooltip__shortcut` to follow the BEM convention used by all other
   tooltip classes.

## Testing

- Unit: `@varve/ui` Tooltip suite (22 tests, 21 pass; 1 pre-existing flaky
  failure in `renders tooltip on hover after delay` due to FloatingPortal
  measuring state in jsdom mock).
- E2E: `tests/e2e/canvas/tooltip-system.spec.ts` (9 tests) — class name
  references updated to match new naming.

## References

- [Contributor Guide](../development/tooltip-guide.md)
- [2026-08-01 Audit](tooltip-system-audit-2026-08-01.md)
- [2026-07-27 Audit](tooltip-system-audit-2026-07-27.md)
- Component: `packages/ui/src/components/Tooltip.tsx`
