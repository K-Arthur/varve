# Tab system

Varve has several controls that resemble tabs but do not share the same
interaction contract. This document defines the current boundary and the
shared React API.

## Choose the semantic model first

Use ARIA `tablist` / `tab` / `tabpanel` only when a set of controls switches
between associated content panels in the same view. Use normal links for route
navigation, a radiogroup for mutually exclusive modes or filters, and a
custom document/page strip when close, reorder, dirty-state, or persistence
behaviour is part of the control.

The full surface inventory and migration status lives in
[`tab-system-audit-2026-09-05.md`](../audits/tab-system-audit-2026-09-05.md).

## Shared `@varve/ui` Tabs

[`Tabs`](../../packages/ui/src/components/Tabs.tsx) is the canonical content
tab primitive. It is controlled for now to preserve existing consumers:

```tsx
<Tabs
  label="Code language"
  tabs={tabs}
  activeTab={active}
  onTabChange={setActive}
  variant="compact"
  activation="manual"
  renderPanel={(tab) => <CodeOutput target={tab.value} />}
/>
```

Supported options are:

- `orientation`: `horizontal` or `vertical`; arrow keys follow the axis.
- `variant`: `underline`, `soft`, `pill`, `panel`, or `compact`.
- `size`: `sm`, `md`, or `lg`.
- `activation`: `automatic` (default) or `manual`.
- `tabs[].icon`, `tabs[].badge`, `tabs[].disabled`, and `tabs[].ariaLabel`.
- `renderPanel(tab, index)`: value-keyed panel rendering for dynamic or
  expensive consumers.
- `unmountInactivePanels`: defaults to `true`; set `false` only when a panel's
  local form, scroll, or editor state should remain mounted.

The legacy positional `children` form remains available for backward
compatibility, but new code should use `renderPanel`. Values are stable keys;
array indices are never used for React keys or ARIA relationships.

### Accessibility contract

The primitive provides a labelled tablist, complete `aria-controls` and
`aria-labelledby` pairs, `aria-orientation` for vertical lists, roving
`tabIndex`, Home/End, orientation-correct arrow navigation, disabled-item
skipping, and a focus-visible indicator. Automatic activation is appropriate
for synchronous panels. Manual activation is available when switching can
perform noticeable work; Enter/Space then commits the focused tab.

Panels are `tabIndex=0` so keyboard users can leave a tablist and reach content
even when the panel has no naturally focusable first child. Inactive panels are
hidden, and optionally unmounted according to `unmountInactivePanels`.

## Visual variants

- `underline`: low chrome for settings, code, history, and content panels.
- `soft`: a quiet active surface for compact view choices.
- `pill`: compact choice groups where the selected value needs a contained
  silhouette.
- `panel`: stronger separation for a dock or card boundary.
- `compact`: the same semantic treatment with reduced spacing for inspectors.

All variants use Varve tokens, preserve label geometry, and keep the active
state legible through foreground, surface, and indicator changes rather than
colour alone. Overflow belongs to the consuming surface: a generic `More`
menu is not built into the primitive because document, Inspector, and website
layouts have different persistence and mobile requirements.

## Motion and lifecycle

The active indicator transitions only colour/border/surface properties. The
reduced-motion media query disables those transitions. Panel rendering is
value-based and lazy by default; consumers that need durable form or scroll
state explicitly opt into mounted-but-hidden panels. No ResizeObserver or
animation loop is used by the shared component.
