import type { Document } from '@varve/scene';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyReplacementPlan, planReplacements } from './replace';
import { searchSpec } from './search';
import type {
  FindReplaceState,
  MatchResult,
  SearchOptions,
  SearchScope,
  SearchSpec,
} from './types';
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
  /** Suppress live search while an IME composition is unfinished. */
  setComposing: (composing: boolean) => void;
  search: () => void;
  /** Re-freeze the selection snapshot and search again. */
  updateFromSelection: () => void;
  replace: (match: MatchResult) => void;
  replaceAndFindNext: () => void;
  replaceChecked: (matchIds: ReadonlySet<string>) => void;
  replaceAll: () => void;
  replaceInSelection: () => void;
  selectResult: (index: number) => void;
  goToNext: () => void;
  goToPrev: () => void;
  open: (initialSearch?: string) => void;
  close: () => void;
}

interface Deps {
  getDoc: () => Document;
  getSelection: () => readonly string[];
  getRevision: () => number;
  onUpdateDoc: (fn: (doc: Document) => Document) => void;
  onBeginTransaction: () => void;
  onCommitTransaction: () => void;
  onSetSelection: (id: string | null) => void;
  onAnnounce: (msg: string) => void;
}

let specCounter = 0;

/** Live-search debounce. Suppressed while an IME composition is in progress. */
const SEARCH_DEBOUNCE_MS = 180;

function specFrom(
  state: FindReplaceState,
  revision: number,
  selection: readonly string[],
): SearchSpec {
  return {
    id: `find-${++specCounter}`,
    revision,
    query: state.searchText,
    options: { ...state.options },
    scope: state.scope,
    selection: [...selection],
    excludeInstances: state.excludeInstances,
    excludeLocked: state.excludeLocked,
    excludeHidden: state.excludeHidden,
  };
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
  getRevision: () => number = () => docRevision,
): FindReplaceAPI {
  const [state, setState] = useState<FindReplaceState>(() => ({
    ...DEFAULT_FIND_REPLACE_STATE,
    skippedCount: { ...DEFAULT_FIND_REPLACE_STATE.skippedCount },
  }));
  const stateRef = useRef(state);
  stateRef.current = state;

  const depsRef = useRef<Deps>({
    getDoc,
    getSelection,
    getRevision,
    onUpdateDoc,
    onBeginTransaction,
    onCommitTransaction,
    onSetSelection,
    onAnnounce,
  });
  depsRef.current = {
    getDoc,
    getSelection,
    getRevision,
    onUpdateDoc,
    onBeginTransaction,
    onCommitTransaction,
    onSetSelection,
    onAnnounce,
  };

  const composingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const applyState = useCallback((next: FindReplaceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const runSearch = useCallback((spec: SearchSpec) => {
    const d = depsRef.current;
    setState((prev) => ({ ...prev, status: 'searching', error: null }));
    const outcome = searchSpec(d.getDoc(), spec);
    setState((prev) => {
      const base: FindReplaceState = {
        ...prev,
        spec,
        currentIndex: 0,
        truncated: outcome.truncated,
        skippedCount: outcome.skipped,
        lastApplied: null,
      };
      if (outcome.error) {
        return {
          ...base,
          results: [],
          status: 'error',
          error: outcome.error.message,
        };
      }
      return {
        ...base,
        results: outcome.results,
        status: outcome.emptySelection ? 'empty-selection' : 'ready',
        error: null,
      };
    });
    if (outcome.error) return;
    if (outcome.emptySelection) {
      d.onAnnounce('Find: no selection to search. Select content or choose a scope.');
      return;
    }
    const skipped = outcome.skipped.locked + outcome.skipped.hidden + outcome.skipped.instances;
    if (outcome.results.length === 0) {
      d.onAnnounce(skipped > 0 ? 'Find: no matches in editable content' : 'Find: no matches');
    } else {
      d.onAnnounce(
        `Find: ${outcome.results.length} match${outcome.results.length === 1 ? '' : 'es'}${
          skipped > 0 ? `, ${skipped} target${skipped === 1 ? '' : 's'} excluded` : ''
        }`,
      );
    }
  }, []);

  const scheduleSearch = useCallback(() => {
    clearDebounce();
    const current = stateRef.current;
    if (!current.open || !current.searchText) return;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (composingRef.current) return;
      const live = stateRef.current;
      if (!live.open || !live.searchText) return;
      runSearch(specFrom(live, depsRef.current.getRevision(), depsRef.current.getSelection()));
    }, SEARCH_DEBOUNCE_MS);
  }, [clearDebounce, runSearch]);

  /** Update query/options/scope and schedule a debounced live search. */
  const invalidate = useCallback(
    (patch: Partial<FindReplaceState>) => {
      const next: FindReplaceState = {
        ...stateRef.current,
        ...patch,
        spec: null,
        results: [],
        currentIndex: 0,
        status: 'idle',
        error: null,
        truncated: false,
        lastApplied: null,
      };
      applyState(next);
      scheduleSearch();
    },
    [applyState, scheduleSearch],
  );

  // Document changes make the live result set stale; replacement stays
  // disabled until the user refreshes, so a stale plan cannot be committed.
  const prevRevisionRef = useRef(docRevision);
  useEffect(() => {
    if (prevRevisionRef.current !== docRevision && stateRef.current.status === 'ready') {
      setState((s) => ({ ...s, status: 'stale' }));
    }
    prevRevisionRef.current = docRevision;
  }, [docRevision]);

  useEffect(() => () => clearDebounce(), [clearDebounce]);

  const setSearchText = useCallback(
    (text: string) => invalidate({ searchText: text }),
    [invalidate],
  );
  const setReplaceText = useCallback((text: string) => {
    setState((prev) => ({ ...prev, replaceText: text }));
  }, []);
  const setOption = useCallback(
    (key: keyof SearchOptions, value: boolean) => {
      invalidate({ options: { ...stateRef.current.options, [key]: value } });
    },
    [invalidate],
  );
  const setScope = useCallback((scope: SearchScope) => invalidate({ scope }), [invalidate]);
  const setExcludeInstances = useCallback(
    (v: boolean) => invalidate({ excludeInstances: v }),
    [invalidate],
  );
  const setExcludeLocked = useCallback(
    (v: boolean) => invalidate({ excludeLocked: v }),
    [invalidate],
  );
  const setExcludeHidden = useCallback(
    (v: boolean) => invalidate({ excludeHidden: v }),
    [invalidate],
  );
  const setComposing = useCallback(
    (composing: boolean) => {
      composingRef.current = composing;
      if (!composing) scheduleSearch();
    },
    [scheduleSearch],
  );

  const search = useCallback(() => {
    clearDebounce();
    const current = stateRef.current;
    if (!current.searchText) {
      applyState({
        ...current,
        spec: null,
        results: [],
        currentIndex: 0,
        status: 'idle',
        error: null,
        truncated: false,
        lastApplied: null,
      });
      return;
    }
    runSearch(specFrom(current, depsRef.current.getRevision(), depsRef.current.getSelection()));
  }, [applyState, clearDebounce, runSearch]);

  const updateFromSelection = useCallback(() => {
    clearDebounce();
    const current = stateRef.current;
    if (!current.searchText) return;
    runSearch(specFrom(current, depsRef.current.getRevision(), depsRef.current.getSelection()));
    depsRef.current.onAnnounce('Find: scope updated from the current selection');
  }, [clearDebounce, runSearch]);

  const commitPlan = useCallback(
    (
      spec: SearchSpec,
      onlyMatchIds?: ReadonlySet<string>,
    ): { applied: number; skipped: number } => {
      const d = depsRef.current;
      // Plan against the live document, then apply inside `updateDoc` so the
      // commit uses whatever `s.document` is current at that moment. Computing
      // `result.doc` out here and returning it would discard any mutation that
      // landed since this closure was created (React batches the whole batch
      // into one updater).
      const doc = d.getDoc();
      const revision = d.getRevision();
      const plan = planReplacements(doc, spec, stateRef.current.replaceText, { onlyMatchIds });
      if (plan.edits.length === 0) {
        return { applied: 0, skipped: plan.skippedProtected };
      }
      let applied = 0;
      d.onBeginTransaction();
      try {
        d.onUpdateDoc((live) => {
          const result = applyReplacementPlan(live, plan, revision);
          applied = result.applied;
          return result.doc;
        });
      } finally {
        d.onCommitTransaction();
      }
      return { applied, skipped: plan.skippedProtected };
    },
    [],
  );

  /** Re-search after a commit and keep the spec's revision current. */
  const refreshResults = useCallback((preserveIndex: number, navigate = false) => {
    const current = stateRef.current;
    const spec = current.spec;
    if (!spec) return;
    const refreshed: SearchSpec = { ...spec, revision: depsRef.current.getRevision() };
    const outcome = searchSpec(depsRef.current.getDoc(), refreshed);
    if (outcome.error) return;
    const nextIndex =
      outcome.results.length === 0
        ? 0
        : Math.min(Math.max(0, preserveIndex), outcome.results.length - 1);
    if (navigate) {
      depsRef.current.onSetSelection(outcome.results[nextIndex]?.nodeId ?? null);
    }
    setState((prev) => ({
      ...prev,
      spec: refreshed,
      results: outcome.results,
      currentIndex: nextIndex,
      status: outcome.results.length === 0 ? 'idle' : 'ready',
      truncated: outcome.truncated,
      skippedCount: outcome.skipped,
    }));
  }, []);

  const replace = useCallback(
    (match: MatchResult) => {
      const current = stateRef.current;
      if (!current.spec || current.status !== 'ready') return;
      if (match.protected) {
        depsRef.current.onAnnounce(
          'Find: that match is in locked or hidden content and is find-only',
        );
        return;
      }
      const { applied } = commitPlan(current.spec, new Set([match.id]));
      if (applied > 0) {
        depsRef.current.onAnnounce('Replaced 1 occurrence');
        refreshResults(current.currentIndex);
      }
    },
    [commitPlan, refreshResults],
  );

  const replaceAndFindNext = useCallback(() => {
    const current = stateRef.current;
    if (!current.spec || current.status !== 'ready') return;
    const match = current.results[current.currentIndex];
    if (!match) return;
    const { applied } = commitPlan(current.spec, new Set([match.id]));
    if (applied > 0) {
      depsRef.current.onAnnounce('Replaced 1 occurrence');
      // The replaced match is gone; the following match shifts into its slot,
      // so navigate to the same index in the refreshed result set.
      refreshResults(current.currentIndex, true);
    }
  }, [commitPlan, refreshResults]);

  const replaceChecked = useCallback(
    (matchIds: ReadonlySet<string>) => {
      const current = stateRef.current;
      if (!current.spec || current.status !== 'ready' || matchIds.size === 0) return;
      const { applied, skipped } = commitPlan(current.spec, matchIds);
      if (applied > 0) {
        depsRef.current.onAnnounce(
          `Replaced ${applied} checked occurrence${applied === 1 ? '' : 's'}${
            skipped > 0 ? `, skipped ${skipped}` : ''
          }`,
        );
      }
      refreshResults(current.currentIndex);
    },
    [commitPlan, refreshResults],
  );

  const replaceAll = useCallback(() => {
    const current = stateRef.current;
    if (!current.spec || current.status !== 'ready' || current.results.length === 0) return;
    const { applied, skipped } = commitPlan(current.spec);
    if (applied === 0) {
      depsRef.current.onAnnounce(
        skipped > 0
          ? 'Replace All: no editable matches (protected or stale)'
          : 'Replace All: nothing changed',
      );
      refreshResults(0);
      return;
    }
    depsRef.current.onAnnounce(
      `Replaced ${applied} occurrence${applied === 1 ? '' : 's'}${
        skipped > 0 ? `, skipped ${skipped}` : ''
      }`,
    );
    setState((prev) => ({
      ...prev,
      results: [],
      currentIndex: 0,
      status: 'idle',
      lastApplied: applied,
    }));
  }, [commitPlan, refreshResults]);

  const replaceInSelection = useCallback(() => {
    const current = stateRef.current;
    const spec = current.spec;
    if (!spec) return;
    if (spec.selection.length === 0) {
      depsRef.current.onAnnounce('Replace in selection: nothing is selected');
      return;
    }
    const selection = new Set(spec.selection);
    const ids = new Set(current.results.filter((r) => selection.has(r.nodeId)).map((r) => r.id));
    replaceChecked(ids);
  }, [replaceChecked]);

  const selectResult = useCallback((index: number) => {
    setState((prev) => {
      const match = prev.results[index];
      if (!match) return prev;
      depsRef.current.onSetSelection(match.nodeId);
      return { ...prev, currentIndex: index };
    });
  }, []);

  const goToNext = useCallback(() => {
    setState((prev) => {
      if (prev.results.length === 0) return prev;
      const nextIdx = (prev.currentIndex + 1) % prev.results.length;
      const nextMatch = prev.results[nextIdx];
      if (!nextMatch) return prev;
      depsRef.current.onSetSelection(nextMatch.nodeId);
      return { ...prev, currentIndex: nextIdx };
    });
  }, []);

  const goToPrev = useCallback(() => {
    setState((prev) => {
      if (prev.results.length === 0) return prev;
      const prevIdx = (prev.currentIndex - 1 + prev.results.length) % prev.results.length;
      const previousMatch = prev.results[prevIdx];
      if (!previousMatch) return prev;
      depsRef.current.onSetSelection(previousMatch.nodeId);
      return { ...prev, currentIndex: prevIdx };
    });
  }, []);

  const open = useCallback(
    (initialSearch?: string) => {
      const base = stateRef.current;
      const next: FindReplaceState =
        initialSearch !== undefined
          ? {
              ...base,
              open: true,
              searchText: initialSearch,
              spec: null,
              results: [],
              currentIndex: 0,
              status: 'idle',
              error: null,
            }
          : { ...base, open: true, error: null };
      applyState(next);
      scheduleSearch();
    },
    [applyState, scheduleSearch],
  );

  const close = useCallback(() => {
    clearDebounce();
    const base = stateRef.current;
    applyState({
      ...base,
      open: false,
      spec: null,
      results: [],
      currentIndex: 0,
      status: 'idle',
      error: null,
      truncated: false,
      lastApplied: null,
    });
  }, [applyState, clearDebounce]);

  return {
    state,
    setSearchText,
    setReplaceText,
    setOption,
    setScope,
    setExcludeInstances,
    setExcludeLocked,
    setExcludeHidden,
    setComposing,
    search,
    updateFromSelection,
    replace,
    replaceAndFindNext,
    replaceChecked,
    replaceAll,
    replaceInSelection,
    selectResult,
    goToNext,
    goToPrev,
    open,
    close,
  };
}
