// COMPLEXITY: 30 — State interface definition + factory; low complexity.

import { defaultViewState } from './pure';
import type { ContentSearchMatch } from './searchIndex';
import type {
  ActivityEvent,
  Asset,
  AssetFolder,
  Branch,
  Collection,
  CollectionEntry,
  FileEntry,
  FileTag,
  Folder,
  HomeViewState,
  Library,
  Permission,
  Project,
  ProjectTemplate,
  RecentFileRecord,
  SavedSearch,
  Tag,
  TemplateLibrary,
  ThumbnailRecord,
  VersionEntry,
  Workspace,
} from './types';

export interface MemoryState {
  files: Map<string, { entry: FileEntry; json: string }>;
  projects: Map<string, Project>;
  thumbnails: Map<string, ThumbnailRecord>;
  view: HomeViewState;
  recentFiles: Map<string, RecentFileRecord>;
  folders: Map<string, Folder>;
  collections: Map<string, Collection>;
  collectionEntries: Map<string, CollectionEntry[]>;
  workspaces: Map<string, Workspace>;
  libraries: Map<string, Library>;
  templates: Map<string, TemplateLibrary>;
  projectTemplates: Map<string, ProjectTemplate>;
  assets: Map<string, Asset>;
  assetBytes: Map<string, Uint8Array>;
  assetFolders: Map<string, AssetFolder>;
  versions: Map<string, VersionEntry[]>;
  /** Content-addressed document store: hash → JSON string (dedup across versions). */
  versionContent: Map<string, string>;
  branches: Map<string, Branch[]>;
  permissions: Map<string, Permission[]>;
  activity: ActivityEvent[];
  tags: Map<string, Tag>;
  fileTags: Map<string, FileTag[]>;
  savedSearches: Map<string, SavedSearch>;
  /** Separate maps for associations not on the entity types. */
  fileFolderIds: Map<string, string | null>;
  assetFolderIds: Map<string, string | null>;
  projectWorkspaceIds: Map<string, string>;
  /** Cached content search index per file id to avoid re-indexing. */
  contentIndexCache: Map<string, Map<string, ContentSearchMatch>>;
  appSettings: Map<string, string>;
}

export function freshState(): MemoryState {
  return {
    files: new Map(),
    projects: new Map(),
    thumbnails: new Map(),
    view: defaultViewState(),
    recentFiles: new Map(),
    folders: new Map(),
    collections: new Map(),
    collectionEntries: new Map(),
    workspaces: new Map(),
    libraries: new Map(),
    templates: new Map(),
    projectTemplates: new Map(),
    assets: new Map(),
    assetBytes: new Map(),
    assetFolders: new Map(),
    versions: new Map(),
    versionContent: new Map(),
    branches: new Map(),
    permissions: new Map(),
    activity: [],
    tags: new Map(),
    fileTags: new Map(),
    savedSearches: new Map(),
    fileFolderIds: new Map(),
    assetFolderIds: new Map(),
    projectWorkspaceIds: new Map(),
    contentIndexCache: new Map(),
    appSettings: new Map(),
  };
}

export interface MemoryPlatformOptions {
  /** Seed files/projects for demos/tests. */
  files?: Array<{ entry: FileEntry; json: string }>;
  projects?: Project[];
  folders?: Folder[];
  collections?: Collection[];
  workspaces?: Workspace[];
  libraries?: Library[];
  templates?: TemplateLibrary[];
  projectTemplates?: ProjectTemplate[];
  assets?: Asset[];
  assetFolders?: AssetFolder[];
  /** Initial view state (merged over defaults). */
  view?: Partial<HomeViewState>;
}
