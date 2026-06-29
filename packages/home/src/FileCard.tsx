import type { FileEntry } from '@strata/platform';
import { formatBytes, formatRelativeTime } from '@strata/platform';
import {
  type ButtonHTMLAttributes,
  forwardRef,
  type KeyboardEvent,
  useEffect,
  useRef,
} from 'react';

export interface FileCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  entry: FileEntry;
  thumbnail: string | null | undefined;
  thumbnailLoading: boolean;
  selected: boolean;
  onOpen: (entry: FileEntry) => void;
  onContext: (e: React.MouseEvent, entry: FileEntry) => void;
}

export const FileCard = forwardRef<HTMLButtonElement, FileCardProps>(function FileCard(
  { entry, thumbnail, thumbnailLoading, selected, onOpen, onContext, className = '', ...rest },
  ref,
) {
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (thumbnail && thumbRef.current) {
      const img = new Image();
      img.src = thumbnail;
      img.alt = '';
      img.className = 'file-card__thumb-img';
      thumbRef.current.innerHTML = '';
      thumbRef.current.appendChild(img);
    }
  }, [thumbnail]);

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(entry);
    }
  };

  return (
    <button
      ref={ref}
      type="button"
      role="gridcell"
      aria-label={`${entry.name}, ${entry.kind}, ${formatRelativeTime(entry.updatedAt)}`}
      aria-selected={selected}
      className={`file-card ${selected ? 'file-card--selected' : ''} ${className}`.trim()}
      onClick={() => onOpen(entry)}
      onContextMenu={(e) => onContext(e, entry)}
      onKeyDown={handleKey}
      {...rest}
    >
      <div className="file-card__thumb" ref={thumbRef}>
        {thumbnailLoading && !thumbnail && <div className="file-card__skeleton" />}
      </div>
      <div className="file-card__body">
        <span className="file-card__name" title={entry.name}>
          {entry.name}
        </span>
        <div className="file-card__meta">
          <span className="file-card__badge">{entry.kind}</span>
          <span>{formatRelativeTime(entry.updatedAt)}</span>
          {entry.size > 0 && <span>{formatBytes(entry.size)}</span>}
        </div>
      </div>
    </button>
  );
});
