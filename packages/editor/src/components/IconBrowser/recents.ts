/**
 * Recently inserted icons — persisted per user (localStorage), capped.
 */

const RECENTS_KEY = 'varve-icon-recents';
export const MAX_RECENTS = 50;

export interface RecentIconEntry {
  canonicalId: string;
  name: string;
  packId: string;
  at: number;
}

export function loadRecents(): RecentIconEntry[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is RecentIconEntry =>
          e !== null &&
          typeof e === 'object' &&
          typeof (e as RecentIconEntry).canonicalId === 'string',
      )
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function recordRecentIcon(entry: Omit<RecentIconEntry, 'at'>): void {
  try {
    const recents = loadRecents().filter((r) => r.canonicalId !== entry.canonicalId);
    recents.unshift({ ...entry, at: Date.now() });
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
  } catch {
    // ignore
  }
}

export function clearRecents(): void {
  try {
    localStorage.removeItem(RECENTS_KEY);
  } catch {
    // ignore
  }
}
