import { Icon } from '@strata/ui';
import { useCallback, useEffect, useRef } from 'react';
import type { FindReplaceAPI } from '../../findReplace/useFindReplace';

export function FindReplaceBar({ api }: { api: FindReplaceAPI }) {
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
        api.close();
      }
    },
    [api, state.status],
  );

  const handleReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (state.results.length > 0) {
          api.replace(state.results[state.currentIndex]);
        }
      }
      if (e.key === 'Escape') {
        api.close();
      }
    },
    [api, state],
  );

  if (!state.open) return null;

  const totalMatches = state.results.length;
  const currentDisplay = totalMatches > 0 ? state.currentIndex + 1 : 0;

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
            onClick={() => totalMatches > 0 && api.replace(state.results[state.currentIndex])}
            disabled={totalMatches === 0}
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

        <label className="find-replace-bar__option">
          Scope:
          <select
            value={state.scope}
            onChange={(e) => api.setScope(e.target.value as 'selection' | 'page' | 'document')}
          >
            <option value="selection">Selection</option>
            <option value="page">Current page</option>
            <option value="document">Entire document</option>
          </select>
        </label>

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

      <style>{`
        .find-replace-bar {
          position: absolute;
          top: 0;
          right: 0;
          z-index: 100;
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 6px;
          padding: 8px 12px;
          min-width: 420px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
          font-size: 12px;
        }
        .find-replace-bar__row {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .find-replace-bar__search-row, .find-replace-bar__replace-row {
          display: flex;
          gap: 4px;
          align-items: center;
        }
        .find-replace-bar__input {
          flex: 1;
          background: var(--color-surface-2, #2a2a2a);
          border: 1px solid var(--color-border, #444);
          border-radius: 4px;
          color: var(--color-text, #ddd);
          padding: 4px 8px;
          font-size: 12px;
          outline: none;
        }
        .find-replace-bar__input:focus {
          border-color: var(--color-accent, #0891b2);
        }
        .find-replace-bar__counter {
          color: var(--color-text-secondary, #888);
          font-size: 11px;
          min-width: 60px;
          text-align: center;
        }
        .find-replace-bar__nav-buttons {
          display: flex;
          gap: 2px;
        }
        .find-replace-bar__nav-btn {
          background: none;
          border: 1px solid var(--color-border, #444);
          border-radius: 3px;
          color: var(--color-text, #ddd);
          cursor: pointer;
          padding: 2px 6px;
          font-size: 10px;
        }
        .find-replace-bar__nav-btn:disabled {
          opacity: 0.3;
          cursor: default;
        }
        .find-replace-bar__action-btn {
          background: var(--color-accent, #0891b2);
          border: none;
          border-radius: 3px;
          color: white;
          cursor: pointer;
          padding: 4px 12px;
          font-size: 11px;
          white-space: nowrap;
        }
        .find-replace-bar__action-btn:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .find-replace-bar__options {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 6px;
          align-items: center;
        }
        .find-replace-bar__option {
          display: flex;
          align-items: center;
          gap: 3px;
          color: var(--color-text-secondary, #888);
          font-size: 11px;
          cursor: pointer;
        }
        .find-replace-bar__option select {
          background: var(--color-surface-2, #2a2a2a);
          border: 1px solid var(--color-border, #444);
          color: var(--color-text, #ddd);
          border-radius: 3px;
          font-size: 11px;
          padding: 1px 4px;
        }
        .find-replace-bar__separator {
          width: 1px;
          height: 16px;
          background: var(--color-border, #444);
        }
        .find-replace-bar__skipped {
          color: var(--color-warning, #f59e0b);
          font-size: 11px;
        }
        .find-replace-bar__status {
          margin-top: 4px;
          font-size: 11px;
          color: var(--color-text-secondary, #888);
        }
        .find-replace-bar__status--warn {
          color: var(--color-warning, #f59e0b);
        }
        .find-replace-bar__status-action {
          background: none;
          border: none;
          color: var(--color-accent, #0891b2);
          cursor: pointer;
          font-size: 11px;
          text-decoration: underline;
          margin-left: 8px;
        }
        .find-replace-bar__error {
          margin-top: 4px;
          font-size: 11px;
          color: var(--color-error, #ef4444);
        }
        .find-replace-bar__no-results {
          margin-top: 4px;
          font-size: 11px;
          color: var(--color-text-secondary, #888);
        }
        .find-results-list {
          position: absolute;
          top: 100%;
          right: 0;
          z-index: 100;
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 6px;
          margin-top: 4px;
          max-height: 300px;
          overflow-y: auto;
          min-width: 420px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        }
        .find-results-group {
          padding: 4px 0;
        }
        .find-results-group__header {
          padding: 4px 12px;
          font-size: 11px;
          font-weight: 600;
          color: var(--color-text-secondary, #888);
        }
        .find-results-item {
          display: block;
          width: 100%;
          text-align: left;
          background: none;
          border: none;
          color: var(--color-text, #ddd);
          padding: 4px 12px 4px 20px;
          cursor: pointer;
          font-size: 11px;
          font-family: monospace;
        }
        .find-results-item:hover {
          background: var(--color-surface-2, #2a2a2a);
        }
        .find-results-item--active {
          background: var(--color-accent-dim, rgba(8,145,178,0.2));
        }
        .find-results-item__snippet {
          opacity: 0.8;
        }
      `}</style>
    </div>
  );
}
