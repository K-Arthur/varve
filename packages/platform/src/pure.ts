/**
 * @strata/platform — pure helpers. No I/O; fully unit-testable.
 *
 * Research basis:
 *  - FNV-1a 32-bit hash: fast, dependency-free content fingerprint that
 *    doubles as the thumbnail cache key (Local-First §4 — content-addressed
 *    caches invalidate themselves when the document changes).
 *  - RFC 3986 relative-time formatting adapted from the TC39 `Intl.RelativeTimeFormat`
 *    proposal ("just now" / "5 min ago" / "yesterday"), chosen over a dep.
 *  - File-kind detection by extension mirrors OS file-association tables.
 */
import type { FileKind, FilterState, HomeViewState, SortDirection } from './types';

/** The canonical Strata document extension (no dot). */
export const STRATA_EXT = 'strata';

const EXT_TO_KIND: Record<string, FileKind> = {
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
    view: 'grid',
    sort: { key: 'opened', direction: 'desc' },
    filter: {
      query: '',
      kinds: [],
      projectId: 'all',
      pinnedOnly: false,
      dateFrom: null,
      dateTo: null,
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
  key: 'updated' | 'opened' | 'created' | 'size' | 'name',
  direction: SortDirection,
): (
  a: { updatedAt: number; openedAt?: number; createdAt: number; size?: number; name: string },
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

/** True when a file kind is one of the importable foreign formats. */
export function isImportableKind(kind: FileKind): boolean {
  return kind === 'figma' || kind === 'illustrator' || kind === 'image';
}
