import { type Platform, upsertPreservingMeta } from '@strata/platform';
import { createDocument, type Document, DocumentCodec, validateDocument } from '@strata/scene';
import type { Viewport } from '@strata/shared';
import { useCallback } from 'react';
import type { RecoveryManager } from '../recovery';
import type { EditorState } from './types';

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
    patch({ document: createDocument('Untitled', true), selection: [] });
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
        await upsertPreservingMeta(platform, meta.fileId, meta.name, json);
      } else {
        return await saveAsImpl(platform, stateRef, recoveryRef, patch);
      }
      await recoveryRef.current?.deleteSession(s.activeId);
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
        resetUndo();
        const name = meta?.name ?? doc.name;
        const filePath = meta?.filePath;
        const sessions = state.sessions.map((s) =>
          s.id === state.activeId ? { ...s, name, filePath, dirty: false } : s,
        );
        const vp: Viewport =
          typeof window !== 'undefined'
            ? { width: window.innerWidth, height: window.innerHeight - 120 }
            : { width: 1200, height: 700 };
        const cam = computeFitAllCamera(doc, vp);
        patch({
          document: doc,
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
