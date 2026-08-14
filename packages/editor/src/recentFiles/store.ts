import { migrateLegacyIndexedDb } from '@varve/platform';
import type { FileLocator, RecentEntry } from './types';
import { IDB_NAME, IDB_STORE, LEGACY_IDB_NAME, MAX_ENTRIES, SCHEMA_KEY } from './types';

let handleDbMigrated = false;

async function ensureHandleDbMigrated(): Promise<void> {
  if (handleDbMigrated) return;
  handleDbMigrated = true;
  await migrateLegacyIndexedDb(LEGACY_IDB_NAME, IDB_NAME, [IDB_STORE]);
}

const changeListeners = new Set<() => void>();

export function subscribeToChanges(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

function notifyChanges(): void {
  changeListeners.forEach((fn) => {
    fn();
  });
}

function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function hashLocator(locator: FileLocator): string {
  switch (locator.kind) {
    case 'path':
      return hashString(locator.path.toLowerCase().replace(/\/$/, ''));
    case 'fsHandle':
      return hashString(`handle:${locator.handleKey}`);
    case 'opfs':
      return hashString(`opfs:${locator.id}`);
    case 'remote':
      return hashString(`remote:${locator.url}`);
    case 'library':
      // Platform-backed recents are identified by library id, not by a
      // locator; they never enter the legacy store.
      return hashString('library');
  }
}

const BIDI_CLEAN = /[\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069]/g;

export function sanitizeLabel(label: string): string {
  return label.replace(BIDI_CLEAN, '');
}

export function labelWithFallback(label: string, maxLen = 80): string {
  const clean = sanitizeLabel(label);
  if (clean.length <= maxLen) return clean;
  return (
    clean.slice(0, Math.floor(maxLen / 2) - 1) +
    '\u2026' +
    clean.slice(clean.length - Math.floor(maxLen / 2) + 2)
  );
}

function normalizePathForDedup(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();
}

export function computeEntryId(locator: FileLocator): string {
  if (locator.kind === 'path') {
    return hashString(`path:${normalizePathForDedup(locator.path)}`);
  }
  return hashLocator(locator);
}

// ── In-memory fallback when localStorage is unavailable ──
let inMemory: RecentEntry[] | null = null;

function readFromStorage(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(SCHEMA_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
      console.warn('[recentFiles] corrupt schema, resetting');
      return [];
    }

    if (typeof parsed.version === 'number' && parsed.version > 1) {
      console.warn('[recentFiles] newer schema version, resetting');
      return [];
    }

    const entries: RecentEntry[] = [];
    for (const e of parsed.entries) {
      if (
        e &&
        typeof e.id === 'string' &&
        typeof e.label === 'string' &&
        e.locator?.kind &&
        typeof e.lastOpenedAt === 'number'
      ) {
        entries.push(e as RecentEntry);
      }
    }
    return entries;
  } catch (err) {
    console.warn('[recentFiles] failed to read from localStorage', err);
    return [];
  }
}

function writeToStorage(entries: RecentEntry[]): boolean {
  try {
    const pruned = applyQuota(entries);
    localStorage.setItem(SCHEMA_KEY, JSON.stringify({ version: 1, entries: pruned }));
    return true;
  } catch (err) {
    console.warn('[recentFiles] failed to write to localStorage', err);
    return false;
  }
}

function applyQuota(entries: RecentEntry[]): RecentEntry[] {
  if (entries.length <= MAX_ENTRIES) return entries;

  const pinned = entries.filter((e) => e.pinned);
  const unpinned = entries.filter((e) => !e.pinned).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  const keep = unpinned.slice(0, MAX_ENTRIES - pinned.length);
  return [...pinned, ...keep].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

// ── IndexedDB for FileSystemFileHandle objects ──

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      void ensureHandleDbMigrated().then(() => resolve(db));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function storeHandle(key: string, handle: FileSystemFileHandle): Promise<void> {
  try {
    const db = await openHandleDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(handle, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (err) {
    console.warn('[recentFiles] failed to store handle in IDB', err);
  }
}

export async function loadHandle(key: string): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openHandleDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => {
        db.close();
        resolve(req.result ?? null);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  } catch {
    return null;
  }
}

// ── Public API ──

export function loadEntries(): RecentEntry[] {
  if (inMemory) return [...inMemory];
  const entries = readFromStorage().sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  if (entries.length === 0 && localStorage && !localStorage.getItem(SCHEMA_KEY)) {
    inMemory = null;
  }
  return entries;
}

export function saveEntries(entries: RecentEntry[]): RecentEntry[] {
  const sorted = [...entries].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  const pruned = applyQuota(sorted);
  const ok = writeToStorage(pruned);
  if (!ok) {
    inMemory = [...pruned];
  } else {
    inMemory = null;
  }
  notifyChanges();
  return pruned;
}

export function addEntry(
  entries: RecentEntry[],
  entry: Omit<RecentEntry, 'id' | 'lastOpenedAt'> & { id?: string },
): RecentEntry[] {
  const id = entry.id ?? computeEntryId(entry.locator);
  const now = Date.now();
  const existing = entries.findIndex((e) => e.id === id);

  const newEntry: RecentEntry = {
    id,
    label: sanitizeLabel(entry.label),
    locator: entry.locator,
    lastOpenedAt: now,
    thumbnailKey: entry.thumbnailKey,
    pinned: entry.pinned,
  };

  let updated: RecentEntry[];
  if (existing >= 0) {
    updated = [...entries];
    updated[existing] = { ...updated[existing], ...newEntry, lastOpenedAt: now };
  } else {
    updated = [newEntry, ...entries];
  }

  return saveEntries(updated);
}

export function removeEntry(entries: RecentEntry[], id: string): RecentEntry[] {
  return saveEntries(entries.filter((e) => e.id !== id));
}

export function clearEntries(): RecentEntry[] {
  saveEntries([]);
  return [];
}

export function togglePinEntry(entries: RecentEntry[], id: string): RecentEntry[] {
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) return entries;
  const updated = [...entries];
  updated[idx] = { ...updated[idx]!, pinned: !updated[idx]!.pinned };
  return saveEntries(updated);
}

export function updateEntryLocator(
  entries: RecentEntry[],
  id: string,
  locator: FileLocator,
): RecentEntry[] {
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) return entries;
  const updated = [...entries];
  updated[idx] = { ...updated[idx]!, locator };
  return saveEntries(updated);
}
