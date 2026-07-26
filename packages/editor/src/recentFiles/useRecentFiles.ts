import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addEntry,
  clearEntries,
  loadEntries,
  removeEntry,
  subscribeToChanges,
  togglePinEntry,
} from './store';
import type { RecentEntry } from './types';
import { SCHEMA_KEY } from './types';

function subscribeToStorage(onChange: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === SCHEMA_KEY) onChange();
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

export interface RecentFilesActions {
  entries: RecentEntry[];
  add: (entry: Omit<RecentEntry, 'id' | 'lastOpenedAt'> & { id?: string }) => void;
  remove: (id: string) => void;
  clear: () => void;
  togglePin: (id: string) => void;
  refresh: () => void;
}

export function useRecentFiles(): RecentFilesActions {
  const [entries, setEntries] = useState<RecentEntry[]>(() => loadEntries());
  const generation = useRef(0);

  const refresh = useCallback(() => {
    const next = loadEntries();
    setEntries(next);
    generation.current++;
  }, []);

  useEffect(() => {
    const unsubStorage = subscribeToStorage(refresh);
    const unsubChanges = subscribeToChanges(refresh);
    return () => {
      unsubStorage();
      unsubChanges();
    };
  }, [refresh]);

  const add = useCallback((entry: Omit<RecentEntry, 'id' | 'lastOpenedAt'> & { id?: string }) => {
    const next = addEntry(loadEntries(), entry);
    setEntries(next);
    generation.current++;
  }, []);

  const removeById = useCallback((id: string) => {
    const next = removeEntry(loadEntries(), id);
    setEntries(next);
    generation.current++;
  }, []);

  const clear = useCallback(() => {
    clearEntries();
    setEntries([]);
    generation.current++;
  }, []);

  const togglePin = useCallback((id: string) => {
    const next = togglePinEntry(loadEntries(), id);
    setEntries(next);
    generation.current++;
  }, []);

  return { entries, add, remove: removeById, clear, togglePin, refresh };
}
