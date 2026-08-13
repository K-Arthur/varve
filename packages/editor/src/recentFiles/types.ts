export type FileLocator =
  | { kind: 'path'; path: string }
  | { kind: 'fsHandle'; handleKey: string }
  | { kind: 'opfs'; id: string }
  | { kind: 'remote'; url: string }
  /** A record in the platform recent-file store (SQLite on desktop,
   *  IndexedDB on web); the document is read back by its library id. */
  | { kind: 'library' };

export interface RecentEntry {
  id: string;
  label: string;
  locator: FileLocator;
  lastOpenedAt: number;
  thumbnailKey?: string;
  pinned?: boolean;
}

export const SCHEMA_KEY = 'recentFiles.v1';
export const MAX_ENTRIES = 15;
export const IDB_NAME = 'varve-recent-handles';
export const LEGACY_IDB_NAME = 'strata-recent-handles';
export const IDB_STORE = 'handles';
export const STORAGE_EVENT_KEY = 'recentFiles.v1';
