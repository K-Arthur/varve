/**
 * useIconSearch — debounced, cancellable icon search across online providers
 * and the local cache, with pagination and offline awareness.
 *
 * Contract:
 * - Threads an AbortController through the provider registry so every query
 *   cancels the previous one's in-flight requests.
 * - Local (cached) results are searched through the same normalization +
 *   synonym expansion as online results and are never silently mixed into an
 *   Online-only filter.
 * - Tracks the server-reported total; "load more" only claims what the
 *   server actually returned.
 */

import {
  descriptorMatchesQuery,
  ensureIconProviders,
  expandSearchTokens,
  getIconProviderRegistry,
  IconProviderError,
  type IconSearchPage,
  type IconSourceDescriptor,
} from '@varve/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listStoredIcons } from './iconStorage';

export interface IconSearchState {
  results: IconSourceDescriptor[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: { code: string; message: string } | null;
  query: string;
  total: number;
  exhausted: boolean;
  /** True when at least one provider is registered and usable. */
  providersReady: boolean;
}

export const DEBOUNCE_MS = 300;
export const MIN_QUERY_LENGTH = 2;
export const PAGE_SIZE = 48;

export function useIconSearch() {
  const [state, setState] = useState<IconSearchState>({
    results: [],
    isLoading: false,
    isLoadingMore: false,
    error: null,
    query: '',
    total: 0,
    exhausted: true,
    providersReady: false,
  });

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef('');
  const nextStartRef = useRef(0);
  const onlineRef = useRef(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const onOnline = () => {
      onlineRef.current = true;
      setIsOnline(true);
    };
    const onOffline = () => {
      onlineRef.current = false;
      setIsOnline(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const toDescriptor = useCallback(
    (record: {
      id: string;
      name: string;
      providerId: string;
      prefix: string;
      canonicalId?: string;
      styles?: string[];
      categories?: string[];
      spdxId?: string;
      paletteType?: 'monotone' | 'multicolor';
    }): IconSourceDescriptor => ({
      canonicalId: record.canonicalId ?? record.id,
      providerId: record.providerId || 'iconify',
      packId: record.prefix,
      iconId: record.id.split(':').pop() ?? record.name,
      name: record.name,
      displayName: record.name,
      aliases: [],
      keywords: [],
      categories: record.categories ?? [],
      styles: (record.styles ?? ['outline']) as IconSourceDescriptor['styles'],
      paletteType: record.paletteType ?? 'monotone',
      licence: { spdxId: record.spdxId, title: undefined },
      isOfflineAvailable: true,
    }),
    [],
  );

  const runSearch = useCallback(async (query: string, start: number): Promise<IconSearchPage> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new IconProviderError('You are offline', 'network-error', '');
    }
    ensureIconProviders();
    const registry = getIconProviderRegistry();
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    return registry.search(query, {
      limit: PAGE_SIZE,
      start,
      signal: controller.signal,
    });
  }, []);

  const search = useCallback(
    (rawQuery: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }

      const trimmed = rawQuery.trim();
      lastQueryRef.current = trimmed;
      nextStartRef.current = 0;

      if (trimmed.length < MIN_QUERY_LENGTH) {
        setState({
          results: [],
          isLoading: false,
          isLoadingMore: false,
          error: null,
          query: trimmed,
          total: 0,
          exhausted: true,
          providersReady: true,
        });
        return;
      }

      setState((prev) => ({ ...prev, isLoading: true, error: null, query: trimmed }));

      timerRef.current = setTimeout(async () => {
        if (lastQueryRef.current !== trimmed) return;
        try {
          const page = await runSearch(trimmed, 0);
          if (lastQueryRef.current !== trimmed) return;
          nextStartRef.current = page.start + page.items.length;
          setState({
            results: page.items,
            isLoading: false,
            isLoadingMore: false,
            error: null,
            query: trimmed,
            total: page.total,
            exhausted: page.exhausted || page.items.length === 0,
            providersReady: true,
          });
        } catch (err) {
          if (lastQueryRef.current !== trimmed) return;
          const code = err instanceof IconProviderError ? err.code : 'network-error';
          const message = err instanceof Error ? err.message : 'Search failed';
          setState({
            results: [],
            isLoading: false,
            isLoadingMore: false,
            error: { code, message },
            query: trimmed,
            total: 0,
            exhausted: true,
            providersReady: true,
          });
        }
      }, DEBOUNCE_MS);
    },
    [runSearch],
  );

  const loadMore = useCallback(async () => {
    const query = lastQueryRef.current;
    if (!query || state.isLoading || state.isLoadingMore || state.exhausted) return;
    setState((prev) => ({ ...prev, isLoadingMore: true }));
    try {
      const page = await runSearch(query, nextStartRef.current);
      nextStartRef.current = page.start + page.items.length;
      setState((prev) => ({
        ...prev,
        results: dedupe([...prev.results, ...page.items]),
        isLoadingMore: false,
        total: page.total,
        exhausted: page.exhausted || page.items.length === 0,
      }));
    } catch (err) {
      const code = err instanceof IconProviderError ? err.code : 'network-error';
      setState((prev) => ({
        ...prev,
        isLoadingMore: false,
        error: { code, message: err instanceof Error ? err.message : 'Load more failed' },
      }));
    }
  }, [state.isLoading, state.isLoadingMore, state.exhausted, runSearch]);

  /** Search local cached icons with the same normalization as online. */
  const searchLocal = useCallback(
    async (rawQuery: string): Promise<IconSourceDescriptor[]> => {
      const all = await listStoredIcons();
      if (!rawQuery.trim()) {
        return all.map(toDescriptor);
      }
      const tokens = expandSearchTokens(rawQuery);
      const query = rawQuery.trim();
      return all
        .map(toDescriptor)
        .filter(
          (d) =>
            descriptorMatchesQuery(d, query) ||
            tokens.every((t) => (d.name + ' ' + d.keywords.join(' ')).includes(t)),
        );
    },
    [toDescriptor],
  );

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
    lastQueryRef.current = '';
    setState({
      results: [],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      query: '',
      total: 0,
      exhausted: true,
      providersReady: true,
    });
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return {
    ...state,
    isOnline,
    search,
    clear,
    loadMore,
    searchLocal,
    runSearch,
  };
}

function dedupe(items: IconSourceDescriptor[]): IconSourceDescriptor[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    if (seen.has(i.canonicalId)) return false;
    seen.add(i.canonicalId);
    return true;
  });
}
