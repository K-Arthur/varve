/**
 * @varve/platform — web save-target implementation (leaf module).
 *
 * Kept out of web.ts because web.ts is already over its cyclomatic
 * complexity ceiling; the whole save-target flow (File System Access API
 * handle persistence, permission handling, download fallback) lives here.
 *
 * A browser file handle is the web equivalent of a desktop path. Handles are
 * stored in local platform metadata (IndexedDB) keyed by an opaque handleId
 * so the editor's session stores an ID, never the handle object and never a
 * fake path. Handles are origin-scoped and permission-gated by the browser.
 */
import { type IDBPDatabase, openDB } from 'idb';
import { normalizeSaveFileName, uuid, withDocumentExt } from './pure';
import type { DocumentSaveTargetChoice, SaveError, SaveTarget, WriteSaveResult } from './types';

/** Save dialog filter: new documents produce the canonical format only.
 *  Legacy .strata files still open/import; they are not offered as an equal
 *  new-document output format. */
const VARVE_SAVE_ACCEPT = [
  {
    description: 'Varve document',
    accept: { 'application/json': ['.varve'] },
  },
];

const HANDLE_DB_NAME = 'varve-handles';
const HANDLE_DB_VERSION = 1;
const STORE_HANDLES = 'handles';

interface HandleRecord {
  handleId: string;
  handle: FileSystemFileHandle;
  name: string;
}

interface WindowWithFsAccess {
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
}

/** FileSystemFileHandle with the permission surface TS lib.dom omits. */
interface PermissionedFileHandle extends FileSystemFileHandle {
  queryPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

function getWindow(): (Window & WindowWithFsAccess) | undefined {
  return typeof window !== 'undefined' ? (window as Window & WindowWithFsAccess) : undefined;
}

async function openHandleDb(): Promise<IDBPDatabase> {
  return openDB(HANDLE_DB_NAME, HANDLE_DB_VERSION, {
    upgrade(db) {
      db.createObjectStore(STORE_HANDLES, { keyPath: 'handleId' });
    },
  });
}

async function storeSaveHandle(handle: FileSystemFileHandle, name: string): Promise<string> {
  const handleId = uuid();
  const db = await openHandleDb();
  try {
    await db.put(STORE_HANDLES, { handleId, handle, name } satisfies HandleRecord);
  } finally {
    db.close();
  }
  return handleId;
}

async function loadSaveHandle(handleId: string): Promise<FileSystemFileHandle | undefined> {
  const db = await openHandleDb();
  try {
    const record = (await db.get(STORE_HANDLES, handleId)) as HandleRecord | undefined;
    return record?.handle;
  } finally {
    db.close();
  }
}

/** Trigger a browser snapshot download. Never reported as a persistent path. */
function triggerDownload(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function writeToSaveHandle(handleId: string, contents: string): Promise<WriteSaveResult> {
  let handle: FileSystemFileHandle | undefined;
  try {
    handle = await loadSaveHandle(handleId);
  } catch {
    return {
      kind: 'failed',
      error: {
        category: 'permission-expired',
        message: "Could not read this file's saved permission. Use Save As to pick it again.",
      },
    };
  }
  if (!handle) {
    return {
      kind: 'failed',
      error: {
        category: 'permission-expired',
        message: "This file's saved handle is no longer available. Use Save As to pick it again.",
      },
    };
  }
  try {
    let permission = await (handle as PermissionedFileHandle).queryPermission({
      mode: 'readwrite',
    });
    if (permission === 'prompt') {
      // Permission re-request needs a user gesture; autosave-driven writes
      // that fail here surface as permission-expired rather than a lie.
      permission = await (handle as PermissionedFileHandle)
        .requestPermission({ mode: 'readwrite' })
        .catch(() => 'denied' as PermissionState);
    }
    if (permission !== 'granted') {
      return {
        kind: 'permission-denied',
        error: {
          category: 'permission-denied',
          message:
            'The browser no longer allows writing to this file. Grant access or use Save As.',
        },
      };
    }
    const writable = await handle.createWritable();
    await writable.write(contents);
    await writable.close();
    return { kind: 'written' };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const lower = message.toLowerCase();
    const category: SaveError['category'] = /notallowed|denied/i.test(lower)
      ? 'permission-denied'
      : /quota|exceeded/i.test(lower)
        ? 'quota-exceeded'
        : /notfound|gone/i.test(lower)
          ? 'destination-missing'
          : 'unknown-io';
    return { kind: 'failed', error: { category, message } };
  }
}

/** Ask the user where to save (File System Access API or download fallback). */
export async function chooseWebSaveTarget(
  suggestedName: string,
): Promise<DocumentSaveTargetChoice> {
  const w = getWindow();
  const suggested = normalizeSaveFileName(suggestedName);
  if (w?.showSaveFilePicker) {
    let handle: FileSystemFileHandle | undefined;
    try {
      handle = await w.showSaveFilePicker({
        suggestedName: suggested,
        types: VARVE_SAVE_ACCEPT,
      });
    } catch {
      // AbortError (user dismissed the picker) and other picker failures all
      // mean "no destination chosen" — never an error state.
      return { kind: 'cancelled' };
    }
    if (!handle) return { kind: 'cancelled' };
    let handleId: string;
    try {
      handleId = await storeSaveHandle(handle, handle.name);
    } catch {
      return {
        kind: 'failed',
        error: {
          category: 'quota-exceeded',
          message: 'Could not remember this file for future saves (browser storage full).',
        },
      };
    }
    return {
      kind: 'target',
      target: { kind: 'web-file-handle', handleId, displayName: handle.name },
    };
  }
  // No File System Access API: "saving" is a snapshot download, never a
  // persistent writable path. Choosing the target simply records that; the
  // download itself happens on writeWebSaveTarget (which has the bytes).
  return {
    kind: 'target',
    target: { kind: 'download-only', suggestedName: withDocumentExt(suggested) },
  };
}

/** Write bytes to an already-resolved web save target. */
export async function writeWebSaveTarget(
  target: SaveTarget,
  contents: string,
): Promise<WriteSaveResult> {
  switch (target.kind) {
    case 'web-file-handle':
      return writeToSaveHandle(target.handleId, contents);
    case 'download-only':
      triggerDownload(target.suggestedName, contents);
      return { kind: 'written' };
    default:
      return {
        kind: 'failed',
        error: {
          category: 'unsupported',
          message: 'This browser cannot write to that location.',
        },
      };
  }
}
