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

import type { FontCatalog, FontCatalogEntry } from './fontCatalog';
import { inheritedFontReference } from './fontFaceInheritance';
import type { FontReference, FontSourceKind } from './fontIdentity';
import { fontReferenceKey } from './fontIdentity';

// ---------------------------------------------------------------------------
// Minimal document types (avoids dependency on @varve/scene)
// ---------------------------------------------------------------------------

/** Minimal text node shape used by the resolver. */
export interface ResolverTextNode {
  id: string;
  kind: 'text';
  /** Node-level overrides for a linked text style. */
  styleOverrides?: Record<string, unknown>;
  fontFamily?: string;
  /** Exact artifact/member identity when the document has one. */
  fontReference?: FontReference;
  fontWeight?: number;
  fontStyle?: string;
  text?: string;
  richText?: ResolverRichText;
}

export interface ResolverTextRun {
  text: string;
  format?: {
    fontFamily?: string;
    fontReference?: FontReference;
    fontWeight?: number;
    fontStyle?: string;
  };
}

export interface ResolverRichText {
  paragraphs: Array<{ runs: ResolverTextRun[] }>;
}

/** Authoritative linked-story projection used by missing-font recovery. */
export interface ResolverStory {
  id: string;
  name?: string;
  thread: string[];
  content?: ResolverRichText;
  language?: string;
}

/** Minimal style shape used by the resolver. */
export interface ResolverTextStyle {
  type: 'text';
  fontFamily?: string;
  fontReference?: FontReference;
  fontWeight?: number;
  fontStyle?: string;
}

/** Minimal document shape used by the resolver. */
export interface ResolverDocument {
  nodes: Record<string, ResolverTextNode | { id: string; kind: string }>;
  styles?: Record<string, ResolverTextStyle | { type: string; [key: string]: unknown }>;
  stories?: Record<string, ResolverStory>;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MissingFontStatus =
  | 'missing'
  | 'missing-family'
  | 'missing-face'
  | 'missing-glyph'
  | 'corrupt'
  | 'unsupported'
  | 'conflicting'
  | 'version-mismatch';

export type MissingFontRecoveryAction =
  | 'install-family'
  | 'install-face'
  | 'choose-face'
  | 'replace-glyphs';

export interface MissingFontDiagnostic {
  /** Human-readable explanation of why the authored face cannot be used. */
  reason: string;
  /** The first useful action the recovery UI can offer. */
  nextAction: MissingFontRecoveryAction;
}

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
  /** Exact artifact/member identity that failed, when the document supplied one. */
  fontReference?: FontReference;
  requestedWeight?: number;
  requestedStyle?: string;
  nodeIds: string[];
  status: MissingFontStatus;
  /** Actionable explanation for statuses that need user recovery. */
  diagnostic?: MissingFontDiagnostic;
  substitutes: FontSubstitute[];
  originalReference: string;
  /** Code points requested by the document but outside the resolved cmap. */
  missingGlyphs?: string[];
}

export interface FontReplacement {
  original: string;
  replacement: string;
  /** Restrict replacement to this exact artifact/member when present. */
  originalReference?: FontReference;
  /** Optional exact face to assign to the replacement runs. */
  replacementReference?: FontReference;
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

type FontResolutionReference = {
  family: string;
  fontReference?: FontReference;
  weight?: number;
  style?: string;
  text?: string;
};

type MissingFamilyRecord = {
  family: string;
  fontReference?: FontReference;
  nodeIds: string[];
  weight?: number;
  style?: string;
  missingGlyphs: Set<string>;
  status: MissingFontStatus;
  diagnostic?: MissingFontDiagnostic;
};

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
  fontReference?: FontReference;
  weight?: number;
  style?: string;
  styleId: string;
}> {
  const results: Array<{
    family: string;
    fontReference?: FontReference;
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
          fontReference: ts.fontReference,
          weight: ts.fontWeight,
          style: ts.fontStyle,
          styleId: id,
        });
      }
    }
  }
  return results;
}

function getFontFamiliesFromNode(node: ResolverTextNode): FontResolutionReference[] {
  const results: FontResolutionReference[] = [];

  if (node.fontFamily) {
    results.push({
      family: node.fontFamily,
      fontReference: node.fontReference,
      weight: node.fontWeight,
      style: node.fontStyle,
      text: node.text,
    });
  }

  for (const paragraph of node.richText?.paragraphs ?? []) {
    for (const run of paragraph.runs) {
      const family = run.format?.fontFamily ?? node.fontFamily;
      if (!family) continue;
      results.push({
        family,
        fontReference: inheritedFontReference(
          node.fontFamily,
          node.fontReference,
          run.format?.fontFamily,
          run.format?.fontReference,
        ),
        weight: run.format?.fontWeight,
        style: run.format?.fontStyle,
        text: run.text,
      });
    }
  }

  return results;
}

function getFontFamiliesFromStory(
  story: ResolverStory,
  fallback?: Pick<ResolverTextNode, 'fontFamily' | 'fontReference' | 'fontWeight' | 'fontStyle'>,
): FontResolutionReference[] {
  const results: FontResolutionReference[] = [];
  for (const paragraph of story.content?.paragraphs ?? []) {
    for (const run of paragraph.runs) {
      const family = run.format?.fontFamily ?? fallback?.fontFamily;
      if (!family) continue;
      results.push({
        family,
        fontReference: inheritedFontReference(
          fallback?.fontFamily,
          fallback?.fontReference,
          run.format?.fontFamily,
          run.format?.fontReference,
        ),
        weight: run.format?.fontWeight ?? fallback?.fontWeight,
        style: run.format?.fontStyle ?? fallback?.fontStyle,
        text: run.text,
      });
    }
  }
  return results;
}

function recordMissingReference(
  familyNodes: Map<string, MissingFamilyRecord>,
  catalog: FontCatalog,
  reference: FontResolutionReference,
  nodeIds: readonly string[],
): void {
  const key = reference.fontReference
    ? `reference:${fontReferenceKey(reference.fontReference)}`
    : `family:${reference.family.toLowerCase()}`;
  const entry = resolveCatalogEntry(catalog, reference);
  const missingGlyphs = entry ? findMissingGlyphs(reference.text, entry) : [];
  if (entry && missingGlyphs.length === 0) return;

  const classified = classifyMissingReference(catalog, reference);
  const status: MissingFontStatus = missingGlyphs.length > 0 ? 'missing-glyph' : classified.status;
  const diagnostic: MissingFontDiagnostic =
    missingGlyphs.length > 0 ? missingFontDiagnostic('missing-glyph') : classified.diagnostic;
  const existing = familyNodes.get(key);
  if (existing) {
    for (const nodeId of nodeIds) {
      if (!existing.nodeIds.includes(nodeId)) existing.nodeIds.push(nodeId);
    }
    if (existing.weight === undefined) existing.weight = reference.weight;
    if (existing.style === undefined) existing.style = reference.style;
    for (const glyph of missingGlyphs) existing.missingGlyphs.add(glyph);
    if (statusPriority(status) > statusPriority(existing.status)) {
      existing.status = status;
      existing.diagnostic = diagnostic;
    }
    return;
  }

  familyNodes.set(key, {
    family: reference.family,
    fontReference: reference.fontReference,
    nodeIds: [...nodeIds],
    weight: reference.weight,
    style: reference.style,
    missingGlyphs: new Set(missingGlyphs),
    status,
    diagnostic,
  });
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
    const familyNodes = new Map<string, MissingFamilyRecord>();

    // Scan text nodes
    for (const node of Object.values(doc.nodes)) {
      if (node.kind !== 'text') continue;

      for (const reference of getFontFamiliesFromNode(node as ResolverTextNode)) {
        recordMissingReference(familyNodes, catalog, reference, [node.id]);
      }
    }

    // Linked stories own their rich text; every visible frame is retained as
    // an affected location so one replacement updates the authoritative text
    // once while the UI can still navigate to each frame.
    for (const story of Object.values(doc.stories ?? {})) {
      const frameIds = story.thread ?? [];
      const fallbackNode = frameIds
        .map((frameId) => doc.nodes[frameId])
        .find((node): node is ResolverTextNode => node?.kind === 'text');
      for (const reference of getFontFamiliesFromStory(story, fallbackNode)) {
        recordMissingReference(familyNodes, catalog, reference, frameIds);
      }
    }

    // Scan text/paragraph style references
    const styleRefs = getFontFamiliesFromStyles(doc);
    for (const ref of styleRefs) {
      const key = ref.fontReference
        ? `reference:${fontReferenceKey(ref.fontReference)}`
        : `family:${ref.family.toLowerCase()}`;
      const entry = resolveCatalogEntry(catalog, ref);
      if (!entry) {
        const diagnostic = classifyMissingReference(catalog, ref);
        const existing = familyNodes.get(key);
        if (!existing) {
          familyNodes.set(key, {
            family: ref.family,
            fontReference: ref.fontReference,
            nodeIds: [],
            weight: ref.weight,
            style: ref.style,
            missingGlyphs: new Set(),
            status: diagnostic.status,
            diagnostic: diagnostic.diagnostic,
          });
        } else if (statusPriority(diagnostic.status) > statusPriority(existing.status)) {
          existing.status = diagnostic.status;
          existing.diagnostic = diagnostic.diagnostic;
        }
      }
    }

    const results: MissingFontInfo[] = [];
    for (const info of familyNodes.values()) {
      const family = info.family;
      const substitutes = this.findSubstitutes(
        {
          familyName: family,
          fontReference: info.fontReference,
          requestedWeight: info.weight,
          requestedStyle: info.style,
          nodeIds: info.nodeIds,
          status: info.status,
          diagnostic: info.diagnostic,
          substitutes: [],
          originalReference: family,
          ...(info.missingGlyphs.size > 0 ? { missingGlyphs: [...info.missingGlyphs].sort() } : {}),
        },
        catalog,
      );

      results.push({
        familyName: family,
        fontReference: info.fontReference,
        requestedWeight: info.weight,
        requestedStyle: info.style,
        nodeIds: info.nodeIds,
        status: info.status,
        diagnostic: info.diagnostic,
        substitutes,
        originalReference: family,
        ...(info.missingGlyphs.size > 0 ? { missingGlyphs: [...info.missingGlyphs].sort() } : {}),
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

    // Tier 1: Exact PostScript name match. An exact face request can carry a
    // PostScript name even when its family label is localized, abbreviated,
    // or shared by several artifacts. Prefer that portable face signal over
    // guessing from the display family.
    const requestedPostScript = missing.fontReference?.postScriptName?.trim().toLowerCase();
    if (requestedPostScript && requestedPostScript !== 'unknown') {
      for (const entry of catalog.all()) {
        const postScriptLower = entry.identity.postScriptName.trim().toLowerCase();
        const family = entry.identity.familyName;
        if (postScriptLower !== requestedPostScript || seen.has(family)) continue;
        seen.add(family);
        allSubstitutes.push({
          familyName: family,
          matchQuality: 'postscript',
          confidence: 0.98,
          source: entry.source,
          availableVariants: collectVariants(catalog, family),
        });
      }
    }

    // Legacy family-only requests use the family label as their best exact
    // signal. Keep this compatibility path after the portable face lookup.
    for (const entry of catalog.all()) {
      const postScriptLower = entry.identity.postScriptName.trim().toLowerCase();
      const target = missing.familyName.trim().toLowerCase().replace(/\s+/g, '');
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

    // Confidence tiers are authoritative; within one tier, prefer candidates
    // whose registered faces can actually satisfy the authored weight/style so
    // the dialog's default replacement does not land on another missing face.
    return allSubstitutes.sort(
      (a, b) =>
        b.confidence - a.confidence ||
        substituteVariantFit(b, missing) - substituteVariantFit(a, missing),
    );
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
    const matches = (family: string | undefined, reference: FontReference | undefined): boolean => {
      if (replacement.originalReference) {
        return Boolean(
          reference &&
            fontReferenceKey(reference) === fontReferenceKey(replacement.originalReference),
        );
      }
      return family?.toLowerCase() === lowerOriginal;
    };
    const replaceFormat = <T extends { fontFamily?: string; fontReference?: FontReference }>(
      value: T,
    ): T => {
      const next = { ...value, fontFamily: replacement.replacement } as T;
      if (replacement.replacementReference) {
        next.fontReference = replacement.replacementReference;
      } else {
        delete next.fontReference;
      }
      return next;
    };

    for (const [id, node] of Object.entries(updatedNodes)) {
      if (!hasTextStyleFont(node)) continue;
      let updatedNode: ResolverTextNode = node;
      let nodeChanged = false;

      if (matches(node.fontFamily, node.fontReference)) {
        updatedNode = replaceFormat(updatedNode);
        nodeChanged = true;
      }

      if (node.richText) {
        let richTextChanged = false;
        const paragraphs = node.richText.paragraphs.map((paragraph) => {
          let paragraphChanged = false;
          const runs = paragraph.runs.map((run) => {
            if (!matches(run.format?.fontFamily, run.format?.fontReference)) return run;
            paragraphChanged = true;
            return {
              ...run,
              format: replaceFormat(run.format ?? {}),
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
          if (matches(ts.fontFamily, ts.fontReference)) {
            if (!stylesChanged) {
              updatedStyles = { ...updatedStyles };
              stylesChanged = true;
            }
            updatedStyles[id] = replaceFormat(ts);
          }
        }
      }
    }

    const updatedStories = doc.stories ? { ...doc.stories } : undefined;
    if (updatedStories) {
      for (const [id, story] of Object.entries(updatedStories)) {
        if (!story.content) continue;
        let storyChanged = false;
        const paragraphs = story.content.paragraphs.map((paragraph) => {
          let paragraphChanged = false;
          const runs = paragraph.runs.map((run) => {
            if (!matches(run.format?.fontFamily, run.format?.fontReference)) return run;
            paragraphChanged = true;
            return {
              ...run,
              format: replaceFormat(run.format ?? {}),
            };
          });
          if (!paragraphChanged) return paragraph;
          storyChanged = true;
          return { ...paragraph, runs };
        });
        if (storyChanged) {
          updatedStories[id] = {
            ...story,
            content: { ...story.content, paragraphs },
          };
        }
      }
    }

    return {
      ...doc,
      nodes: updatedNodes,
      styles: updatedStyles,
      stories: updatedStories,
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

function resolveCatalogEntry(
  catalog: FontCatalog,
  reference: { family: string; fontReference?: FontReference; weight?: number; style?: string },
): FontCatalogEntry | undefined {
  if (reference.fontReference) {
    return catalog.getEntryForReference(reference.fontReference);
  }
  const familyKey = reference.family.toLowerCase();
  const entries = catalog
    .getEntriesForFamily(reference.family)
    .filter((entry) => entry.identity.familyName.toLowerCase() === familyKey);
  if (entries.length === 0) return undefined;

  if (reference.weight !== undefined) {
    const exactCandidates = entries.filter((entry) => matchesRequestedVariant(entry, reference));
    // A request that omits the style still prefers the upright face, matching
    // the CSS default, before the match can be called ambiguous.
    const preferred =
      reference.style === undefined && exactCandidates.length > 1
        ? exactCandidates.filter((entry) => matchesRequestedVariant(entry, { style: 'normal' }))
        : exactCandidates;
    const pool = preferred.length > 0 ? preferred : exactCandidates;
    if (pool.length === 1) return pool[0];
    if (pool.length > 1) return undefined;
  } else {
    // No authored weight: the CSS default is regular (400). A family-only
    // request must not fail because the family also has bold/italic siblings.
    const regular = entries.filter((entry) =>
      matchesRequestedVariant(entry, { weight: 400, style: reference.style ?? 'normal' }),
    );
    if (regular.length === 1) return regular[0];
    if (regular.length > 1) return undefined;
  }

  // Family-level weight matching follows CSS Fonts Level 4: the nearest
  // declared weight resolves the request, so an installed family is not
  // reported missing merely because the authored weight has no exact file.
  // Exact artifact references and explicit styles remain strict above.
  const styled =
    reference.style === undefined
      ? preferUprightEntries(entries)
      : entries.filter((entry) => matchesRequestedVariant(entry, { style: reference.style }));
  if (styled.length === 0) return undefined;
  return selectNearestWeightEntry(styled, reference.weight ?? 400);
}

function preferUprightEntries(entries: FontCatalogEntry[]): FontCatalogEntry[] {
  const upright = entries.filter((entry) => matchesRequestedVariant(entry, { style: 'normal' }));
  return upright.length > 0 ? upright : entries;
}

/**
 * Pick the face CSS would use for a requested weight, preferring exact, then
 * the nearest heavier/lighter stop in spec order. Ambiguous weight groups
 * stay unresolved so the user chooses the exact artifact.
 */
function selectNearestWeightEntry(
  entries: FontCatalogEntry[],
  target: number,
): FontCatalogEntry | undefined {
  const byWeight = new Map<number, FontCatalogEntry[]>();
  for (const entry of entries) {
    const weight = parseWeightFromSubfamily(entry.identity.subfamilyName);
    const group = byWeight.get(weight);
    if (group) group.push(entry);
    else byWeight.set(weight, [entry]);
  }
  const weights = [...byWeight.keys()];
  if (weights.length === 0) return undefined;

  const ascending = (values: number[]) => values.sort((a, b) => a - b);
  const descending = (values: number[]) => values.sort((a, b) => b - a);
  const ordered =
    target <= 500
      ? [
          ...ascending(weights.filter((weight) => weight >= target && weight <= 500)),
          ...descending(weights.filter((weight) => weight < target)),
          ...ascending(weights.filter((weight) => weight > 500)),
        ]
      : [
          ...ascending(weights.filter((weight) => weight >= target)),
          ...descending(weights.filter((weight) => weight < target)),
        ];

  const candidates = byWeight.get(ordered[0]!);
  return candidates?.length === 1 ? candidates[0] : undefined;
}

function matchesRequestedVariant(
  entry: FontCatalogEntry,
  reference: { weight?: number; style?: string },
): boolean {
  const subfamily = entry.identity.subfamilyName.toLowerCase();
  const weight = parseWeightFromSubfamily(entry.identity.subfamilyName);
  const wantsItalic = reference.style?.toLowerCase() === 'italic';
  const styleMatches =
    reference.style === undefined ||
    (wantsItalic ? subfamily.includes('italic') : !subfamily.includes('italic'));
  return (reference.weight === undefined || weight === reference.weight) && styleMatches;
}

/**
 * Ordering score for candidates that share a confidence tier. A candidate
 * whose registered faces include the authored style and a close weight is a
 * better replacement than one that would immediately be missing again.
 */
function substituteVariantFit(substitute: FontSubstitute, missing: MissingFontInfo): number {
  const wantsItalic = missing.requestedStyle?.toLowerCase() === 'italic';
  const styleVariants =
    missing.requestedStyle === undefined
      ? substitute.availableVariants
      : substitute.availableVariants.filter(
          (variant) => (variant.style === 'italic') === wantsItalic,
        );
  if (styleVariants.length === 0) return 0;
  const target = missing.requestedWeight ?? 400;
  const distance = Math.min(...styleVariants.map((variant) => Math.abs(variant.weight - target)));
  return 1 / (1 + distance);
}

function classifyMissingReference(
  catalog: FontCatalog,
  reference: {
    family: string;
    fontReference?: FontReference;
    weight?: number;
    style?: string;
  },
): { status: MissingFontStatus; diagnostic: MissingFontDiagnostic } {
  const entries = catalog.getEntriesForFamily(reference.family);
  if (entries.length === 0) {
    return {
      status: 'missing-family',
      diagnostic: missingFontDiagnostic('missing-family'),
    };
  }

  if (reference.fontReference?.postScriptName) {
    const requestedPostScript = reference.fontReference.postScriptName.toLowerCase();
    if (
      entries.some((entry) => entry.identity.postScriptName.toLowerCase() === requestedPostScript)
    ) {
      return {
        status: 'version-mismatch',
        diagnostic: missingFontDiagnostic('version-mismatch'),
      };
    }
  }

  const variantEntries = entries.filter((entry) => matchesRequestedVariant(entry, reference));
  if (variantEntries.length > 1) {
    return {
      status: 'conflicting',
      diagnostic: missingFontDiagnostic('conflicting'),
    };
  }

  return {
    status: 'missing-face',
    diagnostic: missingFontDiagnostic('missing-face'),
  };
}

function missingFontDiagnostic(status: MissingFontStatus): MissingFontDiagnostic {
  switch (status) {
    case 'missing-family':
      return {
        reason: 'No installed or bundled face matches this family.',
        nextAction: 'install-family',
      };
    case 'missing-face':
      return {
        reason: 'The family is available, but the requested face is not installed.',
        nextAction: 'install-face',
      };
    case 'version-mismatch':
      return {
        reason:
          'A face with this PostScript name exists, but its artifact bytes differ from the document.',
        nextAction: 'install-face',
      };
    case 'conflicting':
      return {
        reason: 'More than one local artifact can satisfy this request; choose an exact face.',
        nextAction: 'choose-face',
      };
    case 'missing-glyph':
      return {
        reason: 'The resolved face does not cover every requested character.',
        nextAction: 'replace-glyphs',
      };
    default:
      return {
        reason: 'The requested face is unavailable.',
        nextAction: 'install-face',
      };
  }
}

function statusPriority(status: MissingFontStatus): number {
  switch (status) {
    case 'missing-glyph':
      return 5;
    case 'corrupt':
    case 'unsupported':
      return 4;
    case 'version-mismatch':
    case 'conflicting':
      return 3;
    case 'missing-face':
      return 2;
    case 'missing-family':
      return 1;
    default:
      return 0;
  }
}

/**
 * Report characters outside a parsed face's cmap when the parser supplied a
 * non-empty range list. An empty list means coverage is unknown (common for
 * legacy/provider metadata), so it must not be treated as “supports nothing”.
 */
function findMissingGlyphs(text: string | undefined, entry: FontCatalogEntry): string[] {
  if (!text || entry.unicodeRanges.length === 0) return [];
  const missing = new Set<string>();
  for (const character of Array.from(text)) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    const supported = entry.unicodeRanges.some(
      ([start, end]) => codePoint >= start && codePoint <= end,
    );
    if (!supported) missing.add(character);
  }
  return [...missing];
}

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
