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

The editor's existing `compact`, `comfortable`, and `cozy` density settings
remain for scan-heavy rows. They do not change document zoom, scene geometry,
selection bounds, or exported output. Website forms keep at least the browser's
16px text threshold to avoid unwanted mobile zoom; marketing display roles
remain fluid and bounded with `clamp()`.

Menus, dialogs, and popovers are viewport-constrained. Dialog titles wrap at
word boundaries or long unbroken strings instead of hiding content with a
single-line ellipsis.

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
