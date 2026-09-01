# Select system

Varve uses a small family of choice controls rather than treating every
one-of-many interaction as the same dropdown. This document is the current
contract for those controls. The implementation lives in `@varve/ui`; the
editor owns only the option data and the decision about which control is
appropriate.

## Semantic decision table

| Need | Control | Varve implementation |
| --- | --- | --- |
| A small, finite, single value | Compact select | `Select` |
| A single value from a long or known list | Searchable select | `Select searchable` or `Combobox` when free text is valid |
| More than one value at once | Token/count picker | `MultiSelect` |
| Two to four frequently changed peer modes | Radio/segmented control | `RadioGroup` or `SegmentedControl` |
| Rich visual choices | Dedicated browser | `PresetPicker`, `BrushBrowser`, font/icon browsers, or feature picker |
| Native platform behavior is valuable | Native select | `NativeSelect` |
| Object/document navigation | List/tree/browser | The owning feature's list or tree, not `Select` |

The option count is a signal, not a rule. A short list with long labels may
still need search, while a frequently used four-way mode is usually faster as
a segmented or radio control. A control must not be converted to a `Select`
only to make markup look uniform.

## `Select` contract

`Select` is the compact, select-only control. Its current public API remains
backwards compatible with the original `value`/`onChange` pair and also
supports the clearer `onValueChange` name for new code:

```tsx
<Select
  label="Rendering intent"
  value={intent}
  onValueChange={setIntent}
  options={[
    { value: 'relative', label: 'Relative colorimetric' },
    { value: 'perceptual', label: 'Perceptual' },
  ]}
  description="Controls how out-of-gamut colours are mapped."
/>
```

Important properties:

- `value` is controlled; `defaultValue` starts an uncontrolled select.
- `onValueChange` and the legacy `onChange` are aliases. If both are passed,
  only `onValueChange` is called.
- `options` contain stable values. Labels are display text and may be
  localized.
- `groups` can provide meaningful labelled groups. Grouping is not a
  substitute for a dedicated browser.
- `description` is static helper text and is linked with `aria-describedby`.
  `error` is reserved for invalid state and is exposed as an alert for the
  existing form-validation contract.
- `icon` and `status` are optional option metadata. Icons are for recognition;
  status indicators are reserved for actual semantic states.
- A selected value that disappears from a dynamic option list is retained and
  displayed as unavailable. The component does not silently select an
  unrelated value; the owner decides whether and how to migrate it.
- `searchable` is explicit. It adds a filter input and uses normalized
  substring matching. Large, rich, or preview-driven datasets should use a
  dedicated browser instead.

The trigger is a real button with select-only combobox semantics, never a
form-submit button. The popup is rendered by `FloatingPortal`, so placement,
collision handling, overlay ownership, and owner-document behavior remain
centralized. The trigger and popup use the shared focus ring and surface
tokens. Ordinary selects stay neutral and compact; semantic colors are not
used as decoration.

## `MultiSelect`

`MultiSelect` owns an array of stable values and exposes a compact summary in
the trigger (`Select values`, one label, or `N selected`). The popup uses a
multi-select listbox with search, selected-state indicators, disabled options,
and optional `maxSelected`. It retains selected values that are temporarily
hidden by search and does not silently discard values when async options are
reloaded. Use it only when multiple simultaneous values are meaningful.

## `Combobox` and specialized browsers

`Combobox` remains the control for editable text with suggestions. It is not a
styling variant of `Select`: `restrictToOptions` is the explicit boundary
between free text and a constrained value.

Fonts, brushes, effects, gradients, presets, icons, and model libraries may
need previews, metadata, favorites, loading/error states, or virtualization.
Those stay in their feature browsers (`FontSelector`, `PresetPicker`, and
similar) rather than making the compact `Select` API card-shaped. A searchable
`Select` is appropriate for a moderately sized textual list; a browser owns
large or rich data.

## Native controls and forms

`NativeSelect` is intentionally available for simple fields where OS/browser
behavior, touch interoperability, or low rendering cost is the priority. It
supports the same stable option/group model and helper/error relationships,
but leaves popup rendering to the platform. It should not be replaced merely
because its menu differs between WebKitGTK, Windows WebView, macOS, and a
browser.

All staged dialog forms update temporary state through the select callback.
Applying the dialog commits that state; Cancel does not. Immediate inspector
fields may continue to update the editor directly through their existing
command/history path.

## Layout, keyboard, and reduced motion

Select triggers fill their available width, truncate long selected labels, and
reserve space for the chevron. Popup width matches the trigger by default and
is capped by the viewport; `FloatingPortal` handles flip/shift collision
behavior. The popup has internal scrolling and opens with the selected item
visible when possible.

Keyboard behavior is stable across browser and desktop builds: Enter/Space or
Arrow keys open, arrows/Home/End navigate enabled options, typeahead works for
non-searchable lists, Enter selects, Escape closes, and focus returns to the
trigger. Search fields own their active descendant while open. Disabled options
remain readable and expose a reason when supplied.

Opening motion is short and tokenized. `prefers-reduced-motion: reduce`
removes decorative transitions without changing state or focus behavior.

## Validation and exceptions

The canonical focused tests are `packages/ui/src/components/Select.test.tsx`,
`MultiSelect.test.tsx`, and `NativeSelect.test.tsx`. Feature-level tests should
exercise their owning workflow, not reimplement popup semantics. The audit
record at `docs/audits/select-system-audit-2026-08-31.md` records the current
repository inventory, migration decisions, visual-validation matrix, and
remaining justified exceptions.
