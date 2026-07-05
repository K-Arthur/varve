/**
 * @strata/platform — types shared by every Platform implementation.
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

/** Dimensions + color metadata for a new document. */
export type Unit = 'px' | 'pt' | 'in' | 'mm' | 'cm' | 'pc';
export type ColorMode = 'rgb' | 'cmyk' | 'grayscale';

export interface NewDocPreset {
  id: string;
  name: string;
  category: 'blank' | 'device' | 'print' | 'social' | 'ui-kit';
  width: number;
  height: number;
  unit: Unit;
  colorMode: ColorMode;
  /** Print bleed in the preset's unit. */
  bleed?: number;
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
}

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
export type VersionKind = 'checkpoint' | 'named' | 'auto';

export interface VersionEntry {
  id: string;
  fileId: string;
  name?: string;
  description?: string;
  documentHash: string;
  timestamp: number;
  kind: VersionKind;
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
