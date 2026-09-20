# Varve interface sizing system

Status: active. This document defines application-interface sizing for the
editor, shared UI package, and website shell. It does not define authored
document typography, canvas geometry, export dimensions, or interaction
thresholds.

## Audit summary

Varve is a dense, pointer-first design editor with shared React primitives, a
Tauri desktop shell, a browser/WASM surface, and an Astro marketing and
documentation site. The 2026-09-20 pass measured the running application
rather than reading the token files, and found four architectural problems
that the previous pass had left in place:

- **Blocking — native controls were never normalised.** `button`, `input`,
  `select`, and `textarea` fell back to the browser's UA stylesheet
  (`13.3333px Arial`). Twenty-plus control classes rendered in the wrong face
  at a size that matched no token; the app carried 28 scattered `font:
  inherit` patches and still leaked. Fixed by one reset in
  `apps/desktop/src/global.css` that assigns the interface-control role.
- **High — three competing size systems.** Shared component tiers
  (32/40/48, with 40 documented as "default"), an Inspector-local fixed-px
  type scale (12/13px plus a rogue 14px icon step), and raw shell literals
  (20/22/23/24/28/30/32). Nothing in the application actually rendered at the
  documented 40px default. Fixed by one five-step ladder and one type ramp.
- **High — the type floor was 10.8px.** `--font-size-2xs` was the
  most-consumed type token in the repository (373 references) and resolved to
  10.8px; nine distinct interface sizes existed, four of them within 1.5px of
  each other. This is the exact failure mode Figma UI3 is still criticised
  for (see § Research basis). Fixed by a stable rem ramp with a 12px floor.
- **High — control geometry was viewport-coupled.** `height: var(--space-6)`
  resolved to 22.4px at a narrow window and 29.6px at 1920, so the status
  bar's targets shrank below the WCAG 2.5.8 24px floor when the window
  narrowed, and `--space-8` made the Inspector tab bar 61px tall.
- **Medium — close affordances had eight geometries and three treatments**,
  including a hover-invisible tab close and a parameter popover whose dismiss
  control was the word "Close" while every sibling used an X.
- **Intentional:** authored text sizes, scene coordinates, canvas overlays,
  print dimensions, chart geometry, and pointer thresholds remain outside this
  system.

## Architecture

The canonical sources are:

- [`typography.ts`](../../packages/ui/src/tokens/typography.ts) — primitive
  type values and complete semantic roles.
- [`sizing.ts`](../../packages/ui/src/tokens/sizing.ts) — the five-step
  control ladder and the visible sizing contract.
- [`iconTokens.ts`](../../packages/ui/src/tokens/iconTokens.ts) — icon grids,
  stroke guidance, and the touch-target floor.
- [`generate-token-css.ts`](../../packages/ui/scripts/generate-token-css.ts) —
  emits the runtime contract consumed by CSS.
- [`apps/desktop/src/global.css`](../../apps/desktop/src/global.css) — the
  native form-control reset, the one place the UA default is overridden.
- [`CloseButton.tsx`](../../packages/ui/src/components/CloseButton.tsx) — the
  one dismiss control.

`tokens.css` is generated and must not be edited directly.

### Typography roles

The interface uses `--font-interface` (the Geist face), content uses
`--font-body` (IBM Plex Sans), editorial display uses Fraunces, and data/code
uses the monospace stack. Consumers use the role properties as a group:

| Role | Size | Use |
| --- | ---: | --- |
| `interface-micro` | 12px | badges, keyboard hints, counts, decorative meta |
| `interface-caption` | 13px | helper text, hints, status meta, table meta |
| `interface-label` | 13px | form, field, and inspector labels |
| `interface-control` | 15px | buttons, menus, tabs, select triggers, inputs, values |
| `interface-subheading` | 15px | section headings inside dense panels |
| `interface-body` | 17px | supporting application copy, dialog body, help |
| `interface-title` | 21px | panel, dialog, and document-chrome titles |
| `interface-heading` | 26px | page-level and empty-state headlines |
| `content-body` / `content-lead` | 17 / 21px | website and documentation reading copy |
| `marketing-*` | fluid | website editorial display |
| `data-numeric` | 15px mono | coordinates, measurements, scan-heavy numeric UI |

The role owns family, size, line-height, and weight together. A component may
change color or tracking for a state, but should not split a role across
unrelated size and line-height tokens.

**Stability.** Interface chrome steps (`2xs`–`xl`) are **stable rem**, so a
toolbar, inspector row, or menu never changes text size because the window was
resized. They still scale with the UI font-size preference and with browser
text zoom, because the values are rem. Only the display steps (`2xl`, `3xl`)
are bounded fluid clamps, and only the marketing site, splash, and
empty-state headlines consume them. The primitive ladder is strictly
increasing at every viewport width, so a display step can never render smaller
than the chrome step below it.

### Component tiers

There are five control heights, and every interactive control picks exactly
one. The names follow the shared component-size vocabulary, and `default` is
the height the application actually renders standard controls at:

| Tier | Block size | Typical use |
| --- | ---: | --- |
| `xs` | 24px | micro affordances inside dense rows (WCAG 2.5.8 floor) |
| `compact` | 28px | compact density rows and controls |
| `default` | 32px | buttons, inputs, selects, tabs, rows, panel headers |
| `large` | 40px | prominent actions, dialog footers, comfortable forms |
| `xl` | 48px | marketing and splash CTAs only |

A height outside this ladder is a bug unless it is documented functional
geometry (overlay handles, canvas anchors, drag thresholds) or a
content-capacity constraint (a textarea's minimum). Coarse-pointer contexts
promote the interactive minimum to `--touch-target-min` (44px) without
requiring the visible icon to grow.

Single-line controls use a stable minimum block size and can expand when their
content legitimately wraps. Textareas use minimum heights, not fixed heights.
Focus and validation use outlines or existing border geometry so states do not
move neighboring content.

### Close affordance

Every dismiss control is `CloseButton` (`.varve-close`), in one of three
sizes: `sm` (24px) for tabs, toasts, and dense rows; `md` (32px) for panels
and popovers; `lg` (44px) for modal dialogs. The glyph is always the same X,
the colour always rises from `--color-text-secondary` to
`--color-text-primary` on hover, and the focus ring never moves the glyph.
Reveal-on-hover is allowed (the editor tab strip uses it to keep tabs quiet),
but a close control must never be *only* hover-reachable: the active tab,
pointer hover, keyboard focus, and touch layouts all reveal it.

### Density behavior

Interface density is a **user preference**, applied at the document root:

- `settings.appearance.uiDensity` (`'default' | 'compact'`, labeled
  Default Pro / Compact Pro in Settings ▸ Appearance) maps to the shared
  `data-density` attribute (`comfortable` / `compact`); the pre-paint script
  in `apps/desktop/index.html` applies the persisted value before first
  paint, and `SettingsProvider` keeps the attribute in sync afterwards.
  `packages/editor/src/settings/interfaceDensity.ts` is the single writer.
- Comfortable maps onto the `default` tier (32px) and compact onto `compact`
  (28px); the attribute drives the `--density-*` row contracts in
  `@varve/ui`. There is no third `cozy` block: a mode nothing can select rots.
- Density changes geometry only — text roles, 24px target floors, and
  semantics are identical in both modes.
- The editor command surfaces are a density consumer too:
  `--density-control-size` (32px / 28px) is the shared contract for the
  floating tool palette, context bar, floating text bar, and selection quick
  bar (`docs/architecture/toolbar-system.md`). Coarse pointers promote these
  to `--touch-target-min` regardless of density.
- The Inspector consumes the same root contract through local semantic aliases
  with three ordered levels (body gap < field-group gap < section separation):
  Default Pro uses 32px rows, `space-3` body gaps, and `space-4` group/section
  rhythm; Compact Pro uses 28px rows, `space-2` body gaps, and `space-3`
  group/section rhythm. Section headers, the node header, and the alignment
  label take the active row height, so panel navigation follows the same
  contract as its controls. Number fields, text inputs, and select triggers
  share one `space-3` inline inset and one bordered sunken chrome.
- These aliases are an ownership adapter, not an override of the global
  component system. Shared Select/Button/Input primitives keep their global
  typography, borders, focus, and pointer-target behavior; Inspector CSS only
  supplies `--insp-row-height` and semantic group gaps. The Inspector type
  aliases resolve to the shared `interface-label` / `interface-control` roles
  — the panel does not maintain a second type scale.
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
| UA default `13.3333px Arial` on buttons/inputs | One native-control reset assigning `--type-interface-control-*` |
| Nine interface sizes (10.8/12/12.48/13/13.33/14.72/16.96/20/…) | Stable rem ramp 12/13/15/17/21/26 with a 12px floor |
| `--font-size-2xs` at 10.8px across 373 consumers | `interface-micro` at 12px, reserved for non-essential meta |
| `font-size: 13px` local Inspector scale | `--type-interface-label` / `--type-interface-control` roles |
| `--insp-icon-size-lg: 14px` orphan icon step | `--icon-size-sm` (16px) from the shared icon ladder |
| 34px "comfortable" Inspector rows | 32px `default` tier, mirrored by `DENSITY_ROW_HEIGHT_PX` |
| `height: var(--space-6)` on a status-bar control | `--component-compact-height` (viewport-independent) |
| `min-height: var(--space-5)` on inline row actions | `--component-xs-height` (24px, WCAG 2.5.8) |
| `min-block-size: var(--space-8)` Inspector tabs (61px) | `--component-large-height` (40px) |
| Eight close geometries / three treatments | `CloseButton` `sm`/`md`/`lg` (24/32/44) |
| Parameter popover's word "Close" | Shared X, labelled `Close <surface>` |
| `opacity: 0` hover-only tab close | Revealed on active tab, hover, focus, and touch |
| `padding: 1px 6px` chip literals | `--space-05 --space-2` |
| 8/9/10px interface text | `--font-size-2xs` (12px floor) |
| Button `min-height: 44px` for every pointer context | `--component-default-height`, promoted to `touch-target-min` for coarse pointers |
| Inputs using fluid `--space-4/5/6` heights | Stable component tier minimums with role-driven text metrics |
| Local `font-size + line-height` pairs | Complete `--type-<role>-*` semantic role |
| TypeScript-only icon constants | Emitted `--icon-size-*`, stroke, and touch-target CSS tokens |
| Ellipsized dialog title | Wrapping title with stable close-button hit region |
| Density tokens with no runtime writer | `data-density` applied from `settings.appearance.uiDensity` (Default Pro / Compact Pro) — see the density contract above |
| Website page-specific lead and section formulas | Shared marketing/content role aliases |
| 51 duplicated docs `h1` clamps and five `.docs-intro` sizes | `.site-page-title` plus the shared `docs-prose.css` recipe |

## Research basis

The ramp and ladder are not derived from a popular preset. They come from
measuring the running application and from the documented failure modes of
comparable tools:

- **Figma UI3** shipped ~11px interface chrome. The forum record is the
  clearest available evidence for what goes wrong: repeated "UI font size way
  too small", "font weight too thin since UI3", "elements (especially in
  Effects menu) are small click targets", and "interface scale should not
  scale the canvas". The first two are why this system sets a 12px floor, keeps
  label weight at medium rather than compensating with bold, and refuses to
  shrink text to fit a layout. The third is why compact controls keep a 24px
  minimum and why `--touch-target-min` promotion is device-derived. The fourth
  is why interface scaling (`fontSizeUI`) and document zoom are separate
  contracts.
- **Photoshop's options bar** is the reference for the status/context bar
  overflow policy: priority tiers drop segments rather than fragmenting labels.
- The ladder's shape (24/28/32/40) follows the density of long-session
  professional tools (VS Code and Linear sit at 13px interface text; Adobe at
  12–13px) while keeping Varve's own 15px control role, which measurement
  showed is the readable centre for this typeface at this density.

## Enforcement

`pnpm audit:sizing` (`scripts/quality/audit-interface-sizing.mjs`) fails on:

1. a raw `font-size` literal in application CSS (must resolve through
   `--type-*` / `--font-size-*`, be a keyword, or be `em`/`%` relative);
2. an interactive control taking its block size from the spacing ladder
   (`height: var(--space-N)` where the block is a control);
3. a close affordance declaring its own box geometry instead of using
   `.varve-close` or a component tier;
4. a missing native form-control reset in `apps/desktop/src/global.css`
   (hard failure, no ratchet).

Existing debt is recorded in `.interface-sizing-baseline.json` and may only
shrink; intentional exceptions are annotated inline with
`/* audit-interface-sizing: allow <reason> */`. The audit is selected by
`verify:plan` for application CSS changes and runs in the staged commit
checkpoint.

## Exceptions and ownership

Raw values are acceptable when they describe a border, a native control
requirement, a genuine one-off surface, an icon optical correction, or
functional geometry. Do not replace values in scene nodes, authored text,
artboards, SVG paths, print boxes, chart coordinates, animation keyframes,
canvas overlay coordinates, or pointer thresholds with interface tokens.

Components own internal composition and minimum usable size. Parent layouts own
available space and sibling gaps. New semantic roles should be added only when
the meaning recurs across more than one component family.

### Choosing a value

1. Pick the **role**, not a number: text gets a `--type-*` role; a control gets
   a `--component-*-height` tier; an icon gets `--icon-size-*`.
2. If the row must be denser, use the `compact` tier — do not invent a height
   between two tiers and do not reach for a `--space-*` token.
3. If a value is genuinely unique (an overlay handle, a chart gutter), keep it
   local and say why in a comment.
4. Never change document or authored geometry to make interface chrome fit.

## Validation contract

Sizing changes require `pnpm verify:plan` followed by
`pnpm verify:affected`. Shared primitive changes additionally require the
affected UI/editor checks, `pnpm audit:docs`, `pnpm audit:emoji`,
`pnpm audit:tokens`, `pnpm audit:spacing`, and `pnpm audit:sizing`. Website
changes require `pnpm build:website`, the website typecheck, and targeted
website Playwright visual captures at desktop, mobile, and both themes.
Screenshots are inspected directly before any baseline is updated.
