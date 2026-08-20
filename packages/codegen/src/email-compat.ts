/**
 * Email compatibility database.
 *
 * Centralises what each compatibility profile can express, so profile checks
 * live in one table instead of being scattered as `if (outlook)` branches
 * through the compiler, the emitter, and the inspector.
 *
 * A profile answers three questions about a CSS declaration:
 *   - can it be emitted natively?
 *   - if not, is there a deterministic fallback?
 *   - what should preflight say about it?
 *
 * Sources of truth are the well-known email-client support tables; the entries
 * below are deliberately conservative — a property is only marked `native` for
 * a profile when the mainstream clients that profile targets render it.
 */

import type { EmailCompatibilityProfile } from '@varve/scene';
import type { EmailIrSeverity } from './email-ir-types';

/** How a construct fares under a given profile. */
export type EmailFeatureSupport = 'native' | 'fallback' | 'unsupported';

export interface EmailCssRule {
  /** CSS property this rule governs. */
  property: string;
  /** Support level per profile. */
  support: Record<EmailCompatibilityProfile, EmailFeatureSupport>;
  /**
   * Deterministic fallback applied when support is `fallback`.
   * Receives the declared value and returns replacement declarations
   * (an empty object drops the declaration).
   */
  fallback?: (value: string) => Record<string, string>;
  /** Diagnostic severity when the property is degraded. */
  severity?: EmailIrSeverity;
  /** Short explanation used in preflight messages. */
  note?: string;
}

const ALL_NATIVE: Record<EmailCompatibilityProfile, EmailFeatureSupport> = {
  conservative: 'native',
  modern: 'native',
  'provider-specific': 'native',
};

function support(
  conservative: EmailFeatureSupport,
  modern: EmailFeatureSupport,
  providerSpecific: EmailFeatureSupport = modern,
): Record<EmailCompatibilityProfile, EmailFeatureSupport> {
  return { conservative, modern, 'provider-specific': providerSpecific };
}

/**
 * The property table. Anything absent is treated as `native` in every profile —
 * the compiler only ever produces a small, curated set of declarations, so an
 * unknown property here means a custom-CSS declaration that the CSS sanitiser
 * has already vetted.
 */
export const EMAIL_CSS_RULES: readonly EmailCssRule[] = [
  {
    property: 'border-radius',
    support: support('fallback', 'native'),
    fallback: () => ({}),
    severity: 'info',
    note: 'Outlook 2007–2019 square off rounded corners; the fill still renders.',
  },
  {
    property: 'box-shadow',
    support: support('unsupported', 'fallback'),
    fallback: () => ({}),
    severity: 'warning',
    note: 'No mainstream desktop client renders box-shadow reliably.',
  },
  {
    property: 'text-shadow',
    support: support('unsupported', 'fallback'),
    fallback: () => ({}),
    severity: 'warning',
    note: 'text-shadow is dropped by Outlook and most webmail clients.',
  },
  {
    property: 'opacity',
    support: support('fallback', 'fallback'),
    fallback: () => ({}),
    severity: 'warning',
    note: 'Partial opacity is ignored by Outlook; composite the colour instead.',
  },
  {
    property: 'display',
    support: support('fallback', 'native'),
    fallback: (value): Record<string, string> =>
      value === 'flex' || value === 'grid' ? {} : { display: value },
    severity: 'warning',
    note: 'Flex and grid do not exist in Outlook; the compiler emits tables instead.',
  },
  {
    property: 'flex-direction',
    support: support('unsupported', 'fallback'),
    fallback: () => ({}),
    severity: 'warning',
  },
  {
    property: 'gap',
    support: support('unsupported', 'fallback'),
    fallback: () => ({}),
    severity: 'warning',
    note: 'Gap is emitted as cell padding by the layout compiler.',
  },
  {
    property: 'align-items',
    support: support('unsupported', 'fallback'),
    fallback: () => ({}),
  },
  {
    property: 'justify-content',
    support: support('unsupported', 'fallback'),
    fallback: () => ({}),
  },
  {
    property: 'transform',
    support: support('unsupported', 'unsupported'),
    severity: 'warning',
    note: 'Transforms require a raster fallback.',
  },
  {
    property: 'filter',
    support: support('unsupported', 'unsupported'),
    severity: 'warning',
    note: 'Filters require a raster fallback.',
  },
  {
    property: 'mix-blend-mode',
    support: support('unsupported', 'unsupported'),
    severity: 'warning',
    note: 'Blend modes require a raster fallback.',
  },
  {
    property: 'background-image',
    support: support('fallback', 'fallback'),
    fallback: () => ({}),
    severity: 'warning',
    note: 'Outlook needs a VML fallback; a solid background-color is used instead.',
  },
  {
    property: 'max-width',
    support: support('fallback', 'native'),
    fallback: () => ({}),
    severity: 'info',
    note: 'Outlook ignores max-width; the compiler pairs it with a width attribute.',
  },
  {
    property: 'position',
    support: support('unsupported', 'unsupported'),
    severity: 'warning',
    note: 'Absolute positioning has no reliable email equivalent.',
  },
  { property: 'color', support: ALL_NATIVE },
  { property: 'background-color', support: ALL_NATIVE },
  { property: 'font-family', support: ALL_NATIVE },
  { property: 'font-size', support: ALL_NATIVE },
  { property: 'font-weight', support: ALL_NATIVE },
  { property: 'font-style', support: ALL_NATIVE },
  { property: 'line-height', support: ALL_NATIVE },
  { property: 'letter-spacing', support: support('fallback', 'native') },
  { property: 'text-align', support: ALL_NATIVE },
  { property: 'text-decoration', support: ALL_NATIVE },
  { property: 'text-transform', support: ALL_NATIVE },
  { property: 'padding', support: ALL_NATIVE },
  { property: 'margin', support: ALL_NATIVE },
  { property: 'border', support: ALL_NATIVE },
  { property: 'border-collapse', support: ALL_NATIVE },
  { property: 'width', support: ALL_NATIVE },
  { property: 'height', support: ALL_NATIVE },
  { property: 'vertical-align', support: ALL_NATIVE },
  { property: 'direction', support: ALL_NATIVE },
];

const RULE_INDEX: ReadonlyMap<string, EmailCssRule> = new Map(
  EMAIL_CSS_RULES.map((rule) => [rule.property, rule]),
);

export function lookupEmailCssRule(property: string): EmailCssRule | undefined {
  return RULE_INDEX.get(property.toLowerCase());
}

export interface CssTransformOutcome {
  /** Declarations that survive, after fallbacks. */
  styles: Record<string, string>;
  /** Declarations that were degraded, for preflight reporting. */
  degraded: Array<{ property: string; value: string; support: EmailFeatureSupport; note?: string }>;
}

/**
 * Apply the compatibility table to a declaration block.
 *
 * `native` declarations pass through. `fallback` declarations are replaced by
 * the rule's fallback output. `unsupported` declarations are dropped. Both of
 * the latter are reported so preflight can explain what happened and why.
 */
export function applyCssCompatibility(
  styles: Record<string, string>,
  profile: EmailCompatibilityProfile,
): CssTransformOutcome {
  const out: Record<string, string> = {};
  const degraded: CssTransformOutcome['degraded'] = [];

  for (const [property, value] of Object.entries(styles)) {
    if (value === undefined || value === '') continue;
    const rule = lookupEmailCssRule(property);
    if (!rule) {
      out[property] = value;
      continue;
    }
    const level = rule.support[profile];
    if (level === 'native') {
      out[property] = value;
      continue;
    }
    degraded.push({ property, value, support: level, note: rule.note });
    if (level === 'fallback' && rule.fallback) {
      Object.assign(out, rule.fallback(value));
    }
  }

  return { styles: out, degraded };
}

// ── Font stacks ───────────────────────────────────────────────────────────────

/**
 * Web-safe stacks keyed by the generic family a design font belongs to.
 * Every stack ends in a generic family so a client that has none of the named
 * faces still picks a sane default.
 */
export const EMAIL_FONT_STACKS = {
  sans: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, Times New Roman, Times, serif',
  mono: 'Consolas, Monaco, "Courier New", monospace',
} as const;

const KNOWN_SERIF = new Set([
  'playfair',
  'playfair display',
  'merriweather',
  'lora',
  'pt serif',
  'source serif pro',
  'crimson text',
  'libre baskerville',
  'eb garamond',
  'georgia',
  'times',
  'times new roman',
  'garamond',
  'baskerville',
  'didot',
  'bodoni',
]);

const KNOWN_MONO = new Set([
  'fira code',
  'jetbrains mono',
  'source code pro',
  'ibm plex mono',
  'roboto mono',
  'space mono',
  'courier',
  'courier new',
  'consolas',
  'monaco',
  'menlo',
]);

/** Which generic family a design font should fall back through. */
export function emailGenericFamily(fontFamily: string): keyof typeof EMAIL_FONT_STACKS {
  const key = fontFamily.trim().toLowerCase().replace(/["']/g, '');
  if (KNOWN_SERIF.has(key)) return 'serif';
  if (KNOWN_MONO.has(key)) return 'mono';
  if (/\bserif\b/.test(key) && !/sans/.test(key)) return 'serif';
  if (/\bmono(space)?\b/.test(key)) return 'mono';
  return 'sans';
}

/**
 * Build the font stack an email should declare.
 *
 * The conservative profile drops the design face entirely — no recipient is
 * guaranteed to have it and the metric shift on fallback is usually worse than
 * simply designing for the web-safe face. Other profiles lead with the design
 * face and fall through the matching web-safe stack.
 */
export function resolveEmailFontStack(
  fontFamily: string,
  profile: EmailCompatibilityProfile,
): string {
  const generic = EMAIL_FONT_STACKS[emailGenericFamily(fontFamily)];
  const name = fontFamily.trim();
  if (!name) return generic;
  if (profile === 'conservative') return generic;
  const isWebSafe = generic.toLowerCase().includes(name.toLowerCase());
  if (isWebSafe) return generic;
  return `${/\s/.test(name) ? `"${name}"` : name}, ${generic}`;
}
