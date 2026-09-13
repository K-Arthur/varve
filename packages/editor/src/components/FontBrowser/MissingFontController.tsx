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
import {
  attachFontManifestToDocument,
  createFontCatalogFromRegistry,
  type FontCatalog,
  FontResolver,
  fontReferenceKey,
  getFontsourceCatalog,
} from '@varve/engine/font';
import type { Document } from '@varve/scene';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isCapabilityRestricted, RESTRICTION_MESSAGES } from '../../capabilities/restrictions';
import { useEditor } from '../../context';

import { FontBrowserDialog } from './FontBrowserDialog';
import { MissingFontDialog } from './MissingFontDialog';
import type { MissingFontRecoveryMatch } from './missingFontRecovery';
import { findMissingFontRecoveryMatch } from './missingFontRecovery';
import { downloadAndApplyOnlineFont } from './useOnlineFontSearch';

export function MissingFontController() {
  const editor = useEditor();
  const [missingFonts, setMissingFonts] = useState<MissingFontInfo[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [browsingFont, setBrowsingFont] = useState<MissingFontInfo | null>(null);
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
      const catalog = createFontCatalogFromRegistry(registry);
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

  const handleReplace = (original: string, replacement: string, missing?: MissingFontInfo) => {
    editor.beginTransaction();
    editor.updateDoc((doc) =>
      replaceFontInDocument(doc, catalogRef.current!, {
        original,
        replacement,
        ...(missing?.fontReference ? { originalReference: missing.fontReference } : {}),
        applyToAll: true,
        preserveOriginalReference: true,
      }),
    );
    editor.commitTransaction();
  };

  const handleReplaceAll = (
    map: Map<string, string>,
    resolvedMissing: readonly MissingFontInfo[] = missingFonts,
  ) => {
    editor.beginTransaction();
    editor.updateDoc((doc) => {
      let next = doc;
      for (const missing of resolvedMissing) {
        const key = missing.fontReference
          ? `reference:${fontReferenceKey(missing.fontReference)}`
          : missing.familyName;
        const replacement = map.get(key);
        if (!replacement) continue;
        next = replaceFontInDocument(next, catalogRef.current!, {
          original: missing.familyName,
          replacement,
          ...(missing.fontReference ? { originalReference: missing.fontReference } : {}),
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

  const recoveryMatches = useMemo(() => {
    const fontsource = getFontsourceCatalog();
    return new Map(
      missingFonts.flatMap((missing) => {
        const match = findMissingFontRecoveryMatch(missing, fontsource);
        return match ? ([[missing.familyName, match]] as const) : [];
      }),
    );
  }, [missingFonts]);

  const handleInstallFontsource = async (
    missing: MissingFontInfo,
    match: MissingFontRecoveryMatch,
  ) => {
    await downloadAndApplyOnlineFont(
      match.artifact.familyName,
      match.artifact.providerId,
      match.artifact.familyId,
      {
        weight: match.artifact.weight,
        style: match.artifact.style,
        subset: match.artifact.subset,
        variable: match.artifact.variable,
      },
    );
    if (match.matchedByAlias) handleReplace(missing.familyName, match.artifact.familyName);
  };

  if (browsingFont) {
    return (
      <FontBrowserDialog
        open
        onClose={() => {
          setBrowsingFont(null);
          setShowDialog(true);
        }}
        onSelect={(family) => {
          handleReplace(browsingFont.familyName, family);
          setBrowsingFont(null);
        }}
      />
    );
  }

  if (!showDialog || missingFonts.length === 0) return null;

  return (
    <MissingFontDialog
      missingFonts={missingFonts}
      recoveryMatches={recoveryMatches}
      downloadRestrictionMessage={
        isCapabilityRestricted('onlineFonts') ? RESTRICTION_MESSAGES.onlineFonts : undefined
      }
      onReplace={handleReplace}
      onReplaceAll={handleReplaceAll}
      onInstallFontsource={handleInstallFontsource}
      onBrowseCatalog={setBrowsingFont}
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
