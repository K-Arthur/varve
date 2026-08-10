/**
 * Generates packages/ui/src/tokens/tokens.css from the audited TS source.
 *
 * Single source of truth: color.ts (audited) → this script → tokens.css.
 * Run: `tsx scripts/generate-token-css.ts` (re-run when color.ts changes).
 *
 * Uses OKLCH color space — all color values emitted as `oklch(L C H)`.
 *
 * Emits:
 *   - :root                      → light defaults (the default theme)
 *   - [data-theme="dark"]        → dark overrides (explicit in-app choice wins)
 *   - [data-theme="high-contrast"]
 *   - @media prefers-color-scheme: dark  → dark when no explicit [data-theme]
 *   - @media prefers-reduced-motion      → durations collapse to 0
 *   - @media forced-colors: active       → high-contrast honoring system colors
 */
import { writeFileSync } from 'node:fs';
import { SEMANTIC, type THEMES } from '../src/tokens/color';
import { oklchToCss } from '../src/tokens/contrast';

const kebab = (s: string) => s.replace(/_/g, '-');

function colorBlock(theme: string): string {
  const palette = SEMANTIC[theme as (typeof THEMES)[number]];
  const lines = Object.entries(palette).map(
    ([token, oklch]) => `  --color-${kebab(token)}: ${oklchToCss(oklch)};`,
  );
  return lines.join('\n');
}

const NON_COLOR = `
  /* --- Typography --- */
  --font-display: "Geist Variable", "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-body: "IBM Plex Sans Variable", "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  /* --- Type system -------------------------------------------------------
   *
   * One rule, shared by the website and the application. Which face is used
   * is decided by the *role* of the text, never by the surface it sits on:
   *
   *   --font-editorial  Brand and display only: the Varve wordmark, marketing
   *                     headlines, section titles, the welcome screen, the
   *                     footer signature. Never interface chrome.
   *   --font-display    Interface chrome: navigation, buttons, menus, panel
   *                     and dialog headings, labels.
   *   --font-body       Reading text: paragraphs, descriptions, help copy.
   *   --font-mono       Code, coordinates, measurements, numeric readouts.
   *
   * Editorial weights: 600 at wordmark/small sizes, 700 at display sizes.
   * Set \`font-variation-settings: 'opsz' N\` alongside it — roughly 24 for
   * wordmark sizes and 144 for display — because Fraunces' hairlines go
   * spindly if the display cut is used small. Consumers import the face
   * themselves (\`@fontsource-variable/fraunces/opsz.css\`); the fallback chain
   * degrades to a system serif if they do not.
   */
  --font-editorial: "Fraunces Variable", "Fraunces", ui-serif, Georgia, "Times New Roman", serif;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  --font-line-tight: 1.15;
  --font-line-normal: 1.5;
  --font-line-relaxed: 1.65;
  --tracking-tight: -0.025em;
  --tracking-base: 0;
  --tracking-wide: 0.05em;
  /* Fluid modular scale (clamp). */
  --font-size-2xs: clamp(0.60rem, 0.58rem + 0.08vw, 0.68rem);
  --font-size-xs: clamp(0.72rem, 0.70rem + 0.10vw, 0.78rem);
  --font-size-sm: clamp(0.83rem, 0.80rem + 0.15vw, 0.92rem);
  --font-size-md: clamp(0.95rem, 0.91rem + 0.20vw, 1.06rem);
  --font-size-lg: clamp(1.08rem, 1.02rem + 0.30vw, 1.25rem);
  --font-size-xl: clamp(1.25rem, 1.15rem + 0.50vw, 1.55rem);
  --font-size-2xl: clamp(1.50rem, 1.35rem + 0.75vw, 2.00rem);
  --font-size-3xl: clamp(1.85rem, 1.60rem + 1.25vw, 2.65rem);

  /* --- Spacing (4-pt grid, fluid) --- */
  --space-0: 0;
  --space-05: clamp(0.08rem, 0.07rem + 0.03vw, 0.10rem);
  --space-1: clamp(0.15rem, 0.14rem + 0.05vw, 0.20rem);
  --space-2: clamp(0.30rem, 0.28rem + 0.10vw, 0.40rem);
  --space-3: clamp(0.50rem, 0.47rem + 0.15vw, 0.65rem);
  --space-4: clamp(0.70rem, 0.66rem + 0.20vw, 0.90rem);
  --space-5: clamp(1.00rem, 0.94rem + 0.30vw, 1.30rem);
  --space-6: clamp(1.40rem, 1.31rem + 0.45vw, 1.85rem);
  --space-7: clamp(2.00rem, 1.87rem + 0.65vw, 2.65rem);
  --space-8: clamp(2.80rem, 2.60rem + 1.00vw, 3.80rem);
  --space-9: clamp(3.60rem, 3.30rem + 1.50vw, 5.00rem);
  --space-10: clamp(4.50rem, 4.00rem + 2.00vw, 6.50rem);
  --space-11: clamp(5.60rem, 5.00rem + 2.50vw, 8.00rem);
  --space-12: clamp(7.00rem, 6.00rem + 3.00vw, 10.00rem);
  --space-13: clamp(8.50rem, 7.50rem + 3.50vw, 12.00rem);
  --space-14: clamp(10.00rem, 9.00rem + 4.00vw, 14.00rem);
  --space-15: clamp(12.00rem, 10.50rem + 5.00vw, 16.00rem);
  --space-16: clamp(14.00rem, 12.00rem + 6.00vw, 18.50rem);
  --space-20: clamp(17.00rem, 15.00rem + 7.00vw, 22.00rem);
  --space-24: clamp(21.00rem, 18.00rem + 9.00vw, 27.00rem);
  --space-32: clamp(28.00rem, 24.00rem + 12.00vw, 36.00rem);
  /* Component aliases. */
  --panel-padding: clamp(0.70rem, 0.66rem + 0.20vw, 0.90rem);
  --toolbar-height: clamp(2.5rem, 2.4rem + 0.5vw, 3rem);
  --topbar-height: clamp(2rem, 1.95rem + 0.25vw, 2.25rem);
  --statusbar-height: clamp(1.5rem, 1.45rem + 0.25vw, 1.75rem);
  --sidebar-width: clamp(14rem, 12rem + 8vw, 18rem);
  --inspector-width: clamp(15rem, 13rem + 8vw, 20rem);

  /* --- Radius --- */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 16px;
  --radius-xl: 28px;
  --radius-2xl: 40px;
  --radius-pill: 9999px;

  /* --- Elevation surfaces (100% opaque, hierarchical) --- */
  --elevation-surface-sunken: oklch(0.95 0.008 260);
  --elevation-surface-default: oklch(0.97 0.008 260);
  --elevation-surface-raised: oklch(0.99 0.006 260);
  --elevation-surface-overlay: oklch(1 0 0);

  /* --- Elevation shadows (dark-theme adaptive) --- */
  --elevation-shadow-raised: 0 4px 12px oklch(0 0 0 / 0.14);
  --elevation-shadow-overlay: 0 12px 32px oklch(0 0 0 / 0.20);

  /* --- Elevation z-index --- */
  --elevation-z-sunken: 0;
  --elevation-z-default: 1;
  --elevation-z-raised: 100;
  --elevation-z-overlay: 1000;

  /* --- Micro-borders (Linear-style 1px edges) --- */
  --border-micro: 1px solid oklch(0 0 0 / 0.08);
  --border-micro-accent: 1px solid oklch(0.779 0.1229 188.31 / 0.25);

  /* --- Legacy shadows (kept for backward compat, prefer elevation-*) --- */
  --shadow-none: none;
  --shadow-xs: 0 1px 2px oklch(0 0 0 / 0.06);
  --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.10);
  --shadow-md: 0 4px 12px oklch(0 0 0 / 0.14);
  --shadow-lg: 0 12px 32px oklch(0 0 0 / 0.20);
  --shadow-xl: 0 24px 48px oklch(0 0 0 / 0.25);

  /* --- Motion --- */
  --duration-instant: 50ms;
  --duration-quick: 100ms;
  --duration-fast: 150ms;
  --duration-base: 250ms;
  --duration-slow: 400ms;
  --duration-slower: 600ms;
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);

  /* --- Legacy z-index (kept for backward compat, prefer elevation-z-*) --- */
  --z-base: 0;
  --z-raised: 10;
  --z-sticky: 50;
  --z-dropdown: 100;
  --z-popover: 200;
  --z-overlay: 1000;
  --z-dialog: 1100;
  --z-modal: 1150;
  --z-toast: 1200;
  --z-tooltip: 1300;

  /* --- Breakpoints (reference values; used in @media, not as custom props) --- */
  --bp-sm: 640px;
  --bp-md: 768px;
  --bp-lg: 1024px;
  --bp-xl: 1280px;
  --bp-2xl: 1536px;

  /* --- Scrim overlay (semi-transparent backdrop behind dialogs/popovers) --- */
  --elevation-scrim: oklch(0 0 0 / 0.55);

  /* --- Compatibility aliases (canonical name → alias) --- */
  --color-surface-default: var(--color-surface-base);
  --color-on-accent: var(--color-text-on-accent);
  --color-accent-hover: var(--color-interactive-hover);
`;

const DARK_ELEVATION = `
  /* Elevation surfaces (dark mode — front-lit: higher = brighter). */
  --elevation-surface-sunken: oklch(0.12 0.008 260);
  --elevation-surface-default: oklch(0.18 0.008 260);
  --elevation-surface-raised: oklch(0.22 0.006 260);
  --elevation-surface-overlay: oklch(0.27 0.005 260);

  /* Elevation shadows (dark mode — more visible on dark bg). */
  --elevation-shadow-raised: 0 4px 12px oklch(0 0 0 / 0.30);
  --elevation-shadow-overlay: 0 12px 32px oklch(0 0 0 / 0.45);

  /* Micro-borders (dark mode — more visible). */
  --border-micro: 1px solid oklch(1 0 0 / 0.08);
  --border-micro-accent: 1px solid oklch(0.779 0.1229 188.31 / 0.30);

  /* Scrim overlay (dark mode — slightly more opaque for contrast). */
  --elevation-scrim: oklch(0 0 0 / 0.65);
`;

const HC_ELEVATION = `
  /* Elevation surfaces (high-contrast — maximum separation). */
  --elevation-surface-sunken: oklch(0 0 0);
  --elevation-surface-default: oklch(0 0 0);
  --elevation-surface-raised: oklch(0.15 0 0);
  --elevation-surface-overlay: oklch(0.2 0 0);

  /* Elevation shadows (HC — outline-style depth cues). */
  --elevation-shadow-raised: 0 0 0 2px oklch(1 0 0);
  --elevation-shadow-overlay: 0 0 0 3px oklch(1 0 0);

  /* Micro-borders (HC — thicker, full-contrast edges). */
  --border-micro: 2px solid oklch(1 0 0);
  --border-micro-accent: 2px solid oklch(0.95 0.2 188);

  /* Scrim overlay (HC — near-opaque for maximum separation). */
  --elevation-scrim: oklch(0 0 0 / 0.7);
`;

/** Map legacy --color-surface-* to canonical elevation tokens (overrides color.ts values). */
const SURFACE_ALIASES = `
  /* Surface aliases — single elevation system (Neo-Bento redesign). */
  --color-surface-app: var(--elevation-surface-default);
  --color-surface-base: var(--elevation-surface-default);
  --color-surface-raised: var(--elevation-surface-raised);
  --color-surface-sunken: var(--elevation-surface-sunken);
  --color-surface-overlay: var(--elevation-surface-overlay);
`;

const css = `/* AUTO-GENERATED by packages/ui/scripts/generate-token-css.ts.
 * Do not edit by hand — edit color.ts + this script, then re-run.
 * Varve design tokens (Strata plan §6). Source of truth: src/tokens/color.ts.
 * Colors emitted as OKLCH (perceptually uniform color space).
 */

:root {
${colorBlock('light')}
${NON_COLOR}
${SURFACE_ALIASES}
}

[data-theme="dark"] {
${colorBlock('dark')}
${DARK_ELEVATION}
${SURFACE_ALIASES}
}

[data-theme="high-contrast"] {
${colorBlock('high-contrast')}
${HC_ELEVATION}
${SURFACE_ALIASES}
}

/* Dark via system preference ONLY when no explicit in-app [data-theme] choice. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
${colorBlock('dark')}
${DARK_ELEVATION}
${SURFACE_ALIASES}
  }
}

/* High-contrast via system preference (prefers-contrast) when no explicit
 * in-app [data-theme] choice. Declared after the dark block so it wins when
 * both preferences apply. */
@media (prefers-contrast: more) {
  :root:not([data-theme]) {
${colorBlock('high-contrast')}
${HC_ELEVATION}
${SURFACE_ALIASES}
  }
}

/* High-contrast honors the OS forced-colors mode using system color keywords. */
@media (forced-colors: active) {
  :root:not([data-theme="high-contrast"]) {
    --color-surface-app: Canvas;
    --color-surface-base: Canvas;
    --color-surface-raised: Canvas;
    --color-surface-sunken: Canvas;
    --color-surface-overlay: Canvas;
    --color-text-primary: CanvasText;
    --color-text-secondary: CanvasText;
    --color-text-subtle: GrayText;
    --color-text-muted: GrayText;
    --color-text-disabled: GrayText;
    --color-text-on-accent: ButtonText;
    --color-text-on-danger: ButtonText;
    --color-border-subtle: ButtonBorder;
    --color-border-strong: ButtonBorder;
    --color-border-focus: Highlight;
    --color-interactive-default: ButtonFace;
    --color-interactive-hover: ButtonFace;
    --color-interactive-active: ButtonFace;
    --color-interactive-disabled: ButtonFace;
    --color-interactive-focus-ring: Highlight;
    --color-feedback-success: CanvasText;
    --color-feedback-warning: CanvasText;
    --color-feedback-danger: CanvasText;
    --color-feedback-info: CanvasText;
    --color-tree-row: Canvas;
    --color-tree-row-hover: Canvas;
    --color-tree-row-selected: Highlight;
    --color-tree-row-focus: Highlight;
    --color-tree-indent-guide: CanvasText;
    --color-layer-accent-frame: Highlight;
    --color-layer-wash-frame: Canvas;
    --color-layer-accent-group: Highlight;
    --color-layer-wash-group: Canvas;
    --color-layer-accent-text: Highlight;
    --color-layer-wash-text: Canvas;
    --color-layer-accent-shape: Highlight;
    --color-layer-wash-shape: Canvas;
    --color-layer-accent-component: Highlight;
    --color-layer-wash-component: Canvas;
    --color-text-muted-on-default: GrayText;
    --color-text-muted-on-raised: GrayText;
    --color-text-muted-on-sunken: GrayText;
    --color-text-muted-on-overlay: GrayText;
    --color-text-subtle-on-default: GrayText;
    --color-text-subtle-on-raised: GrayText;
    --color-text-subtle-on-sunken: GrayText;
    --color-text-subtle-on-overlay: GrayText;
    --color-hero-glow: transparent;
    --elevation-surface-sunken: Canvas;
    --elevation-surface-default: Canvas;
    --elevation-surface-raised: Canvas;
    --elevation-surface-overlay: Canvas;
    --elevation-shadow-raised: none;
    --elevation-shadow-overlay: none;
    --border-micro: 1px solid ButtonBorder;
    --border-micro-accent: 2px solid Highlight;
  }
}

/* Reduced motion: collapse all motion durations to 0 (Strata plan §4.1). */
@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-instant: 0ms;
    --duration-quick: 0ms;
    --duration-fast: 0ms;
    --duration-base: 0ms;
    --duration-slow: 0ms;
    --duration-slower: 0ms;
  }
}
`;

writeFileSync(new URL('../src/tokens/tokens.css', import.meta.url), css);
console.log(`tokens.css generated (${css.length} bytes, OKLCH).`);
