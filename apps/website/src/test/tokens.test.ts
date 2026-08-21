import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Website theme-token tests.
 *
 * Guards the semantic layer in src/styles/theme.css (+ @varve/ui tokens):
 *  1. every required token exists in every theme,
 *  2. every required foreground/background pairing meets WCAG 2.2 AA,
 *  3. pages never fall back to the legacy neutral/teal ramp or raw colors,
 *  4. every custom property referenced on the site is defined,
 *  5. every page uses the shared Layout.
 */

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const themeCss = read('styles/theme.css');
const tokensCss = read('../../../packages/ui/src/tokens/tokens.css');

/* ------------------------------------------------------------------ */
/* CSS custom-property parsing                                         */
/* ------------------------------------------------------------------ */

type VarMap = Record<string, string>;

/** Drop comments and @media blocks so their selectors cannot be mistaken for top-level ones. */
function stripMediaBlocks(source: string): string {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return noComments.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
}

function extractBlock(source: string, selector: string): VarMap {
  // Matches `selector { ... }` at top level of the sheet (no nesting in our files).
  const clean = stripMediaBlocks(source);
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  const out: VarMap = {};
  for (const match of clean.matchAll(re)) {
    const body = match[1].replace(/\/\*[\s\S]*?\*\//g, '');
    for (const line of body.split(';')) {
      const kv = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/);
      if (kv) out[kv[1]] = kv[2];
    }
  }
  return out;
}

function collectThemeMap(theme: 'light' | 'dark' | 'high-contrast'): VarMap {
  const map: VarMap = {};
  const blocks: Array<[string, string]> = [
    [tokensCss, ':root'],
    [tokensCss, `[data-theme="${theme}"]`],
    [themeCss, ':root'],
    [themeCss, `[data-theme="${theme}"]`],
  ];
  for (const [css, sel] of blocks) Object.assign(map, extractBlock(css, sel));
  return map;
}

/** Resolve var() references (including nested aliases) within a theme map. */
function resolveVar(name: string, map: VarMap, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`cyclic custom property: ${name}`);
  const value = map[name];
  if (value === undefined) throw new Error(`undefined custom property: ${name}`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (!ref) return value;
  seen.add(name);
  return resolveVar(ref[1], map, seen);
}

/* ------------------------------------------------------------------ */
/* oklch -> sRGB -> WCAG relative luminance                            */
/* ------------------------------------------------------------------ */

function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  const l1 = l + 0.3963377774 * a + 0.2158037573 * b;
  const m1 = l - 0.1055613458 * a - 0.0638541728 * b;
  const s1 = l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l1 ** 3;
  const m3 = m1 ** 3;
  const s3 = s1 ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    clamp(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    clamp(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  ];
}

function linearize(v: number): number {
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminanceOf(value: string, map: VarMap): number {
  const resolved = resolveVar(value, map);
  // Support system-color fallbacks used by forced-colors (not exercised here).
  if (/^[A-Za-z]+$/.test(resolved)) return 0.5;
  const m = resolved.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!m) throw new Error(`cannot parse color for contrast: ${value} = ${resolved}`);
  const [r, g, b] = oklchToRgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrast(fg: string, bg: string, map: VarMap): number {
  const l1 = luminanceOf(fg, map);
  const l2 = luminanceOf(bg, map);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------------ */
/* Required token inventory                                            */
/* ------------------------------------------------------------------ */

const REQUIRED_TOKENS = [
  // Surfaces
  '--surface-page',
  '--surface-sunken',
  '--surface-card',
  '--surface-card-hover',
  '--surface-header',
  '--surface-footer',
  '--surface-muted',
  '--surface-inset',
  '--surface-inverse',
  '--surface-interactive',
  '--surface-selected',
  '--surface-info',
  '--surface-warning',
  '--surface-danger',
  '--surface-success',
  // Text
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--text-subtle',
  '--text-inverse',
  '--text-on-accent',
  '--text-on-status',
  '--text-link',
  '--text-link-hover',
  '--text-link-visited',
  '--text-disabled',
  '--text-placeholder',
  '--text-code',
  '--text-footer',
  '--text-footer-muted',
  '--text-footer-heading',
  '--text-footer-link',
  '--text-footer-link-hover',
  '--text-success',
  '--text-warning',
  '--text-danger',
  '--text-info',
  // Borders and focus
  '--border-default',
  '--border-subtle',
  '--border-strong',
  '--border-interactive',
  '--border-accent',
  '--border-warning',
  '--border-footer',
  '--divider',
  '--focus-ring',
  '--focus-ring-offset',
  // Brand / accent / status
  '--accent-primary',
  '--accent-primary-hover',
  '--accent-strong',
  '--accent-strong-hover',
  '--accent-soft',
  '--brand-teal',
  '--brand-sandstone',
  '--brand-terracotta',
  '--status-built',
  '--status-partial',
  '--status-dev',
] as const;

/** Foreground/background pairings that must meet WCAG 2.2 AA (4.5:1 text, 3:1 graphics). */
const REQUIRED_PAIRS: Array<[string, string, number, string]> = [
  // Body text on page surfaces
  ['--text-primary', '--surface-page', 4.5, 'headings on page'],
  ['--text-secondary', '--surface-page', 4.5, 'body text on page'],
  ['--text-muted', '--surface-page', 4.5, 'muted text on page'],
  ['--text-subtle', '--surface-page', 4.5, 'subtle text on page'],
  // Cards
  ['--text-primary', '--surface-card', 4.5, 'card heading'],
  ['--text-secondary', '--surface-card', 4.5, 'card body'],
  ['--text-muted', '--surface-card', 4.5, 'card meta'],
  // Sunken / muted surfaces
  ['--text-primary', '--surface-sunken', 4.5, 'heading on sunken'],
  ['--text-secondary', '--surface-sunken', 4.5, 'body on sunken'],
  ['--text-muted', '--surface-sunken', 4.5, 'muted on sunken'],
  ['--text-primary', '--surface-muted', 4.5, 'heading on muted well'],
  ['--text-secondary', '--surface-muted', 4.5, 'body on muted well'],
  // Links (page + card + sunken)
  ['--text-link', '--surface-page', 4.5, 'link on page'],
  ['--text-link', '--surface-card', 4.5, 'link on card'],
  ['--text-link', '--surface-sunken', 4.5, 'link on sunken'],
  ['--text-link-hover', '--surface-page', 4.5, 'link hover on page'],
  ['--text-link-visited', '--surface-page', 4.5, 'visited link on page'],
  // Accent/status buttons and badges
  ['--text-on-accent', '--accent-primary', 4.5, 'primary button label'],
  ['--text-on-accent', '--accent-primary-hover', 4.5, 'primary button hover label'],
  ['--text-on-status', '--status-built', 4.5, 'built badge label'],
  ['--text-on-status', '--status-partial', 4.5, 'partial badge label'],
  ['--text-on-status', '--status-dev', 4.5, 'in-development badge label'],
  // Code blocks
  ['--text-code', '--surface-code', 4.5, 'code block text'],
  ['--text-code', '--surface-inset', 4.5, 'inset code text'],
  // Footer band: regression guard for the 2026-08-10 review (the download
  // title used a light-overlay token on the dark band at 1.04:1)
  ['--text-footer-heading', '--surface-footer', 4.5, 'footer heading'],
  ['--text-footer', '--surface-footer', 4.5, 'footer text'],
  ['--text-footer-muted', '--surface-footer', 4.5, 'footer muted text'],
  ['--text-footer-link', '--surface-footer', 4.5, 'footer link'],
  // Footer
  ['--text-footer', '--surface-footer', 4.5, 'footer body'],
  ['--text-footer-muted', '--surface-footer', 4.5, 'footer meta'],
  ['--text-footer-heading', '--surface-footer', 4.5, 'footer heading'],
  ['--text-footer-link', '--surface-footer', 4.5, 'footer link'],
  ['--text-footer-link-hover', '--surface-footer', 4.5, 'footer link hover'],
  // Status surfaces
  ['--text-secondary', '--surface-info', 4.5, 'info callout body'],
  ['--text-secondary', '--surface-warning', 4.5, 'warning callout body'],
  ['--text-secondary', '--surface-danger', 4.5, 'danger callout body'],
  ['--text-secondary', '--surface-success', 4.5, 'success callout body'],
  ['--text-success', '--surface-page', 4.5, 'success text on page'],
  ['--text-warning', '--surface-page', 4.5, 'warning text on page'],
  ['--text-danger', '--surface-page', 4.5, 'danger text on page'],
  ['--text-info', '--surface-page', 4.5, 'info text on page'],
  // Inverse
  ['--text-inverse', '--surface-inverse', 4.5, 'inverse text'],
  // Interactive boundaries / focus indicators (3:1 graphics)
  ['--focus-ring', '--surface-page', 3.0, 'focus ring vs page'],
  ['--focus-ring', '--surface-card', 3.0, 'focus ring vs card'],
  ['--border-interactive', '--surface-page', 3.0, 'interactive border vs page'],
  ['--border-interactive', '--surface-card', 3.0, 'interactive border vs card'],
  ['--border-accent', '--surface-card', 3.0, 'accent border vs card'],
];

const THEMES = ['light', 'dark'] as const;

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('website theme tokens', () => {
  for (const theme of THEMES) {
    describe(`${theme} theme`, () => {
      const map = collectThemeMap(theme);

      it('defines every required semantic token', () => {
        const missing = REQUIRED_TOKENS.filter((t) => map[t] === undefined);
        expect(missing, `missing tokens in ${theme}`).toEqual([]);
      });

      it.each(REQUIRED_PAIRS)('%s on %s (%s) meets AA', (fg, bg, threshold, label) => {
        const ratio = contrast(fg, bg, map);
        expect(
          ratio,
          `${label}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1 (need ${threshold})`,
        ).toBeGreaterThanOrEqual(threshold);
      });

      it('keeps accent primary visually distinct from page surface', () => {
        const ratio = contrast('--accent-primary', '--surface-page', map);
        expect(ratio).toBeGreaterThanOrEqual(3.0);
      });
    });
  }

  it('defines forced-colors and reduced-motion fallbacks in theme.css', () => {
    expect(themeCss).toContain('@media (forced-colors: active)');
    expect(themeCss).toContain('@media (prefers-color-scheme: dark)');
    expect(themeCss).toContain('color-scheme: light');
    expect(themeCss).toContain('color-scheme: dark');
  });

  it('no longer defines a high-contrast theme or prefers-contrast block', () => {
    // The site exposes exactly two selectable themes (light/dark). Native
    // OS forced-colors remains supported via @media (forced-colors: active),
    // which is tested separately above — it is accessibility infra, not a
    // third site theme. (The historical note in the file's header comment
    // is prose, not a theme definition.)
    const noComments = themeCss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(noComments).not.toMatch(/\[data-theme="high-contrast"\]/);
    expect(noComments).not.toMatch(/prefers-contrast/);
    expect(noComments).not.toMatch(/data-theme="high-contrast"/);
  });

  it('no longer defines the legacy neutral/teal ramp anywhere', () => {
    expect(themeCss).not.toMatch(/--color-neutral-/);
    expect(themeCss).not.toMatch(/--color-teal-/);
  });
});

describe('website page styling', () => {
  const pagesDir = path.join(ROOT, 'pages');
  const pageFiles = fs
    .readdirSync(pagesDir, { recursive: true } as never)
    .filter((f) => typeof f === 'string' && f.endsWith('.astro'));

  it('every page uses the shared Layout', () => {
    const withoutLayout = pageFiles.filter((f) => {
      const src = read(`pages/${f}`);
      return !/import Layout from '\.\.(\/\.\.)*\/layouts\/Layout\.astro'/.test(src);
    });
    expect(withoutLayout).toEqual([]);
  });

  it('pages/components/layouts contain no legacy or hardcoded colors', () => {
    const targets = [
      ...pageFiles.map((f) => `pages/${f}`),
      'layouts/Layout.astro',
      'components/Button.astro',
      'components/BentoCard.astro',
      'components/BentoGrid.astro',
    ];
    const offenders: string[] = [];
    for (const rel of targets) {
      const src = read(rel);
      if (/var\(--color-(neutral|teal|sandstone|terracotta)/.test(src)) {
        offenders.push(`${rel}: legacy --color-* token`);
      }
      // Pages must use the website semantic layer, not raw @varve/ui tokens.
      if (/var\(--color-(text|surface|border|accent|interactive)/.test(src)) {
        offenders.push(`${rel}: raw @varve/ui token instead of website semantic token`);
      }
      // Raw hex/rgb/white/black in style rules (not SVG fills or inline props).
      const styles = src.split(/<style[^>]*>/)[1]?.split('</style>')[0] ?? '';
      const raw = styles.match(
        /(?:color|background(?:-color)?|border(?:-[a-z]+)?):\s*(?:#[\da-f]{3,8}|white|black|rgba?\()/i,
      );
      if (raw) offenders.push(`${rel}: raw color ${raw[0]}`);
      if (/<style[^>]*>\s*<\/style>/.test(src)) offenders.push(`${rel}: empty style block`);
    }
    expect(offenders).toEqual([]);
  });

  it('every custom property referenced on the site is defined', () => {
    const defined = new Set<string>();
    for (const css of [tokensCss, themeCss]) {
      for (const m of css.matchAll(/--[\w-]+\s*:/g)) defined.add(m[0].replace(/\s*:$/, ''));
    }
    // Inline layout overrides are set via style attributes in components/pages.
    for (const m of ['--bento-cols', '--bento-span', '--architecture-rows']) defined.add(m);
    const missing = new Set<string>();
    const allSources = [read('layouts/Layout.astro'), ...pageFiles.map((f) => read(`pages/${f}`))];
    for (const src of allSources) {
      for (const m of src.matchAll(/var\((--[\w-]+)/g)) {
        if (!defined.has(m[1])) missing.add(m[1]);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('no page uses opacity to mute text', () => {
    const offenders = pageFiles.filter((f) => {
      const styles =
        read(`pages/${f}`)
          .split(/<style[^>]*>/)[1]
          ?.split('</style>')[0] ?? '';
      return /(?:opacity|opacity:\s*[\d.]+)/.test(styles) && !styles.includes('transition');
    });
    expect(offenders).toEqual([]);
  });
});
