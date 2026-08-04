/**
 * useIconSearch — debounced search hook for online icon providers.
 */

import { getIconProviderRegistry, type IconProviderResult } from '@varve/engine';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface IconSearchState {
  results: IconProviderResult[];
  isLoading: boolean;
  error: string | null;
  query: string;
  totalResults: number;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export function useIconSearch() {
  const [state, setState] = useState<IconSearchState>({
    results: [],
    isLoading: false,
    error: null,
    query: '',
    totalResults: 0,
  });

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef('');

  const search = useCallback((query: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    const trimmed = query.trim();
    lastQueryRef.current = trimmed;

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setState({ results: [], isLoading: false, error: null, query: trimmed, totalResults: 0 });
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null, query: trimmed }));

    const controller = new AbortController();
    abortRef.current = controller;

    timerRef.current = setTimeout(async () => {
      try {
        const registry = getIconProviderRegistry();
        const results = await registry.search(trimmed, { limit: 50 });
        if (!controller.signal.aborted && lastQueryRef.current === trimmed) {
          setState({
            results,
            isLoading: false,
            error: null,
            query: trimmed,
            totalResults: results.length,
          });
        }
      } catch (err) {
        if (!controller.signal.aborted && lastQueryRef.current === trimmed) {
          setState({
            results: [],
            isLoading: false,
            error: err instanceof Error ? err.message : 'Search failed',
            query: trimmed,
            totalResults: 0,
          });
        }
      }
    }, DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
    setState({ results: [], isLoading: false, error: null, query: '', totalResults: 0 });
  }, []);

  return { ...state, search, clear };
}
