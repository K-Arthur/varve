import type { BatchImportResult } from '@varve/import';
import { useCallback, useState } from 'react';

import './ImportResults.css';

export interface ImportResultsProps {
  result: BatchImportResult;
  onClose: () => void;
}

export function ImportResults({ result, onClose }: ImportResultsProps) {
  const [expanded, setExpanded] = useState(false);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  const hasFailures = result.failCount > 0;
  const warningFileCount = result.results.filter((r) => r.warnings.length > 0).length;

  return (
    <div
      className="import-results-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Import results"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="import-results">
        <div className="import-results__header">
          <h2 className="import-results__title">Import Results</h2>
          <button
            type="button"
            className="import-results__close"
            aria-label="Close"
            onClick={onClose}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="import-results__summary">
          {result.successCount > 0 && (
            <p className="import-results__stat import-results__stat--success">
              {result.successCount} file{result.successCount !== 1 ? 's' : ''} imported successfully
            </p>
          )}
          {hasFailures && (
            <p className="import-results__stat import-results__stat--fail">
              {result.failCount} file{result.failCount !== 1 ? 's' : ''} failed
            </p>
          )}
          {!hasFailures && result.successCount === 0 && (
            <p className="import-results__stat import-results__stat--empty">
              No files were imported
            </p>
          )}
          {warningFileCount > 0 && (
            <p className="import-results__stat import-results__stat--warn">
              {warningFileCount} file{warningFileCount !== 1 ? 's' : ''} with warnings
            </p>
          )}
        </div>

        {result.results.length > 0 && (
          <div className="import-results__files">
            <button
              type="button"
              className="import-results__toggle"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Hide' : 'Show'} details ({result.results.length} files)
            </button>

            {expanded && (
              <ul className="import-results__list">
                {result.results.map((file, i) => (
                  <li key={i} className="import-results__file">
                    <span className="import-results__file-icon">
                      {file.success ? (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      ) : (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      )}
                    </span>
                    <span className="import-results__file-name">{file.name}</span>
                    {file.warnings.length > 0 && (
                      <span className="import-results__file-warnings">
                        ({file.warnings.length} warning{file.warnings.length !== 1 ? 's' : ''})
                      </span>
                    )}
                    {expanded && file.warnings.length > 0 && (
                      <ul className="import-results__file-warning-list">
                        {file.warnings.map((w, j) => (
                          <li key={j}>{w}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="import-results__footer">
          <button
            type="button"
            className="import-results__btn import-results__btn--primary"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {result.warnings.length > 0 && (
          <div role="status" aria-live="polite" className="varve-visually-hidden">
            Import complete: {result.successCount} succeeded, {result.failCount} failed,{' '}
            {result.warnings.length} warnings
          </div>
        )}
      </div>
    </div>
  );
}
