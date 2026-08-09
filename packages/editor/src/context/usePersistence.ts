import { getFontRegistry } from '@varve/engine';
import {
  buildDocumentFontManifest,
  FontCatalog,
  resolveManifestAgainstCatalog,
} from '@varve/engine/font';
import {
  contentHash,
  displayNameFromPath,
  type Platform,
  stripExtension,
  upsertPreservingMeta,
} from '@varve/platform';
import { type Document, DocumentCodec, validateDocument } from '@varve/scene';
import type { Viewport } from '@varve/shared';
import { useCallback, useRef } from 'react';
import { createSaveCoordinator } from '../persistence/saveCoordinator';
import { type SaveIntent, type SaveOutcome, saveTargetFromSession } from '../persistence/saveTypes';
import type { RecoveryManager } from '../recovery';
import { persistProjectThumbnail } from '../thumbnail/thumbnailManager';
// LoadDocumentMeta lives in ./types alongside SessionMeta/SessionFileMeta:
// types.ts is the leaf of this package's type graph, and declaring it here
// would make types.ts depend back on this module (import cycle).
import type { EditorState, LoadDocumentMeta, SaveIssue, SessionFileMeta } from './types';
import { getCanvasViewport } from './viewportOps';

export type { LoadDocumentMeta };

export interface PersistenceAPI {
  serializeDocument: () => string;
  save: () => Promise<boolean>;
  saveAs: () => Promise<boolean>;
  saveCopy: () => Promise<boolean>;
  loadDocument: (json: string, meta?: LoadDocumentMeta) => void;
}

interface SessionUpdate extends SessionFileMeta {}

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

  /**
   * The one save engine. All intents funnel through here, serialized by the
   * coordinator below, so menu Save, keyboard Save, quit Save and Save As can
   * never race each other's writes.
   *
   * Revision safety: the document object is immutable — every mutation
   * produces a new reference. Capturing it before the (possibly slow) write
   * and comparing after is a cheap, exact "did anything change while saving"
   * check: revision N finishing after revision N+1 exists must NOT clear
   * dirty state.
   */
  const runSave = useCallback(
    async (intent: SaveIntent): Promise<SaveOutcome> => {
      if (!platform) {
        patch({
          saveState: 'error',
          saveIssue: issue('unsupported', 'Persistence is unavailable in this mode.'),
        });
        return {
          status: 'failed',
          issue: issue('unsupported', 'Persistence is unavailable in this mode.'),
        };
      }
      const revision = stateRef.current.document;
      // Captured BEFORE the 'saving' patch below: save-copy must restore the
      // previous status, not the transient 'saving' it just set.
      const prevSaveState = stateRef.current.saveState;
      patch({ saveState: 'saving', saveIssue: null });
      try {
        if (intent === 'save-as') {
          return await chooseAndAdopt(
            platform,
            stateRef,
            recoveryRef,
            patch,
            revision,
            stateRef.current.sessions.find((sess) => sess.id === stateRef.current.activeId)?.name,
          );
        }
        if (intent === 'save-copy') {
          const outcome = await performSaveCopy(platform, stateRef, patch, revision);
          patch({ saveState: prevSaveState, saveIssue: null });
          return outcome;
        }
        return await performSave(platform, stateRef, recoveryRef, patch, revision);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        patch({ saveState: 'error', saveIssue: issue('unknown-io', message) });
        return { status: 'failed', issue: issue('unknown-io', message) };
      }
    },
    [platform, stateRef, recoveryRef, patch],
  );

  // Coordinator is created once; runSave only reads stable refs, so the
  // captured closure never goes stale.
  const coordinatorRef = useRef<ReturnType<typeof createSaveCoordinator> | null>(null);
  if (coordinatorRef.current === null) {
    coordinatorRef.current = createSaveCoordinator(runSave);
  }
  const coordinator = coordinatorRef.current;

  const save = useCallback(
    () => coordinator.request('save').then((o) => o.status === 'saved'),
    [coordinator],
  );
  const saveAs = useCallback(
    () => coordinator.request('save-as').then((o) => o.status === 'saved'),
    [coordinator],
  );
  const saveCopy = useCallback(
    () => coordinator.request('save-copy').then((o) => o.status === 'saved-copy'),
    [coordinator],
  );

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
          openInNewSession(resolvedDoc, {
            name,
            filePath: meta.filePath,
            fileId: meta.fileId,
            saveHandleId: meta.saveHandleId,
            saveHandleName: meta.saveHandleName,
            downloadName: meta.downloadName,
            diskContentHash: meta.diskContentHash,
          });
          return;
        }

        resetUndo();
        const active = state.sessions.find((s) => s.id === state.activeId);
        // Rebind the tab to the incoming file unless the caller is replacing
        // the content of the file the tab already holds. Never merge the two:
        // a half-inherited identity is what makes save() write the wrong file.
        const identity: SessionFileMeta = meta?.keepIdentity
          ? {
              filePath: active?.filePath,
              fileId: active?.fileId,
              saveHandleId: active?.saveHandleId,
              saveHandleName: active?.saveHandleName,
            }
          : {
              filePath: meta?.filePath,
              fileId: meta?.fileId,
              saveHandleId: meta?.saveHandleId,
              saveHandleName: meta?.saveHandleName,
              downloadName: meta?.downloadName,
              diskContentHash: meta?.diskContentHash,
            };
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

  return { serializeDocument, save, saveAs, saveCopy, loadDocument };
}

// ─── Save engines ────────────────────────────────────────────────────────────

/** Write to the session's CURRENT destination (or choose one on first save). */
async function performSave(
  platform: Platform,
  stateRef: React.MutableRefObject<EditorState>,
  recoveryRef: React.MutableRefObject<RecoveryManager | null>,
  patch: (partial: Partial<EditorState>) => void,
  revision: Document,
): Promise<SaveOutcome> {
  const s = stateRef.current;
  const meta = s.sessions.find((sess) => sess.id === s.activeId);
  if (!meta) {
    const e = issue('destination-missing', 'No active document to save.');
    patch({ saveState: 'error', saveIssue: e });
    return { status: 'failed', issue: e };
  }
  const target = saveTargetFromSession(meta);
  const json = DocumentCodec.encode(s.document);

  // First save: the user picks a location. Never silently fall into
  // internal storage — recovery may keep running, but the UI may only say
  // "Saved" once the user chose a real destination and the write succeeded.
  if (target.kind === 'unsaved') {
    return chooseAndAdopt(platform, stateRef, recoveryRef, patch, revision, meta.name);
  }

  if (target.kind === 'download-only') {
    // Browser without the File System Access API: every Save produces a
    // fresh snapshot download. A download is not a persistent location, so
    // the document stays dirty and this never reports "saved to a file".
    const written = await platform.writeSaveTarget(target, json);
    if (written.kind !== 'written') return writeFailure(patch, written.error);
    patch({ lastSavedAt: Date.now() });
    return { status: 'saved' };
  }

  if (target.kind === 'native-file') {
    // Safety checks before overwriting: the destination may be gone (USB
    // unplugged) or changed by another app since we last read/wrote it.
    const disk = await platform.readDocumentText(target.path);
    if (disk === undefined) {
      const e = issue(
        'destination-missing',
        'The original location is unavailable. Use Save As to choose a new location. Recovery continues in the background.',
      );
      patch({ saveState: 'error', saveIssue: e });
      return { status: 'failed', issue: e };
    }
    if (meta.diskContentHash && contentHash(disk) !== meta.diskContentHash) {
      const e = issue(
        'file-changed-externally',
        'The file changed on disk since it was opened. Save As to a new location, or use the File menu to decide how to proceed.',
      );
      patch({ saveState: 'error', saveIssue: e });
      return { status: 'failed', issue: e };
    }
    const written = await platform.writeSaveTarget(target, json);
    if (written.kind !== 'written') return writeFailure(patch, written.error);
    // Primary write succeeded. Secondary work (Home mirror, recovery cleanup,
    // thumbnail) must not fail the user's filesystem save.
    const fileId = meta.fileId ?? crypto.randomUUID();
    await mirror(patch, platform, fileId, meta.name, json, { filePath: target.path });
    const update: SessionUpdate = { diskContentHash: contentHash(json), fileId };
    return afterPrimaryWrite(platform, stateRef, recoveryRef, patch, revision, update, meta.name);
  }

  if (target.kind === 'web-file-handle') {
    const written = await platform.writeSaveTarget(target, json);
    if (written.kind !== 'written') return writeFailure(patch, written.error);
    const fileId = meta.fileId ?? crypto.randomUUID();
    await mirror(patch, platform, fileId, meta.name, json);
    const update: SessionUpdate = { fileId };
    return afterPrimaryWrite(platform, stateRef, recoveryRef, patch, revision, update, meta.name);
  }

  // app-storage — the user explicitly chose Varve Library as the document's
  // destination, so a successful library write legitimately marks clean.
  const fileId = meta.fileId ?? target.fileId;
  await mirror(patch, platform, fileId, meta.name, json);
  const update: SessionUpdate = { fileId };
  return afterPrimaryWrite(platform, stateRef, recoveryRef, patch, revision, update, meta.name);
}

/** Save As / first Save: choose a destination, write, adopt only on success. */
async function chooseAndAdopt(
  platform: Platform,
  stateRef: React.MutableRefObject<EditorState>,
  recoveryRef: React.MutableRefObject<RecoveryManager | null>,
  patch: (partial: Partial<EditorState>) => void,
  revision: Document,
  name: string | undefined,
): Promise<SaveOutcome> {
  const choice = await platform.chooseDocumentSaveTarget(name ?? 'Untitled');
  if (choice.kind === 'cancelled') {
    // Cancellation is normal; it must not change anything (no path change,
    // no identity change, no dirty change) and must not look like a failure.
    patch({ saveState: 'idle' });
    return { status: 'cancelled' };
  }
  if (choice.kind === 'unsupported') {
    return writeFailure(patch, {
      category: 'unsupported',
      message: 'Saving to a file is not available in this mode.',
    });
  }
  if (choice.kind === 'failed') return writeFailure(patch, choice.error);

  const target = choice.target;
  const s = stateRef.current;
  const meta = s.sessions.find((sess) => sess.id === s.activeId);
  const json = DocumentCodec.encode(s.document);
  const written = await platform.writeSaveTarget(target, json);
  if (written.kind !== 'written') {
    // The new destination failed — the CURRENT destination stays untouched.
    return writeFailure(patch, written.error);
  }

  const adopted = adoptTarget(meta, target);
  // Identity is stable across Save As: reuse the existing library entry id so
  // version history, recents, projects, tags and recovery keep their history.
  // A fresh UUID is minted only when the document never had one.
  const fileId = meta?.fileId ?? crypto.randomUUID();

  await recoveryRef.current?.deleteSession(s.activeId);
  if (adopted.persistent) {
    await mirror(patch, platform, fileId, adopted.name, json, adopted.mirrorExtra);
  }
  const cur = stateRef.current;
  const clean = cur.document === revision;
  const update: SessionUpdate = { ...adopted.session, fileId, name: adopted.name };
  const sessions = cur.sessions.map((sess) =>
    sess.id === cur.activeId ? { ...sess, ...update, dirty: clean ? false : sess.dirty } : sess,
  );
  patch({
    dirty: clean ? false : cur.dirty,
    saveState: 'saved',
    lastSavedAt: Date.now(),
    saveIssue: null,
    sessions,
  });
  if (clean) {
    void persistProjectThumbnail(platform, cur.document).catch(() => undefined);
  }
  return { status: 'saved' };
}

/** Save a Copy: write elsewhere, never adopt, never touch dirty state. */
async function performSaveCopy(
  platform: Platform,
  stateRef: React.MutableRefObject<EditorState>,
  patch: (partial: Partial<EditorState>) => void,
  revision: Document,
): Promise<SaveOutcome> {
  const s = stateRef.current;
  const meta = s.sessions.find((sess) => sess.id === s.activeId);
  const json = DocumentCodec.encode(s.document);
  const choice = await platform.chooseDocumentSaveTarget(meta?.name ?? 'Untitled');
  if (choice.kind === 'cancelled') {
    patch({ saveState: 'idle' });
    return { status: 'cancelled' };
  }
  if (choice.kind === 'unsupported') {
    return writeFailure(patch, {
      category: 'unsupported',
      message: 'Saving to a file is not available in this mode.',
    });
  }
  if (choice.kind === 'failed') return writeFailure(patch, choice.error);
  const written = await platform.writeSaveTarget(choice.target, json);
  if (written.kind !== 'written') return writeFailure(patch, written.error);
  // Deliberately no session mutation: the active document keeps its own
  // target, name, and dirty state. A successful copy never clears dirty.
  void revision;
  return { status: 'saved-copy' };
}

/**
 * Success bookkeeping after a write to the authoritative destination:
 * recovery cleanup, revision-aware clean marking, thumbnail follow-up.
 */
async function afterPrimaryWrite(
  platform: Platform,
  stateRef: React.MutableRefObject<EditorState>,
  recoveryRef: React.MutableRefObject<RecoveryManager | null>,
  patch: (partial: Partial<EditorState>) => void,
  revision: Document,
  update: SessionUpdate,
  name: string,
): Promise<SaveOutcome> {
  await recoveryRef.current?.deleteSession(stateRef.current.activeId);
  const cur = stateRef.current;
  // Revision-aware clean: if the user edited while the write was in flight,
  // the save covered an older revision — the document stays dirty.
  const clean = cur.document === revision;
  const sessions = cur.sessions.map((sess) =>
    sess.id === cur.activeId
      ? { ...sess, ...update, name, dirty: clean ? false : sess.dirty }
      : sess,
  );
  patch({
    dirty: clean ? false : cur.dirty,
    saveState: 'saved',
    lastSavedAt: Date.now(),
    saveIssue: null,
    sessions,
  });
  if (clean) {
    void persistProjectThumbnail(platform, cur.document).catch(() => undefined);
  }
  return { status: 'saved' };
}

/** Internal Home mirror. Secondary persistence: a mirror failure never fails
 *  the user's primary filesystem save (§58 primary vs secondary). */
async function mirror(
  _patch: (partial: Partial<EditorState>) => void,
  platform: Platform,
  fileId: string,
  name: string,
  json: string,
  extra?: { filePath?: string },
): Promise<void> {
  try {
    await upsertPreservingMeta(platform, fileId, name, json, extra);
  } catch {
    // Home cache/thumbnail index update failed — the primary write already
    // succeeded; log and continue rather than flipping the save to failed.
    if (typeof console !== 'undefined') {
      console.warn('[Varve] internal index mirror failed for', fileId);
    }
  }
}

function writeFailure(
  patch: (partial: Partial<EditorState>) => void,
  error: SaveIssue,
): SaveOutcome {
  patch({ saveState: 'error', saveIssue: error });
  return { status: 'failed', issue: error };
}

function issue(category: SaveIssue['category'], message: string): SaveIssue {
  return { category, message };
}

interface AdoptedTarget {
  /** Session fields to adopt on the active tab. */
  session: SessionUpdate;
  /** Display name derived from the destination. */
  name: string;
  /** Whether the destination should be mirrored into the Home index. */
  persistent: boolean;
  mirrorExtra?: { filePath?: string };
}

function adoptTarget(
  meta: SessionFileMeta | undefined,
  target: ReturnType<typeof saveTargetFromSession>,
): AdoptedTarget {
  // Any real destination choice clears an earlier explicit library choice.
  const base = { libraryStorage: undefined };
  switch (target.kind) {
    case 'native-file':
      return {
        session: {
          ...base,
          filePath: target.path,
          saveHandleId: undefined,
          saveHandleName: undefined,
          downloadName: undefined,
          diskContentHash: undefined,
        },
        name: displayNameFromPath(target.path),
        persistent: true,
        mirrorExtra: { filePath: target.path },
      };
    case 'web-file-handle':
      return {
        session: {
          ...base,
          filePath: undefined,
          saveHandleId: target.handleId,
          saveHandleName: target.displayName,
          downloadName: undefined,
          diskContentHash: undefined,
        },
        name: stripExtension(target.displayName),
        persistent: true,
      };
    case 'download-only':
      return {
        session: {
          ...base,
          filePath: undefined,
          saveHandleId: undefined,
          saveHandleName: undefined,
          downloadName: target.suggestedName,
          diskContentHash: undefined,
        },
        name: stripExtension(target.suggestedName),
        persistent: false,
      };
    default:
      return { session: base, name: meta?.name ?? 'Untitled', persistent: false };
  }
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
