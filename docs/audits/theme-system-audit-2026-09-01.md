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
- The token audit currently checks 135 foreground/background pairs across all
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

## Implementation and visual-review result

The application lifecycle is now consolidated in
`packages/ui/src/tokens/themeRuntime.ts`. Desktop and auxiliary entry points,
Settings, and the View menu use the same preference API. `data-theme-mode`
records System/Light/Dark/High Contrast while `data-theme` records the resolved
palette. Invalid values return to System; OS and storage events synchronize
without a reload; one semantic event invalidates computed-style canvas caches.
The website mirrors the mode/resolution split and storage-event behaviour while
retaining its intentional two-choice Light/Dark control.

The detached shell's obsolete aliases and fallback literals were replaced by
canonical semantic tokens. A narrow source test prevents that chrome from
reintroducing literal colours or the removed aliases. The Settings theme
control now defaults and resets to System, identifies the currently resolved
appearance, and is reachable from both Settings and the View menu through the
same runtime.

### Direct image review

The risk-based application matrix captured a 1440 x 900 editor with Appearance
Settings open in Light, Dark, High Contrast, and System-resolved Dark, plus a
720 x 520 detached-window invalid-route state in High Contrast. Review artifacts
were written to `test-results/theme-visual-review-2026-09-01/`.

The first render found a real runtime failure: Appearance read the current font
and menu settings after its `settings` binding had been removed. The section
crashed only when opened, despite type and unit checks passing. The binding was
restored, a focused component regression test was added, all five captures were
rerun, and the images were inspected again. The corrected images show:

- clear raised-dialog separation and restrained chrome in Light and Dark;
- distinct selected navigation, inputs, borders, and switch controls;
- a visibly different System preference with the resolved Dark appearance
  stated in text;
- strong High Contrast boundaries and focus affordances without recolouring
  document content; and
- detached-window copy and surfaces using the same High Contrast palette.

Representative current website Light, Dark, mobile Dark, and Product images
were also opened and reviewed. Typography, surface hierarchy, header controls,
cards, calls to action, and footer treatment remained coherent in both themes.
The website screenshot comparison did not pass: all 16 stored baselines differed
by roughly 4–10% after the independently committed spacing-system migration
changed shared geometry and page heights. No theme baseline was rewritten to
hide that separate change; the spacing owner must certify and refresh those
baselines as its own reviewable change.

## Agent validation report

```text
Changed scope: @varve/ui theme runtime; desktop/browser entry points;
  editor Settings, View menu, canvas theme event, auxiliary chrome;
  marketing-site lifecycle; application and website theme tests; theme docs
Validation plan: four affected JS packages; Tiers 0–4; no full-suite escalation
Commands actually run:
  pnpm verify:plan --since 8f2e6e15d^
  VARVE_E2E_WORKERS=1 pnpm verify:affected --since 8f2e6e15d^
  pnpm --filter @varve/{ui,editor,desktop,website} typecheck (individually)
  pnpm typecheck:e2e
  pnpm exec vitest run <theme/settings/menu/chrome test files>
  pnpm test:website
  pnpm build:website && pnpm build:website:pages
  pnpm exec playwright test -c playwright.website.config.ts
    apps/website/tests/e2e/theme.spec.ts --reporter=list
  pnpm exec playwright test tests/e2e/settings/theme-lifecycle.spec.ts
    --project=chromium --reporter=list
  pnpm exec playwright test tests/e2e/settings/theme-visual.spec.ts
    --project=chromium --reporter=list
  pnpm exec playwright test tests/e2e/settings/settings-dialog.spec.ts
    --project=chromium --reporter=list
  pnpm exec playwright test -c playwright.website.config.ts
    apps/website/tests/e2e/visual.spec.ts --project=ghpages --reporter=list
  pnpm audit:tokens
  pnpm audit:docs
  pnpm audit:emoji
  node scripts/audit-architecture.mjs --ci
Passed:
  formatting/lint on the committed range; docs/emoji/token audits;
  135/135 application contrast pairs; architecture enforced baselines;
  UI package 515/515; website static 169/169; focused theme/settings tests;
  all affected typechecks; both 66-page website builds;
  website lifecycle 64/64 across both deployment modes;
  application lifecycle 3/3; application visual capture matrix 5/5
  narrow Settings screenshot passed after the spacing-owned baseline refresh
Stopped/failed outside the theme boundary:
  affected runner stopped in @varve/desktop because demoCapabilities.test.ts
  expects two restrictions while production declares onlineFonts as a third;
  the broad editor package run exposed unrelated existing Inspector/export
  failures and was stopped after the failure set was established;
  website visual comparison 0/16 due independently changed spacing geometry;
  the narrow Settings snapshot initially differed for the same reason, then
  passed after its spacing-owned baseline refresh
Skipped as unrelated: Rust workspace, WASM, render benchmarks, packaging,
  signing, and model-quality lanes; no Rust, renderer hot path, or schema changed
Escalations: none
Full suite run: no
```

Native WebKitGTK title-bar behaviour, OS-owned file dialogs/notifications, and
the macOS/Windows native window matrix were not available in this Chromium/Linux
session. Their platform-controlled colours remain an explicit residual risk;
the WebView and detached-window contracts were exercised in Chromium.
