# Switch system

**Status:** current production contract
**Last updated:** 2026-08-31

Varve uses a switch only for an immediate or persisted binary setting. The
checked state means the positive setting is active: `Show guides`, `Enable
snapping`, `Use GPU acceleration`, and `Include bleed` are good labels. A
switch is not a shortcut for a mode picker, command, destructive action, or
theme selector.

## Components

`@varve/ui` exposes two related components:

```tsx
<Switch
  label="Show guides"
  checked={showGuides}
  onChange={(event) => setShowGuides(event.currentTarget.checked)}
/>

<SwitchField
  label="GPU acceleration"
  description="Use hardware acceleration where available."
  checked={gpuEnabled}
  onChange={(event) => setGpuEnabled(event.currentTarget.checked)}
/>
```

`Switch` is a lightweight native checkbox with `role="switch"`. It supports
controlled and uncontrolled operation, forwards the input ref, preserves
native form reset behavior, and generates an ID when one is not supplied.
`SwitchField` composes a label, optional description, optional disabled reason,
and the same primitive. It is for settings rows; dense inspector and toolbar
surfaces should use `Switch` directly.

The field API is deliberately small:

- `label` is required.
- `description` adds supporting copy and is included in `aria-describedby`.
- `disabledReason` explains why an unavailable dependent setting is disabled
  and is also included in `aria-describedby`.
- `size` belongs to `Switch` (`compact` by default, `default` for settings).
- `checked`/`defaultChecked`, `onChange`, `disabled`, `name`, `value`, and
  native input attributes retain normal HTML semantics.

## Visual specification

The base control is compact, token-backed, and stable at high-DPI scales.

| Property | `compact` | `default` |
|---|---:|---:|
| Track | 32 × 18 px | 36 × 20 px |
| Thumb | 14 px | 16 px |
| Thumb travel | 12 px | 14 px |
| Visual radius | pill | pill |
| Minimum layout target | 24 px high | 24 px high |
| State motion | 100 ms token transition | 100 ms token transition |

The off track uses the sunken surface and strong border. The on track uses the
semantic interactive color. The thumb stays high contrast in both states.
Hover and pressed states change contrast only; they do not change geometry.
Focus is a visible ring around the track. Disabled off and disabled on remain
different, and the control does not depend on color alone for its state: the
thumb position and track/border treatment also change.

All colors come from the shared theme tokens. There are no arbitrary blue,
teal, orange, or red switch variants. The base primitive does not import
Motion; reduced motion removes its transitions through CSS.

## Semantic decision rules

- Use `Switch` for one binary setting whose state can be described as on/off.
- Use a checkbox for multi-select, inclusion lists, acknowledgements, or a
  potentially mixed value.
- Use `Radio`, `SegmentedControl`, or a native radio group for mutually
  exclusive peer choices such as color space, render mode, or theme.
- Use `ToggleButton` or a checkable menu item for a toolbar action or command
  whose state is interaction-local rather than a setting.
- Keep long-running work as an action with progress, cancellation, and failure
  feedback. Do not show a checked switch while an async operation is merely
  being requested.

## State and layout rules

The application, document, or dialog draft remains the single source of truth.
Migrating markup must not change persistence scope, undo behavior, Apply/Cancel
boundaries, or default values. Dependent settings retain their stored value
while disabled unless the product explicitly says that disabling resets it.

Use `SwitchField` descriptions for consequential settings, network/privacy
choices, experimental behavior, and restart-required behavior. Keep the
switch itself separate from the row so an inspector can remain narrow. Its
content column may shrink and wrap; the fixed control column must remain
visible inside dialogs, ScrollAreas, and resizable panels.

Labels and descriptions must be associated through generated or caller-supplied
IDs. Do not add a second local state mirror for a controlled switch. Native
keyboard behavior supplies Tab and Space; custom handlers are not needed.

## Website guidance

The marketing site has a two-option Light/Dark theme selector, implemented as
a radio group because the choices are peers. It is not a switch. The website
selector follows the same visible-state, focus, forced-colors, reduced-motion,
and persistence expectations, with Left/Right and Home/End keyboard movement.

## Verification checklist

For a new switch or migration, verify pointer and label activation, Tab and
Space, disabled behavior, controlled updates, uncontrolled defaults, form reset
when relevant, generated IDs, light/dark/high-contrast tokens, reduced motion,
and narrow-panel wrapping. For async or dependent settings, verify success,
failure, rapid reversal, disabled explanation, and restoration of the stored
child value. Capture both states at a normal and narrow panel width and inspect
the rendered images directly.
