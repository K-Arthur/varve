/**
 * Generates packages/ui/src/tokens/tokens.css from the audited TS source.
 *
 * Single sources of truth: color.ts, spacing.ts, sizing.ts, typography.ts,
 * and iconTokens.ts (audited) → this script → tokens.css. Run
 * `tsx scripts/generate-token-css.ts` after any source changes.
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
import {
  BORDER_MICRO,
  BORDER_MICRO_ACCENT,
  ELEVATION_SCRIM,
  ELEVATION_SHADOWS,
  SEMANTIC,
  SIGNATURE_ACCENTS,
  type THEMES,
} from '../src/tokens/color';
import { oklchToCss } from '../src/tokens/contrast';
import { ICON_CSS_CUSTOM_PROPERTIES } from '../src/tokens/iconTokens';
import { COMPONENT_DIMENSIONS, COMPONENT_SIZES } from '../src/tokens/sizing';
import { SPACING_LAYOUT, SPACING_PRIMITIVES, SPACING_SEMANTIC } from '../src/tokens/spacing';
import { FONT_LINE_HEIGHTS, FONT_SIZES, TYPOGRAPHY_ROLES } from '../src/tokens/typography';

const kebab = (s: string) => s.replace(/_/g, '-');

function colorBlock(theme: string): string {
  const palette = SEMANTIC[theme as (typeof THEMES)[number]];
  const lines = Object.entries(palette).map(
    ([token, oklch]) => `  --color-${kebab(token)}: ${oklchToCss(oklch)};`,
  );
  return lines.join('\n');
}

/** `oklch(L C H / A)` for alpha-composited theme recipes. */
const alphaCss = (c: { color: { L: number; C: number; H: number }; alpha: number }) =>
  `oklch(${c.color.L} ${c.color.C} ${c.color.H} / ${c.alpha})`;

/**
 * Theme-varying color values that are not flat semantic colors: elevation
 * aliases, scrim, micro-borders, signature accents, and shadow stacks. All
 * sourced from color.ts so the generator only composes them into CSS names.
 */
function themedColorBlock(theme: string): string {
  const t = theme as (typeof THEMES)[number];
  const scrim = ELEVATION_SCRIM[t];
  const micro = BORDER_MICRO[t];
  const microAccent = BORDER_MICRO_ACCENT[t];
  const shadows = ELEVATION_SHADOWS[t];
  const signature = SIGNATURE_ACCENTS[t];
  return `  /* --- Elevation surfaces (aliases of the audited surface-* roles) --- */
  --elevation-surface-sunken: var(--color-surface-sunken);
  --elevation-surface-default: var(--color-surface-app);
  --elevation-surface-raised: var(--color-surface-raised);
  --elevation-surface-overlay: var(--color-surface-overlay);

  /* --- Elevation shadows (theme-aware: dark needs more, HC uses rings) --- */
  --elevation-shadow-subtle: ${shadows.subtle};
  --elevation-shadow-small: ${shadows.small};
  --elevation-shadow-raised: ${shadows.raised};
  --elevation-shadow-overlay: ${shadows.overlay};

  /* --- Scrim overlay (semi-transparent backdrop behind dialogs/popovers) --- */
  --elevation-scrim: ${alphaCss(scrim)};

  /* --- Micro-borders (hairline surface separation) --- */
  --border-micro: ${micro.width} solid ${alphaCss(micro.color)};
  --border-micro-accent: ${microAccent.width} solid ${alphaCss(microAccent.color)};

  /* --- Signature accents (presentational identity; never text-on-surface) --- */
  --color-signature-branch: ${oklchToCss(signature.branch)};
  --color-signature-audit: ${oklchToCss(signature.audit)};
  --color-signature-ai: ${oklchToCss(signature.ai)};`;
}

const spacingBlock = `
  /* --- Interface spacing: generated from src/tokens/spacing.ts --- */
${Object.entries(SPACING_PRIMITIVES)
  .map(([token, value]) => `  --space-${token}: ${value};`)
  .join('\n')}
  /* Semantic roles keep ownership legible across editor and website surfaces. */
${Object.entries(SPACING_SEMANTIC)
  .map(([token, value]) => `  --space-${token}: ${value};`)
  .join('\n')}
  /* Compatibility aliases for existing shell geometry. */
${Object.entries(SPACING_LAYOUT)
  .map(([token, value]) => `  --${token}: ${value};`)
  .join('\n')}
  /* --- Separator recipes --- */
  --separator-thickness: 1px;
  --separator-content-gap: var(--space-3);
  --separator-inset: var(--space-4);
  --separator-min-length: var(--space-4);
`;

const sizingBlock = `
  /* --- Component sizing: generated from src/tokens/sizing.ts --- */
${Object.entries(COMPONENT_SIZES)
  .map(
    ([size, values]) =>
      `  --component-${size}-height: ${values.controlHeight};\n  --component-${size}-icon-size: ${values.iconSize};\n  --component-${size}-padding-inline: ${values.paddingInline};`,
  )
  .join('\n')}
${Object.entries(COMPONENT_DIMENSIONS)
  .map(([token, value]) => `  --${token}: ${value};`)
  .join('\n')}
${Object.entries(ICON_CSS_CUSTOM_PROPERTIES)
  .map(([token, value]) => `  ${token}: ${value};`)
  .join('\n')}
`;

const typographyBlock = `
  /* --- Semantic typography: generated from src/tokens/typography.ts --- */
${Object.entries(FONT_LINE_HEIGHTS)
  .map(([token, value]) => `  --font-line-${token}: ${value};`)
  .join('\n')}
${Object.entries(FONT_SIZES)
  .map(([token, value]) => `  --font-size-${token}: ${value};`)
  .join('\n')}
  --font-interface: var(--font-display);
${Object.entries(TYPOGRAPHY_ROLES)
  .map(
    ([role, values]) =>
      `  --type-${role}-size: ${values.size};\n  --type-${role}-line-height: ${values.lineHeight};\n  --type-${role}-weight: ${values.weight};\n  --type-${role}-family: ${values.family};`,
  )
  .join('\n')}
`;

const NON_COLOR = `
  /* --- Typography --- */
  /* Wrapped to stay biome-format-clean: the emitted file must pass
   * biome check unchanged, or every tokens:generate run re-dirties it. */
  --font-display:
    "Geist Variable", "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    sans-serif;
  --font-body:
    "IBM Plex Sans Variable", "IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI",
    Roboto, sans-serif;
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
  --tracking-tight: -0.025em;
  --tracking-base: 0;
  --tracking-micro: 0.02em;
  --tracking-wide: 0.05em;
${typographyBlock}
${sizingBlock}

  /* --- Radius --- */
  /* Semantic geometry API. Components should consume these names instead of
   * choosing a raw radius or a generic scale value at each callsite. */
  --radius-none: 0;
  --radius-control-compact: 6px;
  --radius-control: 8px;
  --radius-floating: 14px;
  --radius-surface: 14px;
  --radius-card: 18px;
  --radius-device: 40px;
  --radius-full: var(--radius-pill);
  /* Compatibility names resolve to the semantic scale so older components
   * participate in the system while they are migrated at their owner. */
  --radius-sm: var(--radius-control-compact);
  --radius-md: var(--radius-control);
  --radius-lg: var(--radius-floating);
  --radius-xl: var(--radius-card);
  --radius-2xl: var(--radius-device);
  --radius-pill: 9999px;

  /* --- Legacy shadows: aliases of the themed elevation scale so dark mode
   * does not silently keep light-theme shadow opacities. --- */
  --shadow-none: none;
  --shadow-xs: var(--elevation-shadow-subtle);
  --shadow-sm: var(--elevation-shadow-small);
  --shadow-md: var(--elevation-shadow-raised);
  --shadow-lg: var(--elevation-shadow-overlay);
  --shadow-xl: var(--elevation-shadow-overlay);

  /* --- Elevation z-index --- */
  --elevation-z-sunken: 0;
  --elevation-z-default: 1;
  --elevation-z-raised: 100;
  --elevation-z-overlay: 1000;

  /* --- Motion --- */
  --duration-instant: 50ms;
  --duration-quick: 100ms;
  --duration-fast: 150ms;
  --duration-base: 250ms;
  --duration-slow: 400ms;
  --duration-slower: 600ms;
  --duration-emphasis: 1600ms;
  --duration-emphasis-loop: 4800ms;
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

  /* --- Theme-invariant domain colors ---
   *
   * Deliberately NOT themed. Adding a name here is the sanctioned way to keep
   * a literal out of a component stylesheet; the justification bar is that the
   * color encodes something the interface theme has no authority over:
   *
   *   media-viewer-*  An image/HDR preview is judged against a fixed neutral
   *                   dark backdrop so the surrounding app theme cannot bias
   *                   tonal perception. Same reasoning as the brand splash.
   *   depth-scale-*   The depth-mask legend depicts *document* data
   *                   (near -> mid -> far). The scale states absolute depth, so
   *                   re-theming it would change what the legend says.
   *
   * Values are exact sRGB round-trips of the literals they replaced.
   */
  --color-media-viewer-backdrop: oklch(0.2543 0.0072 248.11);
  --color-media-viewer-foreground: oklch(0.8525 0.0129 236.65);
  --color-depth-scale-near: oklch(0.5569 0.1874 261.2);
  --color-depth-scale-mid: oklch(0.7762 0.1116 188.54);
  --color-depth-scale-far: oklch(0.6197 0.189 29.54);

  /* --- Compatibility aliases (canonical name → alias) --- */
  --color-surface-default: var(--color-surface-base);
  --color-on-accent: var(--color-text-on-accent);
  --color-accent-hover: var(--color-interactive-hover);
`;

/** Indent a generated block one extra level for nesting inside a media query. */
function indent(block: string): string {
  return block
    .split('\n')
    .map((line) => (line.trim() === '' ? line : `  ${line}`))
    .join('\n');
}

const css = `/* AUTO-GENERATED by packages/ui/scripts/generate-token-css.ts.
 * Do not edit by hand — edit color.ts, spacing.ts, or this script, then re-run.
 * Varve design tokens. Sources of truth: src/tokens/color.ts, spacing.ts,
 * sizing.ts, typography.ts, and iconTokens.ts.
 * Colors emitted as OKLCH (perceptually uniform color space).
 */

:root {
${colorBlock('light')}
${spacingBlock}
${NON_COLOR}
${themedColorBlock('light')}
}

[data-theme="dark"] {
${colorBlock('dark')}
${spacingBlock}
${themedColorBlock('dark')}
}

[data-theme="high-contrast"] {
${colorBlock('high-contrast')}
${spacingBlock}
${themedColorBlock('high-contrast')}
}

/* Dark via system preference ONLY when no explicit in-app [data-theme] choice. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
${indent(colorBlock('dark'))}
${indent(spacingBlock)}
${indent(themedColorBlock('dark'))}
  }
}

/* High-contrast via system preference (prefers-contrast) when no explicit
 * in-app [data-theme] choice. Declared after the dark block so it wins when
 * both preferences apply. */
@media (prefers-contrast: more) {
  :root:not([data-theme]) {
${indent(colorBlock('high-contrast'))}
${indent(spacingBlock)}
${indent(themedColorBlock('high-contrast'))}
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
    /* Elevation surfaces are aliases of --color-surface-*, so overriding the
     * semantic roles above is sufficient — do not restate them here. */
    --elevation-shadow-subtle: none;
    --elevation-shadow-small: none;
    --elevation-shadow-raised: none;
    --elevation-shadow-overlay: none;
    --border-micro: 1px solid ButtonBorder;
    --border-micro-accent: 2px solid Highlight;
  }
}

/*
 * Rule/separator channels must survive forced-colors in EVERY app theme.
 * The high-contrast theme keeps its author palette by design (see the
 * :root:not([data-theme="high-contrast"]) block above), but background
 * channels are replaced by the user agent unless the author supplies a system
 * color keyword. Backgrounds drawn with CanvasText/Highlight are honored, so
 * separators and rule recipes stay visible instead of silently disappearing.
 */
@media (forced-colors: active) {
  :root {
    --color-separator-subtle: CanvasText;
    --color-separator-default: CanvasText;
    --color-separator-strong: CanvasText;
    --color-separator-accent: Highlight;
    --color-border-subtle: CanvasText;
    --color-border-strong: CanvasText;
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
    --duration-emphasis: 0ms;
    --duration-emphasis-loop: 0ms;
  }
}
`;

// Collapse blank-line runs introduced by block interpolation so the emitted
// file is format-stable (`tokens:generate` must not re-dirty tokens.css).
const output = css.replace(/\n{3,}/g, '\n\n');
writeFileSync(new URL('../src/tokens/tokens.css', import.meta.url), output);
console.log(`tokens.css generated (${output.length} bytes, OKLCH).`);
