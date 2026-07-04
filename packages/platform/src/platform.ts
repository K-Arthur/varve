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
import type {
  ActivityEvent,
  Asset,
  AssetFolder,
  Branch,
  Collection,
  FileEntry,
  Folder,
  HomeViewState,
  Library,
  OpenFileResult,
  Permission,
  Project,
  ProjectTemplate,
  TemplateLibrary,
  ThumbnailRecord,
  VersionEntry,
  Workspace,
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
  moveToProject(id: string, projectId: string | null): Promise<void>;
  trashFile(id: string): Promise<void>;
  restoreFile(id: string): Promise<void>;
  purgeFile(id: string): Promise<void>;

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
  searchAssets(query: string): Promise<Asset[]>;
  createAssetFolder(workspaceId: string, name: string, parentId?: string): Promise<AssetFolder>;
  deleteAssetFolder(id: string): Promise<void>;

  // ─── Phase 7: Version History ────────────────────────────────────────────
  listVersions(fileId: string): Promise<VersionEntry[]>;
  saveVersion(fileId: string, name: string, description?: string): Promise<VersionEntry>;
  restoreVersion(fileId: string, versionId: string): Promise<string>;
  deleteVersionInfo(versionId: string): Promise<void>;
  listBranches(fileId: string): Promise<Branch[]>;
  createBranch(fileId: string, name: string, baseVersionId?: string): Promise<Branch>;

  // ─── Phase 8: Collaboration Foundation ───────────────────────────────────
  listPermissions(fileId: string): Promise<Permission[]>;
  setPermission(fileId: string, role: Permission['role']): Promise<void>;
  listActivity(workspaceId: string, limit?: number): Promise<ActivityEvent[]>;
  recordActivity(event: Omit<ActivityEvent, 'id' | 'timestamp'>): Promise<void>;

  // ─── Search ───────────────────────────────────────────────────────────────
  searchFiles(query: string): Promise<FileEntry[]>;

  // ─── Reorder ───────────────────────────────────────────────────────────────
  reorderFile(id: string, ordering: string): Promise<void>;

  // ─── File watcher ──────────────────────────────────────────────────────────
  listenForChanges(callback: () => void): Promise<() => void>;

  // ─── File existence ───────────────────────────────────────────────────────
  fileExists(path: string): Promise<boolean>;

  // ─── Thumbnails ──────────────────────────────────────────────────────────
  getThumbnail(hash: string): Promise<string | undefined>;
  putThumbnail(record: ThumbnailRecord): Promise<void>;
  evictThumbnails(keepCount: number): Promise<number>;

  // ─── View state ──────────────────────────────────────────────────────────
  getViewState(): Promise<HomeViewState>;
  setViewState(state: HomeViewState): Promise<void>;

  // ─── Native dialogs / OS integration ─────────────────────────────────────
  openDocumentFromDisk(): Promise<OpenFileResult | null>;
  importDocumentFromDisk(
    extensions: string[],
  ): Promise<{ result: OpenFileResult | null; unsupported: boolean }>;
  saveDocumentToDisk(name: string, documentJson: string): Promise<string | null>;
  saveBinaryFile(
    name: string,
    data: Uint8Array,
    mimeType: string,
    extension: string,
  ): Promise<string | null>;
  revealInFileManager(path: string): Promise<void>;
  fileManagerLabel(): string;
}
