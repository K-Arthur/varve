/**
 * DTCG (Design Tokens Community Group) format export bridge.
 *
 * Converts Strata's internal design token system (SemanticToken map)
 * to the W3C DTCG-compliant JSON format for interoperability with
 * Figma Tokens, Token Studio, Style Dictionary, and Supernova.
 *
 * Output: a DTCG JSON object with `$type`, structured `$value`, and
 * `$description` fields organized in a CTI (Category/Type/Item) hierarchy.
 *
 * Research basis:
 *   - DTCG 2025.10 Design Tokens Format and Color module
 *   - Style Dictionary 4.x format
 *   - Figma Tokens Studio v2 format
 *
 * Usage:
 *   import { dtcgExport } from '@strata/ui/tokens/dtcg';
 *   const json = JSON.stringify(dtcgExport(), null, 2);
 *
 * The export preserves all 52 semantic tokens × 3 themes with OKLCH values.
 */
import { SEMANTIC, type SemanticToken, type Theme } from './color';
import type { Oklch } from './contrast';

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
  $version: string;
  $description: string;
  [key: string]: unknown;
}

/**
 * Convert an Oklch color to OKLCH CSS string.
 */
function oklchToString(c: Oklch): string {
  return `oklch(${c.L.toFixed(4)} ${c.C.toFixed(4)} ${c.H.toFixed(2)})`;
}

function oklchToDtcg(c: Oklch): DTCGColorValue {
  return {
    colorSpace: 'oklch',
    components: [Number(c.L.toFixed(4)), Number(c.C.toFixed(4)), Number(c.H.toFixed(2))],
    alpha: 1,
  };
}

/**
 * CTI hierarchy mapping: maps Strata SemanticToken names to
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
 * Build a nested DTCG JSON object from Strata's semantic tokens.
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
          'strata-token': tokenName,
          'strata-theme': theme,
          'strata-css-color': oklchToString(oklchVal as Oklch),
        },
      } satisfies DTCGToken;
    }

    root[`theme-${theme}`] = themeRoot;
  }

  return root;
}

/**
 * Full DTCG document including versioning and metadata.
 */
export function dtcgExport(): DTCGDocument {
  const colors = buildDTCGExport();

  return {
    $version: '1.0',
    $description: 'Strata Design Tokens — DTCG-compliant format',
    $extensions: {
      generated: new Date().toISOString(),
      source: 'packages/ui/src/tokens/color.ts',
      generator: '@strata/ui/tokens/dtcg.ts',
    },
    color: colors,
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
