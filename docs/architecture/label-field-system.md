# Label and Field System Architecture

**Status:** Implemented (2026-09-05)
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
layout. These are intentionally kept separate from the shared Field system because:

- Inspector labels have a fixed 3.75rem width for column alignment
- Inspector labels use `ew-resize` cursor for drag-to-scrub
- Inspector labels use `user-select: none`
- The inspector needs minimum vertical height (2rem) for pointer precision

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
| Editor `FieldRow` | ✅ Retained | Specialized for dense inspector layout |
| Editor `NumberField` | ✅ Retained | Specialized for scrub/undo/wheel |
| Marketing website | ✅ N/A | No form fields to migrate |

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

### Inspector FieldRow Fixed Width

The inspector's `insp-field__label` has a fixed 3.75rem width for column alignment
across all inspector sections. This is incompatible with the shared Field system's
flexible label width.

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
| `.insp-field__label` | Inspector label (fixed width, scrub cursor) |
