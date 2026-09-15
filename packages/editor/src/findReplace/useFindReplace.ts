import type { Document } from '@varve/scene';
import { useCallback, useEffect, useRef, useState } from 'react';
import { replaceAll as replaceAllInDocument, replaceSingle } from './replace';
import { searchInDocument, validateRegex } from './search';
import type { FindReplaceState, MatchResult, SearchOptions, SearchScope } from './types';
import { DEFAULT_FIND_REPLACE_STATE } from './types';

export interface FindReplaceAPI {
  state: FindReplaceState;
  setSearchText: (text: string) => void;
  setReplaceText: (text: string) => void;
  setOption: (key: keyof SearchOptions, value: boolean) => void;
  setScope: (scope: SearchScope) => void;
  setExcludeInstances: (v: boolean) => void;
  setExcludeLocked: (v: boolean) => void;
  setExcludeHidden: (v: boolean) => void;
  search: () => void;
  replace: (match: MatchResult) => void;
  replaceAll: () => void;
  replaceInSelection: () => void;
  selectResult: (index: number) => void;
  goToNext: () => void;
  goToPrev: () => void;
  open: (initialSearch?: string) => void;
  close: () => void;
}

export function useFindReplace(
  getDoc: () => Document,
  getSelection: () => readonly string[],
  onUpdateDoc: (fn: (doc: Document) => Document) => void,
  onBeginTransaction: () => void,
  onCommitTransaction: () => void,
  onSetSelection: (id: string | null) => void,
  onAnnounce: (msg: string) => void,
  docRevision: number,
): FindReplaceAPI {
  const [state, setState] = useState<FindReplaceState>({ ...DEFAULT_FIND_REPLACE_STATE });
  const stateRef = useRef(state);
  stateRef.current = state;

  const prevRevisionRef = useRef(docRevision);
  useEffect(() => {
    if (prevRevisionRef.current !== docRevision && stateRef.current.status === 'ready') {
      setState((s) => ({ ...s, status: 'stale' }));
    }
    prevRevisionRef.current = docRevision;
  }, [docRevision]);

  const setSearchText = useCallback((text: string) => {
    setState((s) => ({
      ...s,
      searchText: text,
      status: 'idle',
      results: [],
      currentIndex: 0,
      error: null,
    }));
  }, []);

  const setReplaceText = useCallback((text: string) => {
    setState((s) => ({ ...s, replaceText: text }));
  }, []);

  const setOption = useCallback((key: keyof SearchOptions, value: boolean) => {
    setState((s) => ({
      ...s,
      options: { ...s.options, [key]: value },
      status: 'idle',
      results: [],
      currentIndex: 0,
      error: null,
    }));
  }, []);

  const setScope = useCallback((scope: SearchScope) => {
    setState((s) => ({ ...s, scope, status: 'idle', results: [], currentIndex: 0 }));
  }, []);

  const setExcludeInstances = useCallback((v: boolean) => {
    setState((s) => ({ ...s, excludeInstances: v, status: 'idle', results: [], currentIndex: 0 }));
  }, []);

  const setExcludeLocked = useCallback((v: boolean) => {
    setState((s) => ({ ...s, excludeLocked: v, status: 'idle', results: [], currentIndex: 0 }));
  }, []);

  const setExcludeHidden = useCallback((v: boolean) => {
    setState((s) => ({ ...s, excludeHidden: v, status: 'idle', results: [], currentIndex: 0 }));
  }, []);

  const search = useCallback(() => {
    const s = stateRef.current;
    if (!s.searchText) {
      setState((prev) => ({ ...prev, results: [], currentIndex: 0, status: 'idle' }));
      return;
    }

    if (s.options.useRegex) {
      const err = validateRegex(s.searchText);
      if (err) {
        setState((prev) => ({ ...prev, error: err, status: 'idle' }));
        return;
      }
    }

    setState((prev) => ({ ...prev, status: 'searching', error: null }));

    const doc = getDoc();
    const selection = getSelection();
    const { results, skippedCount } = searchInDocument(
      doc,
      s.searchText,
      s.options,
      s.scope,
      selection,
      s.excludeInstances,
      s.excludeLocked,
      s.excludeHidden,
    );

    setState((prev) => ({
      ...prev,
      results,
      currentIndex: results.length > 0 ? 0 : 0,
      status: 'ready',
      skippedCount,
    }));
  }, [getDoc, getSelection]);

  const replace = useCallback(
    (match: MatchResult) => {
      const s = stateRef.current;
      onUpdateDoc((doc) => replaceSingle(doc, match, s.replaceText));
      const newResults = stateRef.current.results.filter(
        (r) => r.nodeId !== match.nodeId || r.flatStart !== match.flatStart,
      );
      setState((prev) => ({
        ...prev,
        results: newResults,
        currentIndex:
          newResults.length > 0 ? Math.min(prev.currentIndex, newResults.length - 1) : 0,
        status: newResults.length === 0 ? 'idle' : 'ready',
      }));
    },
    [onUpdateDoc],
  );

  const replaceAll = useCallback(() => {
    const s = stateRef.current;
    if (s.results.length === 0) return;
    onBeginTransaction();
    onUpdateDoc((doc) => {
      const result = replaceAllInDocument(
        doc,
        s.searchText,
        s.replaceText,
        s.options,
        s.scope,
        getSelection(),
        s.excludeInstances,
        s.excludeLocked,
        s.excludeHidden,
      );
      return result.doc;
    });
    onCommitTransaction();
    const count = s.results.length;
    onAnnounce(`Replace ${count} occurrences`);
    setState((prev) => ({
      ...prev,
      results: [],
      currentIndex: 0,
      status: 'idle',
    }));
  }, [onUpdateDoc, onBeginTransaction, onCommitTransaction, onAnnounce, getSelection]);

  const replaceInSelection = useCallback(() => {
    const s = stateRef.current;
    const selectionResults = s.results.filter((r) => getSelection().includes(r.nodeId));
    if (selectionResults.length === 0) return;
    onBeginTransaction();
    for (const match of selectionResults) {
      onUpdateDoc((doc) => replaceSingle(doc, match, s.replaceText));
    }
    onCommitTransaction();
    const count = selectionResults.length;
    onAnnounce(`Replace ${count} occurrences in selection`);
    setState((prev) => ({
      ...prev,
      results: [],
      currentIndex: 0,
      status: 'idle',
    }));
  }, [onUpdateDoc, onBeginTransaction, onCommitTransaction, onAnnounce, getSelection]);

  const goToNext = useCallback(() => {
    setState((prev) => {
      if (prev.results.length === 0) return prev;
      const nextIdx = (prev.currentIndex + 1) % prev.results.length;
      const nextMatch = prev.results[nextIdx];
      if (!nextMatch) return prev;
      onSetSelection(nextMatch.nodeId);
      return { ...prev, currentIndex: nextIdx };
    });
  }, [onSetSelection]);

  const goToPrev = useCallback(() => {
    setState((prev) => {
      if (prev.results.length === 0) return prev;
      const prevIdx = (prev.currentIndex - 1 + prev.results.length) % prev.results.length;
      const previousMatch = prev.results[prevIdx];
      if (!previousMatch) return prev;
      onSetSelection(previousMatch.nodeId);
      return { ...prev, currentIndex: prevIdx };
    });
  }, [onSetSelection]);

  const selectResult = useCallback(
    (index: number) => {
      setState((prev) => {
        const match = prev.results[index];
        if (!match) return prev;
        onSetSelection(match.nodeId);
        return { ...prev, currentIndex: index };
      });
    },
    [onSetSelection],
  );

  const open = useCallback((initialSearch?: string) => {
    setState((prev) => ({
      ...prev,
      open: true,
      searchText: initialSearch ?? prev.searchText,
      error: null,
    }));
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({
      ...prev,
      open: false,
      results: [],
      currentIndex: 0,
      status: 'idle',
      error: null,
    }));
  }, []);

  return {
    state,
    setSearchText,
    setReplaceText,
    setOption,
    setScope,
    setExcludeInstances,
    setExcludeLocked,
    setExcludeHidden,
    search,
    replace,
    replaceAll,
    replaceInSelection,
    selectResult,
    goToNext,
    goToPrev,
    open,
    close,
  };
}
