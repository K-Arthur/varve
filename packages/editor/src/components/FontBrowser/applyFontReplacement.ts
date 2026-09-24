import {
  attachFontManifestToDocument,
  type FontCatalog,
  type FontReference,
  type FontReplacement,
  FontResolver,
  fontReferenceKey,
  type ResolverDocument,
  type ResolverRichText,
} from '@varve/engine/font';
import type { Document, RichText, TextNode } from '@varve/scene';
import { toFontResolverDocument } from './fontResolverDocument';

/**
 * Apply one reviewed font replacement and keep its provenance in the
 * document manifest.
 *
 * All replacement surfaces use this adapter so a family replacement, an
 * exact artifact/member replacement, and the missing-font dialog have the
 * same rich-run/style behavior. The resolver owns matching and identity
 * clearing; manifest attachment owns persistence metadata.
 */
export function applyFontReplacement(
  doc: Document,
  catalog: FontCatalog,
  replacement: FontReplacement,
  scope?: FontReplacementScope,
): Document {
  if (scope?.nodeIds?.length === 0) return doc;
  const updated = resolveReplacement(doc, replacement, scope);
  const priorReplacements = doc.fontManifest?.replacements ?? [];
  const replacements = [...priorReplacements];
  const sameReference = (
    left: FontReplacement['originalReference'] | FontReplacement['replacementReference'],
    right: FontReplacement['originalReference'] | FontReplacement['replacementReference'],
  ) => {
    if (!left || !right) return !left && !right;
    return fontReferenceKey(left) === fontReferenceKey(right);
  };
  const duplicateIndex = replacements.findIndex(
    (existing) =>
      existing.original.toLowerCase() === replacement.original.toLowerCase() &&
      existing.replacement.toLowerCase() === replacement.replacement.toLowerCase() &&
      sameReference(existing.originalReference, replacement.originalReference) &&
      sameReference(existing.replacementReference, replacement.replacementReference),
  );
  if (duplicateIndex >= 0) replacements[duplicateIndex] = replacement;
  else replacements.push(replacement);

  const manifestInput = {
    nodes: updated.nodes,
    styles: fontManifestStyles(updated.styles),
    fontManifest: {
      version: 2 as const,
      fonts: doc.fontManifest?.fonts ?? [],
      replacements,
    },
  };
  const { manifest } = attachFontManifestToDocument(manifestInput, catalog);

  return {
    ...doc,
    nodes: updated.nodes,
    ...(updated.styles ? { styles: updated.styles } : {}),
    ...(updated.stories ? { stories: updated.stories } : {}),
    fontManifest: manifest,
  };
}

function sameReplacement(left: FontReplacement, right: FontReplacement): boolean {
  const sameReference = (
    a: FontReplacement['originalReference'] | FontReplacement['replacementReference'],
    b: FontReplacement['originalReference'] | FontReplacement['replacementReference'],
  ) => {
    if (!a || !b) return !a && !b;
    return fontReferenceKey(a) === fontReferenceKey(b);
  };
  return (
    left.original.toLowerCase() === right.original.toLowerCase() &&
    left.replacement.toLowerCase() === right.replacement.toLowerCase() &&
    sameReference(left.originalReference, right.originalReference) &&
    sameReference(left.replacementReference, right.replacementReference)
  );
}

export interface FontReplacementScope {
  /** Restrict the authored text nodes changed by this operation. */
  nodeIds?: readonly string[];
}

type FontManifestTextStyle = {
  type: 'text';
  fontFamily?: string;
  fontReference?: FontReference;
  fontWeight?: number;
  fontStyle?: string;
};

function fontManifestStyles(
  styles: Document['styles'],
): Record<string, FontManifestTextStyle> | undefined {
  if (!styles) return undefined;
  const textStyles: Record<string, FontManifestTextStyle> = {};
  for (const [styleId, style] of Object.entries(styles)) {
    if (style.type !== 'text') continue;
    textStyles[styleId] = {
      type: 'text',
      fontFamily: style.fontFamily,
      fontReference: style.fontReference,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
    };
  }
  return textStyles;
}

function replacementMatches(
  replacement: FontReplacement,
  family: string | undefined,
  reference: FontReference | undefined,
): boolean {
  if (replacement.originalReference) {
    return Boolean(
      reference && fontReferenceKey(reference) === fontReferenceKey(replacement.originalReference),
    );
  }
  return family?.toLowerCase() === replacement.original.toLowerCase();
}

function isFontReference(value: unknown): value is FontReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    'artifactHash' in value &&
    typeof value.artifactHash === 'string' &&
    (!('collectionIndex' in value) || typeof value.collectionIndex === 'number') &&
    (!('postScriptName' in value) || typeof value.postScriptName === 'string')
  );
}

function mergeResolverOutput(
  doc: Document,
  resolved: ResolverDocument,
): {
  nodes: Document['nodes'];
  styles: Document['styles'] | undefined;
  stories: Document['stories'] | undefined;
} {
  const nodes = { ...doc.nodes };
  for (const [nodeId, updated] of Object.entries(resolved.nodes)) {
    const original = doc.nodes[nodeId];
    if (original?.kind !== 'text' || !isResolverTextNode(updated)) continue;
    const { fontStyle: _fontStyle, richText, ...updatedFields } = updated;
    nodes[nodeId] = {
      ...original,
      ...updatedFields,
      richText: mergeResolverRichText(original.richText, richText),
    };
  }

  const styles = doc.styles ? { ...doc.styles } : undefined;
  if (styles && resolved.styles) {
    for (const [styleId, updated] of Object.entries(resolved.styles)) {
      const original = doc.styles?.[styleId];
      if (original?.type !== 'text' || !isResolverTextStyle(updated)) continue;
      const { fontStyle: _fontStyle, ...updatedFields } = updated;
      styles[styleId] = { ...original, ...updatedFields };
    }
  }

  const stories = mergeResolverStories(doc.stories, resolved.stories);
  return { nodes, styles, stories };
}

function mergeResolverStories(
  source: Document['stories'],
  resolved: ResolverDocument['stories'],
  storyIds?: ReadonlySet<string>,
): Document['stories'] | undefined {
  if (!source || !resolved) return source;
  const stories = { ...source };
  for (const [storyId, updated] of Object.entries(resolved)) {
    if (storyIds && !storyIds.has(storyId)) continue;
    const original = source[storyId];
    if (!original || !updated) continue;
    const { content, ...updatedFields } = updated;
    stories[storyId] = {
      ...original,
      ...updatedFields,
      content: mergeResolverRichText(original.content, content) ?? original.content,
    };
  }
  return stories;
}

function isResolverTextNode(
  node: ResolverDocument['nodes'][string],
): node is Extract<ResolverDocument['nodes'][string], { kind: 'text' }> {
  return node.kind === 'text';
}

function isResolverTextStyle(
  style: NonNullable<ResolverDocument['styles']>[string] | undefined,
): style is Extract<NonNullable<ResolverDocument['styles']>[string], { type: 'text' }> {
  return style?.type === 'text';
}

function mergeResolverRichText(
  original: RichText | undefined,
  updated: ResolverRichText | undefined,
): RichText | undefined {
  if (!original || !updated) return original;
  const paragraphs = original.paragraphs.map((paragraph, paragraphIndex) => {
    const updatedParagraph = updated.paragraphs[paragraphIndex];
    if (!updatedParagraph) return paragraph;
    const runs = paragraph.runs.map((run, runIndex) => {
      const updatedRun = updatedParagraph.runs[runIndex];
      if (!updatedRun) return run;
      const { format, ...updatedFields } = updatedRun;
      if (!format) return { ...run, ...updatedFields };
      const { fontStyle: _fontStyle, ...updatedFormat } = format;
      return { ...run, ...updatedFields, format: { ...run.format, ...updatedFormat } };
    });
    return { ...paragraph, ...updatedParagraph, runs };
  });
  return { ...original, ...updated, paragraphs };
}

/**
 * Resolve a replacement against either the whole document or a selected set
 * of text nodes. Scoped operations materialize a linked text style onto the
 * affected node before resolving it, which keeps the style link intact while
 * preventing a page-scoped action from changing every document user of that
 * shared style.
 */
function resolveReplacement(
  doc: Document,
  replacement: FontReplacement,
  scope: FontReplacementScope | undefined,
): {
  nodes: Document['nodes'];
  styles: Document['styles'] | undefined;
  stories: Document['stories'] | undefined;
} {
  const resolver = new FontResolver();
  if (scope?.nodeIds !== undefined) {
    if (scope.nodeIds.length === 0) {
      return { nodes: doc.nodes, styles: doc.styles, stories: doc.stories };
    }

    const targetIds = new Set(scope.nodeIds);
    const scopedNodes = { ...doc.nodes };
    const styleBackedTargets = new Set<string>();
    const scopedStoryIds = new Set<string>();
    for (const nodeId of targetIds) {
      const node = doc.nodes[nodeId];
      if (node?.kind !== 'text') continue;
      if (node.storyBinding?.storyId) scopedStoryIds.add(node.storyBinding.storyId);
      const style = node.styleId ? doc.styles?.[node.styleId] : undefined;
      if (style?.type !== 'text') continue;
      const overrides = node.styleOverrides ?? {};
      const effectiveFamily =
        typeof overrides.fontFamily === 'string'
          ? overrides.fontFamily
          : (style.fontFamily ?? node.fontFamily);
      const effectiveReference =
        (isFontReference(overrides.fontReference) ? overrides.fontReference : undefined) ??
        style.fontReference ??
        node.fontReference;
      if (!replacementMatches(replacement, effectiveFamily, effectiveReference)) continue;
      styleBackedTargets.add(nodeId);
      scopedNodes[nodeId] = {
        ...node,
        ...(effectiveFamily ? { fontFamily: effectiveFamily } : {}),
        ...(effectiveReference ? { fontReference: effectiveReference } : {}),
      };
    }

    const projected = toFontResolverDocument({ ...doc, nodes: scopedNodes });
    const scopedStories: NonNullable<ResolverDocument['stories']> = {};
    for (const storyId of scopedStoryIds) {
      const story = projected.stories?.[storyId];
      if (story) scopedStories[storyId] = story;
    }
    const resolved = resolver.applyReplacement(
      {
        ...projected,
        styles: undefined,
        stories: scopedStoryIds.size > 0 ? scopedStories : undefined,
      },
      replacement,
    );
    const nodes = { ...doc.nodes };
    for (const nodeId of targetIds) {
      const updated = resolved.nodes[nodeId];
      const original = doc.nodes[nodeId];
      if (original?.kind !== 'text' || !updated || !isResolverTextNode(updated)) continue;
      const { fontStyle: _fontStyle, richText, ...updatedFields } = updated;
      let updatedText: TextNode = {
        ...original,
        ...updatedFields,
        richText: mergeResolverRichText(original.richText, richText),
      };
      if (styleBackedTargets.has(nodeId)) {
        const styleOverrides = { ...(updatedText.styleOverrides ?? {}) };
        styleOverrides.fontFamily = replacement.replacement;
        if (replacement.replacementReference) {
          styleOverrides.fontReference = replacement.replacementReference;
        } else {
          delete styleOverrides.fontReference;
        }
        updatedText = { ...updatedText, styleOverrides };
      }
      nodes[nodeId] = updatedText;
    }
    const stories = mergeResolverStories(doc.stories, resolved.stories, scopedStoryIds);
    return { nodes, styles: doc.styles, stories };
  }

  const resolved = resolver.applyReplacement(toFontResolverDocument(doc), replacement);
  return mergeResolverOutput(doc, resolved);
}

/**
 * Find one unambiguous replacement that can restore a Document Fonts row.
 *
 * Family-only replacements deliberately clear the current face reference, so
 * they are restorable only when no other replacement history entry targets the
 * same family. Exact replacements use the current artifact/member reference
 * and can coexist with other faces of the same family.
 */
export function findRestorableFontReplacement(
  doc: Document,
  family: string,
  currentReference?: FontReplacement['replacementReference'],
): FontReplacement | undefined {
  const candidates = (doc.fontManifest?.replacements ?? []).filter(
    (replacement) => replacement.replacement.toLowerCase() === family.toLowerCase(),
  );
  const matching = currentReference
    ? candidates.filter(
        (replacement) =>
          replacement.replacementReference !== undefined &&
          fontReferenceKey(replacement.replacementReference) === fontReferenceKey(currentReference),
      )
    : candidates.filter((replacement) => replacement.replacementReference === undefined);
  return matching.length === 1 ? matching[0] : undefined;
}

/** Restore one reviewed replacement and remove its provenance entry. */
export function restoreFontReplacement(
  doc: Document,
  catalog: FontCatalog,
  replacement: FontReplacement,
  currentReference?: FontReplacement['replacementReference'],
  scope?: FontReplacementScope,
): Document {
  const inverse: FontReplacement = {
    original: replacement.replacement,
    replacement: replacement.original,
    ...(currentReference ? { originalReference: currentReference } : {}),
    ...(replacement.originalReference
      ? { replacementReference: replacement.originalReference }
      : {}),
    applyToAll: true,
    preserveOriginalReference: false,
  };
  const updated = resolveReplacement(doc, inverse, scope);
  const remaining = (doc.fontManifest?.replacements ?? []).filter(
    (existing) => !sameReplacement(existing, replacement),
  );
  const manifestInput = {
    nodes: updated.nodes,
    styles: fontManifestStyles(updated.styles),
    fontManifest: {
      version: 2 as const,
      fonts: doc.fontManifest?.fonts ?? [],
      replacements: remaining,
    },
  };
  const { manifest } = attachFontManifestToDocument(manifestInput, catalog);
  return {
    ...doc,
    nodes: updated.nodes,
    ...(updated.styles ? { styles: updated.styles } : {}),
    ...(updated.stories ? { stories: updated.stories } : {}),
    fontManifest: manifest,
  };
}
