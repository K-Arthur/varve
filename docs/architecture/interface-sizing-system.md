# Varve interface sizing system

Status: active. This document defines application-interface sizing for the
editor, shared UI package, and website shell. It does not define authored
document typography, canvas geometry, export dimensions, or interaction
thresholds.

## Audit summary

Varve is a dense, pointer-first design editor with shared React primitives, a
Tauri desktop shell, a browser/WASM surface, and an Astro marketing and
documentation site. The repository already had a useful fluid primitive type
scale and spacing system, but the audit found three architectural gaps:

- **High:** shared controls mixed a 24/28/32px compact scale with 44px default
  buttons and 52px large buttons. Inputs and selects used different heights,
  and the select stylesheet had a dead `--line-height-tight` reference.
- **High:** semantic typography roles were described in comments but consumers
  mostly paired raw `--font-size-*` values with local line heights.
- **Medium:** icon sizes existed as TypeScript constants but were not emitted to
  the runtime CSS token sheet, so SVG consumers could not share a CSS contract.
- **Medium:** dialog titles were single-line ellipsized, which clipped or hid
  legitimate translated and user-provided titles.
- **Intentional:** authored text sizes, scene coordinates, canvas overlays,
  print dimensions, chart geometry, and pointer thresholds remain outside this
  system.

## Architecture

The canonical sources are:

- [`typography.ts`](../../packages/ui/src/tokens/typography.ts) — primitive
  type values and complete semantic roles.
- [`sizing.ts`](../../packages/ui/src/tokens/sizing.ts) — component tiers,
  semantic dimensions, and the visible sizing contract.
- [`iconTokens.ts`](../../packages/ui/src/tokens/iconTokens.ts) — icon grids,
  stroke guidance, and the touch-target floor.
- [`generate-token-css.ts`](../../packages/ui/scripts/generate-token-css.ts) —
  emits the runtime contract consumed by CSS.

`tokens.css` is generated and must not be edited directly.

### Typography roles

The interface uses `--font-interface` (the Geist face), content uses
`--font-body` (IBM Plex Sans), editorial display uses Fraunces, and data/code
uses the monospace stack. Consumers use the role properties as a group:

| Role | Use |
| --- | --- |
| `interface-control` | Buttons, menus, tabs, select triggers, inputs |
| `interface-label` | Form and inspector labels |
| `interface-body` | Supporting application copy and table text |
| `interface-caption` | Hints, metadata, compact badges |
| `interface-title` | Panel and dialog headings |
| `content-body` / `content-lead` | Website and documentation reading copy |
| `marketing-hero` / `marketing-section` | Website editorial display |
| `data-numeric` | Coordinates, measurements, and scan-heavy numeric UI |

The role owns family, size, line-height, and weight together. A component may
change color or tracking for a state, but should not split a role across
unrelated size and line-height tokens.

### Component tiers

There are three visible tiers:

| Tier | Minimum block size | Typical use |
| --- | ---: | --- |
| `compact` | 32px | Dense editor toolbars, compact fields, pills |
| `default` | 40px | Normal buttons, inputs, selects, icon buttons |
| `large` | 48px | Prominent actions and comfortable forms |

Coarse-pointer contexts promote the interactive minimum to 44px without
requiring the visible icon to grow. The visible icon uses the `xs`–`xl` icon
roles; a hit region is owned by its button or handle. This distinction is
especially important for editor overlays and resize handles.

Single-line controls use a stable minimum block size and can expand when their
content legitimately wraps. Textareas use minimum heights, not fixed heights.
Focus and validation use outlines or existing border geometry so states do not
move neighboring content.

### Responsive and density behavior

Interface density is a **user preference**, applied at the document root:

- `settings.appearance.uiDensity` (`'default' | 'compact'`, labeled
  Default Pro / Compact Pro in Settings ▸ Appearance) maps to the shared
  `data-density` attribute (`comfortable` / `compact`); the pre-paint script
  in `apps/desktop/index.html` applies the persisted value before first
  paint, and `SettingsProvider` keeps the attribute in sync afterwards.
  `packages/editor/src/settings/interfaceDensity.ts` is the single writer.
- The attribute drives the existing `--density-*` row contracts in
  `@varve/ui` (compact 28px rows / comfortable 34px rows; the website-only
  `cozy` block is not exposed in the editor). Density changes geometry only —
  text sizes, 24px target floors, and semantics are identical in both modes.
- The editor command surfaces are a density consumer too:
  `--density-control-size` (32px / 28px / cozy 36px) is the shared contract
  for the floating tool palette, context bar, floating text bar, and
  selection quick bar (`docs/architecture/toolbar-system.md`). Coarse
  pointers promote these to `--touch-target-min` regardless of density.
- The Inspector consumes the same root contract through local semantic aliases
  with three ordered levels (body gap < field-group gap < section separation):
  Default Pro uses 34px rows, `space-3` body gaps, and `space-4` group/section
  rhythm; Compact Pro uses 28px rows, `space-2` body gaps, and `space-3`
  group/section rhythm. Section headers, the node header, and the alignment
  label take the active row height, so panel navigation follows the same
  contract as its controls. Number fields, text inputs, and select triggers
  share one `space-3` inline inset and one bordered sunken chrome. Field-group
  spacing and content padding are reduced in Compact Pro, while horizontal
  paired-field geometry remains stable so narrow rails do not gain dead width
  or lose controls.
- These aliases are an ownership adapter, not an override of the global
  component system. Shared Select/Button/Input primitives keep their global
  typography, borders, focus, and pointer-target behavior; Inspector CSS only
  supplies `--insp-row-height` and semantic group gaps. Fixed Inspector-local
  heights such as `2rem` must not replace the shared `--density-*` contract.
- Density never touches document zoom, scene geometry, selection bounds, or
  exported output, and never enters the document undo stack.
- Virtualized consumers must follow the mode: the Layers tree's
  `estimateSize` reads the mode's row-height contract and re-measures on
  change (`subscribeInterfaceDensity` → `virtualizer.measure()`), so no
  stale cached height or invisible focused row survives a switch.
- Touch accommodation stays **device-derived**: `@media (pointer: coarse)`
  promotes interactive minimums to `--touch-target-min` (44px) and the
  toolbar gates touch affordances via `useHasTouchInput`. A manual override
  setting is deliberately not offered — it would make dimensions change
  whenever a hybrid device's primary pointer class changes.
- `settings.appearance.fontSizeUI` scales rem-based typography (and spacing
  roles) through a root font-size override (small 15px / medium —browser
  default— / large 18px); px-based component geometry intentionally does not
  scale, and rows grow with their content via `min-height`.

Website forms keep at least the browser's 16px text threshold to avoid
unwanted mobile zoom; marketing display roles remain fluid and bounded with
`clamp()`. Menus, dialogs, and popovers are viewport-constrained. Dialog
titles wrap at word boundaries or long unbroken strings instead of hiding
content with a single-line ellipsis.

### Dense field rows and metadata

Inspector field rows use a stable two-column contract: the label owns a bounded
label column and the control owns the remaining width. The row itself does not
wrap into a second, ambiguous line; controls that contain several affordances
wrap internally instead. This prevents a long value, URL, or action label from
painting over the next field.

Metadata readouts use an explicit label/value grid. Native definition-list
margins are reset, both columns may shrink, and long values use safe wrapping.
This is required for image colour metadata, but applies to any dense inspector
readout that may contain untrusted or format-provided strings.

Adjustment editors follow the same contract for nested rows: the panel root
must retain a zero-width flex minimum, labels may shrink and wrap within a
bounded column, and controls must be allowed to shrink inside the remaining
space. Long adjustment names, colour labels, select values, and effect actions
must never rely on intrinsic flex widths at the narrow inspector size.

## Migration map

| Previous pattern | Canonical contract |
| --- | --- |
| Button `min-height: 44px` for every pointer context | `component-default-height`, promoted to `touch-target-min` for coarse pointers |
| Toggle buttons at 24/32/36px | `compact` / `default` / `large` tiers |
| Inputs using fluid `--space-4/5/6` heights | Stable component tier minimums with role-driven text metrics |
| Select option `--line-height-tight` | Existing canonical `--font-line-tight` |
| Local `font-size + line-height` pairs | Complete `--type-<role>-*` semantic role |
| TypeScript-only icon constants | Emitted `--icon-size-*`, stroke, and touch-target CSS tokens |
| Ellipsized dialog title | Wrapping title with stable close-button hit region |
| Website page-specific lead and section formulas | Shared marketing/content role aliases |
| Density tokens with no runtime writer | `data-density` applied from `settings.appearance.uiDensity` (Default Pro / Compact Pro) — see the density contract above |

## Exceptions and ownership

Raw values are acceptable when they describe a border, a native control
requirement, a genuine one-off surface, an icon optical correction, or
functional geometry. Do not replace values in scene nodes, authored text,
artboards, SVG paths, print boxes, chart coordinates, animation keyframes,
canvas overlay coordinates, or pointer thresholds with interface tokens.

Components own internal composition and minimum usable size. Parent layouts own
available space and sibling gaps. New semantic roles should be added only when
the meaning recurs across more than one component family.

## Validation contract

Sizing changes require `pnpm verify:plan` followed by
`pnpm verify:affected`. Shared primitive changes additionally require the
affected UI/editor checks, `pnpm audit:docs`, `pnpm audit:emoji`, and
`pnpm audit:tokens`. Website changes require `pnpm build:website`, the
website typecheck, and targeted website Playwright visual captures at desktop,
mobile, and both themes. Screenshots are inspected directly before any
baseline is updated.
