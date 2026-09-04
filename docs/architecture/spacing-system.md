# Varve spacing system

Status: active. This document describes interface spacing only; it does not
govern authored document geometry.

## Audit summary

Varve is a local-first design editor with dense, pointer-oriented desktop
workflows, a home/library surface, shared React controls, and a separate Astro
marketing/documentation site. Before this pass, the editor and UI package
already shared a fluid `--space-*` ladder, but that ladder lived inside the
color-token generator and most consumers had to infer meaning from numbers.
The website consumed the same primitives inconsistently and repeated raw
`rem` values in shared header, CTA, table, form, and page styles.

The highest-risk findings were:

- **High:** spacing ownership was implicit for shared dialog, panel, control,
  menu, and form surfaces; this made double-padding and local overrides easy to
  introduce.
- **High:** the website container gutter and common controls were not tied to
  semantic roles, so mobile and desktop page rhythm diverged.
- **Medium:** the primitive ladder was not independently discoverable or
  testable because it was embedded in `generate-token-css.ts`.
- **Medium:** editor density modes existed (`compact`, `comfortable`, `cozy`)
  but were primarily row-level variables rather than documented semantic
  spacing contracts.
- **Low / intentional:** small raw values remain for borders, optical icon
  alignment, hit targets, native/platform geometry, and authored/document
  layouts. They are not interface-spacing violations.

The editor’s narrow minimum viewport and resizable panels are deliberate: a
design editor cannot collapse its tool chrome into a mobile marketing layout
without harming interaction. The website, by contrast, uses fluid page gutters
and a smaller mobile inset.

## Architecture

The canonical source is [`packages/ui/src/tokens/spacing.ts`](../../packages/ui/src/tokens/spacing.ts).
The generator emits [`packages/ui/src/tokens/tokens.css`](../../packages/ui/src/tokens/tokens.css),
which is the runtime contract for CSS consumers.

### Primitive scale

The existing 4-point-oriented fluid ladder is retained because it already fits
the editor’s compact rows and the website’s larger section rhythm:

`0, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 24, 32`.

The values are fluid only where viewport growth improves composition. A raw
value should not be added to the ladder to preserve a one-off geometry.

### Semantic roles

The small semantic layer covers recurring meaning: page inline/block rhythm,
panel and dialog insets, cards, toolbar groups/items, controls, form fields,
label/control and icon/label relationships, list/menu/table rows, popovers,
tooltips, and empty states. Semantic tokens alias primitives; consumers should
prefer a role when the relationship is stable and use a primitive when the
local purpose is clearer.

`--panel-padding`, toolbar/title/status-bar sizes, and panel widths remain
compatibility aliases during migration. They are layout dimensions rather than
general spacing roles.

### Ownership contract

- A component owns its internal padding and the spacing between its own slots.
- A parent owns the gap between sibling components.
- Reusable components do not add unexplained outer margins.
- Optional content must not leave an empty spacer; use conditional flow and
  `gap`.
- Focus, hover, selected, and validation states reserve geometry through
  transparent borders, outlines, or stable slots rather than changing padding.

### Density and responsive behavior

The editor retains `compact`, `comfortable`, and `cozy` density mappings. These
are for scan-heavy rows and controls; they do not alter canvas coordinates,
selection bounds, exported geometry, or persisted document data. Website page
gutter uses `--space-page-inline` (24px max, 16px on narrow screens), while
editor panels continue to use their dense panel roles and minimum viewport
contract.

### Interface versus authored geometry

Do not replace values in scene nodes, artboards, guides, grids, print/export
boxes, SVG paths, chart coordinates, animation timelines, raster algorithms,
canvas overlays, or pointer thresholds with interface spacing tokens. Functional
hit regions and overlay collision padding may use a dedicated functional token
in the future, but must remain separate from decorative rhythm.

## Migration map

| Previous pattern | Corrected contract |
| --- | --- |
| Website `.container-custom { padding: 0 1.5rem }` | `padding-inline: var(--space-page-inline)` |
| Website CTA/button `gap: .5rem` | `gap: var(--space-icon-label)` |
| Website bento `padding: var(--space-6)` | `padding: var(--space-card)` |
| Shared panel inset inferred from `--space-2` / `--space-3` | `--space-panel` or `--space-panel-compact` |
| Dialog/page form values chosen locally | `--space-dialog`, `--space-form-field`, or `--space-control-group` |
| `--panel-padding` as the source of truth | `--space-panel`, with `--panel-padding` retained for compatibility |

## Verification and future work

Spacing changes must run `pnpm verify:plan` and `pnpm verify:affected`.
Website changes additionally require the website build and targeted Playwright
visual checks at desktop, mobile, dark, and narrow/short viewports. Visual
baselines are inspected directly before any update. Future additions should
first identify the ownership role, then add a semantic alias only if the
meaning recurs across components; otherwise keep the local rule and document
why it is intentional.

The current migration intentionally prioritizes shared primitives and the
marketing shell. The remaining page-specific raw `rem` values are content
rhythm or component-local rules and should be migrated opportunistically at
their owning component, not through a broad search-and-replace.
