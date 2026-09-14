/**
 * MissingFontController — detects missing fonts in the document and renders
 * the MissingFontDialog for resolution.
 *
 * Watches the document for changes, runs FontResolver.detectMissing() against
 * the FontCatalog, and surfaces the dialog when unresolved fonts are found.
 * Replacement actions mutate the document via the editor's updateNode.
 */

import { getFontRegistry } from '@varve/engine';
import type { MissingFontInfo, ResolverDocument } from '@varve/engine/font';
import {
  createFontCatalogFromRegistry,
  type FontCatalog,
  FontResolver,
  getFontsourceCatalog,
  releaseDocumentFonts,
} from '@varve/engine/font';
import type { Document } from '@varve/scene';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isCapabilityRestricted, RESTRICTION_MESSAGES } from '../../capabilities/restrictions';
import { useEditor } from '../../context';

import { applyFontReplacement } from './applyFontReplacement';
import { FontBrowserDialog } from './FontBrowserDialog';
import { MissingFontDialog } from './MissingFontDialog';
import type { MissingFontRecoveryMatch } from './missingFontRecovery';
import {
  findMissingFontRecoveryMatch,
  missingFontRecoveryKey,
  recoveryRequiresReplacement,
} from './missingFontRecovery';
import { downloadAndApplyOnlineFont } from './useOnlineFontSearch';

/** Keep the resolver projection aligned with the document's authoritative text sources. */
export function toFontResolverDocument(doc: Document): ResolverDocument {
  return {
    nodes: doc.nodes,
    styles: doc.styles,
    stories: doc.stories,
  } as unknown as ResolverDocument;
}

export function MissingFontController() {
  const editor = useEditor();
  const [missingFonts, setMissingFonts] = useState<MissingFontInfo[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [browsingFont, setBrowsingFont] = useState<MissingFontInfo | null>(null);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const dismissedKeyRef = useRef('');
  const catalogRef = useRef<FontCatalog | null>(null);
  const resolverRef = useRef<FontResolver | null>(null);

  // Project-scoped font bytes follow the document lifetime. The editor emits
  // this event only after a close is accepted and no second tab references the
  // same document, so shared faces remain available to other open documents.
  useEffect(() => {
    const handleDocumentClosed = (event: Event) => {
      const detail = (event as CustomEvent<{ documentId?: unknown }>).detail;
      if (typeof detail?.documentId !== 'string' || detail.documentId.length === 0) return;
      void releaseDocumentFonts(detail.documentId);
    };
    window.addEventListener('varve:document-fonts-closed', handleDocumentClosed);
    return () => window.removeEventListener('varve:document-fonts-closed', handleDocumentClosed);
  }, []);

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
    const missing = resolverRef.current.detectMissing(
      toFontResolverDocument(doc),
      catalogRef.current,
    );
    setMissingFonts(missing);
  }, [editor.state.document, catalogRevision]);

  const hasMissing = useMemo(() => missingFonts.length > 0, [missingFonts]);

  const missingKey = useMemo(
    () => missingFonts.map(missingFontRecoveryKey).sort().join('\u0000'),
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
      applyFontReplacement(doc, catalogRef.current!, {
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
        const replacement = map.get(missingFontRecoveryKey(missing));
        if (!replacement) continue;
        next = applyFontReplacement(next, catalogRef.current!, {
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
        return match ? ([[missingFontRecoveryKey(missing), match]] as const) : [];
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
        documentId: editor.state.document.id,
      },
    );
    if (recoveryRequiresReplacement(missing, match)) {
      handleReplace(missing.familyName, match.artifact.familyName, missing);
    }
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
