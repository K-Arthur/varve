/**
 * useSelectionHistory — track selection changes for back/forward navigation.
 *
 * Maintains a capped stack of past selections, deduping consecutive duplicates.
 * Exposes selectPrevious() and selectNext() for navigation through history.
 *
 * Research basis: Figma's selection history (Cmd+Shift+[ / Cmd+Shift+] pattern),
 * browser history stack semantics.
 */

import { useCallback, useRef } from 'react';

const MAX_HISTORY = 50;

export interface SelectionHistoryEntry {
  selection: string[];
  timestamp: number;
}

export function useSelectionHistory() {
  const historyRef = useRef<SelectionHistoryEntry[]>([]);
  const currentIndexRef = useRef(-1);

  const push = useCallback((selection: string[]) => {
    const entry: SelectionHistoryEntry = {
      selection: [...selection],
      timestamp: Date.now(),
    };

    // Dedupe: don't push if identical to current
    const current = historyRef.current[currentIndexRef.current];
    if (current && JSON.stringify(current.selection) === JSON.stringify(selection)) {
      return;
    }

    // If we're not at the end, truncate forward history
    if (currentIndexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, currentIndexRef.current + 1);
    }

    historyRef.current.push(entry);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    } else {
      currentIndexRef.current = historyRef.current.length - 1;
    }
  }, []);

  const selectPrevious = useCallback((): string[] | null => {
    if (currentIndexRef.current <= 0) return null;
    currentIndexRef.current -= 1;
    return historyRef.current[currentIndexRef.current]?.selection ?? null;
  }, []);

  const selectNext = useCallback((): string[] | null => {
    if (currentIndexRef.current >= historyRef.current.length - 1) return null;
    currentIndexRef.current += 1;
    return historyRef.current[currentIndexRef.current]?.selection ?? null;
  }, []);

  const canGoBack = useCallback(() => currentIndexRef.current > 0, []);
  const canGoForward = useCallback(
    () => currentIndexRef.current < historyRef.current.length - 1,
    [],
  );

  const reset = useCallback(() => {
    historyRef.current = [];
    currentIndexRef.current = -1;
  }, []);

  return {
    push,
    selectPrevious,
    selectNext,
    canGoBack,
    canGoForward,
    reset,
  };
}
