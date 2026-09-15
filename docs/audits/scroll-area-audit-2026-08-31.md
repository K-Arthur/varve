# Scroll Area Audit

Date: 2026-08-31 (updated 2026-09-05)

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
| Inspector properties | Panel-owned native overflow with token-styled scrollbar | A / F | Token styling applied (scrollbar-color, scrollbar-width). No DOM change needed. |
| Page navigation | Horizontal native overflow with hidden platform chrome | G | Retain native overflow; do not force a visible scrollbar on a compact navigation strip. |
| Editor tabs | Horizontal native overflow with hidden platform chrome | G | Retain native overflow; active tab reveal remains programmatic. |
| Timeline tracks | Specialized vertical/horizontal scroll and wheel routing with token-styled scrollbar | D / H | Do not wrap. WebKit scrollbar tokens aligned with ScrollArea. |
| Canvas | Pointer and wheel input pipeline | C | Never replace with `ScrollArea`. |
| Palette mapping list | Dialog-local bounded list | A / F | Migrated to `ScrollArea`; content remains dense and the dialog owns the containing height. |
| Menus, selects, comboboxes | Overlay-owned keyboard scrolling and `scrollIntoView` | F | Keep specialized so focus and dismissal behavior remain coupled. |
| Home and website surfaces | Native page flow and responsive overflow handling with token-styled scrollbars | E | No migration. Horizontal scroll areas use consistent scrollbar tokens. |
| Settings dialog | Content pane with token-styled scrollbar | A | Token styling applied. |
| Dialog bodies | Flex column with scrollable body, token-styled scrollbar | A | Token styling applied via varve-dialog__body. |
| Library, codegen, logo panels | Panel-owned overflow with token-styled scrollbar | A | Token styling applied. |
| History panel | Panel-owned overflow with token-styled scrollbar | A | Token styling applied. |
| AI panel chat log | Panel-owned overflow with token-styled scrollbar | A | Token styling applied. |
| Layers panel tree | Virtualized with token-styled scrollbar | B | Token styling applied. Scroll root preserved for virtualizer. |
| Brush browser grid | Grid overflow with token-styled scrollbar | A | Token styling applied. |
| Help browser sidebar + content | Panel-owned overflow with token-styled scrollbar | A / E | Token styling applied. |
| Home sidebar | Panel-owned overflow with token-styled scrollbar | A / E | Token styling applied. |

## Scroll System Specification

### ScrollArea component (`@varve/ui`)

`ScrollArea` is native-first. It adds a wrapper and a real viewport, but does
not attach listeners, intercept wheel events, lock scroll chaining, or animate
ordinary scrolling.

- Vertical, horizontal, and both-axis orientations are supported.
- The viewport is exposed through `viewportRef` and marked with stable
  `data-slot="scroll-area-viewport"` metadata.
- Keyboard focus is opt-in through `viewportProps`; ordinary panels do not
  enter the tab order merely because they scroll.
- **data-overflow tracking**: The root element receives `data-overflow` when
  the viewport has scrollable content (via ResizeObserver + passive scroll
  listener, scheduled in rAF). CSS reads this for scrollbar appearance and
  optional edge affordances. No React state is updated per scroll event.
- **Scrollbar appearance**: Thumb fades from transparent (no overflow) to
  visible (overflow) on both Firefox (`scrollbar-color`) and WebKit
  (`::-webkit-scrollbar-thumb`).
- Firefox uses `scrollbar-width: thin` and `scrollbar-color`.
- WebKit uses an 8px track with a 2px transparent inset, a quiet token-based
  thumb, and stronger hover/active states.
- Horizontal-only ScrollArea gets a thinner 6px scrollbar.
- Tracks are transparent, corners are transparent, and no brand accent is used
  for the default thumb.
- `scrollbar-gutter: stable` prevents content width shifts when a vertical
  scrollbar appears.
- `overscroll-behavior: auto` preserves natural nested scroll chaining.
- Forced-colors mode uses system scrollbar and highlight colors.
- No custom touch, pen, wheel, or pointer handling is added.

### ScrollProgress

`ScrollProgress` is an independent opt-in composition. It updates the DOM
directly on a passive scroll listener scheduled with `requestAnimationFrame`,
recalculates through `ResizeObserver`, hides itself when there is no overflow,
and does not add progress UI to routine editor panels. The parent ScrollArea
handles `data-overflow`; ScrollProgress only renders the visual progress bar.

### `.varve-scrollbar` utility class

A CSS utility class for applying consistent scrollbar tokens to any native
overflow region without wrapping in ScrollArea. Use when the DOM structure
should not change but the scrollbar should match the visual language.

```html
<div class="varve-scrollbar" style="overflow-y: auto">
  <!-- content -->
</div>
```

### Website `.scroll-x` utility

A CSS utility class for horizontal scroll containers on the marketing website.
Provides thin scrollbar tokens matching the editor's ScrollArea.

## When to use each approach

| Situation | Approach |
| --- | --- |
| New bounded panel, dialog body, card, list | `ScrollArea` component |
| Existing panel where DOM cannot change | `.varve-scrollbar` CSS class |
| Horizontal table/strip on website | `.scroll-x` CSS class |
| Virtualized collection (layers, icons, fonts) | Keep native scroll root; apply scrollbar tokens via CSS |
| Canvas, timeline, ruler | Keep specialized; share only scrollbar tokens |
| Native document flow (page scroll) | Keep native; do not wrap |

## Prohibited migrations

- **Canvas viewport**: Never replace with `ScrollArea` or add scrollbar
  styling that would interfere with the wheel input pipeline.
- **Timeline tracks**: Do not wrap in `ScrollArea`. Keep the specialized
  vertical/horizontal scroll and wheel routing.
- **Virtualized layers tree**: Do not wrap in `ScrollArea`. The virtualizer
  requires direct access to the scroll root for measurement, keyboard
  navigation, drag hit testing, and autoscroll.
- **Native document flow**: Do not place an entire page inside a custom
  scroll viewport merely for scrollbar styling.

## Nested scroll guidance

- Use `overscroll-behavior: contain` on scroll regions that should not
  propagate scrolling to parent containers (inspector, layers, timeline,
  brush browser).
- Dialogs should have a fixed/sticky header, bounded scrolling body, and
  fixed/sticky footer. The dialog body is the scroll owner.
- Avoid double scrollbars. If a panel has a scrollable inner region, the
  outer container should use `overflow: hidden`.
- Test scroll transfer at both boundaries when nesting scroll areas.

## Focus guidance

- Keyboard focus on scroll areas is opt-in via `viewportProps.tabIndex`.
- Ordinary panels do not become tab stops merely because they scroll.
- Interactive children within scroll areas are reachable through normal
  tab order; the scroll area itself does not add a focus stop.
- `scrollIntoView({ block: 'nearest', inline: 'nearest' })` is the standard
  pattern for revealing focused/active items in horizontal strips.

## Restoration ownership

| Surface | Restoration | Mechanism |
| --- | --- | --- |
| Editor panels (detach/reattach) | Per-panel scrollTop/scrollLeft | `panelLifecycle.ts` captures from `[data-panel-scroll]` |
| Inspector tabs | Per-tab scroll position | sessionStorage via DisclosureSection |
| Settings dialog | Per-section scroll position | sessionStorage |
| Home sidebar | Per-route | Browser native restoration |
| Layers tree | Virtualizer manages | `scrollToIndex` on navigation |
| Timeline tracks | Per-document | Manual via `scrollOffset` state |

## Responsive layout requirements

Scroll areas must have correctly constrained ancestors. Key patterns:

- `min-width: 0` and `min-height: 0` on flex/grid children that scroll
- `flex: 1 1 auto` with `min-height: 0` for vertical scroll in flex columns
- `scrollbar-gutter: stable` to prevent content width shifts
- `dvh` units with fallbacks for embedded WebViews
- `overflow-x: auto` with `scrollbar-width: thin` for horizontal strips
