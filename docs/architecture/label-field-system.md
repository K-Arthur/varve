# Label and Field System Architecture

**Status:** Implemented (2026-09-07)
**Scope:** `@varve/ui` shared primitives, editor Inspector, home dialog, marketing website

## Overview

Varve has a coherent label and field-composition system built around small composable
primitives in `@varve/ui`. The system supports two distinct layout contexts:

1. **Compact inspector rows** — scan-heavy professional controls with short labels
   beside the control (via the editor's `FieldRow` / `NumberField`)
2. **Standard form fields** — dialog, settings, and library forms with labels above
   controls, descriptions, errors, and validation states (via `Field` + `FieldLabel` +
   `FieldDescription` + `FieldError`)

## Shared Primitives (`@varve/ui`)

### Field

| Component | Purpose | Key Props |
|-----------|---------|-----------|
| `Field` | Container for label+control composition | `layout?: 'column' \| 'row'`, `as?: 'div' \| 'fieldset'`, `disabled` |
| `FieldLabel` | Associated label with optional indicators | `htmlFor`, `required`, `optional`, `visuallyHidden` |
| `FieldDescription` | Static helper text below the control | `id` |
| `FieldError` | Validation error with `role="alert"` | `id` |
| `FieldControl` | Wrapper for the control element | — |

### useFieldIds Hook

Generates stable IDs and merges `aria-describedby` relationships for form components
that render their own labels internally (like `Input`, `TextArea`, `NativeSelect`):

```tsx
const { id, errorId, descriptionId, hintId, mergeDescribedBy } = useFieldIds(propId);
const describedBy = mergeDescribedBy(
  rest['aria-describedby'],  // caller-provided
  error ? errorId : undefined,
  hint ? hintId : undefined,
);
```

## Layout Contexts

### Standard Form Field (column layout)

```tsx
<Field>
  <FieldLabel htmlFor="email" required>Email</FieldLabel>
  <input id="email" type="email" />
  <FieldDescription id="email-desc">We won't share this.</FieldDescription>
  <FieldError id="email-err">Invalid email.</FieldError>
</Field>
```

Renders as a vertical stack: label above, control, description below, error below that.

### Compact Inspector Row (row layout)

The editor's `FieldRow` and `NumberField` use their own specialized CSS classes
(`insp-field`, `insp-field__label`, `insp-field__control`) for the dense inspector
layout. These remain separate from the shared Field system because:

- Inspector labels also act as scrub handles for numeric controls
- Inspector labels use `ew-resize` cursor for drag-to-scrub
- Inspector labels use `user-select: none`
- The inspector needs minimum vertical height (2rem) for pointer precision

The row grammar is responsive rather than fixed-width: the label column uses a
bounded percentage of the row and the control column is allowed to shrink to
zero before an input's intrinsic width can affect layout. This prevents a long
value, unit suffix, or binding affordance from expanding beyond the panel.

Related controls use `InspectorFieldGroup`:

```tsx
<InspectorFieldGroup columns={2}>
  <NumberField label="W" value={width} onChange={setWidth} unit="px" />
  <NumberField label="H" value={height} onChange={setHeight} unit="px" />
</InspectorFieldGroup>
```

Use a group for paired geometry, channel pairs, and action/value combinations.
At narrow inspector container widths the pair becomes a vertical stack. Do not
wrap multiple rows in `.insp-field`; `.insp-field` is one row only.

### Continuous values

`RangeValueControl` is the canonical slider-plus-precision composition. Every
continuous inspector parameter should expose both exploratory dragging and a
keyboard-editable numeric value. Use `displayScale={100}` when the document
stores a normalized value but the UI speaks in percentage points. The slider
continues to use the model range while the precision field uses the scaled range.

Comparison split handles and other visual scrubbers may remain slider-only when
there is no stored parameter to edit. A parameter slider must not be slider-only
merely because the panel is compact.

### Spacing, bounds, and viewport behavior

- Field groups use token gaps and `min-width: 0` at every grid/flex boundary.
- Numeric inputs, units, lock buttons, reset buttons, and selects stay inside
  the inspector content box; the parent panel never relies on horizontal
  scrolling to reveal a value.
- Paired rows use `minmax(0, 1fr)` tracks. A 240–320px desktop inspector can
  show pairs; below the narrow container threshold, paired fields stack.
- Effect Studio uses three columns on wide dialogs, two columns on medium
  dialogs, and one document-flow column on phone-sized dialogs. Its inspector
  is not sticky in the one-column layout, so it cannot cover the gallery.
- The same spacing contract applies in light, dark, and high-contrast themes.
  Surfaces, labels, borders, errors, and focus rings use semantic tokens;
  high-contrast adds visible edges to controls that are transparent-border in
  the regular themes.

```tsx
// Editor Inspector pattern (specialized, not migrated)
<FieldRow label="Opacity" htmlFor={opacityId}>
  <input id={opacityId} type="range" ... />
</FieldRow>

// or with NumberField (self-contained)
<NumberField label="X" value={xValue} onChange={...} unit="px" />
```

### Setting/Choice Row (via SwitchField)

```tsx
<SwitchField
  label="GPU acceleration"
  description="Use hardware acceleration where available."
  disabledReason="Requires compatible hardware."
  checked={enabled}
  onChange={setEnabled}
/>
```

## Accessibility Rules

### Label Association

Every control must have a programmatically-associated accessible name:

| Pattern | When to Use |
|---------|-------------|
| `label[htmlFor]` | Native form controls (`input`, `select`, `textarea`) |
| Wrapping `<label>` | Inline toggles (Switch, Checkbox, Radio) |
| `<fieldset>` + `<legend>` | Related checkbox/radio groups |
| `aria-labelledby` | Composite controls that cannot use `htmlFor` |
| `aria-label` | Only where a visible label is genuinely inappropriate |

### Description/Error Linking

All descriptions and errors are linked via `aria-describedby`:

```tsx
<input
  aria-describedby="field-desc field-error"
  aria-invalid={hasError ? 'true' : undefined}
/>
<p id="field-desc">Helper text</p>
<p id="field-error" role="alert">Error message</p>
```

### aria-invalid Consistency

All components use **string `'true'`** for `aria-invalid` (not boolean `true`),
ensuring CSS selectors `[aria-invalid="true"]` work correctly.

## Design Tokens

| Token | Use |
|-------|-----|
| `--type-interface-label-size` | Label font size (sm) |
| `--type-interface-label-line-height` | Label line height (1.35) |
| `--font-weight-medium` | Label font weight (500) |
| `--color-text-secondary` | Label color |
| `--color-text-muted` | Description/hint color |
| `--color-feedback-danger` | Error color |
| `--space-label-control` | Gap between label and control |
| `--space-form-field` | Gap between form fields |
| `--font-size-xs` | Description/error font size |

## Migration Status

| Surface | Status | Notes |
|---------|--------|-------|
| `Input` | ✅ Migrated | Uses `useFieldIds` for ID generation |
| `TextArea` | ✅ Migrated | Uses `useFieldIds` for ID generation |
| `NativeSelect` | ✅ Migrated | Uses `useFieldIds` for ID generation |
| `Checkbox` | ✅ Enhanced | Added `description`, `error`, `aria-describedby` |
| `SwitchField` | ✅ Retained | Already a well-designed composition |
| `RadioGroup` | ✅ Retained | Uses `<fieldset>` + `<legend>` correctly |
| `Slider` | ✅ Retained | Uses `<fieldset>` + `<legend>` correctly |
| `Select` | ✅ Fixed | `aria-invalid` now uses string `'true'` |
| `Combobox` | ✅ Fixed | `aria-invalid` now uses string `'true'` |
| `MultiSelect` | ✅ Fixed | `aria-invalid` now uses string `'true'` |
| `NumberInput` | ✅ Fixed | `label` prop now optional; external `<label htmlFor>` supported |
| Home `NewDesignDialog` | ✅ Fixed | Removed duplicate labels, associated DPI/Bleed via `htmlFor` |
| Home `NewFileDialog` | ✅ Fixed | Removed duplicate labels, associated DPI/Bleed via `htmlFor` |
| Home `ShareDialog` | ✅ OK | Proper `<label htmlFor>` on email input |
| Home `VersionHistory` | ✅ OK | Proper `<label htmlFor>` on naming input |
| Home `FilterDropdown` | ✅ OK | Wrapping `<label>` for checkboxes, proper a11y |
| Editor `FieldRow` | ✅ Standardized | Responsive label/control row with bounded tracks |
| Editor `InspectorFieldGroup` | ✅ Added | Responsive paired/triple/action grid with narrow-panel stacking |
| Editor `NumberField` | ✅ Retained | Specialized for scrub/undo/wheel |
| Editor `RangeValueControl` | ✅ Standardized | Slider plus direct precision entry, including normalized percentage scaling |
| Marketing website | ✅ Updated | Feature copy explains precision controls and responsive inspector behavior |

## Home Screen Fixes

The home screen had several label association issues:

### Duplicate Labels (fixed)
Both `NewDesignDialog` and `NewFileDialog` had duplicate accessible names on
width/height NumberInputs: a visible `<label htmlFor>` AND a `label="Width"` prop
on NumberInput (which renders as `aria-label`). The `label` prop was removed from
NumberInput in these contexts, leaving the visible `<label>` as the sole accessible
name.

### Redundant aria-label (fixed)
`NewDesignDialog`'s name input had both `aria-label="Document name"` AND a
`<label htmlFor="new-design-name">`. The redundant `aria-label` was removed.

### Unassociated labels (fixed)
"DPI" and "Bleed" labels in both `NewDesignDialog` and `NewFileDialog` were
`<span>` elements with no programmatic association to their NumberInputs. Converted
to `<label htmlFor>` with matching `id` props on the NumberInputs.

### NumberInput label prop (changed)
Made the `label` prop optional (was required). When an external `<label htmlFor>`
provides the accessible name, the `label` prop should be omitted to avoid
duplication. Existing callers that pass `label` continue to work unchanged.

### FilterDropdown (retained)
Uses wrapping `<label>` elements around native checkboxes with `accent-color`.
This is a valid a11y pattern. The native checkboxes are intentionally used for
their compact appearance in the filter popover.

## Specialized Patterns Retained

### Inspector NumberField Scrub Labels

The editor's `NumberField` uses its label as a drag-to-scrub handle. This dual
purpose (accessible name + interaction handle) is unique to the inspector and does
not generalize to the shared Field system.

### Inspector FieldRow Responsive Label Column

The inspector's `insp-field__label` uses a bounded row-relative column instead of a
fixed width. This keeps short labels aligned while allowing the control column to
retain usable input widths as a panel is resized. Labels still retain their scrub
cursor and the accessible name of the `NumberField`.

### NewDesignDialog Inline Grid

The new design dialog uses a horizontal grid of label+control pairs
(`new-design__field-row`) where labels are used as inline category markers rather
than form labels. This layout is specific to the preset picker and dimension entry
workflow.

## Testing

- **23 Field tests**: Field container, FieldLabel (htmlFor, required, optional, visuallyHidden), FieldDescription, FieldError (role="alert"), FieldControl, useFieldIds hook (unique IDs, mergeDescribedBy), full composition scenarios
- **11 Checkbox tests**: description/error/aria-describedby linking, merged describedBy, external aria-describedby preservation
- **Existing tests**: All 63+ existing form component tests continue to pass

## CSS Architecture

All form component CSS uses design tokens exclusively. No hardcoded colors, spacing,
or typography values. Key CSS classes:

| Class | Purpose |
|-------|---------|
| `.varve-field` | Shared field container |
| `.varve-field--row` | Compact row layout |
| `.varve-field__label` | Label typography and color |
| `.varve-field__description` | Description text styling |
| `.varve-field__error` | Error text styling |
| `.varve-field__required` | Required indicator |
| `.varve-field__optional` | Optional marker |
| `.varve-field__control` | Control wrapper |
| `.insp-field` | Inspector-specific row layout |
| `.insp-field__label` | Inspector label (bounded column, scrub cursor) |
| `.insp-field__control` | Shrinkable control column with internal pair handling |
| `.insp-field-group` | Vertical stack/positioned anchor for related rows |
| `.insp-field-group--columns-2` | Responsive two-column group |
| `.range-value-control` | Shared slider and precision-entry group |
