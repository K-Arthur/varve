/**
 * @strata/platform — the Platform interface.
 *
 * One surface for local-first persistence + native OS integration. Implemented
 * by `createMemoryPlatform` (tests/demo), `createWebPlatform` (IndexedDB +
 * File System Access API + Blob fallbacks), and `createTauriPlatform`
 * (Tauri IPC into SQLite + native dialogs + opener plugin).
 *
 * Design rule: every method is async and side-effectful; the Home surface
 * never touches IndexedDB / Tauri directly. This is what lets the same React
 * tree run in a browser, in a Tauri webview, and under Vitest.
 */
import type { FileEntry, HomeViewState, OpenFileResult, Project, ThumbnailRecord } from './types';

export interface Platform {
  /** Identifies the active implementation ('web' | 'tauri' | 'memory'). */
  readonly kind: 'web' | 'tauri' | 'memory';

  // ─── Files ───────────────────────────────────────────────────────────────
  /** All live (non-trashed) files. */
  listFiles(): Promise<FileEntry[]>;
  /** All soft-deleted files (Trash view). */
  listTrashedFiles(): Promise<FileEntry[]>;
  /** One file by id, regardless of trashed state. */
  getFile(id: string): Promise<FileEntry | undefined>;
  /** Read the serialized document JSON; undefined if missing. */
  readFile(id: string): Promise<string | undefined>;
  /** Create or replace a file and its document JSON. */
  upsertFile(entry: FileEntry, documentJson: string): Promise<void>;
  /** Mark a file opened now (or at the given epoch ms). */
  touchFile(id: string, openedAt?: number): Promise<void>;
  /** Rename a file. */
  renameFile(id: string, name: string): Promise<void>;
  /** Toggle the pinned flag. */
  setPinned(id: string, pinned: boolean): Promise<void>;
  /** Move a file into a project (or Unfiled with null). */
  moveToProject(id: string, projectId: string | null): Promise<void>;
  /** Soft-delete (move to Trash, recoverable). */
  trashFile(id: string): Promise<void>;
  /** Restore a trashed file. */
  restoreFile(id: string): Promise<void>;
  /** Permanently delete a file and its document JSON. */
  purgeFile(id: string): Promise<void>;

  // ─── Projects ────────────────────────────────────────────────────────────
  listProjects(): Promise<Project[]>;
  createProject(name: string): Promise<Project>;
  renameProject(id: string, name: string): Promise<void>;
  /** Delete a project; its members become Unfiled (projectId = null). */
  deleteProject(id: string): Promise<void>;
  setProjectPinned(id: string, pinned: boolean): Promise<void>;

  // ─── Thumbnails ──────────────────────────────────────────────────────────
  /** Cached data URL for a content hash, or undefined. */
  getThumbnail(hash: string): Promise<string | undefined>;
  /** Store a rendered thumbnail. */
  putThumbnail(record: ThumbnailRecord): Promise<void>;
  /** Evict oldest thumbnails until at most `keepCount` remain; returns evicted count. */
  evictThumbnails(keepCount: number): Promise<number>;

  // ─── View state ──────────────────────────────────────────────────────────
  getViewState(): Promise<HomeViewState>;
  setViewState(state: HomeViewState): Promise<void>;

  // ─── Native dialogs / OS integration ─────────────────────────────────────
  /** Open a `.strata` document via the OS file picker. Null if cancelled. */
  openDocumentFromDisk(): Promise<OpenFileResult | null>;
  /**
   * Import a foreign design file (.fig / .AI / image). Returns null if
   * cancelled or the format is unsupported. Implementations surface a clear
   * reason via the second element when unsupported.
   */
  importDocumentFromDisk(
    extensions: string[],
  ): Promise<{ result: OpenFileResult | null; unsupported: boolean }>;
  /** Save a document to disk via the OS save dialog; returns the path or null. */
  saveDocumentToDisk(name: string, documentJson: string): Promise<string | null>;
  /**
   * Save a binary file (PDF, PNG, SVG, etc.) via the OS save dialog.
   * Returns the chosen path, or null if cancelled.
   */
  saveBinaryFile(name: string, data: Uint8Array, mimeType: string, extension: string): Promise<string | null>;
  /** Reveal a path in the OS file manager. */
  revealInFileManager(path: string): Promise<void>;
  /** Platform-appropriate verb for the "reveal" action ("Reveal in Finder", etc.). */
  fileManagerLabel(): string;
}
