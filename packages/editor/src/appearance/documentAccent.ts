/**
 * documentAccent — the opt-in "accent from document" appearance mode.
 *
 * Contract (docs/architecture/design-token-system.md, "Document-derived
 * accents"): the user's default is the FIXED brand accent. When
 * `settings.appearance.accentSource` is `'document'`, a bounded extraction
 * derives an accent hue from the rendered page preview and re-tints ONLY the
 * accent/interactive token families. Keyboard focus, canvas selection and
 * handle marks, semantic feedback, workspace identities, layer tags, text
 * highlights, and brand tokens are deliberately never overridden — a
 * dominant artwork color must not be able to hide the marks users steer by
 * or repurpose semantic meaning.
 *
 * Extraction samples only the canonical page-nav thumbnail (the same
 * `flattenSceneToEngine` → engine IR replay the thumbnail system renders for
 * the page nav), downscaled to 64×64, analyzed in the existing palette
 * worker. No full-resolution readbacks, no new canvases beyond one bounded
 * 64×64 decode surface, no network, no inference models.
 *
 * Guarantees:
 * - Trailing debounce: continuous editing or dragging never triggers
 *   extraction mid-gesture; work starts only after input settles.
 * - Generation tokens + abort: a newer context (edit, page switch, document
 *   close) invalidates in-flight work; stale results never apply.
 * - Empty, fully transparent, or grayscale documents fall back to the fixed
 *   accent (no eligible candidate), never to an arbitrary hue.
 * - The High-Contrast theme is never overridden.
 * - Ramp lightness/chroma reuse the audited TEAL ladder exactly (only the
 *   hue rotates), so WCAG pairs hold by construction — and are re-validated
 *   at runtime anyway, falling back to fixed on any failure.
 * - Only the DOM root's style and one data attribute change. Documents,
 *   history, dirty-state, saved colors, and exports are untouched.
 */

import type { PaletteAnalysis } from '@varve/engine';
import {
  minimumRatio,
  type Oklch,
  oklchContrastRatio,
  oklchToCss,
  SEMANTIC,
  TEAL,
  type Theme,
} from '@varve/ui/tokens';
import { analyzePaletteInWorker } from '../intelligence/paletteAnalysisService';

export type AccentSourcePreference = 'fixed' | 'document';

/** A document-derived accent source in Oklch (the extracted hue + fixed viable L/C). */
export interface AccentSourceColor {
  h: number;
}

/** Minimum chroma for a swatch to count as a hue source (below = grayscale). */
export const MIN_ACCENT_CHROMA = 0.045;

/** Viable lightness window for accent duty (readable partners exist inside it). */
export const MIN_ACCENT_LIGHTNESS = 0.3;
export const MAX_ACCENT_LIGHTNESS = 0.88;

/** Role bias when ranking eligible swatches (deterministic tie-break after score). */
const ROLE_BIAS: Record<string, number> = {
  primary: 1.5,
  accent: 1.25,
  dominant: 1.1,
};

/**
 * Pick the document accent hue from a palette analysis. Returns null when
 * nothing eligible exists (empty, transparent, or grayscale document) — the
 * caller must fall back to the fixed accent.
 *
 * Ranking: largest `weight × chroma × roleBias` wins; ties break by hue then
 * lightness so the same document always yields the same accent.
 */
export function pickAccentSource(analysis: PaletteAnalysis): AccentSourceColor | null {
  if (analysis.extracted.length === 0) return null;
  if (
    analysis.warnings.some((warning) => warning.code === 'no-meaningful-colors') ||
    !(analysis.coverage > 0)
  ) {
    return null;
  }

  let best: { score: number; h: number; l: number } | null = null;
  for (const swatch of analysis.extracted) {
    const [l, c, h] = swatch.oklch;
    if (c < MIN_ACCENT_CHROMA) continue;
    if (l < MIN_ACCENT_LIGHTNESS || l > MAX_ACCENT_LIGHTNESS) continue;
    const bias = ROLE_BIAS[swatch.roleCandidate] ?? 1;
    const score = swatch.weight * c * bias;
    if (
      best === null ||
      score > best.score + Number.EPSILON ||
      (Math.abs(score - best.score) <= Number.EPSILON &&
        (h < best.h || (h === best.h && l < best.l)))
    ) {
      best = { score, h, l };
    }
  }
  return best === null ? null : { h: best.h };
}

/**
 * The token families the document accent may re-tint, per theme, expressed
 * as `[semanticToken, rampStep]` pairs. Steps index the audited 12-step ramp
 * (0-based); only the hue rotates, L and C come from the fixed ladder so the
 * audited contrast relationships are preserved.
 */
const OVERRIDABLE_TOKENS: Record<
  Exclude<Theme, 'high-contrast'>,
  ReadonlyArray<readonly [string, number]>
> = {
  light: [
    ['accent-primary', 5],
    ['accent-default', 5],
    ['accent-teal', 5],
    ['accent-subtle', 1],
    ['accent-on-subtle', 11],
    ['separator-accent', 8],
    ['interactive-default', 8],
    ['interactive-hover', 9],
    ['interactive-active', 10],
    ['interactive-pressed-surface', 10],
    ['interactive-selected-surface', 1],
    ['interactive-selected-border', 8],
    ['interactive-current-indicator', 8],
    ['interactive-checked-surface', 8],
    ['interactive-drop-target-surface', 1],
    ['interactive-drop-target-border', 8],
    ['tree-row-selected', 8],
  ],
  dark: [
    ['accent-primary', 5],
    ['accent-default', 5],
    ['accent-teal', 5],
    ['accent-subtle', 10],
    ['accent-on-subtle', 5],
    ['separator-accent', 4],
    ['interactive-default', 4],
    ['interactive-hover', 3],
    ['interactive-active', 2],
    ['interactive-pressed-surface', 2],
    ['interactive-selected-surface', 10],
    ['interactive-selected-border', 4],
    ['interactive-current-indicator', 4],
    ['interactive-checked-surface', 4],
    ['interactive-drop-target-surface', 10],
    ['interactive-drop-target-border', 4],
    ['tree-row-selected', 4],
  ],
};

/** Structural AA pairs that must still hold for an override set to apply. */
const VALIDATED_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['text-on-accent', 'interactive-default'],
  ['accent-on-subtle', 'accent-subtle'],
  ['interactive-selected-foreground', 'interactive-selected-surface'],
];

/** Derive the 12-step document-hue ramp (TEAL ladder, rotated hue). */
export function deriveRamp(hue: number): readonly Oklch[] {
  return TEAL.map((step) => ({ L: step.L, C: step.C, H: hue }));
}

/**
 * Compute the CSS custom-property overrides for one theme, or null when the
 * theme must keep its fixed accent (High-Contrast always; any theme whose
 * structural pairs fail validation with the derived ramp).
 */
export function deriveAccentOverrides(
  source: AccentSourceColor,
  theme: Theme,
): Record<string, string> | null {
  if (theme === 'high-contrast') return null;
  const ramp = deriveRamp(source.h);
  const overrides: Record<string, string> = {};
  for (const [token, step] of OVERRIDABLE_TOKENS[theme]) {
    overrides[`--color-${token}`] = oklchToCss(ramp[step] as Oklch);
  }
  for (const [fg, bg] of VALIDATED_PAIRS) {
    const fgColor = SEMANTIC[theme][fg as keyof (typeof SEMANTIC)['light']];
    const bgEntry = OVERRIDABLE_TOKENS[theme].find(([token]) => token === bg);
    if (!fgColor || !bgEntry) return null;
    // When the foreground partner is itself overridden, validate the derived
    // pair; otherwise the fixed foreground against the derived background.
    const fgEntry = OVERRIDABLE_TOKENS[theme].find(([token]) => token === fg);
    const derivedFg = fgEntry ? (ramp[fgEntry[1]] as Oklch) : fgColor;
    const ratio = oklchContrastRatio(derivedFg, ramp[bgEntry[1]] as Oklch);
    if (!(ratio >= minimumRatio('AA'))) return null;
  }
  // Interactive selected-surface hover keeps its dedicated lightness with the
  // rotated hue (color.ts defines it as a hand-tuned step outside the ladder).
  const hoverToken = SEMANTIC[theme]['interactive-selected-surface-hover'];
  if (hoverToken) {
    overrides['--color-interactive-selected-surface-hover'] = oklchToCss({
      L: hoverToken.L,
      C: hoverToken.C,
      H: source.h,
    });
  }
  return overrides;
}

/* ─────────────────────────── Application ─────────────────────────── */

const STYLE_ELEMENT_ID = 'varve-doc-accent';

function resolvedTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const value = document.documentElement.dataset.theme;
  return value === 'dark' || value === 'high-contrast' ? value : 'light';
}

function writeOverrides(overrides: Record<string, string> | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  let style = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (overrides === null || Object.keys(overrides).length === 0) {
    style?.remove();
    delete root.dataset.accentSource;
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    document.head.appendChild(style);
  }
  const body = Object.entries(overrides)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  style.textContent = `/* Document-derived accent (opt-in; appearance.accentSource). */\n:root {\n${body}\n}\n`;
  root.dataset.accentSource = 'document';
}

/* ─────────────────────────── Controller ─────────────────────────── */

export interface DocumentAccentContext {
  /** Identity of the extractable surface (document + page + revision). */
  key: string;
  /** Render the authorized visible content via the canonical thumbnail pipeline. */
  render: () => Promise<string | null>;
}

const EXTRACT_DEBOUNCE_MS = 400;
const SAMPLE_SIDE = 64;

let preference: AccentSourcePreference = 'fixed';
let context: DocumentAccentContext | null = null;
let currentSource: AccentSourceColor | null = null;
let generation = 0;
let abortController: AbortController | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function applyCurrent(): void {
  const source = preference === 'document' ? currentSource : null;
  writeOverrides(source === null ? null : deriveAccentOverrides(source, resolvedTheme()));
}

function cancelPending(): void {
  generation += 1;
  abortController?.abort();
  abortController = null;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

async function decodeToPixels(
  dataUrl: string,
  signal: AbortSignal,
): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null> {
  if (typeof document === 'undefined') return null;
  const image = new Image();
  image.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) return onAbort();
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => reject(new Error('accent preview decode failed')), {
      once: true,
    });
    signal.addEventListener('abort', onAbort, { once: true });
  });
  if (signal.aborted) return null;
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIDE;
  canvas.height = SAMPLE_SIDE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
  const { data } = ctx.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
  return { width: SAMPLE_SIDE, height: SAMPLE_SIDE, data };
}

async function extract(): Promise<void> {
  const gen = ++generation;
  abortController?.abort();
  abortController = new AbortController();
  const signal = abortController.signal;
  const active = context;
  if (!active) return;
  try {
    const dataUrl = await active.render();
    if (gen !== generation || active !== context || signal.aborted) return;
    if (!dataUrl) {
      currentSource = null;
      applyCurrent();
      return;
    }
    const pixels = await decodeToPixels(dataUrl, signal);
    if (gen !== generation || active !== context || signal.aborted || pixels === null) return;
    const analysis = await analyzePaletteInWorker(pixels, { colorCount: 6 }, signal);
    if (gen !== generation || active !== context || signal.aborted) return;
    currentSource = pickAccentSource(analysis);
  } catch {
    // Aborted or failed extraction: keep whatever was last applied honestly
    // (fixed accent when nothing valid exists yet), never a stale hue.
    if (gen !== generation) return;
    currentSource = null;
  }
  applyCurrent();
}

function schedule(immediate = false): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  if (preference !== 'document' || context === null) return;
  if (immediate) {
    void extract();
    return;
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void extract();
  }, EXTRACT_DEBOUNCE_MS);
}

export const documentAccentController = {
  /** Preference change (SettingsContext application path and reset flows). */
  setPreference(next: AccentSourcePreference): void {
    if (preference === next) {
      applyCurrent();
      return;
    }
    preference = next;
    if (next === 'fixed') {
      cancelPending();
      currentSource = null;
      applyCurrent();
      return;
    }
    schedule(!!currentSource);
  },
  /** Document/page/revision change; null when no extractable document exists. */
  setDocumentContext(next: DocumentAccentContext | null): void {
    if (context !== null && next !== null && context.key === next.key) return;
    context = next;
    currentSource = null;
    cancelPending();
    if (next === null) {
      applyCurrent();
      return;
    }
    schedule();
  },
  /** Theme switches re-derive the override map without re-extracting. */
  themeChanged(): void {
    applyCurrent();
  },
  /** Test/teardown seam. */
  __reset(): void {
    cancelPending();
    preference = 'fixed';
    context = null;
    currentSource = null;
    if (typeof document !== 'undefined') writeOverrides(null);
  },
};
