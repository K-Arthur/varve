import { getFontRegistry } from '@varve/engine';
import {
  buildDocumentFontManifest,
  FontCatalog,
  resolveManifestAgainstCatalog,
} from '@varve/engine/font';
import { contentHash, type Platform, upsertPreservingMeta } from '@varve/platform';
import { type Document, DocumentCodec, validateDocument } from '@varve/scene';
import type { Viewport } from '@varve/shared';
import { useCallback } from 'react';
import type { RecoveryManager } from '../recovery';
import { persistProjectThumbnail } from '../thumbnail/thumbnailManager';
// LoadDocumentMeta lives in ./types alongside SessionMeta/SessionFileMeta:
// types.ts is the leaf of this package's type graph, and declaring it here
// would make types.ts depend back on this module (import cycle).
import type { EditorState, LoadDocumentMeta, SessionFileMeta } from './types';
import { getCanvasViewport } from './viewportOps';

export type { LoadDocumentMeta };

export interface PersistenceAPI {
  serializeDocument: () => string;
  save: () => Promise<boolean>;
  saveAs: () => Promise<boolean>;
  loadDocument: (json: string, meta?: LoadDocumentMeta) => void;
}

export function usePersistence(
  state: EditorState,
  patch: (partial: Partial<EditorState>) => void,
  stateRef: React.MutableRefObject<EditorState>,
  platform: Platform | undefined,
  resetUndo: () => void,
  /** Session mechanics stay in the editor context; persistence only asks for
   *  a new tab when a caller explicitly wants one (backup "restore a copy"). */
  openInNewSession: (doc: Document, meta?: SessionFileMeta) => void,
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
      // A session bound only to a path (opened from Recent, or from disk)
      // already has a home on disk — mint its app-store id on first save
      // instead of falling back to a Save As prompt.
      const fileId = meta?.fileId ?? (meta?.filePath ? crypto.randomUUID() : undefined);
      if (meta && fileId) {
        // App-store copy (recents, thumbnails, home screen) — always kept.
        await upsertPreservingMeta(platform, fileId, meta.name, json);
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
      // Non-blocking thumbnail persistence after save. Encrypted sessions
      // never write plaintext pixels — only the encrypted placeholder.
      if (meta?.encrypted) {
        void persistEncryptedThumbnail(platform, json);
      } else {
        void persistFileThumbnail(platform, fileId, s.document).catch(() => undefined);
      }
      patch({
        dirty: false,
        saveState: 'saved',
        lastSavedAt: Date.now(),
        sessions: s.sessions.map((sess) =>
          sess.id === s.activeId ? { ...sess, dirty: false, fileId } : sess,
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
    (json: string, meta?: LoadDocumentMeta) => {
      try {
        const decoded = DocumentCodec.decode(json);
        if (!decoded.ok) throw new Error(decoded.error);
        const doc = decoded.document;
        const result = validateDocument(doc);
        if (!result.valid && typeof console !== 'undefined') {
          console.warn('[Strata] loadDocument: validation warnings:', result.errors);
        }
        const resolvedDoc = resolveFontManifest(doc);
        const name = meta?.name ?? doc.name;

        if (meta?.newSession) {
          openInNewSession(resolvedDoc, { name, filePath: meta.filePath, fileId: meta.fileId });
          return;
        }

        resetUndo();
        const active = state.sessions.find((s) => s.id === state.activeId);
        // Rebind the tab to the incoming file unless the caller is replacing
        // the content of the file the tab already holds. Never merge the two:
        // a half-inherited identity is what makes save() write the wrong file.
        const identity: SessionFileMeta = meta?.keepIdentity
          ? { filePath: active?.filePath, fileId: active?.fileId }
          : { filePath: meta?.filePath, fileId: meta?.fileId };
        const sessions = state.sessions.map((s) =>
          s.id === state.activeId ? { ...s, ...identity, name, dirty: false } : s,
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
    [patch, resetUndo, state.sessions, state.activeId, computeFitAllCamera, openInNewSession],
  );

  return { serializeDocument, save, saveAs, loadDocument };
}

/**
 * Re-resolve a document's font manifest against the current device's font
 * catalog. Exported so every path that brings a document in from outside —
 * loadDocument and the editor context's openFile — resolves fonts the same
 * way; a document opened on a different machine otherwise keeps the authoring
 * machine's unresolved manifest.
 *
 *
 * If the document already has a font manifest, its entries are re-resolved
 * against the locally available fonts (handles cross-device opening). If the
 * document has no manifest (legacy pre-v2.9), a new one is built from scratch.
 *
 * Returns the document with an updated `fontManifest` field.
 */
export function resolveFontManifest(doc: Document): Document {
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
      const fileId = crypto.randomUUID();
      // Non-blocking thumbnail persistence after save-as
      persistProjectThumbnail(platform, s.document, { fileId });
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

/**
 * Generate + persist the file's canonical thumbnail after a save, honoring
 * the user's persisted source preference (read back from the platform index
 * so the editor and Home always agree on the source).
 */
async function persistFileThumbnail(
  platform: Platform,
  fileId: string,
  document: Document,
): Promise<void> {
  const entry = await platform.getFile(fileId);
  await persistProjectThumbnail(platform, document, {
    fileId,
    preference: entry?.thumbnailPreference,
  });
}

/**
 * Encrypted-session thumbnail policy: remove any plaintext preview for this
 * document and store only the content-free encrypted placeholder.
 */
async function persistEncryptedThumbnail(platform: Platform, documentJson: string): Promise<void> {
  try {
    const { clearProjectPreviewData, createEncryptedThumbnailRecord } = await import(
      '../thumbnail/encryptedThumbnailPolicy'
    );
    const hash = contentHash(documentJson);
    await clearProjectPreviewData(platform, hash);
    await platform.putThumbnail(createEncryptedThumbnailRecord(hash));
  } catch {
    // Best-effort: placeholder write failure is non-fatal.
  }
}
