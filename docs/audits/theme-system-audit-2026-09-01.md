# Theme system audit — 2026-09-01

## Scope and method

This audit covers the desktop/web application, auxiliary panel windows,
`@varve/ui`, the editor and home packages, Storybook/visual harnesses, canvas
overlays, and the marketing website. Discovery combined repository-wide
searches for theme state, CSS custom properties, literal colour syntax,
renderer colours, portal roots, persistence, and visual tests with inspection
of the existing token generator and contrast gates.

The literal-colour search found 129 non-test source files outside the generated
token sheet and its TypeScript source. That number is a classification input,
not a migration target: it includes authored document defaults, export
fixtures, colour-picker gradients, thumbnails, shaders/rendering probes,
multicolour brand art, and deliberately theme-independent canvas overlays.
Those values must not be converted into application-chrome tokens.

## Architecture before this work

- `packages/ui/src/tokens/color.ts` is the canonical colour source. It defines
  primitive OKLCH ramps and one semantic contract for `light`, `dark`, and
  `high-contrast`; `packages/ui/scripts/generate-token-css.ts` emits
  `tokens.css`.
- Product chrome consumes CSS custom properties. React state contains only a
  `themeRevision` counter so canvas colour caches can be invalidated without
  passing a large theme object through the editor tree.
- The editor exposes Light, Dark, High Contrast, and System in Settings, while
  the View menu exposes only the three resolved themes.
- The website imports the shared generated tokens and maps them through
  `apps/website/src/styles/theme.css`. It intentionally exposes only Light and
  Dark; first-time visitors follow the OS. Native forced-colours support is
  independent of that selector.
- Portals inherit from the document root, and desktop title-bar controls use
  the shared CSS variables. The startup loader is intentionally brand-fixed
  dark and is documented as an identity surface rather than application
  chrome.
- The token audit currently checks 120 foreground/background pairs across all
  three application themes. Website static and browser audits add route-level
  computed-style and visual coverage.

## Findings

### High

1. **Theme lifecycle has competing implementations.** The pre-paint HTML,
   primary React entry point, auxiliary entry point, Menubar, and Settings each
   read, validate, apply, and persist theme state differently. This makes a
   correct first paint possible but leaves no single runtime authority.
2. **System is not a durable preference.** Settings removes the storage key and
   `data-theme`, the default settings record says Light, and the menu cannot
   select System. The selected preference and resolved appearance can disagree.
3. **OS, tab, and window updates are incomplete.** CSS follows OS changes when
   no attribute exists, but JavaScript canvas caches do not receive a reliable
   semantic change event. Storage changes are not reconciled across browser
   tabs or Tauri auxiliary windows.
4. **Persisted appearance values are trusted by assertion.** Unknown or obsolete
   theme strings can enter the typed settings store instead of falling back to
   System.

### Medium

1. **Auxiliary chrome uses obsolete custom-property names** such as
   `--color-surface`, `--color-text`, and `--color-border`; its fallback literals
   hide the drift and make detached panels diverge from the primary window.
2. **Several newer editor surfaces use fallback literals around valid tokens.**
   These are harmless while the token sheet loads but disguise misspellings and
   weaken future enforcement. Migration should target application chrome,
   without touching document/export colour paths.
3. **Theme regression coverage is fragmented.** Token contrast and website
   lifecycle tests are strong, but the shared runtime itself has no unit tests
   for invalid storage, System resolution, OS changes, or storage events.

### Low / intentional exceptions

- Brand SVG fills, startup-loader colours, colour-picker spectra, thumbnails,
  sample documents, exported artwork, and document-authored palettes retain
  literal colour values by design.
- Canvas editing indicators that must remain visible over arbitrary artwork
  use fixed functional hues and, where necessary, dual black/white strokes.
  They are UI overlays, excluded from export, and should be tested visually
  against light, dark, saturated, and transparent content rather than mapped to
  the document palette.
- The website keeps a smaller Light/Dark selector. High Contrast remains an
  application theme; OS forced-colours remains the website accessibility path.

## Implementation sequence

1. Add one typed theme-preference runtime to `@varve/ui`: safe persistence,
   migration, resolved-theme application, pre-paint-compatible attributes,
   system and storage listeners, and a single change event.
2. Route desktop entry points, Settings, and View-menu commands through that
   runtime. Keep the settings field as a compatibility mirror while the theme
   preference key remains authoritative.
3. Replace obsolete auxiliary-window token names and add narrow safeguards for
   new application-chrome literals.
4. Align the website's lifecycle attributes and cross-tab behaviour without
   exposing an additional selector or changing authored/brand visuals.
5. Run the impact planner and affected checks, token/docs/emoji audits, targeted
   lifecycle E2E, application and website visual suites, and manually inspect a
   risk-based screenshot matrix before accepting any baseline change.

## Acceptance boundary

The migration is complete when every application entry point uses the same
runtime contract, System is distinguishable from its resolved appearance,
invalid preferences fail safely, menu/Settings/window state stays synchronized,
canvas caches receive theme changes, detached chrome uses canonical tokens, and
the inspected application/website matrices remain coherent in their supported
themes. Literal authored/rendering colours are explicitly outside the chrome
migration boundary.
