import { getFontRegistry } from '@varve/engine';
import {
  buildDocumentFontManifest,
  FontCatalog,
  resolveManifestAgainstCatalog,
} from '@varve/engine/font';
import { type Platform, upsertPreservingMeta } from '@varve/platform';
import {
  createDocument,
  createNewDocument,
  type Document,
  DocumentCodec,
  validateDocument,
} from '@varve/scene';
import type { Viewport } from '@varve/shared';
import { useCallback } from 'react';
import type { RecoveryManager } from '../recovery';
import { persistProjectThumbnail } from '../thumbnail/thumbnailManager';
import type { EditorState } from './types';
import { getCanvasViewport } from './viewportOps';

// Canonical empty-document fallback (never fails; guard keeps TS narrow).
const EMPTY_DOCUMENT_FACTORY = (): Document => createDocument('Untitled', true);

export interface PersistenceAPI {
  newDocument: () => void;
  serializeDocument: () => string;
  save: () => Promise<boolean>;
  saveAs: () => Promise<boolean>;
  loadDocument: (json: string, meta?: { name?: string; filePath?: string }) => void;
}

export function usePersistence(
  state: EditorState,
  patch: (partial: Partial<EditorState>) => void,
  stateRef: React.MutableRefObject<EditorState>,
  platform: Platform | undefined,
  snapshotSession: () => void,
  resetUndo: () => void,
  recoveryRef: React.MutableRefObject<RecoveryManager | null>,
  // The document format has no saved camera, so opening a file whose content
  // lives far from world origin needs an explicit fit-to-content fallback —
  // shares the exact same "Fit all" computation used elsewhere, passed in
  // rather than duplicated (it depends on walkNodes/nodeWorldBounds/
  // fitBoundsCamera already imported in context.tsx).
  computeFitAllCamera: (
    doc: Document,
    viewport: Viewport,
  ) => { zoom: number; pan: { x: number; y: number } } | null,
): PersistenceAPI {
  const newDocument = useCallback(() => {
    snapshotSession();
    resetUndo();
    // Canonical creation service: an empty, infinite-canvas (flat, page-less)
    // document — no default page geometry, no initial frame.
    const created = createNewDocument({});
    patch({
      document: created.ok ? created.result.document : EMPTY_DOCUMENT_FACTORY(),
      selection: [],
    });
  }, [patch, snapshotSession, resetUndo]);

  const serializeDocument = useCallback(() => {
    return DocumentCodec.encode(stateRef.current.document);
  }, [stateRef]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!platform) {
      patch({ saveState: 'error' });
      return false;
    }
    patch({ saveState: 'saving' });
    try {
      const s = stateRef.current;
      const meta = s.sessions.find((sess) => sess.id === s.activeId);
      const json = DocumentCodec.encode(s.document);
      if (meta?.fileId) {
        // App-store copy (recents, thumbnails, home screen) — always kept.
        await upsertPreservingMeta(platform, meta.fileId, meta.name, json);
        // Figma/Photoshop behavior: a document opened from disk saves back
        // to its original path. When the runtime supports path writes,
        // keep the external file in sync too; unsupported runtimes (web)
        // fall back to the picker inside writeDocumentToPath.
        if (meta.filePath) {
          const written = await platform.writeDocumentToPath(meta.filePath, json);
          if (!written) {
            // The user cancelled the picker fallback — still keep the app
            // store copy, but surface the save as cancelled.
            return false;
          }
        }
      } else {
        return await saveAsImpl(platform, stateRef, recoveryRef, patch);
      }
      await recoveryRef.current?.deleteSession(s.activeId);
      // Non-blocking thumbnail persistence after save (falls back to
      // automatic document overview when no preference is set).
      void persistProjectThumbnail(platform, s.document).catch(() => undefined);
      patch({
        dirty: false,
        saveState: 'saved',
        lastSavedAt: Date.now(),
        sessions: s.sessions.map((sess) =>
          sess.id === s.activeId ? { ...sess, dirty: false } : sess,
        ),
      });
      return true;
    } catch {
      patch({ saveState: 'error' });
      return false;
    }
  }, [platform, stateRef, recoveryRef, patch]);

  const saveAs = useCallback(async (): Promise<boolean> => {
    return saveAsImpl(platform, stateRef, recoveryRef, patch);
  }, [platform, stateRef, recoveryRef, patch]);

  const loadDocument = useCallback(
    (json: string, meta?: { name?: string; filePath?: string }) => {
      try {
        const decoded = DocumentCodec.decode(json);
        if (!decoded.ok) throw new Error(decoded.error);
        const doc = decoded.document;
        const result = validateDocument(doc);
        if (!result.valid && typeof console !== 'undefined') {
          console.warn('[Strata] loadDocument: validation warnings:', result.errors);
        }
        const resolvedDoc = resolveFontManifest(doc);
        resetUndo();
        const name = meta?.name ?? doc.name;
        const filePath = meta?.filePath;
        const sessions = state.sessions.map((s) =>
          s.id === state.activeId ? { ...s, name, filePath, dirty: false } : s,
        );
        const cam = computeFitAllCamera(resolvedDoc, getCanvasViewport());
        patch({
          document: resolvedDoc,
          selection: [],
          sessions,
          dirty: false,
          ...(cam ? { zoom: cam.zoom, pan: cam.pan } : {}),
        });
      } catch {
        // invalid JSON — ignore silently
      }
    },
    [patch, resetUndo, state.sessions, state.activeId, computeFitAllCamera],
  );

  return { newDocument, serializeDocument, save, saveAs, loadDocument };
}

/**
 * Re-resolve a document's font manifest against the current device's font catalog.
 *
 * If the document already has a font manifest, its entries are re-resolved
 * against the locally available fonts (handles cross-device opening). If the
 * document has no manifest (legacy pre-v2.9), a new one is built from scratch.
 *
 * Returns the document with an updated `fontManifest` field.
 */
function resolveFontManifest(doc: Document): Document {
  if (hasTextNodes(doc) === false) {
    return doc;
  }

  const catalog = buildCatalogFromRegistry();

  if (doc.fontManifest) {
    const resolved = resolveManifestAgainstCatalog(doc.fontManifest, catalog);
    return { ...doc, fontManifest: resolved };
  }

  const manifest = buildDocumentFontManifest(
    { nodes: doc.nodes, styles: doc.styles } as Parameters<typeof buildDocumentFontManifest>[0],
    catalog,
  );
  return { ...doc, fontManifest: manifest };
}

/** Check if a document contains any text nodes that reference fonts. */
function hasTextNodes(doc: Document): boolean {
  for (const node of Object.values(doc.nodes)) {
    if (node.kind === 'text' && node.fontFamily) {
      return true;
    }
  }
  return false;
}

/**
 * Build a FontCatalog from the current FontRegistry for manifest resolution.
 */
function buildCatalogFromRegistry(): FontCatalog {
  const catalog = new FontCatalog();
  const registry = getFontRegistry();

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

  return catalog;
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

export async function saveAsImpl(
  platform: Platform | undefined,
  stateRef: React.MutableRefObject<EditorState>,
  recoveryRef: React.MutableRefObject<RecoveryManager | null>,
  patch: (partial: Partial<EditorState>) => void,
): Promise<boolean> {
  if (!platform) {
    patch({ saveState: 'error' });
    return false;
  }
  patch({ saveState: 'saving' });
  try {
    const s = stateRef.current;
    const meta = s.sessions.find((sess) => sess.id === s.activeId);
    const json = DocumentCodec.encode(s.document);
    const filePath = await platform.saveDocumentToDisk(meta?.name ?? 'Untitled', json);
    if (filePath) {
      await recoveryRef.current?.deleteSession(s.activeId);
      // Non-blocking thumbnail persistence after save-as
      void persistProjectThumbnail(platform, s.document).catch(() => undefined);
      const fileId = crypto.randomUUID();
      patch({
        dirty: false,
        saveState: 'saved',
        lastSavedAt: Date.now(),
        sessions: s.sessions.map((sess) =>
          sess.id === s.activeId ? { ...sess, dirty: false, filePath, fileId } : sess,
        ),
      });
      return true;
    }
    patch({ saveState: 'idle' });
    return false;
  } catch {
    patch({ saveState: 'error' });
    return false;
  }
}
