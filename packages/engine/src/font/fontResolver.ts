/**
 * Font resolver — missing-font detection and progressive resolution.
 *
 * Scans documents for text nodes referencing fonts not present in the catalog,
 * then proposes ranked substitutes via a multi-tier resolution strategy:
 *   1. Exact PostScript name match
 *   2. Family + style match
 *   3. Compatible family mapping (e.g. "Arial" → "Helvetica")
 *   4. Script-aware fallback
 *
 * Research basis: CSS Fonts Level 4 font-family resolution, fontconfig
 * match patterns, Figma/ Sketch font substitution heuristics.
 */

import type { FontCatalog } from './fontCatalog';
import type { FontSourceKind } from './fontIdentity';

// ---------------------------------------------------------------------------
// Minimal document types (avoids dependency on @varve/scene)
// ---------------------------------------------------------------------------

/** Minimal text node shape used by the resolver. */
export interface ResolverTextNode {
  id: string;
  kind: 'text';
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: string;
  text?: string;
  richText?: {
    paragraphs: Array<{
      runs: Array<{
        text: string;
        format?: { fontFamily?: string; fontWeight?: number; fontStyle?: string };
      }>;
    }>;
  };
}

/** Minimal style shape used by the resolver. */
export interface ResolverTextStyle {
  type: 'text';
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: string;
}

/** Minimal document shape used by the resolver. */
export interface ResolverDocument {
  nodes: Record<string, ResolverTextNode | { id: string; kind: string }>;
  styles?: Record<string, ResolverTextStyle | { type: string; [key: string]: unknown }>;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MissingFontStatus =
  | 'missing'
  | 'corrupt'
  | 'unsupported'
  | 'conflicting'
  | 'version-mismatch';

export type MatchQuality =
  | 'exact'
  | 'postscript'
  | 'family-style'
  | 'compatible'
  | 'user-approved'
  | 'script-fallback';

export interface FontSubstitute {
  familyName: string;
  matchQuality: MatchQuality;
  confidence: number;
  source: FontSourceKind;
  availableVariants: Array<{ weight: number; style: string }>;
}

export interface MissingFontInfo {
  familyName: string;
  requestedWeight?: number;
  requestedStyle?: string;
  nodeIds: string[];
  status: MissingFontStatus;
  substitutes: FontSubstitute[];
  originalReference: string;
}

export interface FontReplacement {
  original: string;
  replacement: string;
  applyToAll: boolean;
  preserveOriginalReference: boolean;
}

// ---------------------------------------------------------------------------
// Cross-platform font compatibility map
// ---------------------------------------------------------------------------

export const FONT_COMPAT_MAP: Record<string, string[]> = {
  Arial: ['Helvetica', 'Liberation Sans', 'DejaVu Sans', 'Noto Sans'],
  Helvetica: ['Arial', 'Liberation Sans', 'DejaVu Sans', 'Noto Sans'],
  'Times New Roman': ['Times', 'Liberation Serif', 'DejaVu Serif', 'Noto Serif'],
  Times: ['Times New Roman', 'Liberation Serif', 'DejaVu Serif'],
  'Courier New': ['Courier', 'Liberation Mono', 'DejaVu Sans Mono', 'Noto Sans Mono'],
  Courier: ['Courier New', 'Liberation Mono', 'DejaVu Sans Mono'],
  Georgia: ['Cambria', 'Liberation Serif', 'Noto Serif'],
  Cambria: ['Georgia', 'Liberation Serif'],
  'Trebuchet MS': ['Lucida Grande', 'DejaVu Sans', 'Noto Sans'],
  'Lucida Grande': ['Trebuchet MS', 'DejaVu Sans'],
  'Palatino Linotype': ['Palatino', 'Book Antiqua', 'Liberation Serif'],
  Palatino: ['Palatino Linotype', 'Book Antiqua', 'Liberation Serif'],
  Garamond: ['EB Garamond', 'Liberation Serif', 'Noto Serif'],
  'Book Antiqua': ['Palatino Linotype', 'Palatino', 'Liberation Serif'],
  Consolas: ['Fira Code', 'JetBrains Mono', 'Liberation Mono', 'DejaVu Sans Mono'],
  'Fira Code': ['Consolas', 'JetBrains Mono', 'Liberation Mono'],
  'JetBrains Mono': ['Fira Code', 'Consolas', 'Liberation Mono'],
  'Liberation Sans': ['Arial', 'Helvetica', 'DejaVu Sans', 'Noto Sans'],
  'Liberation Serif': ['Times New Roman', 'Times', 'DejaVu Serif', 'Noto Serif'],
  'Liberation Mono': ['Courier New', 'Courier', 'DejaVu Sans Mono'],
  'DejaVu Sans': ['Arial', 'Liberation Sans', 'Noto Sans'],
  'DejaVu Serif': ['Times New Roman', 'Liberation Serif', 'Noto Serif'],
  'DejaVu Sans Mono': ['Courier New', 'Liberation Mono', 'Noto Sans Mono'],
  'Noto Sans': ['Arial', 'Liberation Sans', 'DejaVu Sans'],
  'Noto Serif': ['Times New Roman', 'Liberation Serif', 'DejaVu Serif'],
  'Noto Sans Mono': ['Courier New', 'Liberation Mono', 'DejaVu Sans Mono'],
  'Open Sans': ['Noto Sans', 'Liberation Sans', 'Arial'],
  Roboto: ['Noto Sans', 'Open Sans', 'Helvetica', 'Arial'],
  'Source Sans Pro': ['Noto Sans', 'Open Sans', 'Arial'],
  'Source Serif Pro': ['Noto Serif', 'Times New Roman', 'Georgia'],
  'Source Code Pro': ['Consolas', 'Fira Code', 'Liberation Mono'],
  Inter: ['Noto Sans', 'Helvetica Neue', 'Helvetica', 'Arial'],
  'Helvetica Neue': ['Helvetica', 'Arial', 'Noto Sans'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasTextStyleFont(
  node: ResolverTextNode | { id: string; kind: string },
): node is ResolverTextNode {
  if (node.kind !== 'text') return false;
  const textNode = node as ResolverTextNode;
  return (
    Boolean(textNode.fontFamily) ||
    Boolean(
      textNode.richText?.paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => Boolean(run.format?.fontFamily)),
      ),
    )
  );
}

function getFontFamiliesFromStyles(doc: ResolverDocument): Array<{
  family: string;
  weight?: number;
  style?: string;
  styleId: string;
}> {
  const results: Array<{
    family: string;
    weight?: number;
    style?: string;
    styleId: string;
  }> = [];
  if (!doc.styles) return results;

  for (const [id, style] of Object.entries(doc.styles)) {
    if (style.type === 'text') {
      const ts = style as ResolverTextStyle;
      if (ts.fontFamily) {
        results.push({
          family: ts.fontFamily,
          weight: ts.fontWeight,
          style: ts.fontStyle,
          styleId: id,
        });
      }
    }
  }
  return results;
}

function getFontFamiliesFromNode(node: ResolverTextNode): Array<{
  family: string;
  weight?: number;
  style?: string;
}> {
  const results: Array<{
    family: string;
    weight?: number;
    style?: string;
  }> = [];

  if (node.fontFamily) {
    results.push({
      family: node.fontFamily,
      weight: node.fontWeight,
      style: node.fontStyle,
    });
  }

  for (const paragraph of node.richText?.paragraphs ?? []) {
    for (const run of paragraph.runs) {
      const family = run.format?.fontFamily;
      if (!family) continue;
      results.push({
        family,
        weight: run.format?.fontWeight,
        style: run.format?.fontStyle,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// FontResolver
// ---------------------------------------------------------------------------

export class FontResolver {
  /**
   * Scan all text nodes for fonts not present in the catalog.
   * Returns one MissingFontInfo per unique missing family, with all affected
   * node IDs collected.
   */
  detectMissing(doc: ResolverDocument, catalog: FontCatalog): MissingFontInfo[] {
    const familyNodes = new Map<
      string,
      {
        family: string;
        nodeIds: string[];
        weight?: number;
        style?: string;
      }
    >();

    // Scan text nodes
    for (const node of Object.values(doc.nodes)) {
      if (node.kind !== 'text') continue;

      for (const reference of getFontFamiliesFromNode(node as ResolverTextNode)) {
        const family = reference.family;
        const key = family.toLowerCase();
        const entry = catalog
          .getEntriesForFamily(family)
          .find((e) => e.identity.familyName.toLowerCase() === key);

        if (entry) continue;

        const existing = familyNodes.get(key);
        if (existing) {
          if (!existing.nodeIds.includes(node.id)) existing.nodeIds.push(node.id);
          if (existing.weight === undefined) existing.weight = reference.weight;
          if (existing.style === undefined) existing.style = reference.style;
        } else {
          familyNodes.set(key, {
            family,
            nodeIds: [node.id],
            weight: reference.weight,
            style: reference.style,
          });
        }
      }
    }

    // Scan text/paragraph style references
    const styleRefs = getFontFamiliesFromStyles(doc);
    for (const ref of styleRefs) {
      const key = ref.family.toLowerCase();
      const entry = catalog
        .getEntriesForFamily(ref.family)
        .find((e) => e.identity.familyName.toLowerCase() === key);
      if (!entry) {
        const existing = familyNodes.get(key);
        if (!existing) {
          familyNodes.set(key, {
            family: ref.family,
            nodeIds: [],
            weight: ref.weight,
            style: ref.style,
          });
        }
      }
    }

    const results: MissingFontInfo[] = [];
    for (const info of familyNodes.values()) {
      const family = info.family;
      const substitutes = this.findSubstitutes(
        {
          familyName: family,
          requestedWeight: info.weight,
          requestedStyle: info.style,
          nodeIds: info.nodeIds,
          status: 'missing',
          substitutes: [],
          originalReference: family,
        },
        catalog,
      );

      results.push({
        familyName: family,
        requestedWeight: info.weight,
        requestedStyle: info.style,
        nodeIds: info.nodeIds,
        status: 'missing',
        substitutes,
        originalReference: family,
      });
    }

    return results;
  }

  /**
   * Find progressive substitutes for a missing font from the catalog.
   *
   * Resolution tiers (highest confidence first):
   * 1. Exact PostScript name match
   * 2. Family + style match
   * 3. Compatible family mapping (FONT_COMPAT_MAP)
   * 4. Script-aware fallback (same category, any family)
   */
  findSubstitutes(missing: MissingFontInfo, catalog: FontCatalog): FontSubstitute[] {
    const allSubstitutes: FontSubstitute[] = [];
    const seen = new Set<string>();

    // Tier 1: Exact PostScript name match
    for (const entry of catalog.all()) {
      const postScriptLower = entry.identity.postScriptName.toLowerCase();
      const target = missing.familyName.toLowerCase().replace(/\s+/g, '');
      if (postScriptLower === target && !seen.has(entry.identity.familyName)) {
        seen.add(entry.identity.familyName);
        allSubstitutes.push({
          familyName: entry.identity.familyName,
          matchQuality: 'postscript',
          confidence: 0.95,
          source: entry.source,
          availableVariants: collectVariants(catalog, entry.identity.familyName),
        });
      }
    }

    // Tier 2: Family + style match
    for (const entry of catalog.all()) {
      const family = entry.identity.familyName;
      if (seen.has(family)) continue;
      if (family.toLowerCase() !== missing.familyName.toLowerCase()) continue;

      const weightMatch = missing.requestedWeight
        ? entry.identity.subfamilyName
            .toLowerCase()
            .includes(weightToName(missing.requestedWeight).toLowerCase())
        : true;
      const styleMatch = missing.requestedStyle
        ? missing.requestedStyle === 'italic'
          ? entry.identity.subfamilyName.toLowerCase().includes('italic')
          : !entry.identity.subfamilyName.toLowerCase().includes('italic')
        : true;

      if (weightMatch && styleMatch) {
        seen.add(family);
        allSubstitutes.push({
          familyName: family,
          matchQuality: 'family-style',
          confidence: 0.85,
          source: entry.source,
          availableVariants: collectVariants(catalog, family),
        });
      }
    }

    // Tier 3: Compatible family mapping
    const compatFamilies = FONT_COMPAT_MAP[missing.familyName] ?? [];
    for (const compat of compatFamilies) {
      if (seen.has(compat)) continue;
      const entries = catalog.getEntriesForFamily(compat);
      const firstEntry = entries[0];
      if (firstEntry) {
        seen.add(compat);
        allSubstitutes.push({
          familyName: compat,
          matchQuality: 'compatible',
          confidence: 0.7,
          source: firstEntry.source,
          availableVariants: collectVariants(catalog, compat),
        });
      }
    }

    // Tier 4: Script-aware fallback (same category, any family)
    const missingCategory = guessCategory(missing.familyName);
    for (const entry of catalog.all()) {
      const family = entry.identity.familyName;
      if (seen.has(family)) continue;
      if (entry.category === missingCategory) {
        seen.add(family);
        allSubstitutes.push({
          familyName: family,
          matchQuality: 'script-fallback',
          confidence: 0.4,
          source: entry.source,
          availableVariants: collectVariants(catalog, family),
        });
      }
    }

    return allSubstitutes.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Apply a font replacement to all affected text nodes in the document.
   * Optionally preserves the original font reference for metadata/debugging.
   */
  applyReplacement(doc: ResolverDocument, replacement: FontReplacement): ResolverDocument {
    const updatedNodes = { ...doc.nodes } as Record<
      string,
      ResolverTextNode | { id: string; kind: string }
    >;
    const lowerOriginal = replacement.original.toLowerCase();

    for (const [id, node] of Object.entries(updatedNodes)) {
      if (!hasTextStyleFont(node)) continue;
      let updatedNode: ResolverTextNode = node;
      let nodeChanged = false;

      if (node.fontFamily?.toLowerCase() === lowerOriginal) {
        updatedNode = { ...updatedNode, fontFamily: replacement.replacement };
        nodeChanged = true;
      }

      if (node.richText) {
        let richTextChanged = false;
        const paragraphs = node.richText.paragraphs.map((paragraph) => {
          let paragraphChanged = false;
          const runs = paragraph.runs.map((run) => {
            if (run.format?.fontFamily?.toLowerCase() !== lowerOriginal) return run;
            paragraphChanged = true;
            return {
              ...run,
              format: { ...run.format, fontFamily: replacement.replacement },
            };
          });
          if (!paragraphChanged) return paragraph;
          richTextChanged = true;
          return { ...paragraph, runs };
        });

        if (richTextChanged) {
          updatedNode = { ...updatedNode, richText: { ...node.richText, paragraphs } };
          nodeChanged = true;
        }
      }

      if (nodeChanged) updatedNodes[id] = updatedNode;
    }

    // Also update text/paragraph styles
    let updatedStyles = doc.styles ? { ...doc.styles } : undefined;
    if (updatedStyles) {
      let stylesChanged = false;
      for (const [id, style] of Object.entries(updatedStyles)) {
        if (style.type === 'text') {
          const ts = style as ResolverTextStyle;
          if (ts.fontFamily?.toLowerCase() === lowerOriginal) {
            if (!stylesChanged) {
              updatedStyles = { ...updatedStyles };
              stylesChanged = true;
            }
            updatedStyles[id] = { ...ts, fontFamily: replacement.replacement };
          }
        }
      }
    }

    return {
      ...doc,
      nodes: updatedNodes,
      styles: updatedStyles,
    } as ResolverDocument;
  }

  /**
   * Auto-generate a replacement map for all missing fonts, picking the
   * highest-confidence substitute from the catalog.
   */
  buildReplacementMap(doc: ResolverDocument, catalog: FontCatalog): Map<string, FontSubstitute> {
    const missing = this.detectMissing(doc, catalog);
    const map = new Map<string, FontSubstitute>();

    for (const info of missing) {
      if (info.substitutes.length > 0) {
        map.set(info.familyName, info.substitutes[0]!);
      }
    }

    return map;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function collectVariants(
  catalog: FontCatalog,
  familyName: string,
): Array<{ weight: number; style: string }> {
  const entries = catalog.getEntriesForFamily(familyName);
  const variants: Array<{ weight: number; style: string }> = [];

  for (const entry of entries) {
    variants.push({
      weight: parseWeightFromSubfamily(entry.identity.subfamilyName),
      style: entry.identity.subfamilyName.toLowerCase().includes('italic') ? 'italic' : 'normal',
    });
  }

  return variants;
}

function parseWeightFromSubfamily(subfamily: string): number {
  const lower = subfamily.toLowerCase();
  if (lower.includes('thin')) return 100;
  if (lower.includes('extralight') || lower.includes('extra light')) return 200;
  if (lower.includes('light')) return 300;
  if (lower.includes('regular') || lower === 'normal') return 400;
  if (lower.includes('medium')) return 500;
  if (lower.includes('semibold') || lower.includes('semi bold')) return 600;
  if (lower.includes('bold')) return 700;
  if (lower.includes('extrabold') || lower.includes('extra bold')) return 800;
  if (lower.includes('black') || lower.includes('heavy')) return 900;
  return 400;
}

function weightToName(weight: number): string {
  if (weight <= 100) return 'Thin';
  if (weight <= 200) return 'ExtraLight';
  if (weight <= 300) return 'Light';
  if (weight <= 400) return 'Regular';
  if (weight <= 500) return 'Medium';
  if (weight <= 600) return 'SemiBold';
  if (weight <= 700) return 'Bold';
  if (weight <= 800) return 'ExtraBold';
  return 'Black';
}

function guessCategory(familyName: string): string {
  const lower = familyName.toLowerCase();
  if (/\b(courier|consolas|fira\s*code|jetbrains|mono|code|terminal)\b/i.test(lower))
    return 'monospace';
  if (/\b(georgia|times|garamond|palatino|baskerville|serif|bodoni|didot)\b/i.test(lower))
    return 'serif';
  return 'sans-serif';
}
