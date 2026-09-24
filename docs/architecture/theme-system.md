# Application theme system

Varve has one application-colour source, one semantic CSS contract, and one
runtime preference contract across the desktop shell, browser build, detached
panel windows, and editor packages. The marketing site consumes the same
generated foundation but owns a smaller site-specific semantic layer; see
[website-theme-contrast.md](website-theme-contrast.md). The surface-tier,
canvas-identity, and document-derived-accent layer built on these tokens is
specified in [design-token-system.md](design-token-system.md).

## Ownership and layers

1. `packages/ui/src/tokens/color.ts` owns the primitive OKLCH ramps and the
   `SEMANTIC` mappings for Light, Dark, and High Contrast. Product components
   must not select ramp positions directly.
2. `packages/ui/scripts/generate-token-css.ts` emits
   `packages/ui/src/tokens/tokens.css`. Never edit the generated colour blocks
   by hand. Each theme exposes the same `--color-*` semantic roles.
3. Product CSS consumes semantic roles such as `--color-surface-base`,
   `--color-text-primary`, `--color-border-subtle`, and
   `--color-interactive-focus-ring`. Domain aliases are appropriate only for a
   real editing concept such as a guide, selection outline, timeline playhead,
   or transparency grid.
4. `packages/ui/src/tokens/themeRuntime.ts` owns preference validation,
   persistence, resolution, root attributes, and synchronization. It does not
   pass a palette object through React.

The root attributes deliberately represent two different facts:

- `data-theme-mode="system|light|dark|high-contrast"` is the durable user
  preference.
- `data-theme="light|dark|high-contrast"` is the concrete palette currently
  consumed by CSS and canvas colour readers.

System therefore remains distinguishable from a resolved Light or Dark
appearance. CSS inheritance updates ordinary chrome without a React-tree
rerender. The editor listens for `varve:theme-change` only to invalidate the
small set of canvas colour caches whose values were read from computed styles.

## Lifecycle contract

`varve-theme` in local storage is authoritative. `strata-theme` is read only as
a migration fallback and is removed on the next successful write. Missing,
corrupt, or unknown values normalize to System.

Every application document follows this order:

1. A dependency-free script in `apps/desktop/index.html` validates and resolves
   the stored preference before the first paint, preventing a Light/Dark flash.
2. The entry point calls `initializeThemeLifecycle()` once. It reconciles the
   pre-paint state and owns the operating-system and storage listeners.
3. An OS colour-scheme change updates the resolved theme only when the
   preference is System.
4. A same-origin storage event reconciles browser tabs and Tauri WebView
   windows without reloading them.
5. Settings and View-menu commands call `setThemePreference()`; neither writes
   attributes or storage independently.

The Settings `appearance.theme` field is a compatibility mirror for the
settings schema. The runtime storage key remains the theme authority. Resetting
settings returns the preference to System. Native OS dialogs and standard
window furniture remain platform-controlled; failure to recolour them cannot
prevent the WebView theme from applying.

## Application themes and website themes

The design application intentionally supports System, Light, Dark, and High
Contrast. The marketing site exposes only Light and Dark, with System as its
implicit first-visit mode and native `forced-colors` as its high-contrast path.
This is a product-scope distinction, not a second colour foundation. On the
site, `data-theme-mode` is `system` until a visitor chooses Light or Dark, and
`data-theme` is always the resolved Light/Dark palette.

## Interface colour versus authored colour

Application theme tokens may colour shell surfaces, panels, controls, menus,
dialogs, focus states, status messages, and non-exported editor overlays. They
must not rewrite document fills or strokes, imported media, colour-picker
values, exported artwork, user palettes, chart palettes intended for export,
or render-test fixtures.

Canvas overlays are a separate functional domain. Selection, guide, snapping,
path-node, and transform indicators may use fixed hues or dual dark/light
strokes when that is required to remain visible over arbitrary artwork. These
values are intentional only when the overlay is excluded from export, colour
sampling, and document persistence. Brand SVG artwork, the fixed dark
startup loader, the image/HDR viewer backdrop, and the depth-mask data scale
are also intentional identity surfaces rather than themeable application
chrome; the last two are named in `tokens.css` under
`Theme-invariant domain colors` so they have an owner and a stated reason.

## Representative migration map

| Obsolete or local value | Canonical role |
|---|---|
| `--color-surface` / `#fff` | `--color-surface-base` |
| `--color-surface-elevated` / `#f5f5f5` | `--color-surface-raised` |
| `--color-surface-subtle` | `--color-surface-sunken` |
| `--color-surface-selected` | `--color-interactive-selected-surface` |
| `--elevation-surface` (as a shadowless surface) | `--color-surface-overlay` |
| `--color-text` / `#1a1a1a` | `--color-text-primary` |
| `--color-text-strong` / `--color-text-default` | `--color-text-primary` |
| `--color-text-tertiary` | `--color-text-subtle` |
| lowered parent `opacity` for secondary copy | `--color-text-secondary` or `--color-text-muted` |
| `--color-border` / `#e0e0e0` | `--color-border-subtle` or `--color-border-strong`, according to purpose |
| `--color-border-accent` | `--color-accent-primary` |
| `--color-border-default` | `--color-border-subtle` |
| `--color-border-error` / `--color-border-warning` | `--color-feedback-danger` / `--color-feedback-warning` |
| `--color-feedback-error` / `--danger` / `--color-text-danger` | `--color-text-danger` |
| `--color-feedback-info-strong` | `--color-text-info` |
| `--color-accent-contrast` / `--color-text-primary-on-accent` | `--color-text-on-accent` |
| `--color-stroke-subtle` | `--color-border-subtle` |
| `--color-interactive-subtle` | `--color-accent-subtle` |
| `--elevation-shadow-sm` | `--elevation-shadow-raised` |
| `--line-height-normal` | `--font-line-normal` |
| `--font-size-3xs` | `--font-size-2xs` |
| `--space-1-5` | `--space-1` |
| `--menubar-height` | `--menubar-total-height` |
| local accent and focus literals | `--color-interactive-default` and `--color-interactive-focus-ring` |
| local disabled opacity | `--color-text-disabled` + `--color-interactive-disabled` |
| literal fallback on a defined token (`var(--color-x, #fff)`) | delete the fallback — the token is the value |

The migration target is semantic intent, not a mechanical literal-to-token
replacement. Authored and renderer colours stay in their owning domain.

## Adding or changing theme UI

- Add or change semantic roles in `color.ts`, map the role in every theme, add
  every meaningful foreground/background pairing to the contrast contract,
  then regenerate `tokens.css`.
- Use the semantic custom property in components. Do not add
  `theme === 'dark' ? ...` branches or palette-ramp references to product UI.
- Route all preference controls through `setThemePreference()` and display
  System separately from its resolved appearance.
- Portal content must remain under the document root or explicitly inherit the
  root custom properties. Detached windows must load the generated token CSS
  and initialize the same lifecycle.
- Document literal exceptions beside their owner. Do not broaden a lint/test
  allowlist to hide application-chrome values.

## Verification

- `pnpm audit:tokens` verifies the declared WCAG 2.2 AA semantic pairs across
  all three application themes (315 pairs: text roles on every surface tier
  they can land on, feedback graphics on every tier, and text-safe feedback
  roles including the hover surface), then runs
  `scripts/quality/audit-token-usage.mjs` for undefined custom-property
  references and literal fallbacks on defined tokens.
- `packages/ui/src/tokens/tokens.test.ts` proves the committed `tokens.css`
  still matches `color.ts`, declares no custom property twice in a theme block,
  keeps the `--elevation-surface-*` → `--color-surface-*` alias direction, and
  never lets an elevation alias overwrite a semantic surface role.
- `pnpm lint:css` bans hex colours and duplicate custom properties in the
  design-system stylesheets.
- `themeRuntime.test.ts` covers normalization, migration, resolution, blocked
  storage, semantic events, OS updates, and storage reconciliation.
- `tests/e2e/settings/theme-lifecycle.spec.ts` covers first paint, System,
  invalid values, Settings, and detached-window synchronization.
- Website static, browser, contrast, and screenshot checks are documented in
  `website-theme-contrast.md`.
- Visual review must include Light, Dark, and High Contrast application chrome;
  System under both OS resolutions; an open settings dialog and menu; detached
  chrome; and representative website desktop/mobile pages. Screenshot baselines
  are updated only after direct image inspection.
