import type { BatchImportResult, ImportCapabilities, ImportReport } from '@varve/import';
import { Button, Dialog } from '@varve/ui';
import { useId, useState } from 'react';

import './ImportResults.css';

export interface ImportResultsProps {
  result: BatchImportResult | ImportResultReport;
  onClose: () => void;
  /** Reveal the roots that actually reached the canvas, when available. */
  onRevealSelection?: (rootIds: readonly string[], documentId?: string) => void;
}

export type ImportResultReport = ImportReport & {
  insertedCount?: number;
  committedRootIds?: readonly string[];
  documentId?: string;
  route?: 'paste' | 'import' | 'drop';
};

interface ImportResultWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

interface ImportResultRow {
  name: string;
  status: 'success' | 'partial' | 'failed' | 'unsupported';
  warnings: ImportResultWarning[];
  /** Parser capability record, when available (format-level summary). */
  capabilities?: ImportCapabilities;
}

function isServiceReport(
  result: BatchImportResult | ImportResultReport,
): result is ImportResultReport {
  return 'files' in result;
}

function rowsFor(result: BatchImportResult | ImportResultReport): ImportResultRow[] {
  if (!isServiceReport(result)) {
    return result.results.map((file) => ({
      name: file.name,
      status: file.success ? 'success' : 'failed',
      warnings: file.warnings.map((message) => ({
        code: 'batch.warning',
        message,
        severity: 'warning' as const,
      })),
    }));
  }
  return result.files.map((file) => ({
    name: file.name,
    status: file.status,
    warnings: [
      ...file.warnings.map((issue) => ({
        code: issue.code,
        message: issue.message,
        severity: issue.severity,
      })),
      ...file.unsupportedFeatures.map((feature) => ({
        code: feature.code,
        message: feature.message,
        severity: 'warning' as const,
      })),
      ...(file.error
        ? [{ code: 'import.error', message: file.error, severity: 'error' as const }]
        : []),
    ],
    ...(file.capabilities ? { capabilities: file.capabilities } : {}),
  }));
}

function capabilitySummary(capabilities: ImportCapabilities): string {
  const yes = (value: boolean) => (value ? 'preserved' : 'not preserved');
  return [
    `format-level: vectors ${yes(capabilities.vectors)}`,
    `text ${yes(capabilities.text)}`,
    `images ${yes(capabilities.images)}`,
    `multipage ${yes(capabilities.multipage)}`,
    `page size ${yes(capabilities.pageDimensions)}`,
    `masters ${yes(capabilities.masters)}`,
    `text threads ${yes(capabilities.textThreads)}`,
  ].join(' · ');
}

export function ImportResults({ result, onClose, onRevealSelection }: ImportResultsProps) {
  const [expanded, setExpanded] = useState(false);
  const detailListId = useId();
  const rows = rowsFor(result);
  const serviceReport = isServiceReport(result);
  const successCount = result.successCount;
  const partialCount = serviceReport ? result.partialCount : 0;
  const failCount = serviceReport ? result.failureCount : result.failCount;
  const unsupportedCount = serviceReport ? result.unsupportedCount : 0;
  const insertedCount = serviceReport ? result.insertedCount : undefined;
  const committedRootIds = serviceReport ? result.committedRootIds : undefined;

  const hasFailures = failCount > 0;
  const warningFileCount = rows.filter((file) => file.warnings.length > 0).length;
  const canReveal = Boolean(committedRootIds && committedRootIds.length > 0 && onRevealSelection);

  // The shared @varve/ui Dialog owns the modal contract: native showModal()
  // gives focus placement, containment, an inert background, Escape with the
  // nested-overlay guard, and focus restoration (including on unmount, which
  // is how this conditionally-mounted report is dismissed). Before this
  // migration the overlay div claimed aria-modal but never moved focus and
  // only handled Escape when focus already happened to be inside it.
  return (
    <Dialog
      open
      onClose={onClose}
      title="Import Results"
      footer={
        <>
          {canReveal && (
            <Button
              variant="ghost"
              onClick={() =>
                onRevealSelection?.(
                  committedRootIds ?? [],
                  serviceReport ? result.documentId : undefined,
                )
              }
            >
              Reveal selection
            </Button>
          )}
          <Button variant="default" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="import-results">
        <div className="import-results__summary">
          {insertedCount !== undefined && (
            <p className="import-results__stat import-results__stat--success">
              {insertedCount} layer{insertedCount !== 1 ? 's' : ''} inserted
            </p>
          )}
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
              aria-expanded={expanded}
              aria-controls={expanded ? detailListId : undefined}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Hide' : 'Show'} details ({rows.length} files)
            </button>

            {expanded && (
              <ul className="import-results__list" id={detailListId}>
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
                    {expanded && file.capabilities && (
                      <span className="import-results__file-capabilities">
                        {capabilitySummary(file.capabilities)}
                      </span>
                    )}
                    {expanded && file.warnings.length > 0 && (
                      <ul className="import-results__file-warning-list">
                        {file.warnings.map((w, j) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: stateless warning strings; content keys would collide on duplicates
                          <li key={j} data-code={w.code} data-severity={w.severity}>
                            {w.severity === 'error' ? <strong>Error: </strong> : null}
                            {w.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {warningFileCount > 0 && (
          <div role="status" aria-live="polite" className="varve-visually-hidden">
            Import complete: {successCount} succeeded, {partialCount} partially converted,{' '}
            {failCount} failed, {warningFileCount} files with warnings
          </div>
        )}
      </div>
    </Dialog>
  );
}
