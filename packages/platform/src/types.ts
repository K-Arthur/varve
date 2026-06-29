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
}

/** A user-created collection that groups files. */
export interface Project {
  id: string;
  name: string;
  /** Optional accent hex (resolved against tokens at render time). */
  color?: string;
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

export type SortKey = 'updated' | 'opened' | 'name' | 'created' | 'size';
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

export type ViewMode = 'grid' | 'list';

/** Which sidebar collection is currently shown. */
export type SidebarSection = 'recent' | 'all' | 'project' | 'templates' | 'trash';

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
}

/** Persisted Home view state — restored verbatim on launch. */
export interface HomeViewState {
  section: SidebarSection;
  /** Active project when section === 'project'; null otherwise. */
  activeProjectId: string | null;
  view: ViewMode;
  sort: SortState;
  filter: FilterState;
  sidebarCollapsed: boolean;
}

/** Dimensions + color metadata for a new document. */
export type Unit = 'px' | 'pt' | 'in' | 'mm';
export type ColorMode = 'rgb' | 'cmyk';

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
