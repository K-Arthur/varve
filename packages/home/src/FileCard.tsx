import type { FileEntry } from '@varve/platform';
import { fileKindLabel, formatRelativeTime } from '@varve/platform';
import {
  SemanticIcon,
  SOLID_CHROME_ICONS,
  SolidIcon,
  SortableItemHandle,
  Thumbnail,
  Tooltip,
  useSortableItem,
} from '@varve/ui';
import {
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

export interface FileCardProps extends HTMLAttributes<HTMLDivElement> {
  entry: FileEntry;
  thumbnail: string | null | undefined;
  thumbnailLoading: boolean;
  selected: boolean;
  onOpen: (entry: FileEntry) => void;
  onContext: (e: React.MouseEvent, entry: FileEntry) => void;
  onClick?: (e: React.MouseEvent) => void;
  onRename?: (id: string, newName: string) => void;
  isRenaming?: boolean;
  /** Pass entry.id to enter rename, null to exit (matches FileList). */
  onStartRename?: (id: string | null) => void;
  isMissing?: boolean;
  onToggleFavorite?: (entry: FileEntry) => void;
}

export const FileCard = forwardRef<HTMLDivElement, FileCardProps>(function FileCard(
  {
    entry,
    thumbnail,
    thumbnailLoading,
    selected,
    onOpen,
    onContext,
    onClick,
    onRename,
    isRenaming = false,
    onStartRename,
    isMissing = false,
    onToggleFavorite,
    className = '',
    style: styleProp,
    ...rest
  },
  ref,
) {
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [renameValue, setRenameValue] = useState(entry.name);
  const sortable = useSortableItem({ id: entry.id, data: { type: 'file', fileId: entry.id } });
  const dndStyle: React.CSSProperties = {
    transform: sortable.renderProps.transform,
    transition: sortable.renderProps.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
  };
  const mergedStyle = { ...styleProp, ...dndStyle };

  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      sortable.setNodeRef(node);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref, sortable.setNodeRef],
  );

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

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
        onStartRename?.(null);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setRenameValue(entry.name);
        onStartRename?.(null);
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
    onStartRename?.(null);
  }, [renameValue, entry.id, entry.name, onRename, onStartRename]);

  useEffect(() => {
    setRenameValue(entry.name);
  }, [entry.name]);

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick?.(e as unknown as React.MouseEvent);
    }
    if (e.key === 'F2') {
      e.preventDefault();
      onStartRename?.(entry.id);
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: ARIA gridcell role required for virtualized grid; div used to allow nested interactive children (fav button, rename input)
    <div
      ref={mergedRef}
      aria-label={`${entry.name}, ${fileKindLabel(entry.kind)}, ${formatRelativeTime(entry.updatedAt)}${isMissing ? ', file missing' : ''}`}
      aria-selected={selected}
      className={`file-card bento-cell ${selected ? 'file-card--selected' : ''} ${isMissing ? 'file-card--missing' : ''} ${className}`.trim()}
      style={mergedStyle}
      onClick={onClick}
      onDoubleClick={() => onOpen(entry)}
      onContextMenu={(e) => onContext(e, entry)}
      tabIndex={0}
      role="gridcell"
      onKeyDown={handleKey}
      {...rest}
    >
      <div className="file-card__thumb">
        <SortableItemHandle
          sortable={sortable.renderProps}
          className="file-card__drag-handle"
          aria-label={`Drag ${entry.name} to reorder`}
        >
          <SolidIcon name={SOLID_CHROME_ICONS.gripVertical} size="0.75em" />
        </SortableItemHandle>
        <Thumbnail
          src={thumbnail}
          alt={entry.name}
          pending={thumbnailLoading && !thumbnail}
          unavailable={isMissing}
          className="file-card__thumb-img"
        />
        {entry.kind && <span className="file-card__thumb-badge">{fileKindLabel(entry.kind)}</span>}
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
            style={{ width: '100%' }}
          />
        ) : (
          <Tooltip label={entry.name} truncationOnly>
            <span className="file-card__name">{entry.name}</span>
          </Tooltip>
        )}
        <div className="file-card__meta">
          {onToggleFavorite && (
            <button
              type="button"
              className={`file-card__fav ${entry.favoritedAt && entry.favoritedAt > 0 ? 'file-card__fav--active' : ''}`}
              aria-label={
                entry.favoritedAt && entry.favoritedAt > 0
                  ? 'Remove from Favorites'
                  : 'Add to Favorites'
              }
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onToggleFavorite(entry);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <SemanticIcon
                name="Star"
                size="xs"
                fill={entry.favoritedAt && entry.favoritedAt > 0 ? 'currentColor' : 'none'}
              />
            </button>
          )}
          <span>{formatRelativeTime(entry.updatedAt)}</span>
        </div>
      </div>
    </div>
  );
});
