import type { BatchImportResult, ImportReport } from '@varve/import';
import { type KeyboardEvent, useCallback, useState } from 'react';

import './ImportResults.css';

export interface ImportResultsProps {
  result: BatchImportResult | ImportReport;
  onClose: () => void;
}

interface ImportResultRow {
  name: string;
  status: 'success' | 'partial' | 'failed' | 'unsupported';
  warnings: string[];
}

function isServiceReport(result: BatchImportResult | ImportReport): result is ImportReport {
  return 'files' in result;
}

function rowsFor(result: BatchImportResult | ImportReport): ImportResultRow[] {
  if (!isServiceReport(result)) {
    return result.results.map((file) => ({
      name: file.name,
      status: file.success ? 'success' : 'failed',
      warnings: file.warnings,
    }));
  }
  return result.files.map((file) => ({
    name: file.name,
    status: file.status,
    warnings: [
      ...file.warnings.map((issue) => issue.message),
      ...file.unsupportedFeatures.map((feature) => feature.message),
      ...(file.error ? [file.error] : []),
    ],
  }));
}

export function ImportResults({ result, onClose }: ImportResultsProps) {
  const [expanded, setExpanded] = useState(false);
  const rows = rowsFor(result);
  const serviceReport = isServiceReport(result);
  const successCount = result.successCount;
  const partialCount = serviceReport ? result.partialCount : 0;
  const failCount = serviceReport ? result.failureCount : result.failCount;
  const unsupportedCount = serviceReport ? result.unsupportedCount : 0;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  const hasFailures = failCount > 0;
  const warningFileCount = rows.filter((file) => file.warnings.length > 0).length;

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
          {successCount > 0 && (
            <p className="import-results__stat import-results__stat--success">
              {successCount} file{successCount !== 1 ? 's' : ''} imported successfully
            </p>
          )}
          {partialCount > 0 && (
            <p className="import-results__stat import-results__stat--warn">
              {partialCount} file{partialCount !== 1 ? 's' : ''} imported with fidelity changes
            </p>
          )}
          {hasFailures && (
            <p className="import-results__stat import-results__stat--fail">
              {failCount} file{failCount !== 1 ? 's' : ''} failed or could not be imported
            </p>
          )}
          {unsupportedCount > 0 && (
            <p className="import-results__stat import-results__stat--fail">
              {unsupportedCount} file{unsupportedCount !== 1 ? 's' : ''} used an unsupported format
            </p>
          )}
          {!hasFailures && successCount === 0 && partialCount === 0 && (
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

        {rows.length > 0 && (
          <div className="import-results__files">
            <button
              type="button"
              className="import-results__toggle"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Hide' : 'Show'} details ({rows.length} files)
            </button>

            {expanded && (
              <ul className="import-results__list">
                {rows.map((file, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: file names can repeat across imports; rows are stateless (no id in BatchFileResult)
                  <li key={i} className="import-results__file">
                    <span
                      className={`import-results__file-icon import-results__file-icon--${file.status}`}
                    >
                      {file.status === 'success' ? (
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
                    {file.status === 'partial' && file.warnings.length === 0 && (
                      <span className="import-results__file-warnings">(fidelity changes)</span>
                    )}
                    {file.warnings.length > 0 && (
                      <span className="import-results__file-warnings">
                        ({file.warnings.length} warning{file.warnings.length !== 1 ? 's' : ''})
                      </span>
                    )}
                    {expanded && file.warnings.length > 0 && (
                      <ul className="import-results__file-warning-list">
                        {file.warnings.map((w, j) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: stateless warning strings; content keys would collide on duplicates
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

        {warningFileCount > 0 && (
          <div role="status" aria-live="polite" className="varve-visually-hidden">
            Import complete: {successCount} succeeded, {partialCount} partially converted,{' '}
            {failCount} failed, {warningFileCount} files with warnings
          </div>
        )}
      </div>
    </div>
  );
}
