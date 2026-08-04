/**
 * MissingFontController — detects missing fonts in the document and renders
 * the MissingFontDialog for resolution.
 *
 * Watches the document for changes, runs FontResolver.detectMissing() against
 * the FontCatalog, and surfaces the dialog when unresolved fonts are found.
 * Replacement actions mutate the document via the editor's updateNode.
 */

import { getFontRegistry } from '@varve/engine';
import type { MissingFontInfo } from '@varve/engine/font';
import { FontCatalog, FontResolver } from '@varve/engine/font';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';

import { MissingFontDialog } from './MissingFontDialog';

export function MissingFontController() {
  const editor = useEditor();
  const [missingFonts, setMissingFonts] = useState<MissingFontInfo[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const catalogRef = useRef<FontCatalog | null>(null);
  const resolverRef = useRef<FontResolver | null>(null);

  // Build catalog from registry on mount
  useEffect(() => {
    const registry = getFontRegistry();
    const catalog = new FontCatalog();
    const resolver = new FontResolver();

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
    resolverRef.current = resolver;
  }, []);

  // Detect missing fonts when document changes
  useEffect(() => {
    if (!catalogRef.current || !resolverRef.current) return;

    const doc = editor.state.document;
    const minimalDoc = {
      nodes: Object.fromEntries(
        Object.entries(doc.nodes).map(([id, node]) => [
          id,
          node.kind === 'text'
            ? {
                id,
                kind: 'text' as const,
                fontFamily: node.fontFamily,
                fontWeight: node.fontWeight,
                fontStyle: node.fontStyle,
                text: node.text,
              }
            : { id, kind: node.kind },
        ]),
      ),
    };

    const missing = resolverRef.current.detectMissing(minimalDoc, catalogRef.current);
    setMissingFonts(missing);
  }, [editor.state.document]);

  const hasMissing = useMemo(() => missingFonts.length > 0, [missingFonts]);

  const handleReplace = (original: string, replacement: string) => {
    editor.beginTransaction();
    for (const node of Object.values(editor.state.document.nodes)) {
      if (node.kind === 'text' && node.fontFamily === original) {
        editor.updateNode(node.id, (n) => {
          if (n.kind !== 'text') return n;
          return { ...n, fontFamily: replacement };
        });
      }
    }
    editor.commitTransaction();
  };

  const handleReplaceAll = (map: Map<string, string>) => {
    editor.beginTransaction();
    for (const [original, replacement] of map) {
      for (const node of Object.values(editor.state.document.nodes)) {
        if (node.kind === 'text' && node.fontFamily === original) {
          editor.updateNode(node.id, (n) => {
            if (n.kind !== 'text') return n;
            return { ...n, fontFamily: replacement };
          });
        }
      }
    }
    editor.commitTransaction();
    setShowDialog(false);
  };

  const handleDismiss = () => {
    setShowDialog(false);
  };

  if (!showDialog && hasMissing) {
    setShowDialog(true);
  }

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
