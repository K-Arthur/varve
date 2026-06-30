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
  useState,
} from 'react';

export interface FileCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  entry: FileEntry;
  thumbnail: string | null | undefined;
  thumbnailLoading: boolean;
  selected: boolean;
  onOpen: (entry: FileEntry) => void;
  onContext: (e: React.MouseEvent, entry: FileEntry) => void;
  onFileDragStart?: (e: React.DragEvent, entry: FileEntry) => void;
  onClick?: (e: React.MouseEvent) => void;
  onRename?: (id: string, newName: string) => void;
  isRenaming?: boolean;
  onStartRename?: () => void;
  isMissing?: boolean;
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
    onClick,
    onRename,
    isRenaming = false,
    onStartRename,
    isMissing = false,
    className = '',
    style: styleProp,
    ...rest
  },
  ref,
) {
  const thumbRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [renameValue, setRenameValue] = useState(entry.name);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.id,
  });
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

  // Focus rename input when renaming starts
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  // Reset rename value when entry changes
  useEffect(() => {
    setRenameValue(entry.name);
  }, [entry.name]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (renameValue.trim() && renameValue !== entry.name) {
          onRename?.(entry.id, renameValue.trim());
        } else {
          setRenameValue(entry.name);
        }
        onStartRename?.(); // Exit rename mode
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setRenameValue(entry.name);
        onStartRename?.(); // Exit rename mode
      }
    },
    [renameValue, entry.id, entry.name, onRename, onStartRename],
  );

  const handleRenameBlur = useCallback(() => {
    if (renameValue.trim() && renameValue !== entry.name) {
      onRename?.(entry.id, renameValue.trim());
    } else {
      setRenameValue(entry.name);
    }
    onStartRename?.(); // Exit rename mode
  }, [renameValue, entry.id, entry.name, onRename, onStartRename]);

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
      onClick?.(e as unknown as React.MouseEvent);
    }
    if (e.key === 'F2') {
      e.preventDefault();
      onStartRename?.();
    }
  };

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: ARIA gridcell role required for virtualized grid */}
      <button
        ref={mergedRef}
        type="button"
        aria-label={`${entry.name}, ${entry.kind}, ${formatRelativeTime(entry.updatedAt)}${isMissing ? ', file missing' : ''}`}
        aria-selected={selected}
        draggable
        className={`file-card ${selected ? 'file-card--selected' : ''} ${isMissing ? 'file-card--missing' : ''} ${className}`.trim()}
        style={mergedStyle}
        onClick={onClick}
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
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={handleRenameBlur}
              className="file-card__rename-input"
              style={{
                width: '100%',
                background: 'var(--color-surface-raised)',
                border: '1px solid var(--color-interactive-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 4px',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--font-weight-medium)',
                color: 'var(--color-text-primary)',
                outline: 'none',
              }}
            />
          ) : (
            <span className="file-card__name" title={entry.name}>
              {entry.name}
            </span>
          )}
          <div className="file-card__meta">
            <span className="file-card__badge">{entry.kind}</span>
            <span>{formatRelativeTime(entry.updatedAt)}</span>
            {entry.size > 0 && <span>{formatBytes(entry.size)}</span>}
          </div>
        </div>
      </button>
    </>
  );
});
