/**
 * Font usage index — document-level font usage tracking.
 *
 * Scans all text nodes, rich text runs, and text/paragraph styles to build a
 * per-font-family usage map. Used for:
 *   - Subsetting: only embed glyphs that are actually used
 *   - Font warnings: alert when a font is missing
 *   - Cleanup: identify unused fonts for removal
 *   - Migration: upgrade legacy documents that store fonts as bare strings
 *
 * Research basis: CSS font-loading spec, OpenType subset theory,
 * Figma/ Sketch font usage tracking.
 */

// ---------------------------------------------------------------------------
// Minimal document types (avoids dependency on @varve/scene)
// ---------------------------------------------------------------------------

/** Minimal text node shape for usage scanning. */
export interface UsageTextNode {
  id: string;
  kind: 'text';
  text?: string;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: string;
  /** Legacy font field (pre-v1.6 documents). */
  font?: string | number;
  richText?: {
    paragraphs: Array<{
      runs: Array<{
        text: string;
        format?: { fontFamily?: string; fontWeight?: number; fontStyle?: string };
      }>;
    }>;
  };
}

/** Minimal text style shape for usage scanning. */
export interface UsageTextStyle {
  type: 'text';
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: string;
  /** Legacy font field (pre-v1.6 documents). */
  font?: string | number;
}

/** Minimal document shape for usage scanning. */
export interface UsageDocument {
  nodes: Record<string, UsageTextNode | { id: string; kind: string }>;
  styles?: Record<string, UsageTextStyle | { type: string; [key: string]: unknown }>;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FontUsage {
  familyName: string;
  weight?: number;
  style?: string;
  nodeIds: string[];
  styleIds: string[];
  totalCharacters: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTextNode(n: { id: string; kind: string }): n is UsageTextNode {
  return n.kind === 'text';
}

function countChars(text: string): number {
  // Count visible characters (excluding zero-width joiners and format chars)
  return text.replace(/[\u200B-\u200D\uFEFF]/g, '').length;
}

// ---------------------------------------------------------------------------
// FontUsageIndex
// ---------------------------------------------------------------------------

export class FontUsageIndex {
  /**
   * Build a complete font usage map by scanning:
   * - All text nodes (fontFamily on the node + richText runs)
   * - All text/paragraph styles
   *
   * Keys are lowercased family names for case-insensitive matching.
   */
  build(doc: UsageDocument): Map<string, FontUsage> {
    const index = new Map<string, FontUsage>();

    const ensure = (family: string): FontUsage => {
      const key = family.toLowerCase();
      let usage = index.get(key);
      if (!usage) {
        usage = {
          familyName: family,
          nodeIds: [],
          styleIds: [],
          totalCharacters: 0,
        };
        index.set(key, usage);
      }
      return usage;
    };

    // 1. Scan text nodes
    for (const node of Object.values(doc.nodes)) {
      if (!isTextNode(node)) continue;

      // Node-level fontFamily
      if (node.fontFamily) {
        const usage = ensure(node.fontFamily);
        usage.nodeIds.push(node.id);
        usage.totalCharacters += countChars(node.text ?? '');

        if (node.fontWeight !== undefined) usage.weight = node.fontWeight;
        if (node.fontStyle !== undefined) usage.style = node.fontStyle;
      }

      // Rich text runs
      if (node.richText) {
        for (const paragraph of node.richText.paragraphs) {
          for (const run of paragraph.runs) {
            const family = run.format?.fontFamily;
            if (family) {
              const usage = ensure(family);
              if (!usage.nodeIds.includes(node.id)) {
                usage.nodeIds.push(node.id);
              }
              usage.totalCharacters += countChars(run.text);

              if (run.format?.fontWeight !== undefined) usage.weight = run.format.fontWeight;
              if (run.format?.fontStyle !== undefined) usage.style = run.format.fontStyle;
            }
          }
        }
      }
    }

    // 2. Scan text/paragraph styles
    if (doc.styles) {
      for (const [id, style] of Object.entries(doc.styles)) {
        if (style.type === 'text') {
          const ts = style as UsageTextStyle;
          if (ts.fontFamily) {
            const usage = ensure(ts.fontFamily);
            usage.styleIds.push(id);
            if (ts.fontWeight !== undefined) usage.weight = ts.fontWeight;
            if (ts.fontStyle !== undefined) usage.style = ts.fontStyle;
          }
        }
      }
    }

    return index;
  }

  /**
   * Get usage info for a specific font family.
   */
  getFamilyUsage(doc: UsageDocument, family: string): FontUsage {
    const index = this.build(doc);
    const key = family.toLowerCase();
    return (
      index.get(key) ?? {
        familyName: family,
        nodeIds: [],
        styleIds: [],
        totalCharacters: 0,
      }
    );
  }

  /**
   * How many nodes use this font family.
   */
  getUsageCount(doc: UsageDocument, family: string): number {
    return this.getFamilyUsage(doc, family).nodeIds.length;
  }

  /**
   * All unique font families in the document.
   */
  getUniqueFamilies(doc: UsageDocument): string[] {
    const index = this.build(doc);
    return [...index.values()].map((u) => u.familyName);
  }

  /**
   * Whether any node in the document uses this font.
   */
  isFontUsed(doc: UsageDocument, family: string): boolean {
    return this.getUsageCount(doc, family) > 0;
  }

  /**
   * All node IDs that use a given font family.
   */
  getAffectedNodes(doc: UsageDocument, family: string): string[] {
    return this.getFamilyUsage(doc, family).nodeIds;
  }
}

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

/**
 * Upgrade old documents that store fonts only as bare family strings on nodes
 * that lack proper font properties. This handles pre-v1.6 documents where
 * text nodes may have a `font` string field instead of the structured
 * `fontFamily`/`fontWeight`/`fontStyle` fields.
 *
 * Returns a new document with migrated text nodes. The migration is idempotent:
 * running it on an already-migrated document is a no-op.
 */
export function migrateLegacyFontRefs(doc: UsageDocument): UsageDocument {
  let changed = false;
  const updatedNodes = { ...doc.nodes } as Record<
    string,
    UsageTextNode | { id: string; kind: string }
  >;

  for (const [id, node] of Object.entries(updatedNodes)) {
    if (!isTextNode(node)) continue;

    // Case 1: Has `font` string but no `fontFamily` — migrate
    if (node.font && typeof node.font === 'string' && !node.fontFamily) {
      const parsed = parseLegacyFontString(node.font);
      updatedNodes[id] = {
        ...node,
        fontFamily: parsed.family,
        fontWeight: parsed.weight,
        fontStyle: parsed.style,
      };
      changed = true;
    }

    // Case 2: Has numeric `font` (weight) but no `fontWeight`
    if (typeof node.font === 'number' && node.fontWeight === undefined) {
      updatedNodes[id] = {
        ...updatedNodes[id],
        fontWeight: node.font,
      } as UsageTextNode | { id: string; kind: string };
      changed = true;
    }
  }

  // Migrate legacy styles
  let updatedStyles = doc.styles;
  if (doc.styles) {
    const styleEntries = Object.entries(doc.styles);
    let stylesChanged = false;
    const newStyles: Record<string, UsageTextStyle | { type: string; [key: string]: unknown }> = {};

    for (const [id, style] of styleEntries) {
      if (style.type === 'text') {
        const ts = style as UsageTextStyle;
        if (ts.font && typeof ts.font === 'string' && !ts.fontFamily) {
          const parsed = parseLegacyFontString(ts.font);
          newStyles[id] = {
            ...style,
            fontFamily: parsed.family,
            fontWeight: parsed.weight,
            fontStyle: parsed.style,
          };
          stylesChanged = true;
        } else {
          newStyles[id] = style;
        }
      } else {
        newStyles[id] = style;
      }
    }

    if (stylesChanged) {
      updatedStyles = newStyles;
      changed = true;
    }
  }

  if (!changed) return doc;

  return {
    ...doc,
    nodes: updatedNodes,
    styles: updatedStyles,
  } as UsageDocument;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a legacy CSS-style font shorthand string into structured properties.
 * Examples:
 *   "bold 16px Arial" → { family: "Arial", weight: 700, style: "normal" }
 *   "italic 12px Georgia" → { family: "Georgia", weight: 400, style: "italic" }
 *   "14px Helvetica" → { family: "Helvetica", weight: 400, style: "normal" }
 */
function parseLegacyFontString(font: string): {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
} {
  const parts = font.trim().split(/\s+/);
  let family = 'Arial';
  let weight = 400;
  let style: 'normal' | 'italic' = 'normal';

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'bold') {
      weight = 700;
    } else if (lower === 'italic') {
      style = 'italic';
    } else if (lower === 'oblique') {
      style = 'italic';
    } else if (lower === 'normal') {
      weight = 400;
      style = 'normal';
    } else if (/^\d+$/.test(part)) {
      weight = Number.parseInt(part, 10);
    } else if (lower.endsWith('px') || lower.endsWith('pt') || lower.endsWith('em')) {
      // Skip size values
    } else {
      family = part;
    }
  }

  return { family, weight, style };
}
