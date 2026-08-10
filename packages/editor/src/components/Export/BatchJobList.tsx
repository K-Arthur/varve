/**
 * Batch job list — lists all export jobs with status, select-all, and per-row checkbox.
 */

import type { ExportJob } from '@varve/scene';
import { useMemo } from 'react';

import './BatchJobList.css';

export interface BatchJobListProps {
  jobs: ExportJob[];
  selectedIds: Set<string>;
  onToggleJob: (jobId: string) => void;
  onToggleAll: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function statusIcon(status: ExportJob['status']): string {
  switch (status) {
    case 'pending':
      return '\u25CB';
    case 'running':
      return '\u25B6';
    case 'done':
      return '\u2713';
    case 'error':
      return '\u2717';
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
  return (
    <div className="batch-job-list__virtual" style={{ maxHeight: 400, overflowY: 'auto' }}>
      {children}
    </div>
  );
}

export function BatchJobList({ jobs, selectedIds, onToggleJob, onToggleAll }: BatchJobListProps) {
  const allSelected = jobs.length > 0 && selectedIds.size === jobs.length;

  const rows = useMemo(() => {
    return jobs.map((job) => (
      <div
        key={`${job.nodeId}-${job.presetId}`}
        className={`batch-job-row${selectedIds.has(`${job.nodeId}-${job.presetId}`) ? ' batch-job-row--selected' : ''}`}
      >
        <label className="batch-job-row__checkbox">
          <input
            type="checkbox"
            checked={selectedIds.has(`${job.nodeId}-${job.presetId}`)}
            onChange={() => onToggleJob(`${job.nodeId}-${job.presetId}`)}
            aria-label={`Include ${job.fileName}`}
          />
        </label>
        <span className="batch-job-row__name">{job.fileName}</span>
        <span className="batch-job-row__format">{job.format}</span>
        <span className="batch-job-row__dims">
          {job.dimensions.w}x{job.dimensions.h}
        </span>
        <span className="batch-job-row__size">{formatSize(job.estimatedSize)}</span>
        <span className={`batch-job-row__status batch-job-row__status--${job.status}`}>
          {statusIcon(job.status)}
          <span className="sr-only">{job.status}</span>
        </span>
      </div>
    ));
  }, [jobs, selectedIds, onToggleJob]);

  return (
    <fieldset className="batch-job-list" aria-label="Export jobs">
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
        <span className="batch-job-list__col-dims">Size</span>
        <span className="batch-job-list__col-est">Est.</span>
        <span className="batch-job-list__col-status">Status</span>
      </div>
      <VirtualizedList itemCount={jobs.length}>{rows}</VirtualizedList>
      {jobs.length === 0 && <div className="batch-job-list__empty">No export jobs to display.</div>}
    </fieldset>
  );
}
