import type { IngestFileLike } from '@varve/shared';
import { formatFileSize } from '@varve/shared';
import { Icon } from '../icons';
import { Button } from './Button';
import { FileError } from './FileError';

export type FileQueueStatus = 'queued' | 'processing' | 'complete' | 'failed' | 'cancelled';

export interface FileQueueItem<T extends IngestFileLike = IngestFileLike> {
  id: string;
  file: T;
  status: FileQueueStatus;
  progress?: number;
  error?: string;
}

export interface FileQueueProps<T extends IngestFileLike = IngestFileLike> {
  items: readonly FileQueueItem<T>[];
  label?: string;
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  className?: string;
}

function statusLabel(status: FileQueueStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'processing':
      return 'Processing';
    case 'complete':
      return 'Complete';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
  }
}

function statusIcon(
  status: FileQueueStatus,
): 'Clock3' | 'LoaderCircle' | 'CircleCheck' | 'CircleAlert' | 'CircleX' {
  switch (status) {
    case 'queued':
      return 'Clock3';
    case 'processing':
      return 'LoaderCircle';
    case 'complete':
      return 'CircleCheck';
    case 'failed':
      return 'CircleAlert';
    case 'cancelled':
      return 'CircleX';
  }
}

/** Ordered, compact batch feedback. Feature code owns the queue state. */
export function FileQueue<T extends IngestFileLike>({
  items,
  label = 'Selected files',
  onRemove,
  onRetry,
  className = '',
}: FileQueueProps<T>) {
  const complete = items.filter((item) => item.status === 'complete').length;
  const failed = items.filter((item) => item.status === 'failed').length;

  if (items.length === 0) return null;

  return (
    <section className={`file-queue ${className}`} aria-label={label}>
      <div className="file-queue__summary" role="status" aria-live="polite">
        <span>
          {items.length} file{items.length === 1 ? '' : 's'} selected
        </span>
        {(complete > 0 || failed > 0) && (
          <span>
            {complete} complete{failed > 0 ? ` · ${failed} failed` : ''}
          </span>
        )}
      </div>
      <ul className="file-queue__list">
        {items.map((item) => {
          const progress = Math.max(0, Math.min(100, item.progress ?? 0));
          return (
            <li key={item.id} className={`file-queue__item file-queue__item--${item.status}`}>
              <Icon
                name={statusIcon(item.status)}
                label={undefined}
                className="file-queue__status-icon"
              />
              <div className="file-queue__details">
                <span className="file-queue__name" title={item.file.name}>
                  {item.file.name}
                </span>
                <span className="file-queue__meta">
                  {formatFileSize(item.file.size)}
                  {item.file.type ? ` · ${item.file.type}` : ''} · {statusLabel(item.status)}
                </span>
                {item.status === 'processing' && (
                  <div
                    className="file-queue__progress"
                    role="progressbar"
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Processing ${item.file.name}`}
                  >
                    <span style={{ width: `${progress}%` }} />
                  </div>
                )}
                {item.error && <FileError message={item.error} compact />}
              </div>
              <div className="file-queue__actions">
                {item.status === 'failed' && onRetry && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRetry(item.id)}
                    aria-label={`Retry ${item.file.name}`}
                  >
                    Retry
                  </Button>
                )}
                {onRemove && item.status !== 'processing' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemove(item.id)}
                    aria-label={`Remove ${item.file.name}`}
                  >
                    <Icon name="X" label={undefined} />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
