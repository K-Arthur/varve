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
