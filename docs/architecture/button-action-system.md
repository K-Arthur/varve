# Button and Action-Control System

**Status:** Implemented, tokenized, and reviewed 2026-09-02

**Scope:** `@varve/ui`, editor and home action surfaces, and the Astro
marketing website

This document defines the semantic and visual contract for actions. A control
is classified by what it does before its shape or placement is considered.

## Primitive selection

| Intent | Primitive | Required semantics |
| --- | --- | --- |
| One-shot action | `Button` | Native button, explicit accessible name, default `type="button"` |
| Icon-only action | `IconButton` | Visible tooltip where useful, explicit `label`, icon is decorative |
| Persistent on/off state | `ToggleButton` | `aria-pressed` and state-driven styling |
| One choice from a short set | `SegmentedControl` | `radiogroup` with roving radio focus |
| Connected independent actions | `ButtonGroup` | Group geometry only; it does not imply selection |
| Value selection or free input | `Select` / `NativeSelect` / `Combobox` | Keep listbox or input semantics |
| Navigation | Link or site navigation primitive | `href`, current-page state, no button styling requirements |
| Dragging | Dedicated handle | `aria-grabbed`/instructions when applicable; never disguise as an action |

Menus, tabs, switches, checkboxes, color swatches, and canvas handles retain
their own interaction models. A floating location does not make a control a
menu item.

## Canonical button API

`Button` exposes these variants:

```ts
type ButtonVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'destructive'
  | 'link'
  | 'toolbar';
```

`toolbar` is a density/visual variant, not a pressed state. Persistent state
belongs to `ToggleButton` or `SegmentedControl`.

Sizes are `xs`, `sm`, `md`, `lg`, `icon-xs`, `icon-sm`, `icon`, and `icon-lg`.
Icon-only controls use `IconButton`, which owns the accessible label and
decorative icon contract. Text and icons are laid out by the shared content
wrapper; product surfaces should not recreate button geometry locally.

Every native action defaults to `type="button"`. A caller must opt into
`submit` or `reset` when that is genuinely the form action. `disabled` is
native and non-focusable; `softDisabled` is reserved for controls that must
remain discoverable and therefore use `aria-disabled` with an interaction
guard.

## State and feedback

- `loading` exposes `aria-busy`, uses the shared `Spinner`, and blocks duplicate
  activation while the operation is pending.
- `loadingLabel` supplies the temporary accessible name when the visible label
  changes or disappears.
- Destructive actions may use `confirmLabel` for an explicit second activation;
  focus leaving the control cancels confirmation.
- `CopyButton` guards concurrent clipboard operations, announces success or
  failure through a live region, clears timers on unmount, and ignores stale
  completions after its value changes.
- Busy, disabled, confirmation, and pressed states are distinct. A disabled
  control is not a substitute for a pending state, and a pending state is not
  represented by a guessed timer.

## Visual contract

Shared buttons use the semantic theme tokens, compact/control radii, stable
control heights, and a restrained hover/press/focus treatment. Icon-only
targets remain at least the shared compact control size and expand to the
touch-target token on coarse pointers. Connected groups keep member seams
visible while the outer group owns the radius.

Regular actions do not use shine, ripple, magnetic, confetti, heartbeat, or
other attention-seeking effects. `ShineBorder` remains an independently
allowlisted decorative transition and is not a button treatment. Button and
website transitions stop under `prefers-reduced-motion: reduce`.

## Editor integration

The main floating toolbar uses `ToggleButton` for active tools, `Button` for
selection commands, and `IconButton` for chevrons and compact actions. The
tool-options trigger is a toggle because it represents an open/closed state.
The floating text bar uses toggles for Bold, Italic, and List, and the shared
segmented radiogroup for text alignment. Tooltips, roving toolbar focus,
disabled reasons, and anchored menus remain owned by their existing systems.

## Website integration

`apps/website/src/components/Button.astro` and the global `.btn-*` classes use
the same semantic names. The default marketing action maps to `default`, not
`primary`; legacy `btn-primary` callsites are not part of the current contract.
The `.btn-pill` and `.btn-pill-outline` classes are retained only for explicit
marketing treatments and are not available as product button variants.

## Verification surfaces

The Storybook `Components/Button` gallery covers variants, sizes, icon-only
controls, leading/trailing icons, disabled/busy/destructive states, copy
feedback, connected groups, narrow layouts, themes, and reduced motion. Unit
tests cover native type defaults, labels, loading/confirmation behavior,
clipboard races, and the editor toolbar/text-bar semantics. Browser validation
must inspect the main toolbar, quick text toolbar, inspector/dialog actions,
start screen, and website light/dark/narrow states directly from captured
screenshots; assertions alone are not visual evidence.
