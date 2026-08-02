/**
 * ExportResultsList — per-item results of a completed export job (Strata export
 * rebuild, M9).
 *
 * Drives the "what actually happened" feedback after a batch: every requested
 * file shows its status, bytes written, and duration; failures carry their
 * error message; a Retry failed action re-runs only the failed outputs. This
 * closes the loop on partial-failure batches — the dialog can continue after
 * nonfatal failures instead of leaving the user to guess which files landed.
 */

import { Icon } from '@strata/ui';
import type { ExportFileReport } from '../../exportService';

import './ExportResultsList.css';

export interface ExportResultsListProps {
  files: ExportFileReport[];
  /** Show a Retry failed action when any file failed. */
  onRetryFailed?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ExportResultsList({ files, onRetryFailed }: ExportResultsListProps) {
  const failed = files.filter((f) => f.status === 'failed');
  const succeeded = files.length - failed.length;

  if (files.length === 0) return null;

  return (
    <section className="export-results" aria-label="Export results">
      <div className="export-results__summary" role="status">
        {succeeded} of {files.length} exported
        {failed.length > 0 ? ` \u00b7 ${failed.length} failed` : ''}
      </div>
      <ul className="export-results__list">
        {files.map((file) => (
          <li
            key={`${file.nodeId}-${file.fileName}`}
            className={`export-results__item export-results__item--${file.status}`}
          >
            <Icon
              name={file.status === 'success' ? 'CircleCheck' : 'TriangleAlert'}
              size={14}
              className={`export-results__status-icon export-results__status-icon--${file.status}`}
              label={undefined}
            />
            <span className="export-results__file">{file.fileName}</span>
            <span className="export-results__meta">
              {file.status === 'success'
                ? `${file.mimeType} \u00b7 ${formatBytes(file.byteCount)} \u00b7 ${formatDuration(file.durationMs)}`
                : 'Failed'}
            </span>
            {file.status === 'failed' && file.error && (
              <span className="export-results__error">{file.error}</span>
            )}
          </li>
        ))}
      </ul>
      {failed.length > 0 && onRetryFailed && (
        <button type="button" className="export-results__retry" onClick={onRetryFailed}>
          <Icon name="RotateCcw" size={14} label={undefined} />
          Retry failed ({failed.length})
        </button>
      )}
    </section>
  );
}
