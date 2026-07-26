import { Icon, Select } from '@strata/ui';
import { useCallback, useEffect, useRef } from 'react';
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
  const replaceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.open && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.select();
    }
  }, [state.open]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          api.goToPrev();
        } else {
          if (state.status === 'idle' || state.status === 'stale') {
            api.search();
          } else {
            api.goToNext();
          }
        }
      }
      if (e.key === 'Escape') {
        (onRequestClose ?? api.close)();
      }
    },
    [api, onRequestClose, state.status],
  );

  const handleReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const currentMatch = state.results[state.currentIndex];
        if (currentMatch) {
          api.replace(currentMatch);
        }
      }
      if (e.key === 'Escape') {
        (onRequestClose ?? api.close)();
      }
    },
    [api, onRequestClose, state],
  );

  if (!state.open) return null;

  const totalMatches = state.results.length;
  const currentDisplay = totalMatches > 0 ? state.currentIndex + 1 : 0;
  const currentMatch = state.results[state.currentIndex];

  const statusText = (() => {
    switch (state.status) {
      case 'searching':
        return 'Searching…';
      case 'stale':
        return 'Results out of date — search again';
      default:
        return '';
    }
  })();

  return (
    <div className="find-replace-bar" role="dialog" aria-label="Find and replace">
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
            data-shortcut-ignore
            aria-label="Find text"
          />
          <span className="find-replace-bar__counter">
            {state.status === 'ready' ? `${currentDisplay} of ${totalMatches}` : ''}
          </span>
          <div className="find-replace-bar__nav-buttons">
            <button
              type="button"
              className="find-replace-bar__nav-btn"
              onClick={api.goToPrev}
              disabled={totalMatches === 0}
              aria-label="Previous match"
              title="Previous match (Shift+Enter)"
            >
              <Icon name="ChevronUp" label="" />
            </button>
            <button
              type="button"
              className="find-replace-bar__nav-btn"
              onClick={api.goToNext}
              disabled={totalMatches === 0}
              aria-label="Next match"
              title="Next match (Enter)"
            >
              <Icon name="ChevronDown" label="" />
            </button>
            <button
              type="button"
              className="find-replace-bar__nav-btn"
              onClick={onRequestClose ?? api.close}
              aria-label="Close find and replace"
              title="Close (Escape)"
            >
              <Icon name="X" label="" />
            </button>
          </div>
        </div>

        <div className="find-replace-bar__replace-row">
          <input
            ref={replaceInputRef}
            type="text"
            className="find-replace-bar__input"
            placeholder="Replace…"
            value={state.replaceText}
            onChange={(e) => api.setReplaceText(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
            data-shortcut-ignore
            aria-label="Replace text"
          />
          <button
            type="button"
            className="find-replace-bar__action-btn"
            onClick={() => currentMatch && api.replace(currentMatch)}
            disabled={!currentMatch}
          >
            Replace
          </button>
          <button
            type="button"
            className="find-replace-bar__action-btn"
            onClick={api.replaceAll}
            disabled={totalMatches === 0}
          >
            Replace All
          </button>
        </div>
      </div>

      <div className="find-replace-bar__options">
        <label className="find-replace-bar__option">
          <input
            type="checkbox"
            checked={state.options.caseSensitive}
            onChange={(e) => api.setOption('caseSensitive', e.target.checked)}
          />
          Case
        </label>
        <label className="find-replace-bar__option">
          <input
            type="checkbox"
            checked={state.options.wholeWord}
            onChange={(e) => api.setOption('wholeWord', e.target.checked)}
          />
          Word
        </label>
        <label className="find-replace-bar__option">
          <input
            type="checkbox"
            checked={state.options.useRegex}
            onChange={(e) => api.setOption('useRegex', e.target.checked)}
          />
          Regex
        </label>
        <label className="find-replace-bar__option">
          <input
            type="checkbox"
            checked={state.options.matchDiacritics}
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

      {statusText && (
        <div
          className={`find-replace-bar__status ${state.status === 'stale' ? 'find-replace-bar__status--warn' : ''}`}
        >
          {statusText}
          {state.status === 'stale' && (
            <button type="button" className="find-replace-bar__status-action" onClick={api.search}>
              Search again
            </button>
          )}
        </div>
      )}

      {state.error && <div className="find-replace-bar__error">{state.error}</div>}

      {state.status === 'ready' && state.results.length === 0 && state.searchText.length > 0 && (
        <div className="find-replace-bar__no-results">No matches found</div>
      )}

      <FindResultsList
        results={state.results}
        currentIndex={state.currentIndex}
        onSelect={(_match, index) => api.selectResult(index)}
      />
    </div>
  );
}
