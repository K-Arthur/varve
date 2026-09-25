/**
 * DTCG (Design Tokens Community Group) format export bridge.
 *
 * Converts Varve's internal design token system (SemanticToken map)
 * to Design Tokens Format Module 2025.10 JSON for interchange with
 * Style Dictionary, Tokens Studio, Figma, Penpot, Terrazzo, and similar.
 *
 * Standards status: the 2025.10 Format/Color/Resolver modules are Final
 * Community Group Reports (published 2025-10-28, "considered stable").
 * They are NOT W3C Standards and are not on the W3C Standards Track —
 * neither this export nor its documentation may claim otherwise.
 *
 * Output: a DTCG JSON object with `$type`, structured `$value`,
 * `$description`, and vendor-namespaced `$extensions`, organized in a
 * theme → CTI (Category/Type/Item) hierarchy.
 *
 * Export profile guarantees:
 * - deterministic: two calls produce byte-identical JSON (no timestamps,
 *   random ids, or precision-losing rounding of authored values)
 * - no `$version`: that key never existed in DTCG and the published 2025.10
 *   JSON Schema rejects it at the document level
 * - every extension lives under the reverse-domain key `org.varve`, as
 *   DTCG 2025.10 §5.2.3 requires of tool-authored extension data
 *
 * Research basis:
 *   - DTCG 2025.10 Design Tokens Format and Color modules (Final CG Reports)
 *   - Style Dictionary 4.x/5.x DTCG format
 *   - Figma Tokens Studio v2 format (legacy adapter only)
 *
 * Usage:
 *   import { dtcgExport } from '@varve/ui/tokens';
 *   const json = JSON.stringify(dtcgExport(), null, 2);
 *
 * The export preserves all 52 semantic tokens × 3 themes with OKLCH values.
 */
import { SEMANTIC, type SemanticToken, type Theme } from './color';
import type { Oklch } from './contrast';

/** Reverse-domain extension key; every tool-specific key lives under it. */
export const VARVE_EXTENSION_KEY = 'org.varve';

export interface DTCGToken {
  $type: 'color';
  $value: DTCGColorValue;
  $description?: string;
  $extensions?: Record<string, unknown>;
}

export interface DTCGColorValue {
  colorSpace: 'oklch';
  components: [number, number, number];
  alpha?: number;
}

export interface DTCGGroup {
  [key: string]: DTCGGroup | DTCGToken;
}

export interface DTCGDocument {
  $description: string;
  $extensions: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Convert an Oklch color to OKLCH CSS string (display convenience copy —
 * the structured `components` remain the authoritative value).
 */
function oklchToString(c: Oklch): string {
  return `oklch(${c.L.toFixed(4)} ${c.C.toFixed(4)} ${c.H.toFixed(2)})`;
}

function oklchToDtcg(c: Oklch): DTCGColorValue {
  return {
    colorSpace: 'oklch',
    components: [c.L, c.C, c.H],
    alpha: 1,
  };
}

/**
 * CTI hierarchy mapping: maps Varve SemanticToken names to
 * DTCG Category/Type/Item paths.
 *
 * Pattern:
 *   surface-app       → color/surface/app
 *   text-primary      → color/text/primary
 *   border-subtle     → color/border/subtle
 *   interactive-hover → color/interactive/hover
 *   accent-primary    → color/accent/primary
 *   tree-row          → color/tree/row
 *   layer-accent-frame → color/layer/accent/frame
 *   hero-glow         → color/brand/hero-glow
 */
function tokenToPath(token: SemanticToken): string[] {
  // Group tokens by known prefixes
  if (token.startsWith('surface-')) return ['color', 'surface', token.slice(8)];
  if (token.startsWith('text-')) return ['color', 'text', token.slice(5)];
  if (token.startsWith('border-')) return ['color', 'border', token.slice(7)];
  if (token.startsWith('interactive-')) return ['color', 'interactive', token.slice(12)];
  if (token.startsWith('feedback-')) return ['color', 'feedback', token.slice(9)];
  if (token.startsWith('accent-')) return ['color', 'accent', token.slice(7)];
  if (token.startsWith('tree-')) return ['color', 'tree', token.slice(5)];
  if (token.startsWith('layer-')) {
    const rest = token.slice(6); // layer-accent-frame → accent/frame
    return ['color', 'layer', ...rest.split('-')];
  }
  if (token.startsWith('hero-') || token.startsWith('brand-')) {
    return ['color', 'brand', token];
  }
  // Fallback
  return ['color', 'other', token];
}

/**
 * Build a nested DTCG JSON object from Varve's semantic tokens.
 * Returns a DTCGGroup representing the `color` namespace with
 * CTI hierarchy.
 */
export function buildDTCGExport(themes?: Theme[]): Record<string, DTCGGroup> {
  const themeList = themes ?? ['light', 'dark', 'high-contrast'];

  // The outermost wrapper with version info
  const root: Record<string, DTCGGroup> = {};

  for (const theme of themeList) {
    const themeRoot: DTCGGroup = {};

    for (const [tokenName, oklchVal] of Object.entries(SEMANTIC[theme] ?? {})) {
      const path = tokenToPath(tokenName as SemanticToken);

      // Navigate/create nested structure
      let current = themeRoot;
      for (let i = 0; i < path.length - 1; i++) {
        const segment = path[i]!;
        if (!current[segment] || typeof current[segment] !== 'object') {
          current[segment] = {};
        }
        current = current[segment] as DTCGGroup;
      }

      const leafName = path[path.length - 1]!;
      current[leafName] = {
        $type: 'color',
        $value: oklchToDtcg(oklchVal as Oklch),
        $extensions: {
          [VARVE_EXTENSION_KEY]: {
            token: tokenName,
            theme,
            cssColor: oklchToString(oklchVal as Oklch),
          },
        },
      } satisfies DTCGToken;
    }

    root[`theme-${theme}`] = themeRoot;
  }

  return root;
}

/**
 * Full DTCG document including description and tool metadata.
 *
 * Deterministic: identical input always produces identical output, so an
 * unchanged export can be diffed against the previous one. Tool metadata
 * (specification version, generator, source file) lives under the
 * `org.varve` extension key rather than in a `$version` property — `$version`
 * is not part of DTCG 2025.10.
 */
export function dtcgExport(): DTCGDocument {
  const themes = buildDTCGExport();

  return {
    $description: 'Varve application design tokens — DTCG 2025.10 format',
    $extensions: {
      [VARVE_EXTENSION_KEY]: {
        specification: 'dtcg-2025.10',
        generator: '@varve/ui/tokens/dtcg.ts',
        source: 'packages/ui/src/tokens/color.ts',
        scope: 'application-ui-tokens (not document tokens)',
      },
    },
    ...themes,
  };
}

/**
 * Export as a flat list of token entries (alternative to nested format).
 * Useful for consumption by Style Dictionary or simple iteration.
 */
export function dtcgFlatExport(): DTCGTokenEntry[] {
  const entries: DTCGTokenEntry[] = [];
  const themes: Theme[] = ['light', 'dark', 'high-contrast'];

  for (const theme of themes) {
    for (const [tokenName, oklchVal] of Object.entries(SEMANTIC[theme] ?? {})) {
      entries.push({
        name: tokenName as SemanticToken,
        theme,
        path: tokenToPath(tokenName as SemanticToken),
        $type: 'color',
        $value: oklchToDtcg(oklchVal as Oklch),
      });
    }
  }

  return entries;
}

export interface DTCGTokenEntry {
  name: SemanticToken;
  theme: Theme;
  path: string[];
  $type: 'color';
  $value: DTCGColorValue;
}

// ── Tokens Studio v2 format export ──────────────────────────────────────

/**
 * Export tokens in Tokens Studio v2 format.
 * This format is compatible with the "Tokens Studio" plugin ecosystem.
 */
export function tokensStudioExport(): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [themeName, tokens] of Object.entries(SEMANTIC)) {
    const themeGroup: Record<string, unknown> = {};

    for (const [tokenName, oklchVal] of Object.entries(tokens)) {
      const path = tokenToPath(tokenName as SemanticToken);
      let current = themeGroup;

      for (let i = 0; i < path.length - 1; i++) {
        const segment = path[i]!;
        if (!current[segment] || typeof current[segment] !== 'object') {
          current[segment] = {};
        }
        current = current[segment] as Record<string, unknown>;
      }

      const leafName = path[path.length - 1]!;
      current[leafName] = {
        value: oklchToString(oklchVal as Oklch),
        type: 'color',
      };
    }

    result[themeName === 'light' ? 'global' : themeName] = themeGroup;
  }

  return result;
}
