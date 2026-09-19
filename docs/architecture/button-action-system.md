# Button and Action-Control System

**Status:** Implemented, tokenized, and reviewed 2026-09-02; vocabulary consolidated 2026-09-19

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

`Button` exposes these variants (runtime `BUTTON_VARIANTS` is the source of
truth; the type is derived from it):

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

Sizes are `xs`, `sm`, `md`, `lg`, `icon-xs`, `icon-sm`, `icon`, and `icon-lg`
(runtime `BUTTON_SIZES`). Icon-only controls use `IconButton`, which owns the
accessible label and decorative icon contract. Text and icons are laid out by
the shared content wrapper; product surfaces must not recreate button geometry
locally, and no surface may hand-write `varve-btn` markup — every access path
goes through the primitives.

The vocabulary is closed and checked: `ButtonVariantParity.test.ts` fails when
a variant or size has no rule in `components.css` or when the stylesheet
declares a `.varve-btn--*` modifier outside the union, and
`tests/unit/button-system.test.ts` fails when any package writes a
`varve-btn--*` modifier or re-hand-rolls `varve-btn` markup. Before this guard,
`varve-btn--primary` and `varve-btn--danger` were written by call sites for
months with no matching rule, so destructive actions rendered with neutral
chrome (fixed 2026-09-19).

Every native action defaults to `type="button"`. A caller must opt into
`submit` or `reset` when that is genuinely the form action. `disabled` is
native and non-focusable; `softDisabled` is reserved for controls that must
remain discoverable and therefore use `aria-disabled` with an interaction
guard. `disabledReason` pairs with either disabled state: the control stays
focusable (`aria-disabled`), the reason is exposed through
`aria-describedby`, and pointer users see it as a title, so an unavailable
action is never a communication dead end.

## State and feedback

- `loading` exposes `aria-busy`, uses the shared `Spinner`, and blocks duplicate
  activation while the operation is pending.
- `loadingLabel` supplies the temporary accessible name when the visible label
  changes or disappears.
- Destructive actions may use `confirmLabel` for an explicit second activation;
  focus leaving the control cancels confirmation.
- `disabledReason` is the only sanctioned way to explain an unavailable action.
  It keeps the control focusable and announced ("Select a layer first"), and
  the reason is the pointer title. The 2026-09-19 pass added it to the layout
  save/import, workspace reset, and gradient-preset import gates; new disabled
  controls whose blocker is not obvious from their own label should use it.
- `CopyButton` guards concurrent clipboard operations, announces success or
  failure through a live region, clears timers on unmount, and ignores stale
  completions after its value changes.
- Busy, disabled, confirmation, and pressed states are distinct. A disabled
  control is not a substitute for a pending state, and a pending state is not
  represented by a guessed timer.
- **Pressed state has one source.** `aria-pressed` (toggles) or
  `aria-checked` (radio/segmented members) is authoritative; styling selects on
  the attribute, never on a parallel `--active` / `is-active` class. The
  2026-09-19 consolidation removed that class plumbing from the context bar,
  floating toolbars, selection quick bar, timeline, status bar, crop, spec
  units, archive, and upscale surfaces; feature code should not reintroduce it.
  Add `aria-pressed` first when a control gains a visual engaged state.
- A popover or menu trigger's engaged highlight comes from `aria-pressed` (it
  is a toggle) alongside its `aria-expanded` popup semantics — not from a
  third, trigger-only modifier class.

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

The context bar (`ContextControlBar`) composes the same primitives:
`ToggleButton` for persistent state such as Bold, Italic, and clip content;
`Button` for one-shot actions such as swap orientation and vectorize. Its
`.ccb__btn` class owns geometry only. Timeline playback, track mute/solo,
selection quick bar items, status-bar toggles, crop ratio/guide choices, spec
unit choices, archive type, and upscale zoom follow the same rule: the ARIA
attribute carries the state, the surface stylesheet selects on it.

## Website integration

`apps/website/src/components/Button.astro` is the only action component for
marketing pages and emits the global `.btn-*` classes; page markup must use it
instead of hand-writing anchors with button classes (84 anchors across 47 pages
were migrated on 2026-09-19). The component forwards extra anchor/button
attributes (`target`, `rel`, `aria-*`, `data-*`), maps the default marketing
action to `default` (not `primary`), and keeps the site's semantic variant
names aligned with the product. Legacy `btn-primary` callsites are not part of
the contract. `.btn-pill` and `.btn-pill-outline` remain marketing-only
treatments and are not product button variants.

## Conflict and precedent notes

Research on button failures that have concrete counterparts in this codebase:

- **Undefined/parallel variants.** Destructive actions that do not look
  destructive is a recurring review finding; it happened here because a variant
  name was written without a rule. The parity + vocabulary guards make that
  class of drift impossible to merge silently.
- **Disabled without explanation.** NN/g, GOV.UK, Shopify Polaris, and
  Smashing Magazine all document users re-tapping an inert control and then
  guessing which field is wrong. `disabledReason` plus the shared
  `softDisabled` path is the repo's answer; use it whenever the label alone
  does not state the blocker.
- **Loading indicators that flash.** The shared `useDelayedLoading` (150 ms)
  keeps short operations from flickering while `aria-busy` is immediate.
- **Destructive confirmation.** `confirmLabel` is inline and reversible; it is
  for reversible in-app actions. Modal confirmation stays reserved for
  genuinely irreversible operations.

## Verification surfaces

The Storybook `Components/Button` gallery covers variants, sizes, icon-only
controls, leading/trailing icons, disabled/busy/destructive states, copy
feedback, connected groups, narrow layouts, themes, and reduced motion. Unit
tests cover native type defaults, labels, loading/confirmation behavior,
`disabledReason` focus/description/tooltip semantics, clipboard races, and the
editor toolbar/text-bar semantics. Two repository guards keep the system
closed: `packages/ui/src/components/ButtonVariantParity.test.ts` (TSX ↔ CSS
vocabulary) and `tests/unit/button-system.test.ts` (no raw `varve-btn` markup
or undeclared modifier anywhere in `packages/` and `apps/`). Browser validation
must inspect the main toolbar, quick text toolbar, inspector/dialog actions,
start screen, and website light/dark/narrow states directly from captured
screenshots; assertions alone are not visual evidence.
