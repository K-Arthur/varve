/**
 * @varve/platform — types shared by every Platform implementation.
 *
 * Research basis: the "Local-First Software" essay (Kleppmann et al., 2019)
 * — the application's state lives on the user's device first; remote sync is
 * layered on later (Strata plan §3.2). The interface is deliberately
 * backend-agnostic so the same Home surface runs in a browser (IndexedDB +
 * File System Access API), on desktop (Tauri + SQLite + native dialogs), or
 * in tests (in-memory). Nothing here may assume a particular transport.
 */

/** The kind of file, derived from its extension. Drives badges + filters. */
export type FileKind = 'strata' | 'figma' | 'illustrator' | 'image' | 'unknown';

// ─── Editor workspace modes (shared with the editor package for relevance) ──
/**
 * Canonical editor workspace modes. A project may be relevant to one or more.
 * Mirrors `packages/editor/src/workspace/workspaceTypes.ts`.
 */
export type EditorWorkspaceMode = 'design' | 'print' | 'drawing' | 'image' | 'motion' | 'codegen';

// ─── Recent-File Record (v1) ───────────────────────────────────────────────
/** Maximum number of recent-file records kept. */
export const MAX_RECENT_FILES = 100;

/**
 * Versioned metadata record for a recently opened project.
 *
 * Design rules:
 *   - `id` is the canonical project identity (the FileEntry.id), NOT the file
 *     path. File paths can change (rename / move); the ID is stable across
 *     Save As, folder moves, and workspace reassignment.
 *   - `name` is a snapshot taken at open time. It is never used as identity.
 *   - `hidden` suppresses the entry from the Recent view without deleting it.
 *   - `workspaceRelevance` is derived from document-feature analysis and
 *     manual user tags. Never inferred from filename or extension alone.
 *   - `encrypted` is set once and never cleared by the recent-files system.
 *   - `missing` is set asynchronously by a bounded background check.
 *   - `sourceWorkspaceId` records the platform workspace active when the
 *     project was last opened, for workspace-scoped filtering.
 */
export interface RecentFileRecord {
  /** Stable project/document UUID (matches FileEntry.id). */
  id: string;
  /** Display name snapshot at last-open time. */
  name: string;
  /** Epoch ms of the most recent open. Sorted descending. */
  lastOpenedAt: number;
  /** Cumulative open count (for "most opened" sorting). */
  openedCount: number;
  /** User-pinned to the top of the Recent list. */
  pinned: boolean;
  /** User-hidden from the Recent view. */
  hidden: boolean;
  /** Detected workspace affinities (editor mode, not platform workspace). */
  workspaceRelevance: EditorWorkspaceMode[];
  /** User-assigned workspace tag. Takes precedence over inferred relevance. */
  userWorkspaceTag: EditorWorkspaceMode | null;
  /** True when the file is encrypted/locked (no thumbnail or content shown). */
  encrypted: boolean;
  /** True when the file is no longer accessible on disk. */
  missing: boolean;
  /** Format version of this record for safe migration. */
  version: number;
  /** Platform workspace ID active when last opened (for workspace-scoped filtering). */
  sourceWorkspaceId?: string;
  /** Content hash at last open (for stale detection). */
  contentHash?: string;
}

/** Editable fields on a RecentFileRecord (subset that users can override). */
export interface RecentFilePatch {
  pinned?: boolean;
  hidden?: boolean;
  userWorkspaceTag?: EditorWorkspaceMode | null;
  name?: string;
  /** True when the file is no longer reachable at its recorded location. */
  missing?: boolean;
}

/** Filter config for recent-file workspace filtering. */
export interface RecentWorkspaceFilter {
  mode: 'all' | 'relevant' | 'pinned' | 'workspace-tagged';
  editorMode?: EditorWorkspaceMode;
  projectCapability?: EditorWorkspaceMode;
}

/** A pointer to a design document in the local index. */
export interface FileEntry {
  /** Stable unique id (uuid). */
  id: string;
  /** Display name without extension. */
  name: string;
  /** Format of the underlying file. */
  kind: FileKind;
  /** Owning project id, or null for "Unfiled". */
  projectId: string | null;
  /** Epoch ms of creation. */
  createdAt: number;
  /** Epoch ms of last save. */
  updatedAt: number;
  /** Epoch ms of last open; 0 when never opened (drives the Recents list). */
  openedAt: number;
  /** Serialized byte size (for display + sort). */
  size: number;
  /** Pinned to the top of lists. */
  pinned: boolean;
  /** Epoch ms when soft-deleted (moved to Trash), or null when live. */
  trashedAt: number | null;
  /** Absolute path on disk (desktop). Undefined when app-managed (web). */
  filePath?: string;
  /** Ordering key for drag-and-drop reorder (fractional-indexing, empty string = not set). */
  ordering: string;
  /** Content hash; used as the thumbnail-cache key and invalidation signal. */
  contentHash: string;
  /** True if the file no longer exists on disk (desktop only). */
  isMissing?: boolean;
  /** Epoch ms when the file was favorited/bookmarked; 0 or undefined when not favorited. */
  favoritedAt?: number;
  /** User preference for thumbnail source (undefined = automatic document overview). */
  thumbnailPreference?: ThumbnailSourcePreference;
}

/** A user-created collection that groups files. */
export interface Project {
  id: string;
  name: string;
  /** Optional accent hex (resolved against tokens at render time). */
  color?: string;
  /** Optional description shown in project header. */
  description?: string;
  /** Workspace this project belongs to. */
  workspaceId?: string;
  /** Lifecycle status for workflow tracking. */
  status?: 'active' | 'archived' | 'draft';
  /** User id of the project owner (future collaboration). */
  ownerId?: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  trashedAt: number | null;
}

/**
 * Source selection for automatic thumbnail generation.
 * Persisted on the FileEntry (app metadata, not document JSON — a thumbnail
 * preference is a property of the user's local index entry, and must not
 * change the document byte-for-byte, which would invalidate every revision
 * hash). `region` is a user-defined rectangular crop in document coordinates.
 */
export type ThumbnailSourcePreference =
  | { type: 'automatic' }
  | { type: 'page'; pageId: string }
  | { type: 'frame'; nodeId: string }
  | { type: 'selection'; nodeIds: string[] }
  | { type: 'region'; region: { x: number; y: number; w: number; h: number } };

/** A cached thumbnail keyed by content hash. */
export interface ThumbnailRecord {
  hash: string;
  /** Data URL (vector SVG or raster PNG). */
  dataUrl: string;
  width: number;
  height: number;
  createdAt: number;
}

export type SortKey = 'updated' | 'opened' | 'name' | 'created' | 'size' | 'ordering';
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

export type ViewMode = 'grid' | 'list';

/** Which sidebar collection is currently shown. */
export type SidebarSection =
  | 'recent'
  | 'all'
  | 'drafts'
  | 'favorites'
  | 'project'
  | 'collections'
  | 'templates'
  | 'trash'
  | 'activity'
  | 'assets'
  | 'versions';

export interface FilterState {
  /** Free-text query (matched against name). Empty = no query. */
  query: string;
  /** Restrict to these file kinds. Empty array = all kinds. */
  kinds: FileKind[];
  /**
   * 'all' = no project filter; a string = restrict to that project;
   * null = only Unfiled files. Mirrors the sidebar's three groupings.
   */
  projectId: string | null | 'all';
  /** Show only pinned items. */
  pinnedOnly: boolean;
  /** Epoch ms lower bound on updatedAt, or null. */
  dateFrom: number | null;
  /** Epoch ms upper bound on updatedAt, or null. */
  dateTo: number | null;
  /** Restrict to files with any of these tag ids. Empty = no tag filter. */
  tagIds: string[];
  /** Recent-files workspace filter. Only applies when section === 'recent'. */
  recentWorkspaceFilter?: RecentWorkspaceFilter;
  /** Show hidden recent entries (admin/debug). */
  showHidden?: boolean;
}

/** Persisted Home view state — restored verbatim on launch. */
export interface HomeViewState {
  section: SidebarSection;
  /** Active project when section === 'project'; null otherwise. */
  activeProjectId: string | null;
  /** Active workspace used to scope files, projects and assets. */
  activeWorkspaceId: string | null;
  view: ViewMode;
  sort: SortState;
  filter: FilterState;
  sidebarCollapsed: boolean;
}

/** A reusable starter document. */
export interface TemplateDef {
  id: string;
  name: string;
  category: string;
  description: string;
  /** Serialized Document JSON to seed a new file from this template. */
  documentJson: string;
  /** Content hash of the seeded document (thumbnail cache key). */
  previewHash: string;
  /** Optional marketplace entitlement id; gated until entitled. */
  entitlementId?: string;
  /** True for templates shipped with the app. */
  builtin?: boolean;
}

/** Result of opening/importing a document from disk. */
export interface OpenFileResult {
  entry: FileEntry;
  documentJson: string;
  /** Absolute path the document was opened from, when the runtime exposes
   *  one (Tauri). Lets File → Save write back to the original location. */
  filePath?: string;
}

// ─── Save destinations (user-controlled persistence) ─────────────────────────
/**
 * Where the current document is written.
 *
 * A document's IDENTITY (FileEntry.id / RecentFileRecord.id) is deliberately
 * separate from its STORAGE LOCATION. Identity survives Save As, folder moves
 * and renames; the save target describes where the bytes go. Recovery and the
 * internal Home index are never save targets — they are implementation
 * details of autosave and metadata, and must not be presented as "Saved".
 *
 * Contract rules:
 *   - `native-file`   — an OS filesystem path the user chose through a native
 *     dialog. Desktop only.
 *   - `web-file-handle` — a browser File System Access API handle persisted
 *     in local platform metadata (IndexedDB). The handleId is platform
 *     internal; only the platform may hold the actual FileSystemFileHandle.
 *   - `app-storage`   — explicitly chosen Varve Library storage. The user
 *     opted into the app-managed location; only then may a library write
 *     mark a document clean.
 *   - `download-only` — no persistent location exists (browser without the
 *     File System Access API). Every "save" produces a snapshot download.
 *     Never reported as a persistent path, never marks a document clean.
 *   - `unsaved`       — the document has never been assigned a destination.
 */
export type SaveTarget =
  | { kind: 'native-file'; path: string }
  | { kind: 'web-file-handle'; handleId: string; displayName: string }
  | { kind: 'app-storage'; fileId: string }
  | { kind: 'download-only'; suggestedName: string }
  | { kind: 'unsaved' };

/** User-actionable category for a save failure. `detail` keeps raw internals
 *  for diagnostics; `message` is safe to show to the user. */
export type SaveErrorCategory =
  | 'permission-denied'
  | 'disk-full'
  | 'read-only'
  | 'destination-missing'
  | 'file-changed-externally'
  | 'serialization-failed'
  | 'filesystem-unavailable'
  | 'permission-expired'
  | 'quota-exceeded'
  | 'unsupported'
  | 'unknown-io';

export interface SaveError {
  category: SaveErrorCategory;
  /** Human-readable, user-actionable message. */
  message: string;
  /** Raw internal detail for diagnostics; not for display or telemetry. */
  detail?: unknown;
}

/** Result of asking the user for a save destination. Cancellation is a
 *  normal outcome and is never reported as an error. */
export type DocumentSaveTargetChoice =
  | { kind: 'target'; target: SaveTarget }
  | { kind: 'cancelled' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; error: SaveError };

/** Result of writing bytes to an already-resolved save target. */
export type WriteSaveResult =
  | { kind: 'written' }
  | { kind: 'permission-denied'; error: SaveError }
  | { kind: 'failed'; error: SaveError };

/** Pre-overwrite read of a document path. `missing` means the path does not
 *  resolve to a file; `unreadable` means it exists but could not be read
 *  (permission, IO, encoding); `unsupported` is used by runtimes without
 *  path-based file access (web, memory). */
export type DocumentReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'missing' | 'unreadable' | 'unsupported'; message?: string };

// ─── Phase 1: Drafts ─────────────────────────────────────────────────────────
/** Sentinel projectId meaning "this file is a draft" (personal sandbox). */
export const DRAFTS_ID = '__drafts__';

// ─── Phase 2: Folders & Collections ──────────────────────────────────────────
/** A folder within a project for organizing files. */
export interface Folder {
  id: string;
  name: string;
  projectId: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  ordering: string;
}

/** A cross-project collection (like a smart playlist). */
export interface Collection {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  filter?: CollectionFilter;
  createdAt: number;
  updatedAt: number;
  ordering: string;
}

export interface CollectionFilter {
  type: 'manual' | 'smart';
  query?: string;
  kinds?: FileKind[];
  projectIds?: string[];
  dateFrom?: number;
  dateTo?: number;
}

export interface CollectionEntry {
  id: string;
  collectionId: string;
  fileId: string;
  addedAt: number;
  note?: string;
}

// ─── Phase 3: Workspaces ─────────────────────────────────────────────────────
export type WorkspaceKind = 'personal' | 'team';

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  kind: WorkspaceKind;
  createdAt: number;
  updatedAt: number;
}

// ─── Phase 3: Shared Libraries ───────────────────────────────────────────────
export type LibraryKind = 'components' | 'styles' | 'assets' | 'mixed';

export interface Library {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  kind: LibraryKind;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// ─── Phase 5: Template Library ───────────────────────────────────────────────
export type TemplateSource = 'builtin' | 'user' | 'workspace' | 'community';

export interface TemplateLibrary {
  id: string;
  name: string;
  description: string;
  category: string;
  previewHash: string;
  source: TemplateSource;
  documentJson: string;
  tags: string[];
  usageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  files: Array<{ name: string; documentJson: string }>;
  folderStructure?: Array<{ name: string; children?: string[] }>;
  previewHash: string;
}

// ─── Phase 6: Asset Management ───────────────────────────────────────────────
export type AssetKind = 'image' | 'icon' | 'font' | 'other';

export interface Asset {
  id: string;
  workspaceId: string;
  name: string;
  kind: AssetKind;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  thumbnailHash?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AssetFolder {
  id: string;
  workspaceId: string;
  name: string;
  parentId: string | null;
  createdAt: number;
}

// ─── Phase 7: Version History & Branching ────────────────────────────────────
export type VersionKind = 'checkpoint' | 'named' | 'auto' | 'manual';

export type VersionOrigin =
  | 'save'
  | 'autosave'
  | 'checkpoint'
  | 'manual'
  | 'import'
  | 'migration'
  | 'sync';

export interface VersionEntry {
  id: string;
  fileId: string;
  name?: string;
  description?: string;
  /** FNV-1a content hash of the stored document JSON (dedup key). */
  documentHash: string;
  timestamp: number;
  kind: VersionKind;
  /** Why this version was created. */
  origin: VersionOrigin;
  /** Byte size of the stored document JSON. */
  size: number;
  /** Schema (document-format) version at capture time. */
  schemaVersion?: string;
  /** Optional base64/data-URI thumbnail preview. */
  thumbnail?: string;
  /** Pinned versions are never pruned. */
  pinned: boolean;
}

export interface CreateVersionInput {
  fileId: string;
  kind: VersionKind;
  name?: string;
  description?: string;
  origin: VersionOrigin;
  documentJson: string;
  contentHash: string;
  size: number;
  schemaVersion?: string;
  thumbnail?: string;
  pinned?: boolean;
}

export interface VersionStats {
  totalVersions: number;
  namedVersions: number;
  totalBytes: number;
}

export interface Branch {
  id: string;
  name: string;
  fileId: string;
  baseVersionId?: string;
  status: 'open' | 'merged' | 'closed';
  createdAt: number;
  updatedAt: number;
}

// ─── Phase 9: Tags & Metadata ─────────────────────────────────────────────────
/** A user-defined tag for categorizing files across projects. */
export interface Tag {
  id: string;
  /** Workspace this tag belongs to. */
  workspaceId: string;
  name: string;
  /** Optional accent hex for visual identification. */
  color?: string;
  createdAt: number;
  updatedAt: number;
}

/** Association between a file and a tag. */
export interface FileTag {
  fileId: string;
  tagId: string;
  addedAt: number;
}

/** Default recent-files workspace filter (show all). */
export const DEFAULT_RECENT_WORKSPACE_FILTER: RecentWorkspaceFilter = {
  mode: 'all',
};

// ─── Recent-file persistence schema version ─────────────────────────────────
export const RECENT_FILE_SCHEMA_VERSION = 1;

/** A saved search that can be recalled from the sidebar. */
export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  kinds?: FileKind[];
  tagIds?: string[];
  createdAt: number;
  updatedAt: number;
}

// ─── Phase 8: Collaboration Foundation ───────────────────────────────────────
export type PermissionRole = 'owner' | 'editor' | 'viewer' | 'commenter';

export interface Permission {
  fileId?: string;
  projectId?: string;
  workspaceId?: string;
  email?: string;
  role: PermissionRole;
  grantedAt: number;
}

export interface ActivityEvent {
  id: string;
  workspaceId: string;
  fileId?: string;
  projectId?: string;
  type: string;
  timestamp: number;
  metadata?: Record<string, string>;
}
