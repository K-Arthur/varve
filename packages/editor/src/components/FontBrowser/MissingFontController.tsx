/**
 * MissingFontController — detects missing fonts in the document and renders
 * the MissingFontDialog for resolution.
 *
 * Watches the document for changes, runs FontResolver.detectMissing() against
 * the FontCatalog, and surfaces the dialog when unresolved fonts are found.
 * Replacement actions mutate the document via the editor's updateNode.
 */

import { getFontRegistry } from '@varve/engine';
import type { FontReplacement, MissingFontInfo, ResolverDocument } from '@varve/engine/font';
import { attachFontManifestToDocument, FontCatalog, FontResolver } from '@varve/engine/font';
import type { Document } from '@varve/scene';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';

import { MissingFontDialog } from './MissingFontDialog';

export function MissingFontController() {
  const editor = useEditor();
  const [missingFonts, setMissingFonts] = useState<MissingFontInfo[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const dismissedKeyRef = useRef('');
  const catalogRef = useRef<FontCatalog | null>(null);
  const resolverRef = useRef<FontResolver | null>(null);

  // Build the catalog from the registry and refresh it when a local/provider
  // font becomes available. A stale catalog would keep offering a fallback
  // after the user installed or downloaded the requested face.
  useEffect(() => {
    const registry = getFontRegistry();
    const refresh = () => {
      const catalog = new FontCatalog();
      for (const family of registry.families()) {
        const entries = registry.getEntries(family);
        const first = entries[0];
        if (!first) continue;

        catalog.addEntry({
          identity: {
            contentHash: `registry:${family}`,
            postScriptName: family.replace(/\s+/g, '-'),
            familyName: family,
            subfamilyName: weightToSubfamily(first.weight, first.style),
            fullName: `${family} ${weightToSubfamily(first.weight, first.style)}`,
          },
          format: 'unknown',
          fileSize: 0,
          unitsPerEm: 1000,
          ascender: 800,
          descender: -200,
          lineGap: 0,
          glyphCount: 0,
          isVariable: registry.isVariable(family),
          axes: [],
          namedInstances: [],
          openTypeFeatures: registry.getSupportedFeatures(family),
          unicodeRanges: [],
          scripts: [],
          embeddingRights: first.source === 'system' ? 'installable' : 'unknown',
          hasColorGlyphs: false,
          category: 'sans-serif',
          source:
            first.source === 'system' ? 'system' : first.source === 'google' ? 'remote' : 'bundled',
        });
      }
      catalogRef.current = catalog;
      resolverRef.current ??= new FontResolver();
      setCatalogRevision((revision) => revision + 1);
    };

    refresh();
    return registry.subscribe(refresh);
  }, []);

  // Detect missing fonts when document changes
  useEffect(() => {
    if (!catalogRef.current || !resolverRef.current) return;

    const doc = editor.state.document;
    const minimalDoc = { nodes: doc.nodes, styles: doc.styles } as unknown as ResolverDocument;

    const missing = resolverRef.current.detectMissing(minimalDoc, catalogRef.current);
    setMissingFonts(missing);
  }, [editor.state.document, catalogRevision]);

  const hasMissing = useMemo(() => missingFonts.length > 0, [missingFonts]);

  const missingKey = useMemo(
    () =>
      missingFonts
        .map((font) => font.originalReference.toLowerCase())
        .sort()
        .join('\u0000'),
    [missingFonts],
  );

  useEffect(() => {
    if (!hasMissing) {
      dismissedKeyRef.current = '';
      setShowDialog(false);
      return;
    }
    if (dismissedKeyRef.current !== missingKey) setShowDialog(true);
  }, [hasMissing, missingKey]);

  const handleReplace = (original: string, replacement: string) => {
    editor.beginTransaction();
    editor.updateDoc((doc) =>
      replaceFontInDocument(doc, catalogRef.current!, {
        original,
        replacement,
        applyToAll: true,
        preserveOriginalReference: true,
      }),
    );
    editor.commitTransaction();
  };

  const handleReplaceAll = (map: Map<string, string>) => {
    editor.beginTransaction();
    editor.updateDoc((doc) => {
      let next = doc;
      for (const [original, replacement] of map) {
        if (!replacement) continue;
        next = replaceFontInDocument(next, catalogRef.current!, {
          original,
          replacement,
          applyToAll: true,
          preserveOriginalReference: true,
        });
      }
      return next;
    });
    editor.commitTransaction();
    setShowDialog(false);
  };

  const handleDismiss = () => {
    dismissedKeyRef.current = missingKey;
    setShowDialog(false);
  };

  if (!showDialog || missingFonts.length === 0) return null;

  return (
    <MissingFontDialog
      missingFonts={missingFonts}
      catalog={catalogRef.current!}
      onReplace={handleReplace}
      onReplaceAll={handleReplaceAll}
      onDismiss={handleDismiss}
      onClose={handleDismiss}
    />
  );
}

function replaceFontInDocument(
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
  const duplicateIndex = replacements.findIndex(
    (existing) =>
      existing.original.toLowerCase() === replacement.original.toLowerCase() &&
      existing.replacement.toLowerCase() === replacement.replacement.toLowerCase(),
  );
  if (duplicateIndex >= 0) replacements[duplicateIndex] = replacement;
  else replacements.push(replacement);

  const { manifest } = attachFontManifestToDocument(
    {
      nodes: updated.nodes,
      styles: updated.styles,
      fontManifest: {
        version: 1,
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

function weightToSubfamily(weight: number, style: string): string {
  const weightNames: Record<number, string> = {
    100: 'Thin',
    200: 'ExtraLight',
    300: 'Light',
    400: 'Regular',
    500: 'Medium',
    600: 'SemiBold',
    700: 'Bold',
    800: 'ExtraBold',
    900: 'Black',
  };
  const base = weightNames[weight] ?? 'Regular';
  return style === 'italic' ? `${base} Italic` : base;
}
