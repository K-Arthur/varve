# Website theme, color and contrast architecture

The Varve marketing site (`apps/website`) uses one semantic color system for
every route, theme and deployment mode. This document describes the token
layers, the theme-resolution model, the accessibility gates, and how to run
the verification pipeline.

## Why this exists

The site previously layered a second, light-only `--color-neutral-*` ramp on
top of the theme-aware `@varve/ui` tokens and picked colors from both systems.
In a dark-mode session the page background and header stayed light while the
semantic text tokens flipped light, so headings rendered near-white on white,
bento cards got dark surfaces with dark inherited text, and each page mixed
light-page and dark-component rendering. A computed-style audit found
495 WCAG violations across 42 routes x 3 themes.

## Token layers

1. `packages/ui/src/tokens/tokens.css` — the editor's theme-aware tokens
   (auto-generated from `color.ts`), keyed off `html[data-theme]` with
   `prefers-color-scheme` and `forced-colors` fallbacks.
2. `apps/website/src/styles/theme.css` — the website semantic layer. It maps
   the site's roles to values per theme:

   | Group | Tokens |
   |---|---|
   | Surfaces | `--surface-page`, `--surface-sunken`, `--surface-card`, `--surface-card-hover`, `--surface-header`, `--surface-footer`, `--surface-muted`, `--surface-inset`, `--surface-code`, `--surface-inverse`, `--surface-accent-soft`, `--surface-interactive`, `--surface-selected`, `--surface-info`, `--surface-warning`, `--surface-danger`, `--surface-success` |
   | Text | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-subtle`, `--text-inverse`, `--text-on-accent`, `--text-on-status`, `--text-link`, `--text-link-hover`, `--text-link-visited`, `--text-disabled`, `--text-placeholder`, `--text-code`, `--text-footer*`, `--text-success`, `--text-warning`, `--text-danger`, `--text-info` |
   | Borders/focus | `--border-default`, `--border-subtle`, `--border-strong`, `--border-interactive`, `--border-accent`, `--border-warning`, `--border-footer`, `--divider`, `--focus-ring`, `--focus-ring-offset` |
   | Brand/status | `--accent-primary`, `--accent-primary-hover`, `--accent-strong`, `--accent-strong-hover`, `--accent-soft`, `--brand-teal`, `--brand-sandstone`, `--brand-terracotta`, `--status-built`, `--status-partial`, `--status-dev` |

   Every group has a complete light and dark set, plus
   `prefers-color-scheme` (no-JS) and `forced-colors: active` fallbacks.
   `color-scheme` is set per theme so native controls, scrollbars and form
   fields match.
3. `apps/website/src/styles/global.css` — element defaults and shared
   components (`body`, headings, links, `kbd`/`pre`/`code`/tables, forms,
   `.btn-*`, `.skip-link`, `.code-block`) that only reference the
   semantic tokens.

### Rules

- Pages never reference raw hex, `white`/`black`, the legacy
  `--color-neutral-*`/`--color-teal-*` ramp, or the raw `@varve/ui`
  `--color-*` tokens directly — only the website semantic layer.
  Enforced by `apps/website/src/test/tokens.test.ts`.
- Muted text is a color, never a parent `opacity`.
- Brand colors (teal, sandstone, terracotta) are used as surfaces with dark
  `--text-on-status` text; they are not used as text colors on page
  backgrounds.

## Theme resolution

The site exposes exactly two selectable themes — light and dark. A
`ThemeToggle` control persists the user's choice; first-time visitors
follow the OS until their first explicit click.

`Layout.astro` ships an inline, pre-paint script (positioned before any
stylesheet in the built HTML) that sets one canonical state,
`<html data-theme="light|dark">`:

- an explicit persisted choice (`localStorage["varve-theme"]` in
  `{"light","dark"}`) wins;
- otherwise the OS preference drives, tracked with a `matchMedia` change
  listener so a first-time visitor follows a mid-session OS switch;
- the first explicit click converts the automatic state into a persisted
  choice (that click is the only write to storage);
- legacy values (`"system"`, `"high-contrast"`, anything invalid) resolve to
  the OS preference and are replaced by the next explicit choice — they are
  never rendered as a theme;
- with JavaScript disabled, the `prefers-color-scheme` fallback blocks in
  `theme.css`/`tokens.css` keep rendering readable.

There is no site high-contrast theme. Native OS forced-colors (Windows High
Contrast and similar) remains fully supported through the
`@media (forced-colors: active)` blocks in both token layers, which resolve
every surface/text/border role to system colors. That is accessibility
infrastructure and is deliberately independent of the two selectable themes.

## Contrast targets (WCAG 2.2 AA)

All ratios are computed with exact oklch -> sRGB -> WCAG relative luminance
(not approximations). Required minimums:

- normal text 4.5:1, large text 3:1,
- interactive boundaries and focus indicators 3:1,
- disabled controls are exempt but must stay recognizable,
- purely decorative text is exempt (WCAG 1.4.3 covers text that conveys
  information). Exactly one element qualifies: the oversized footer wordmark,
  which duplicates the brand lockup a few rows above it and is deliberately a
  faint ground. The computed-style audit skips `aria-hidden` subtrees — the
  same boundary axe uses for its colour-contrast rule — so anything reachable
  by a screen reader is still held to the full ratio, and hiding real content
  to dodge the check would fail the axe suite instead.

Notable tuned values (see `theme.css` for the full set):

- light-mode `--accent-primary` is a dark teal with white text (~16:1),
  matching the editor's button treatment; dark mode uses the light teal with
  dark text (~8:1).
- dark-mode `--text-muted`/`--text-subtle` are brightened so muted text stays
  at ~4.8:1 on the dark page (the shared editor tokens are 2.6:1 on the
  website's darker surface).
- status badges use brand tints light enough for dark text (>= 4.5:1).

## Verification pipeline

Unit/static (`pnpm test:website` — vitest):

- every required token exists in every theme;
- required foreground/background pairings meet AA (exact math);
- pages contain no legacy, hardcoded or raw `@varve/ui` tokens;
- no undefined custom properties; every page uses the shared layout.

Browser (`pnpm test:website:e2e` — Playwright, `playwright.website.config.ts`):

- two static servers: GitHub Pages mode (`/varve`, dist) and custom-domain
  mode (`/`, dist-root) — the full suite runs in both;
- computed-style contrast audit across 26 routes x 2 themes;
- theme resolution, persistence, legacy migration, switcher `aria-pressed`
  and no-FOUC ordering; forced-colors emulation resolves surfaces to system
  colors;
- hero/feature/card visibility regression tests (the reported defects);
- mobile menu a11y, focus rings, skip link, hash anchors under the sticky
  header;
- axe-core (wcag2a/aa/21/22) on representative routes;
- asset integrity: every local asset resolves 200 in both base modes;
- screenshot baselines (`visual.spec.ts`), regenerate deliberately with
  `npx playwright test -c playwright.website.config.ts --update-snapshots`.

Product screenshots consumed by the site are generated and validated by
`scripts/screenshots/` (`pnpm screenshots:product` / `screenshots:website` /
`screenshots:update`); the manifest is `apps/website/src/data/screenshot-manifest.json`.

Audit tool: `apps/website/scripts/audit-theme.mjs` renders every route x
theme and reports computed-style violations (uses the same exact math).

Layout fixes the pipeline depends on:

- `scroll-padding-top: 5.5rem` on `html` so hash targets clear the sticky
  header;
- page h1s use `clamp(2rem, 5vw, 2.5rem)` and grids use
  `minmax(min(<px>, 100%), 1fr)` so 320px viewports never overflow;
- `#main-content` carries `tabindex="-1"` so the skip link can move focus.

## Deployments

- GitHub Pages project mode: `SITE_BASE=/varve` (default).
- Custom domain: `SITE_BASE=/` via `pnpm build:website:root`
  (`SITE_URL=https://varve.example SITE_BASE=/ astro build --outDir dist-root`).
  Both builds are covered by the E2E suite; asset resolution is asserted per
  mode so a base-path regression can never masquerade as a color bug.
