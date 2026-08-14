/**
 * @varve/platform — pure helpers. No I/O; fully unit-testable.
 *
 * Research basis:
 *  - FNV-1a 32-bit hash: fast, dependency-free content fingerprint that
 *    doubles as the thumbnail cache key (Local-First §4 — content-addressed
 *    caches invalidate themselves when the document changes).
 *  - RFC 3986 relative-time formatting adapted from the TC39 `Intl.RelativeTimeFormat`
 *    proposal ("just now" / "5 min ago" / "yesterday"), chosen over a dep.
 *  - File-kind detection by extension mirrors OS file-association tables.
 */
import type {
  EditorWorkspaceMode,
  FileKind,
  FilterState,
  HomeViewState,
  RecentFileRecord,
  RecentWorkspaceFilter,
  SaveError,
  SortDirection,
} from './types';

/** The canonical Varve document extension (no dot). New saves default to
 *  `.varve`; the schema is versioned independently of the extension (see
 *  @varve/scene CURRENT_DOCUMENT_VERSION), so `.strata` files open through
 *  the same migration pipeline. */
export const DOCUMENT_EXT = 'varve';

/** Legacy document extension, still openable and still writable on
 *  explicit Save As for compatibility. */
export const LEGACY_DOCUMENT_EXT = 'strata';

/** All extensions the app treats as native editable documents. */
export const DOCUMENT_EXTS = [DOCUMENT_EXT, LEGACY_DOCUMENT_EXT] as const;

const EXT_TO_KIND: Record<string, FileKind> = {
  // `.varve` and `.strata` are the same editable format — kind stays
  // 'strata' for persisted compatibility (SQLite DEFAULT 'strata').
  varve: 'strata',
  strata: 'strata',
  fig: 'figma',
  ai: 'illustrator',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  svg: 'image',
  gif: 'image',
};

/** User-facing label for a FileKind (shown in badges, ARIA labels, etc.). */
export function fileKindLabel(kind: FileKind): string {
  switch (kind) {
    case 'strata':
      return 'Varve';
    case 'figma':
      return 'Figma';
    case 'illustrator':
      return 'Illustrator';
    case 'image':
      return 'Image';
    default:
      return kind;
  }
}

/** Derive the file kind from a filename. Unknown extensions → 'unknown'. */
export function detectFileKind(filename: string): FileKind {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return 'unknown';
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_TO_KIND[ext] ?? 'unknown';
}

/** Strip the final extension from a filename; returns the name unchanged if none. */
export function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return filename;
  return filename.slice(0, dot);
}

/**
 * Ensure a display name carries the canonical `.varve` extension for a save
 * dialog's default path. Names that already end in a document extension
 * (.varve or .strata) are left untouched — Save As on a legacy file keeps
 * its extension unless the user changes it.
 */
export function withDocumentExt(name: string): string {
  if (/\.(varve|strata)$/i.test(name)) return name;
  return `${name}.${DOCUMENT_EXT}`;
}

/**
 * Make a safe *suggested* save-dialog filename from a display name:
 * strips path separators and control characters (so a session name can never
 * leak a directory into the dialog), trims whitespace, and never stacks a
 * second extension onto an already-extended name.
 */
export function normalizeSaveFileName(name: string): string {
  const cleaned = name
    .split('')
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .replace(/[\\/:]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const base = cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'Untitled';
  return withDocumentExt(base);
}

/** Basename of an OS path, without its final extension ("Poster"). */
export function displayNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const base = parts[parts.length - 1] ?? '';
  return stripExtension(base);
}

/** Directory portion of an OS path, or null when none is derivable. */
export function directoryOfPath(path: string): string | null {
  const sep = path.includes('\\') ? '\\' : '/';
  const trimmed = path.replace(/[\\/]+$/, '');
  const last = trimmed.lastIndexOf(sep);
  if (last < 0) return null;
  const dir = trimmed.slice(0, last);
  return dir.length === 0 ? null : dir;
}

/**
 * Classify a native (Tauri) save-write failure from its error text into a
 * user-actionable SaveErrorCategory. The Tauri IPC layer surfaces the OS
 * error string directly; substring matching keeps the mapping honest
 * without pretending to be locale-aware.
 */
export function classifyTauriSaveError(message: string): SaveError {
  const m = message.toLowerCase();
  let category: SaveError['category'] = 'unknown-io';
  if (/no space left on device|disk full|quota/i.test(m)) category = 'disk-full';
  else if (/permission denied|access is denied|operation not permitted/i.test(m)) {
    category = 'permission-denied';
  } else if (/read-?only|read-only file system/i.test(m)) category = 'read-only';
  else if (/no such file|not found|does not exist/i.test(m)) category = 'destination-missing';
  else if (/not supported|unsupported/i.test(m)) category = 'unsupported';
  return { category, message };
}

/**
 * FNV-1a 32-bit hash of a string. Returned as 8-char hex. Deterministic and
 * fast; collisions are not a correctness risk at editor scale (<1M docs).
 */
export function contentHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // h * 16777619 mod 2^32, keeping it a 32-bit unsigned int.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The default, first-launch Home view state (Recent, grid, updated-desc). */
export function defaultViewState(): HomeViewState {
  return {
    section: 'recent',
    activeProjectId: null,
    activeWorkspaceId: null,
    view: 'grid',
    sort: { key: 'opened', direction: 'desc' },
    filter: {
      query: '',
      kinds: [],
      projectId: 'all',
      pinnedOnly: false,
      dateFrom: null,
      dateTo: null,
      tagIds: [],
    },
    sidebarCollapsed: false,
  };
}

/** Deep-merge a partial view state over the defaults (survives schema growth). */
export function mergeViewState(partial: Partial<HomeViewState> | undefined): HomeViewState {
  const d = defaultViewState();
  if (!partial) return d;
  return {
    section: partial.section ?? d.section,
    activeProjectId: partial.activeProjectId ?? d.activeProjectId,
    activeWorkspaceId: partial.activeWorkspaceId ?? d.activeWorkspaceId,
    view: partial.view ?? d.view,
    sort: { ...d.sort, ...(partial.sort ?? {}) },
    filter: { ...d.filter, ...(partial.filter ?? {}) },
    sidebarCollapsed: partial.sidebarCollapsed ?? d.sidebarCollapsed,
  };
}

/** Toggle a sort direction, or switch sort key (new keys start descending). */
export function toggleSort(
  current: { key: string; direction: SortDirection },
  key: string,
): { key: SortDirection extends never ? never : typeof current.key; direction: SortDirection } {
  if (current.key === key) {
    return {
      key: current.key as never,
      direction: current.direction === 'asc' ? 'desc' : 'asc',
    } as never;
  }
  return { key: key as never, direction: 'desc' } as never;
}

/** An empty filter (no query, no kind/project/date/pinned restrictions). */
export function emptyFilter(): FilterState {
  return {
    query: '',
    kinds: [],
    projectId: 'all',
    pinnedOnly: false,
    dateFrom: null,
    dateTo: null,
    tagIds: [],
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Compact relative-time string ("just now", "5 min ago", "3 days ago").
 * Falls back to an absolute localized date for >7 days. Uses Intl where it
 * matters; the small-integer phrases are hardcoded so they translate cleanly.
 */
export function formatRelativeTime(epochMs: number, now: number = Date.now()): string {
  const diff = now - epochMs;
  if (diff < MIN) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} hr ago`;
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < WEEK) return `${Math.floor(diff / DAY)} days ago`;
  try {
    return new Date(epochMs).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return new Date(epochMs).toISOString().slice(0, 10);
  }
}

/** Absolute timestamp for hover tooltips (locale-aware). */
export function formatAbsoluteTime(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleString();
  } catch {
    return new Date(epochMs).toISOString();
  }
}

/** Human-readable byte size ("4.2 KB", "1.1 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Comparator for a (file | project) field given a sort key + direction. */
export function compareBy(
  key: 'updated' | 'opened' | 'created' | 'size' | 'name' | 'ordering',
  direction: SortDirection,
): (
  a: {
    updatedAt: number;
    openedAt?: number;
    createdAt: number;
    size?: number;
    name: string;
    ordering?: string;
  },
  b: typeof a,
) => number {
  const mul = direction === 'asc' ? 1 : -1;
  return (a, b) => {
    switch (key) {
      case 'name': {
        const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        return cmp * mul;
      }
      case 'opened': {
        const av = a.openedAt ?? 0;
        const bv = b.openedAt ?? 0;
        return (av - bv) * mul;
      }
      case 'created':
        return (a.createdAt - b.createdAt) * mul;
      case 'size': {
        const av = a.size ?? 0;
        const bv = b.size ?? 0;
        return (av - bv) * mul;
      }
      case 'ordering': {
        const ao = a.ordering ?? '';
        const bo = b.ordering ?? '';
        return ao < bo ? -1 * mul : ao > bo ? 1 * mul : 0;
      }
      default:
        return (a.updatedAt - b.updatedAt) * mul;
    }
  };
}

/** Generate a v4-style uuid via crypto when present, else a Math.random fallback. */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * SHA-256 hex digest of arbitrary bytes (content identity for asset
 * deduplication and embedding reuse). Returns null when the platform has
 * no WebCrypto (never blocks import in degraded environments).
 */
export async function contentHashOf(bytes: Uint8Array): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

/** True when a file kind is one of the importable foreign formats. */
export function isImportableKind(kind: FileKind): boolean {
  return kind === 'figma' || kind === 'illustrator' || kind === 'image';
}

// ─── Fuzzy Search ─────────────────────────────────────────────────────────────

/**
 * Trigram-based fuzzy search scoring.
 *
 * Research basis: trigram inverted indexes are cheap to build, compact,
 * and excellent for fuzzy matching on short strings (file names, commands).
 * See: "Fuzzy Search for Low-Latency Desktop Assistants" (2025) —
 * trigram indexes hit sub-10ms candidate retrieval for 10k-100k items.
 *
 * This implementation extracts character trigrams from the query and
 * candidate, then scores by the ratio of shared trigrams to query trigrams.
 * A bonus is added for prefix matches. Typos within one edit distance are
 * tolerated because a typo typically only affects 2-3 trigrams.
 */
export function extractTrigrams(s: string): string[] {
  const trimmed = s.toLowerCase().trim();
  if (trimmed === '') return [];
  const padded = `  ${trimmed} `;
  const trigrams: string[] = [];
  for (let i = 0; i < padded.length - 2; i++) {
    trigrams.push(padded.slice(i, i + 3));
  }
  return trigrams;
}

/**
 * Score a candidate string against a query (0 = no match, 1 = perfect match).
 * Uses trigram overlap ratio with a prefix bonus.
 */
export function fuzzyScore(query: string, candidate: string): number {
  const q = query.toLowerCase().trim();
  const c = candidate.toLowerCase().trim();
  if (q === '' || c === '') return 0;
  if (c.includes(q)) return 1;

  const qTrigrams = new Set(extractTrigrams(q));
  const cTrigrams = new Set(extractTrigrams(c));
  if (qTrigrams.size === 0) return 0;

  let shared = 0;
  for (const t of qTrigrams) {
    if (cTrigrams.has(t)) shared++;
  }

  const overlap = shared / qTrigrams.size;
  const prefixBonus = c.startsWith(q.slice(0, Math.min(q.length, 3))) ? 0.15 : 0;
  return Math.min(1, overlap + prefixBonus);
}

/**
 * Fuzzy-search a list of items, returning items scored above the threshold
 * sorted by descending score.
 */
export function fuzzySearch<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
  threshold = 0.3,
): T[] {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(query, getText(item)) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}

// ─── Smart Collection Evaluation ──────────────────────────────────────────────

import type { Collection, FileEntry } from './types';

// ─── Recent-file helpers ─────────────────────────────────────────────────────

/** Comparator for RecentFileRecord by a sort key + direction. */
export function compareRecentBy(
  key: 'lastOpenedAt' | 'openedCount' | 'name',
  direction: SortDirection,
): (a: RecentFileRecord, b: RecentFileRecord) => number {
  const mul = direction === 'asc' ? 1 : -1;
  return (a, b) => {
    switch (key) {
      case 'name':
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * mul;
      case 'openedCount':
        return (a.openedCount - b.openedCount) * mul;
      default:
        return (a.lastOpenedAt - b.lastOpenedAt) * mul;
    }
  };
}

/**
 * Score a RecentFileRecord's relevance to a workspace mode (0-1).
 * Manual tags take full precedence; inferred relevance counts proportionally.
 */
export function recentRelevanceScore(record: RecentFileRecord, mode: EditorWorkspaceMode): number {
  if (record.userWorkspaceTag === mode) return 1;
  if (record.userWorkspaceTag !== null) return 0;
  return record.workspaceRelevance.includes(mode) ? 0.5 : 0;
}

/**
 * Filter a RecentFileRecord list by a workspace filter config.
 * Returns records matched for the given mode.
 */
export function filterRecentByWorkspace(
  records: RecentFileRecord[],
  filter: RecentWorkspaceFilter | undefined,
  currentEditorMode?: EditorWorkspaceMode,
): RecentFileRecord[] {
  if (!filter || filter.mode === 'all') return records;

  // 'pinned' mode doesn't need an editor mode
  if (filter.mode === 'pinned') {
    return records.filter((r) => r.pinned);
  }

  const mode = filter.editorMode ?? currentEditorMode;
  if (!mode) return records;

  switch (filter.mode) {
    case 'workspace-tagged':
      return records.filter(
        (r) => r.userWorkspaceTag === mode || r.workspaceRelevance.includes(mode),
      );
    default:
      return records.filter(
        (r) =>
          r.userWorkspaceTag === mode ||
          r.workspaceRelevance.includes(mode) ||
          r.workspaceRelevance.length === 0, // unclassified = shown everywhere
      );
  }
}

/** Compute the display sections for the recent-files sidebar count badge. */
export function recentFileSections(records: RecentFileRecord[]): {
  all: number;
  pinned: number;
  relevant: (mode: EditorWorkspaceMode) => number;
  hidden: number;
} {
  return {
    all: records.filter((r) => !r.hidden).length,
    pinned: records.filter((r) => r.pinned && !r.hidden).length,
    relevant: (mode) =>
      records.filter(
        (r) => !r.hidden && (r.userWorkspaceTag === mode || r.workspaceRelevance.includes(mode)),
      ).length,
    hidden: records.filter((r) => r.hidden).length,
  };
}

/**
 * Evaluate a smart collection filter against a list of files.
 * Returns only files that match all specified criteria.
 */
export function evaluateSmartCollection(collection: Collection, files: FileEntry[]): FileEntry[] {
  const filter = collection.filter;
  if (filter?.type !== 'smart') return [];

  return files.filter((f) => {
    if (f.trashedAt !== null) return false;

    if (filter.query) {
      const q = filter.query.toLowerCase();
      if (!f.name.toLowerCase().includes(q)) return false;
    }

    if (filter.kinds && filter.kinds.length > 0) {
      if (!filter.kinds.includes(f.kind)) return false;
    }

    if (filter.projectIds && filter.projectIds.length > 0) {
      if (!filter.projectIds.includes(f.projectId ?? '')) return false;
    }

    if (filter.dateFrom !== null && filter.dateFrom !== undefined) {
      if (f.updatedAt < filter.dateFrom) return false;
    }

    if (filter.dateTo !== null && filter.dateTo !== undefined) {
      if (f.updatedAt > filter.dateTo) return false;
    }

    return true;
  });
}
