import {
  attachFontManifestToDocument,
  type FontCatalog,
  type FontReplacement,
  FontResolver,
  fontReferenceKey,
  type ResolverDocument,
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
): Document {
  const resolver = new FontResolver();
  const updated = resolver.applyReplacement(
    { nodes: doc.nodes, styles: doc.styles } as unknown as ResolverDocument,
    replacement,
  );
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
  const resolver = new FontResolver();
  const updated = resolver.applyReplacement(
    { nodes: doc.nodes, styles: doc.styles } as unknown as ResolverDocument,
    inverse,
  );
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
    fontManifest: manifest,
  };
}
