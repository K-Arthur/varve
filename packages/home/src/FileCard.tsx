import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { FileEntry } from '@strata/platform';
import { formatBytes, formatRelativeTime } from '@strata/platform';
import {
  type ButtonHTMLAttributes,
  forwardRef,
  type KeyboardEvent,
  useCallback,
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
  onFileDragStart?: (e: React.DragEvent, entry: FileEntry) => void;
}

export const FileCard = forwardRef<HTMLButtonElement, FileCardProps>(function FileCard(
  {
    entry,
    thumbnail,
    thumbnailLoading,
    selected,
    onOpen,
    onContext,
    onFileDragStart,
    className = '',
    style: styleProp,
    ...rest
  },
  ref,
) {
  const thumbRef = useRef<HTMLDivElement>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id });
  const dndStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const mergedStyle = { ...styleProp, ...dndStyle };

  const mergedRef = useCallback(
    (node: HTMLButtonElement | null) => {
      setNodeRef(node);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref, setNodeRef],
  );

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
      ref={mergedRef}
      type="button"
      aria-label={`${entry.name}, ${entry.kind}, ${formatRelativeTime(entry.updatedAt)}`}
      aria-selected={selected}
      draggable
      className={`file-card ${selected ? 'file-card--selected' : ''} ${className}`.trim()}
      style={mergedStyle}
      onClick={() => onOpen(entry)}
      onContextMenu={(e) => onContext(e, entry)}
      onKeyDown={handleKey}
      onDragStart={(e) => onFileDragStart?.(e, entry)}
      {...attributes}
      role="gridcell"
      {...listeners}
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
