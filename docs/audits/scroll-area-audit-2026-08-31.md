# Scroll Area Audit

Date: 2026-08-31

## Scope

The audit searched the UI, editor, home, help, prototype, website, desktop,
and end-to-end test trees for overflow declarations, scrollbar selectors,
scroll metrics, wheel handlers, scroll restoration, sticky regions, and
virtualized collections. `overflow: hidden` used by overlays, text truncation,
canvas composition, and clipping is not a scroll region.

## Classification

| Category | Regions found | Decision |
| --- | ---: | --- |
| A. Standard contained | 6 | Use the shared primitive for bounded dialog and panel content when the viewport is owned by the surface. |
| B. Dense virtualized | 1 | Layers tree keeps its existing virtualizer, scroll root, keyboard navigation, and drag auto-scroll. |
| C. Canvas / viewport | 1 | Keep the canvas input pipeline and wheel-to-pan/zoom behavior specialized. |
| D. Timeline / tracks | 3 | Keep timeline tracks, ruler, and media strip specialized; share only visual tokens. |
| E. Native document flow | 4 | Keep home, website, help, and ordinary document flow native. |
| F. Nested / overlay | 7 | Keep local native scroll roots unless a surface needs the shared scrollbar treatment; test propagation per overlay. |
| G. Horizontal strips | 5 | Keep tabs, page navigation, and media strips native horizontal overflow; wrapping or overflow menus remain preferable where available. |
| H. Auto-scroll | 3 | Keep layers, pages, and timeline drag auto-scroll specialized. |

Counts are region classifications, not raw grep matches. A surface can appear
in more than one operational note, but each scroll root has one primary owner.

## Surface Notes

| Surface | Current implementation | Primary classification | Migration decision |
| --- | --- | --- | --- |
| Layers tree | Virtualized native `div`, selectable rows, sortable drag/drop | B / H | Do not wrap. The existing root is required by measurement and drag hit testing. |
| Inspector properties | Panel-owned native overflow | A / F | Retain the native root for now; adopt shared styling in a later structural migration after all tab panel roots are unified. |
| Page navigation | Horizontal native overflow with hidden platform chrome | G | Retain native overflow; do not force a visible scrollbar on a compact navigation strip. |
| Editor tabs | Horizontal native overflow with hidden platform chrome | G | Retain native overflow; active tab reveal remains programmatic. |
| Timeline tracks | Specialized vertical/horizontal scroll and wheel routing | D / H | Do not wrap. Existing containment is intentional. |
| Canvas | Pointer and wheel input pipeline | C | Never replace with `ScrollArea`. |
| Palette mapping list | Dialog-local bounded list | A / F | Migrated to `ScrollArea`; content remains dense and the dialog owns the containing height. |
| Menus, selects, comboboxes | Overlay-owned keyboard scrolling and `scrollIntoView` | F | Keep specialized so focus and dismissal behavior remain coupled. |
| Home and website surfaces | Native page flow and responsive overflow handling | E | No migration. |

## Scroll System Specification

`ScrollArea` is native-first. It adds a wrapper and a real viewport, but does
not attach listeners, intercept wheel events, lock scroll chaining, or animate
ordinary scrolling.

- Vertical, horizontal, and both-axis orientations are supported.
- The viewport is exposed through `viewportRef` and marked with stable
  `data-slot="scroll-area-viewport"` metadata.
- Keyboard focus is opt-in through `viewportProps`; ordinary panels do not
  enter the tab order merely because they scroll.
- Firefox uses `scrollbar-width: thin` and `scrollbar-color`.
- WebKit uses an 8px track with a 2px transparent inset, a quiet token-based
  thumb, and stronger hover/active states.
- Tracks are transparent, corners are transparent, and no brand accent is used
  for the default thumb.
- `scrollbar-gutter: stable` prevents content width shifts when a vertical
  scrollbar appears.
- `overscroll-behavior: auto` preserves natural nested scroll chaining.
- Forced-colors mode uses system scrollbar and highlight colors.
- No custom touch, pen, wheel, or pointer handling is added.

`ScrollProgress` is an independent opt-in composition. It updates the DOM
directly on a passive scroll listener scheduled with `requestAnimationFrame`,
recalculates through `ResizeObserver`, hides itself when there is no overflow,
and does not add progress UI to routine editor panels.

## Verification Plan

Focused component tests cover orientation metadata, viewport ref identity,
keyboard-focus opt-in, and optional progress composition. Existing canvas,
layers, timeline, overlay, and scrollbar-related E2E suites remain the
specialized interaction coverage and must not be replaced by generic scroll
tests.

Remaining visual coverage should be added through the existing Storybook
surface when the UI package gallery is next exercised. No production gallery
route is added for this primitive.
