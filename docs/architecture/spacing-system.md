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

### Second pass (2026-09-19): ownership conflicts and the missing gate

A follow-up pass audited how the ladder was actually *applied*. Tokens were in
place; the rendered result still did not follow them. Three structural causes
were found and fixed, plus one missing safeguard:

- **Blocking — one grammar, two owners.** `@varve/ui`’s ColorPicker emitted the
  editor’s Inspector class names (`insp-field`, `insp-field__label`,
  `insp-field__control`, `insp-num__input`, `insp-slider__track/__thumb`), and
  `components.css` defined them a second time with a *different design*: a fixed
  60px label column against the Inspector’s 38% grid column, a fluid field
  height against the compact 32px field, and a 24px slider thumb against the
  colour slider’s 4×24px marker. Which one rendered depended on stylesheet
  import order (`inspector.css` is loaded from `PropertiesPanel.tsx`, so it
  happened to win — nothing enforced it). The ColorPicker now owns its own
  namespaces (`color-fields__*`, `color-slider__*`) with declarations that
  mirror the Inspector grammar, so `@varve/ui` no longer depends on
  `@varve/editor`’s stylesheet. **Rule: a package must not define or consume
  another package’s class grammar.**
- **Blocking — a broad rule swallowed a container.** The Inspector’s section
  content container is a `<fieldset>`, and `.insp-panel fieldset { gap:
  var(--space-2) }` (written for stacked field *groups*) out-specified
  `.insp-disclosure__content { gap: var(--space-1) }`. The gap between two
  fields therefore equalled the gap between two sections, so every section read
  as one undifferentiated stack. The broad rule is now excluded from the
  section container. **Rule: a container’s rhythm belongs to the container; a
  descendant selector must not out-specify the element it targets.**
- **Blocking — a dead spacing rule.** The registry composed sections as
  `<div key={id}>{el}</div>`, which made every section the last child of its own
  parent, so `.insp-disclosure:last-child { margin-bottom: 0 }` matched all of
  them and zeroed the section-to-section margin for every section. Measured
  before/after at 1440×900: content gap 5.92px → 2.96px, section separation
  ~5.92px → ~11.8px. The keyed wrapper is now a keyed Fragment. **Rule: a
  spacing contract that depends on sibling position needs a test or a
  measurement, because a wrapper element can silently disable it.**
- **Missing — no gate.** Nothing failed when a raw length was written into a
  spacing property. `audit-spacing.mjs` now blocks it, blocks literal fallbacks
  on ladder tokens, and ratchets existing debt through
  `.spacing-baseline.json`.

The same pass finished the migration of the shell’s legacy dialog/panel blocks
(157 raw declarations in `editor.css`), the Inspector’s row/column gaps (44 raw
`gap` declarations across ten stylesheets), the last 67
`var(--space-*, <length>)` fallbacks, and the website’s shared surfaces (42
declarations across header, hero, footer, trust strip, CTA, product showcase,
discipline tabs, and search dialog).

### Why the ladder was not rewritten

The obvious alternative — replacing the fluid ladder with a stable 4px grid —
was rejected. The dense steps resolve to 2.96 / 5.92 / 9.68 / 13.44px at
1440px, and the product’s raw values (2 / 4 / 6 / 8 / 12 / 16 / 24px) sit
*between* them. Rewriting the ladder would have re-rendered ~3,300 token
consumers at once, changing the product’s established density, and the deltas
would have been systematically in the loosening direction on a dense editor.
Adding a second “dense” ladder was also rejected: that is two spacing systems,
which is the failure this document exists to prevent. Instead each raw value
was mapped by meaning to the nearest canonical step, and the residual
one-offs are annotated in place.

The industry evidence agrees: the recurring complaint is not too few tokens but
“too many tokens and variations to remember” and “a patchwork of arbitrary gaps
and paddings *despite tokens being in place*”, with the recommended remedy
being a small set plus governance that stops the set from growing. That is
exactly what `audit-spacing` provides.

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
- **One owner per selector.** A class name has exactly one defining stylesheet.
  A shared package must not emit another package's class names, and a broad
  descendant rule (`.insp-panel fieldset`) must not out-specify the specific
  element it targets (`.insp-disclosure__content`).
- **Row and column spacing is rhythm too.** `gap`, `row-gap`, `column-gap`, and
  the legacy `grid-gap` longhands are spacing properties and are gated exactly
  like `padding` and `margin`. Dense gaps use `--space-05` (hairlines between
  grid cells), `--space-1` (stacks inside a control), and `--space-2` (control
  clusters); panel and section separation uses `--space-3` and above.
- **A literal fallback on a ladder token is a defect.** `--space-*` is always
  defined by `tokens.css`, so `var(--space-2, 8px)` can only ever paint an
  unthemed value and hides the token's absence.
- **Section rhythm must be measurable.** The gap between two sections has to
  stay clearly larger than the gap between two fields inside one; if a wrapper,
  an override, or a `:last-child` rule collapses that ratio, grouping stops
  reading. `reports/spacing-review/` holds the captures and the computed
  measurements used to check it.

### Selecting a value (for contributors)

1. Identify the relationship: inside a control, between siblings, between
   sections, or page rhythm.
2. Use the semantic role when one exists for that relationship (`--space-panel`,
   `--space-dialog`, `--space-control-group`, `--space-icon-label`,
   `--space-form-field`, `--space-list-row`, `--space-menu-item`,
   `--space-table-cell`). Otherwise use the primitive whose meaning matches.
3. If nothing fits, ask whether the value is functional geometry (a hit region,
   an overlay offset, an optical nudge). If it is, keep the raw value and
   annotate it with `audit-spacing: allow <reason>`.
4. Never add a ladder step for a one-off. Adding a primitive changes every
   consumer’s vocabulary; the ladder is deliberately finite.
5. Run `pnpm audit:spacing`. If the value is genuine debt, migrate it; the
   baseline may only shrink (`pnpm audit:spacing:update` rewrites it and the
   diff must be a reduction).

### Density and responsive behavior

Interface density is a documented user preference — Default Pro and Compact
Pro, applied through the root `data-density` attribute
(`packages/editor/src/settings/interfaceDensity.ts`); see
`interface-sizing-system.md` for the runtime and virtualization contract.
The `--density-*` row roles below it are consumed with `:root` fallbacks so
surfaces that have not opted in still render a consistent baseline. Density
does not alter canvas coordinates, selection bounds, exported geometry, or
persisted document data. Website page gutter uses `--space-page-inline`
(24px max, 16px on narrow screens), while editor panels continue to use
their dense panel roles and minimum viewport contract.

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
| Shell panel raw values: `gap/padding/margin: 2px` | `var(--space-1)` |
| Shell panel raw values: `4-6px` | `var(--space-2)` |
| Shell panel raw values: `8-10px` | `var(--space-3)` / `var(--space-panel-compact)` |
| Shell panel raw values: `12-16px` | `var(--space-4)` / `var(--space-form-field)` |
| Shell panel raw values: `20-28px` | `var(--space-5)` / `var(--space-6)` |
| Dialog side gutters chosen per dialog (12-24px) | `var(--space-dialog)` |
| `.settings-hint { margin: 0 0 0 120px }` | `calc(var(--settings-label-column) + var(--space-3))`, column defined once |
| `gap: 2px` / `gap: 4px` / `gap: 6px` in Inspector rows | `var(--space-1)` / `var(--space-2)` / `var(--space-2)` |
| `gap: 1px` between grid cells | `var(--space-05)` (hairline step) |
| `grid-template-columns: 1fr 1fr` | `repeat(2, minmax(0, 1fr))` (a bare `1fr` keeps `min-width: auto` and can overflow the rail) |
| `var(--space-2, 8px)` | `var(--space-2)` — a fallback on a defined token is a defect |
| ColorPicker emitting `insp-field` / `insp-num__input` / `insp-slider*` | `color-fields__row` / `__label` / `__control` / `__input`, `color-slider__*` |
| `.varve-number-input { height: var(--space-6) }` | `min-height: var(--component-compact-height)` (a fluid height resized the same field at every window width) |
| Website footer gaps `1.25 / 1.5 / 1.75 / 2 / 2.5 / 3rem` | `--space-5 / --space-6 / --space-7 / --space-8` (near-duplicates consolidated) |
| Inspector section content gap overridden to `--space-2` | `.insp-disclosure__content { gap: var(--space-1) }` restored |
| `<div key={id}>{section}</div>` in the Inspector | keyed `Fragment` so `:last-child` and the section margin apply |

## Verification and future work

Spacing changes must run `pnpm verify:plan` and `pnpm verify:affected`.
`pnpm audit:spacing` is the domain gate and is selected automatically by the
affected planner for every interface stylesheet path; it also scans the
website's shared components. Website changes additionally require the website
build and targeted Playwright visual checks at desktop, mobile, dark, and
narrow/short viewports. Visual baselines are inspected directly before any
update.

Structural changes to section or panel rhythm need more than a green audit: the
audit sees declarations, not rendered ratios. Capture the surface, read the
computed `gap`/`margin`/`padding` of the section and of its content, and confirm
the inter-section gap is still clearly larger than the intra-section one. The
captures and measurements for the 2026-09-19 pass are in
`reports/spacing-review/` and the diagnostic specs that produced them follow the
`tests/e2e/inspector/zz-*.spec.ts` throwaway pattern (not committed).

Known debt and open items:

- The semantic-role layer has few consumers: ~3,300 references use the numeric
  primitives directly against ~30 semantic references. That is a naming and
  documentation problem rather than a rhythm problem (the roles alias the same
  primitives), but new work should prefer a role where one exists.
- `.spacing-baseline.json` records 292 buckets of remaining raw interface
  spacing. Most are content rhythm, functional geometry, and dense-chrome
  one-offs in satellite dialogs; the ratchet allows them to shrink only.
- `AdjustmentScopeSection` still uses a bespoke `.insp-section` grammar whose
  rules live in `editor.css` rather than `inspector.css`. Every other section
  uses `.insp-disclosure`. Folding it into `DisclosureSection` would remove the
  second grammar and the last Inspector class owned by the shell stylesheet.
- `packages/editor/src/components/LayersPanel/layers.css` was not audited for
  raw row spacing in this pass beyond the shared gate.
- The colour picker’s *visual* result could not be re-captured after the
  namespace change because the heavy-task lease was held by other sessions; its
  box model was measured directly instead (popover 400×560, colour area 362×181
  at the designed 60% ratio, field rows 32px, dialog body capped at 472px). A
  fresh capture is the first thing to redo.

The current migration intentionally prioritizes shared primitives and the
marketing shell. The remaining page-specific raw `rem` values are content
rhythm or component-local rules and should be migrated opportunistically at
their owning component, not through a broad search-and-replace.
