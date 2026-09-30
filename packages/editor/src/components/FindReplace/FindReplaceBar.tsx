import { Icon, Select, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FindReplaceAPI } from '../../findReplace/useFindReplace';
import { FindResultsList } from './FindResultsList';
import './FindReplaceBar.css';

export function FindReplaceBar({
  api,
  onRequestClose,
}: {
  api: FindReplaceAPI;
  onRequestClose?: () => void;
}) {
  const { state } = api;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (state.open && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  }, [state.open]);

  // Checked identity is only meaningful for the live result set: prune ids that
  // no longer exist so a stale id can never target a replacement. A successful
  // replacement ends the checked batch, which keeps "Replace Checked" from
  // reappearing (disabled) after the batch is already applied.
  useEffect(() => {
    setChecked((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(state.results.map((m) => m.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [state.results]);

  useEffect(() => {
    if (state.lastApplied !== null) setChecked(new Set());
  }, [state.lastApplied]);

  const requestClose = useCallback(() => {
    (onRequestClose ?? api.close)();
  }, [onRequestClose, api]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          if (state.results.length > 0) api.goToPrev();
        } else if (state.status === 'idle' || state.status === 'stale') {
          api.search();
        } else if (state.results.length > 0) {
          api.goToNext();
        } else {
          api.search();
        }
        return;
      }
      if (e.key === 'Escape') requestClose();
    },
    [api, requestClose, state.status, state.results.length],
  );

  const handleReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        // Replace (never Replace All) from the replace field.
        api.replaceAndFindNext();
      }
      if (e.key === 'Escape') requestClose();
    },
    [api, requestClose],
  );

  const totalMatches = state.results.length;
  const currentDisplay = totalMatches > 0 ? state.currentIndex + 1 : 0;
  const currentMatch = state.results[state.currentIndex];
  const editableMatches = useMemo(() => state.results.filter((m) => !m.protected), [state.results]);
  const checkedEditable = useMemo(
    () => editableMatches.filter((m) => checked.has(m.id)),
    [editableMatches, checked],
  );
  const isReady = state.status === 'ready';
  const canReplaceCurrent = isReady && Boolean(currentMatch) && !currentMatch?.protected;
  const canReplaceAll = isReady && editableMatches.length > 0;
  const selectionLabel =
    state.scope === 'selection'
      ? (state.spec?.selection.length ?? 0) === 0
        ? 'Selection (nothing selected)'
        : `Selection (${state.spec?.selection.length ?? 0} selected)`
      : null;

  if (!state.open) return null;

  const replaceCurrentReason = !isReady
    ? 'Run a search first'
    : currentMatch?.protected
      ? 'This match is in locked or hidden content (find only)'
      : !currentMatch
        ? 'No current match'
        : undefined;
  const replaceAllReason = !isReady
    ? 'Run a search first'
    : editableMatches.length === 0
      ? totalMatches === 0
        ? 'No matches'
        : 'All matches are in locked or hidden content'
      : undefined;

  return (
    <div
      className="find-replace-bar"
      role="dialog"
      aria-modal="false"
      aria-label="Find and replace"
      data-find-replace
    >
      <div className="find-replace-bar__row">
        <div className="find-replace-bar__search-row">
          <input
            ref={searchInputRef}
            type="text"
            className="find-replace-bar__input"
            placeholder="Find…"
            value={state.searchText}
            onChange={(e) => api.setSearchText(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            onCompositionStart={() => api.setComposing(true)}
            onCompositionEnd={() => api.setComposing(false)}
            data-shortcut-ignore
            aria-label="Find text"
          />
          <span
            className="find-replace-bar__counter"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {state.status === 'ready'
              ? `${currentDisplay} of ${totalMatches}`
              : state.status === 'empty-selection'
                ? 'No selection'
                : ''}
          </span>
          <div className="find-replace-bar__nav-buttons">
            <Tooltip label="Previous match">
              <button
                type="button"
                className="find-replace-bar__nav-btn"
                onClick={api.goToPrev}
                disabled={totalMatches === 0}
                aria-label="Previous match"
              >
                <Icon name="ChevronUp" label="" />
              </button>
            </Tooltip>
            <Tooltip label="Next match">
              <button
                type="button"
                className="find-replace-bar__nav-btn"
                onClick={api.goToNext}
                disabled={totalMatches === 0}
                aria-label="Next match"
              >
                <Icon name="ChevronDown" label="" />
              </button>
            </Tooltip>
            <Tooltip label="Close find and replace">
              <button
                type="button"
                className="find-replace-bar__nav-btn"
                onClick={requestClose}
                aria-label="Close find and replace"
              >
                <Icon name="X" label="" />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="find-replace-bar__replace-row">
          <input
            type="text"
            className="find-replace-bar__input"
            placeholder="Replace…"
            value={state.replaceText}
            onChange={(e) => api.setReplaceText(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
            onCompositionStart={() => api.setComposing(true)}
            onCompositionEnd={() => api.setComposing(false)}
            data-shortcut-ignore
            aria-label="Replace text"
          />
          <Tooltip label={replaceCurrentReason ?? 'Replace the current match'}>
            <button
              type="button"
              className="find-replace-bar__action-btn"
              onClick={() => currentMatch && api.replace(currentMatch)}
              disabled={!canReplaceCurrent}
              title={replaceCurrentReason}
            >
              Replace
            </button>
          </Tooltip>
          <Tooltip label={replaceCurrentReason ?? 'Replace the current match and move to the next'}>
            <button
              type="button"
              className="find-replace-bar__action-btn"
              onClick={api.replaceAndFindNext}
              disabled={!canReplaceCurrent}
              title={replaceCurrentReason}
            >
              Replace &amp; Find Next
            </button>
          </Tooltip>
          <Tooltip label={replaceAllReason ?? 'Replace every eligible match (one undo step)'}>
            <button
              type="button"
              className="find-replace-bar__action-btn"
              onClick={api.replaceAll}
              disabled={!canReplaceAll}
              title={replaceAllReason}
            >
              Replace All
            </button>
          </Tooltip>
          {checkedEditable.length > 0 && (
            <button
              type="button"
              className="find-replace-bar__action-btn"
              onClick={() => api.replaceChecked(new Set(checkedEditable.map((m) => m.id)))}
            >
              Replace Checked ({checkedEditable.length})
            </button>
          )}
        </div>
      </div>

      <div className="find-replace-bar__options">
        <label className="find-replace-bar__option">
          <input
            type="checkbox"
            checked={state.options.caseSensitive}
            onChange={(e) => api.setOption('caseSensitive', e.target.checked)}
          />
          Match case
        </label>
        <label className="find-replace-bar__option">
          <input
            type="checkbox"
            checked={state.options.wholeWord}
            onChange={(e) => api.setOption('wholeWord', e.target.checked)}
          />
          Whole word
        </label>
        <label className="find-replace-bar__option">
          <input
            type="checkbox"
            checked={state.options.useRegex}
            onChange={(e) => api.setOption('useRegex', e.target.checked)}
          />
          Regex
        </label>
        <label
          className="find-replace-bar__option"
          title={
            state.options.useRegex
              ? 'Diacritic-insensitive matching is not available in regex mode'
              : 'Ignore diacritics'
          }
        >
          <input
            type="checkbox"
            checked={state.options.matchDiacritics}
            disabled={state.options.useRegex}
            onChange={(e) => api.setOption('matchDiacritics', e.target.checked)}
          />
          Match diacritics
        </label>

        <span className="find-replace-bar__separator" />

        <div className="find-replace-bar__scope">
          <Select
            label="Search scope"
            value={state.scope}
            options={[
              { value: 'selection', label: 'Selection' },
              { value: 'page', label: 'Current page' },
              { value: 'document', label: 'Entire document' },
            ]}
            onChange={(scope) => api.setScope(scope as 'selection' | 'page' | 'document')}
          />
        </div>
        <button
          type="button"
          className="find-replace-bar__status-action"
          onClick={api.updateFromSelection}
          title="Re-freeze the search scope from the current selection"
        >
          Update from selection
        </button>

        <label className="find-replace-bar__option">
          <input
            type="checkbox"
            checked={state.excludeInstances}
            onChange={(e) => api.setExcludeInstances(e.target.checked)}
          />
          Exclude instances
        </label>
        <label className="find-replace-bar__option">
          <input
            type="checkbox"
            checked={state.excludeLocked}
            onChange={(e) => api.setExcludeLocked(e.target.checked)}
          />
          Exclude locked
        </label>
        <label className="find-replace-bar__option">
          <input
            type="checkbox"
            checked={state.excludeHidden}
            onChange={(e) => api.setExcludeHidden(e.target.checked)}
          />
          Exclude hidden
        </label>

        {state.skippedCount.instances > 0 && (
          <span className="find-replace-bar__skipped">
            Skipped {state.skippedCount.instances} instance
            {state.skippedCount.instances !== 1 ? 's' : ''}
          </span>
        )}
        {state.skippedCount.locked > 0 && (
          <span className="find-replace-bar__skipped">
            Skipped {state.skippedCount.locked} locked
          </span>
        )}
        {state.skippedCount.hidden > 0 && (
          <span className="find-replace-bar__skipped">
            Skipped {state.skippedCount.hidden} hidden
          </span>
        )}
      </div>

      {selectionLabel && (
        <div className="find-replace-bar__status">
          Scope: {selectionLabel}. The scope is frozen for this search — navigating results or
          clicking the canvas will not change it.
        </div>
      )}
      {!selectionLabel && state.spec && (
        <div className="find-replace-bar__status">
          Scope: {state.scope === 'page' ? 'current page' : 'entire document'}. Frozen for this
          search.
        </div>
      )}

      {state.status === 'searching' && <div className="find-replace-bar__status">Searching…</div>}
      {state.status === 'stale' && (
        <div className="find-replace-bar__status find-replace-bar__status--warn">
          Results are out of date — the document changed.
          <button type="button" className="find-replace-bar__status-action" onClick={api.search}>
            Search again
          </button>
        </div>
      )}
      {state.status === 'empty-selection' && (
        <div className="find-replace-bar__status find-replace-bar__status--warn">
          Nothing is selected. Select text, or choose Current page or Entire document.
        </div>
      )}

      {state.error && <div className="find-replace-bar__error">{state.error}</div>}

      {state.status === 'ready' && totalMatches === 0 && state.searchText.length > 0 && (
        <div className="find-replace-bar__no-results">
          No matches
          {state.skippedCount.locked + state.skippedCount.hidden + state.skippedCount.instances > 0
            ? ' — excluded targets are reported above'
            : ''}
        </div>
      )}

      {state.lastApplied !== null && (
        <div className="find-replace-bar__status" role="status" aria-live="polite">
          Replaced {state.lastApplied} occurrence{state.lastApplied === 1 ? '' : 's'} — Undo to
          restore.
        </div>
      )}

      <FindResultsList
        results={state.results}
        currentIndex={state.currentIndex}
        checked={checked}
        truncated={state.truncated}
        onToggleChecked={(id, isChecked) =>
          setChecked((prev) => {
            const next = new Set(prev);
            if (isChecked) next.add(id);
            else next.delete(id);
            return next;
          })
        }
        onSelect={(_match, index) => api.selectResult(index)}
      />
    </div>
  );
}
