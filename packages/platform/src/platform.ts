/**
 * @varve/platform — the Platform interface.
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
import type {
  ActivityEvent,
  Asset,
  AssetFolder,
  Branch,
  Collection,
  CreateVersionInput,
  DocumentReadResult,
  DocumentSaveTargetChoice,
  FileEntry,
  Folder,
  HomeViewState,
  Library,
  OpenFileResult,
  Permission,
  Project,
  ProjectTemplate,
  RecentFilePatch,
  RecentFileRecord,
  SavedSearch,
  SaveTarget,
  Tag,
  TemplateLibrary,
  ThumbnailRecord,
  ThumbnailSourcePreference,
  VersionEntry,
  VersionStats,
  Workspace,
  WriteSaveResult,
} from './types';

export interface Platform {
  /** Identifies the active implementation ('web' | 'tauri' | 'memory'). */
  readonly kind: 'web' | 'tauri' | 'memory';

  // ─── Files ───────────────────────────────────────────────────────────────
  listFiles(): Promise<FileEntry[]>;
  listTrashedFiles(): Promise<FileEntry[]>;
  getFile(id: string): Promise<FileEntry | undefined>;
  readFile(id: string): Promise<string | undefined>;
  upsertFile(entry: FileEntry, documentJson: string): Promise<void>;
  touchFile(id: string, openedAt?: number): Promise<void>;
  renameFile(id: string, name: string): Promise<void>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  setFavorited(id: string, favoritedAt: number | null): Promise<void>;
  moveToProject(id: string, projectId: string | null): Promise<void>;
  trashFile(id: string): Promise<void>;
  restoreFile(id: string): Promise<void>;
  purgeFile(id: string): Promise<void>;

  // ─── Recent Files ───────────────────────────────────────────────────────
  /** List all recent-file records (ordered by lastOpenedAt DESC). */
  listRecentFiles(): Promise<RecentFileRecord[]>;
  /**
   * Create or update a recent-file record when a file is opened.
   * If the record already exists, updates lastOpenedAt, opensCount, name,
   * and optional workspaceMode. Returns the updated record.
   */
  touchRecentFile(
    id: string,
    name: string,
    sourceWorkspaceId?: string,
    contentHash?: string,
  ): Promise<RecentFileRecord>;
  /**
   * Update editable fields on a recent-file record (pin, hide, tag, name).
   * Silent no-op when the record doesn't exist.
   */
  patchRecentFile(id: string, patch: RecentFilePatch): Promise<void>;
  /** Remove a single entry from recent-file records. */
  removeRecentFile(id: string): Promise<void>;
  /** Clear ALL recent-file records. */
  clearRecentHistory(): Promise<void>;

  // ─── Projects ────────────────────────────────────────────────────────────
  listProjects(): Promise<Project[]>;
  createProject(name: string): Promise<Project>;
  renameProject(id: string, name: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  setProjectPinned(id: string, pinned: boolean): Promise<void>;

  // ─── Phase 1: Drafts ─────────────────────────────────────────────────────
  listDrafts(): Promise<FileEntry[]>;
  moveFileToDrafts(id: string): Promise<void>;
  promoteFromDrafts(id: string, projectId: string): Promise<void>;

  // ─── Phase 2: Folders ────────────────────────────────────────────────────
  listFolders(projectId: string): Promise<Folder[]>;
  createFolder(projectId: string, name: string, parentId?: string): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<void>;
  deleteFolder(id: string): Promise<void>;
  moveFileToFolder(fileId: string, folderId: string | null): Promise<void>;
  reorderFolder(id: string, ordering: string): Promise<void>;

  // ─── Phase 2: Collections ────────────────────────────────────────────────
  listCollections(): Promise<Collection[]>;
  createCollection(name: string, opts?: Partial<Collection>): Promise<Collection>;
  updateCollection(id: string, patch: Partial<Collection>): Promise<void>;
  deleteCollection(id: string): Promise<void>;
  addFileToCollection(collectionId: string, fileId: string): Promise<void>;
  removeFileFromCollection(collectionId: string, fileId: string): Promise<void>;
  listCollectionFiles(collectionId: string): Promise<FileEntry[]>;
  reorderCollection(id: string, ordering: string): Promise<void>;

  // ─── Phase 3: Workspaces ─────────────────────────────────────────────────
  listWorkspaces(): Promise<Workspace[]>;
  createWorkspace(name: string, kind?: 'personal' | 'team'): Promise<Workspace>;
  renameWorkspace(id: string, name: string): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;
  moveProjectToWorkspace(projectId: string, workspaceId: string): Promise<void>;

  // ─── Phase 3: Shared Libraries ───────────────────────────────────────────
  listLibraries(workspaceId: string): Promise<Library[]>;
  createLibrary(workspaceId: string, name: string, kind?: Library['kind']): Promise<Library>;
  enableLibrary(id: string, enabled: boolean): Promise<void>;
  deleteLibrary(id: string): Promise<void>;

  // ─── Phase 4: Content-Aware Search ───────────────────────────────────────
  searchFileContent(fileId: string, query: string): Promise<string[]>;

  // ─── Phase 5: Templates ──────────────────────────────────────────────────
  listTemplates(source?: string[]): Promise<TemplateLibrary[]>;
  createTemplateFromFile(fileId: string, name: string, category: string): Promise<TemplateLibrary>;
  deleteTemplate(id: string): Promise<void>;
  searchTemplates(query: string): Promise<TemplateLibrary[]>;
  listProjectTemplates(): Promise<ProjectTemplate[]>;
  createProjectFromTemplate(templateId: string, name: string): Promise<void>;

  // ─── Phase 6: Assets ─────────────────────────────────────────────────────
  listAssets(workspaceId: string, folderId?: string): Promise<Asset[]>;
  importAsset(
    workspaceId: string,
    name: string,
    data: Uint8Array,
    mimeType: string,
  ): Promise<Asset>;
  deleteAsset(id: string): Promise<void>;
  /**
   * Read the stored source bytes of an imported asset (used by the semantic
   * indexer to derive embeddings). Returns null when the platform does not
   * retain asset bytes (e.g. native backends without asset commands).
   */
  getAssetBytes(id: string): Promise<Uint8Array | null>;
  searchAssets(query: string): Promise<Asset[]>;
  createAssetFolder(workspaceId: string, name: string, parentId?: string): Promise<AssetFolder>;
  deleteAssetFolder(id: string): Promise<void>;

  // ─── Phase 7: Version History ────────────────────────────────────────────
  listVersions(fileId: string): Promise<VersionEntry[]>;
  saveVersion(fileId: string, name: string, description?: string): Promise<VersionEntry>;
  restoreVersion(fileId: string, versionId: string): Promise<string>;
  deleteVersionInfo(versionId: string): Promise<void>;
  /**
   * Create a full version with content-addressed document storage.
   * The document JSON is stored keyed by its content hash so identical
   * content across versions shares one copy (dedup).
   */
  createVersion(input: CreateVersionInput): Promise<VersionEntry>;
  /** Restore a version's full document JSON by version id. */
  restoreVersionById(versionId: string): Promise<string>;
  /** Rename / describe a version. */
  renameVersion(versionId: string, name?: string, description?: string): Promise<void>;
  /** Update a version's thumbnail data URL after async generation. */
  updateVersionThumbnail(versionId: string, thumbnail: string | undefined): Promise<void>;
  /** Pin (protect from prune) or unpin a version. */
  pinVersion(versionId: string, pinned: boolean): Promise<void>;
  /**
   * Prune auto/checkpoint versions beyond `maxAuto`, preserving named and
   * pinned. Returns the number of versions removed.
   */
  pruneVersions(fileId: string, maxAuto: number): Promise<number>;
  /** Stats for the version-history UI. */
  getVersionStats(fileId: string): Promise<VersionStats>;
  listBranches(fileId: string): Promise<Branch[]>;
  createBranch(fileId: string, name: string, baseVersionId?: string): Promise<Branch>;

  // ─── Phase 8: Collaboration Foundation ───────────────────────────────────
  listPermissions(fileId: string): Promise<Permission[]>;
  setPermission(fileId: string, role: Permission['role'], email?: string): Promise<void>;
  listActivity(workspaceId: string, limit?: number): Promise<ActivityEvent[]>;
  recordActivity(event: Omit<ActivityEvent, 'id' | 'timestamp'>): Promise<void>;

  // ─── Phase 9: Tags & Metadata ─────────────────────────────────────────────
  listTags(workspaceId: string): Promise<Tag[]>;
  createTag(workspaceId: string, name: string, color?: string): Promise<Tag>;
  renameTag(id: string, name: string): Promise<void>;
  deleteTag(id: string): Promise<void>;
  listFileTags(fileId: string): Promise<Tag[]>;
  addFileTag(fileId: string, tagId: string): Promise<void>;
  removeFileTag(fileId: string, tagId: string): Promise<void>;
  listFilesByTag(tagId: string): Promise<FileEntry[]>;

  // ─── Phase 9: Saved Searches ──────────────────────────────────────────────
  listSavedSearches(): Promise<SavedSearch[]>;
  createSavedSearch(
    name: string,
    query: string,
    kinds?: string[],
    tagIds?: string[],
  ): Promise<SavedSearch>;
  deleteSavedSearch(id: string): Promise<void>;

  // ─── Search ───────────────────────────────────────────────────────────────
  searchFiles(query: string): Promise<FileEntry[]>;

  // ─── Reorder ───────────────────────────────────────────────────────────────
  reorderFile(id: string, ordering: string): Promise<void>;

  // ─── File watcher ──────────────────────────────────────────────────────────
  listenForChanges(callback: () => void): Promise<() => void>;

  // ─── Native file drag-and-drop ──────────────────────────────────────────
  // On Linux, OS file drops don't reach the page as HTML5 `dragover`/`drop`
  // DOM events: when `dragDropEnabled` is true (the default — it IS read;
  // it gates the handler installed at tauri-runtime-wry lib.rs
  // `drag_drop_handler_enabled`), wry hooks GTK's drag signals on the
  // WebView widget (wry webkitgtk/drag_drop.rs `connect_drag_event`) and
  // forwards them as `tauri://drag-*` window events instead. Setting
  // `dragDropEnabled: false` does NOT restore HTML5 file drops in
  // WebKitGTK — it just silences the tauri events too, leaving no drop
  // path at all. So the config must stay `true` and this bridge is how
  // Linux desktop receives OS file drops. Web/memory platforms are no-ops
  // here since real HTML5 DnD already works there.
  onNativeFileDrop(handler: (event: NativeFileDropEvent) => void): Promise<() => void>;
  /** Read a file's raw bytes from an absolute OS path (e.g. from a native file drop). */
  readFileBytes(path: string): Promise<Uint8Array>;

  // ─── File existence ───────────────────────────────────────────────────────
  fileExists(path: string): Promise<boolean>;
  /**
   * Batch existence probe for missing-file sweeps. One IPC round-trip for
   * the whole Home library instead of one probe per file. Per-path invalid
   * input reports `false` (never found).
   */
  checkFilesExist(paths: string[]): Promise<boolean[]>;

  // ─── Thumbnails ──────────────────────────────────────────────────────────
  /**
   * Persist the user's thumbnail source preference for a file. Lives on the
   * FileEntry (app metadata), so it survives restarts and is preserved
   * across saves without touching the document bytes. Silent no-op when the
   * file does not exist.
   */
  setThumbnailPreference(fileId: string, preference: ThumbnailSourcePreference): Promise<void>;
  getThumbnail(hash: string): Promise<string | undefined>;
  putThumbnail(record: ThumbnailRecord): Promise<void>;
  deleteThumbnail(hash: string): Promise<void>;
  evictThumbnails(keepCount: number): Promise<number>;

  // ─── View state ──────────────────────────────────────────────────────────
  getViewState(): Promise<HomeViewState>;
  setViewState(state: HomeViewState): Promise<void>;

  // ─── App settings (small persisted flags, e.g. onboarding-complete) ──────
  // Backed by native storage (SQLite on desktop, IndexedDB on web) rather
  // than raw localStorage, which is not guaranteed to survive between
  // separate app launches in every WebView implementation.
  getAppSetting(key: string): Promise<string | null>;
  setAppSetting(key: string, value: string): Promise<void>;

  // ─── Native dialogs / OS integration ─────────────────────────────────────
  openDocumentFromDisk(): Promise<OpenFileResult | null>;
  /** Open a document by absolute path (OS file-association intake: "Open
   *  With" hands the app a path instead of a user pick). Unsupported
   *  runtimes (web/memory) return null. */
  openDocumentFromPath(path: string): Promise<OpenFileResult | null>;
  importDocumentFromDisk(
    extensions: string[],
  ): Promise<{ result: OpenFileResult | null; unsupported: boolean }>;
  /**
   * Ask the user where to save a document (File → Save As / first Save).
   * The dialog is always native. The returned target is only ever a
   * *candidate* — nothing is written and no session state changes until
   * `writeSaveTarget` succeeds on it.
   *
   * Deprecated in favour of `chooseDocumentSaveTarget` + `writeSaveTarget`
   * (which separate "choose" from "write" so repeated Save can reuse a
   * target); kept for compatibility — returns the chosen path on success
   * and null when the picker was cancelled or the write failed.
   */
  saveDocumentToDisk(name: string, documentJson: string): Promise<string | null>;
  /**
   * Write a document back to an existing path (File → Save for files opened
   * from disk). Returns the path on success, null when the runtime cannot
   * write that path or the write failed.
   *
   * Deprecated in favour of `writeSaveTarget`; kept for compatibility.
   */
  writeDocumentToPath(path: string, documentJson: string): Promise<string | null>;
  /**
   * Open the native save dialog for a NEW document destination. Does not
   * write anything. The editor owns all state changes: the returned target
   * becomes the session's target only after a successful `writeSaveTarget`.
   */
  chooseDocumentSaveTarget(suggestedName: string): Promise<DocumentSaveTargetChoice>;
  /** Write `contents` to an already-resolved save target. */
  writeSaveTarget(target: SaveTarget, contents: string): Promise<WriteSaveResult>;
  /** Read the current bytes of an external file target, for external-change
   *  detection before overwriting. The result distinguishes a missing path
   *  from a path that exists but cannot be read (permission, IO), so a save
   *  never misreports a permission error as a vanished destination. */
  readDocumentText(path: string): Promise<DocumentReadResult>;
  saveBinaryFile(
    name: string,
    data: Uint8Array,
    mimeType: string,
    extension: string,
  ): Promise<string | null>;
  /** Choose one directory for a multi-file export. Unsupported runtimes return null. */
  chooseExportFolder(): Promise<string | null>;
  /** Atomically write a safe relative export path under a previously chosen folder. */
  writeBinaryFileToFolder(folder: string, relativePath: string, data: Uint8Array): Promise<string>;
  revealInFileManager(path: string): Promise<void>;
  fileManagerLabel(): string;

  // ─── Native clipboard ──────────────────────────────────────────────────────
  // Reads an image off the OS clipboard directly (native Rust, not the
  // browser's Web Clipboard API). Last-resort fallback for platforms/webviews
  // where `navigator.clipboard.read()` and the DOM `paste` event both fail to
  // surface image data (notably WebKitGTK on Wayland). Returns null if the
  // clipboard has no image or the platform doesn't support this.
  readClipboardImage(): Promise<Uint8Array | null>;

  // ─── Native OS Print ──────────────────────────────────────────────────────
  /** List available printers on the system. */
  listPrinters(): Promise<PrinterInfo[]>;
  /** Send a PDF document to a printer. */
  printPdf(data: Uint8Array, jobTitle: string, options: PrintJobOptions): Promise<PrintJobResult>;
  /** Cancel a previously submitted print job. */
  cancelPrintJob(printerName: string, jobId: number): Promise<string>;
}

/** A native OS file drag-and-drop event, as reported by Tauri's window-level
 *  drag-drop events. `position` is in logical (CSS) pixels, window-relative —
 *  the same coordinate space as a DOM `MouseEvent`'s `clientX`/`clientY`. */
export type NativeFileDropEvent =
  | { type: 'enter'; paths: string[]; position: { x: number; y: number } }
  | { type: 'over'; position: { x: number; y: number } }
  | { type: 'drop'; paths: string[]; position: { x: number; y: number } }
  | { type: 'leave' };

/** Information about an available printer. */
export interface PrinterInfo {
  name: string;
  description: string;
  isColor: boolean;
  paperSizes: string[];
  supportsDuplex: boolean;
  acceptingJobs: boolean;
}

/** Options for a print job. */
export interface PrintJobOptions {
  printerName: string;
  copies?: number;
  duplex?: boolean;
  colorMode?: 'color' | 'grayscale';
  pageSize?: string;
}

/** Result of submitting a print job. */
export interface PrintJobResult {
  jobId: number;
  message: string;
  success: boolean;
}
