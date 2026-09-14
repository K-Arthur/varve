import {
  attachFontManifestToDocument,
  type FontCatalog,
  type FontReference,
  type FontReplacement,
  FontResolver,
  fontReferenceKey,
  type ResolverDocument,
  type ResolverTextNode,
} from '@varve/engine/font';
import type { Document } from '@varve/scene';

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

  const { manifest } = attachFontManifestToDocument(
    {
      nodes: updated.nodes,
      styles: updated.styles,
      stories: updated.stories,
      fontManifest: {
        version: 2,
        fonts: doc.fontManifest?.fonts ?? [],
        replacements,
      },
    } as Parameters<typeof attachFontManifestToDocument>[0],
    catalog,
  );

  return {
    ...doc,
    nodes: updated.nodes as Document['nodes'],
    ...(updated.styles ? { styles: updated.styles as Document['styles'] } : {}),
    ...(updated.stories ? { stories: updated.stories as Document['stories'] } : {}),
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
        (overrides.fontReference as FontReference | undefined) ??
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

    const resolved = resolver.applyReplacement(
      {
        nodes: scopedNodes,
        styles: undefined,
        stories:
          scopedStoryIds.size > 0
            ? Object.fromEntries(
                [...scopedStoryIds]
                  .filter((storyId) => doc.stories?.[storyId])
                  .map((storyId) => [storyId, doc.stories![storyId]]),
              )
            : undefined,
      } as unknown as ResolverDocument,
      replacement,
    );
    const nodes = { ...doc.nodes };
    for (const nodeId of targetIds) {
      const updated = resolved.nodes[nodeId];
      if (!updated) continue;
      if (styleBackedTargets.has(nodeId) && updated.kind === 'text') {
        // ResolverDocument intentionally keeps non-text nodes opaque. Once
        // the discriminant is checked, retain the text-node shape so linked
        // style overrides survive the scoped replacement.
        const updatedText = updated as ResolverTextNode;
        const styleOverrides = { ...(updatedText.styleOverrides ?? {}) };
        styleOverrides.fontFamily = replacement.replacement;
        if (replacement.replacementReference) {
          styleOverrides.fontReference = replacement.replacementReference;
        } else {
          delete styleOverrides.fontReference;
        }
        nodes[nodeId] = { ...updatedText, styleOverrides } as Document['nodes'][string];
      } else {
        nodes[nodeId] = updated as Document['nodes'][string];
      }
    }
    let stories = doc.stories;
    if (resolved.stories && doc.stories) {
      stories = { ...doc.stories };
      for (const storyId of scopedStoryIds) {
        const updatedStory = resolved.stories[storyId];
        if (updatedStory) stories[storyId] = updatedStory as Document['stories'][string];
      }
    }
    return { nodes, styles: doc.styles, stories };
  }

  const resolved = resolver.applyReplacement(
    { nodes: doc.nodes, styles: doc.styles, stories: doc.stories } as unknown as ResolverDocument,
    replacement,
  );
  return {
    nodes: resolved.nodes as Document['nodes'],
    styles: resolved.styles as Document['styles'] | undefined,
    stories: resolved.stories as Document['stories'] | undefined,
  };
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
  const { manifest } = attachFontManifestToDocument(
    {
      nodes: updated.nodes,
      styles: updated.styles,
      fontManifest: {
        version: 2,
        fonts: doc.fontManifest?.fonts ?? [],
        replacements: remaining,
      },
    } as Parameters<typeof attachFontManifestToDocument>[0],
    catalog,
  );
  return {
    ...doc,
    nodes: updated.nodes as Document['nodes'],
    ...(updated.styles ? { styles: updated.styles as Document['styles'] } : {}),
    ...(updated.stories ? { stories: updated.stories as Document['stories'] } : {}),
    fontManifest: manifest,
  };
}
