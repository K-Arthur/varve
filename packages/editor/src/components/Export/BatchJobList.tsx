/**
 * Batch job list — lists all export jobs with status, select-all, search filter,
 * format filtering, and per-row checkbox.
 */

import type { ExportJob } from '@varve/scene';
import { Icon } from '@varve/ui';
import { useMemo, useState } from 'react';
import { FormatBadge, formatLabel } from './FormatBadge';
import { formatFileSize } from './formatBytes';

import './BatchJobList.css';

export interface BatchJobListProps {
  jobs: ExportJob[];
  selectedIds: Set<string>;
  onToggleJob: (jobId: string) => void;
  onToggleAll: () => void;
  /** Replaces the default "No export jobs" line when the list is empty. */
  emptyState?: React.ReactNode;
}

function StatusIcon({ status }: { status: ExportJob['status'] }) {
  switch (status) {
    case 'pending':
      return <Icon name="Clock" size={13} label="Pending" />;
    case 'running':
      return <Icon name="LoaderCircle" size={13} className="batch-job-row__spin" label="Running" />;
    case 'done':
      return <Icon name="Check" size={13} label="Done" />;
    case 'error':
      return <Icon name="CircleAlert" size={13} label="Error" />;
  }
}

interface VirtualizedListProps {
  children: React.ReactNode[];
  itemCount: number;
}

function VirtualizedList({ children, itemCount }: VirtualizedListProps) {
  if (itemCount <= 50) {
    return <>{children}</>;
  }
  return <div className="batch-job-list__virtual">{children}</div>;
}

export function BatchJobList({
  jobs,
  selectedIds,
  onToggleJob,
  onToggleAll,
  emptyState,
}: BatchJobListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);

  const allSelected = jobs.length > 0 && selectedIds.size === jobs.length;

  const formatCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of jobs) {
      const fmt = job.format.toLowerCase();
      counts.set(fmt, (counts.get(fmt) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([format, count]) => ({ format, count }));
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (selectedFormat && job.format.toLowerCase() !== selectedFormat) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        return job.fileName.toLowerCase().includes(q);
      }
      return true;
    });
  }, [jobs, selectedFormat, searchQuery]);

  const rows = useMemo(() => {
    return filteredJobs.map((job) => {
      const isSelected = selectedIds.has(`${job.nodeId}-${job.presetId}`);
      return (
        <div
          key={`${job.nodeId}-${job.presetId}`}
          className={`batch-job-row${isSelected ? ' batch-job-row--selected' : ''}`}
        >
          <label className="batch-job-row__checkbox">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleJob(`${job.nodeId}-${job.presetId}`)}
              aria-label={`Include ${job.fileName}`}
            />
          </label>
          <span className="batch-job-row__name" title={job.fileName}>
            {job.fileName}
          </span>
          <span className="batch-job-row__format">
            <FormatBadge format={job.format} />
          </span>
          <span className="batch-job-row__dims">
            {job.dimensions.w} {'\u00d7'} {job.dimensions.h}
            {job.outputPpi ? (
              <>
                {' '}
                <span className="batch-job-row__ppi">{Math.round(job.outputPpi)} PPI</span>
              </>
            ) : null}
          </span>
          <span className="batch-job-row__size">{formatFileSize(job.estimatedSize)}</span>
          <span className={`batch-job-row__status batch-job-row__status--${job.status}`}>
            <StatusIcon status={job.status} />
            <span className="sr-only">{job.status}</span>
          </span>
        </div>
      );
    });
  }, [filteredJobs, selectedIds, onToggleJob]);

  return (
    <fieldset className="batch-job-list" aria-label="Export jobs">
      {jobs.length > 1 && (
        <div className="batch-job-list__toolbar">
          <div className="batch-job-list__search-wrap">
            <Icon name="Search" size={13} className="batch-job-list__search-icon" />
            <input
              type="search"
              className="batch-job-list__search"
              placeholder="Filter files…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Filter files"
            />
            {searchQuery && (
              <button
                type="button"
                className="batch-job-list__clear-search"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <Icon name="X" size={12} />
              </button>
            )}
          </div>
          {formatCounts.length > 1 && (
            <div
              className="batch-job-list__format-filters"
              role="toolbar"
              aria-label="Filter by format"
            >
              <button
                type="button"
                className={`batch-job-list__filter-btn${selectedFormat === null ? ' batch-job-list__filter-btn--active' : ''}`}
                aria-pressed={selectedFormat === null}
                onClick={() => setSelectedFormat(null)}
              >
                All ({jobs.length})
              </button>
              {formatCounts.map(({ format, count }) => (
                <button
                  key={format}
                  type="button"
                  className={`batch-job-list__filter-btn${selectedFormat === format ? ' batch-job-list__filter-btn--active' : ''}`}
                  aria-pressed={selectedFormat === format}
                  onClick={() => setSelectedFormat(selectedFormat === format ? null : format)}
                >
                  {formatLabel(format)} ({count})
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="batch-job-list__header">
        <label className="batch-job-list__select-all">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleAll}
            aria-label="Select all jobs"
          />
        </label>
        <span className="batch-job-list__col-name">File</span>
        <span className="batch-job-list__col-format">Format</span>
        <span className="batch-job-list__col-dims">Dimensions</span>
        <span className="batch-job-list__col-est">Size</span>
        <span className="batch-job-list__col-status">Status</span>
      </div>

      <VirtualizedList itemCount={filteredJobs.length}>{rows}</VirtualizedList>

      {jobs.length === 0 &&
        (emptyState ?? <div className="batch-job-list__empty">No export jobs to display.</div>)}

      {jobs.length > 0 && filteredJobs.length === 0 && (
        <div className="batch-job-list__empty">
          <p>No jobs match "{searchQuery}"</p>
          <button
            type="button"
            className="batch-job-list__clear-filter-btn"
            onClick={() => {
              setSearchQuery('');
              setSelectedFormat(null);
            }}
          >
            Clear filters
          </button>
        </div>
      )}
    </fieldset>
  );
}
