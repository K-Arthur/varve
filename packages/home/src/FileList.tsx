import { useVirtualizer } from '@tanstack/react-virtual';
import type { FileEntry, SortDirection, SortKey } from '@varve/platform';
import { formatBytes, formatRelativeTime } from '@varve/platform';
import { Icon, Thumbnail } from '@varve/ui';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';

export interface FileListProps {
  files: readonly FileEntry[];
  thumbnails: Map<string, string | null>;
  onLoadThumbnail: (entry: FileEntry) => void;
  onOpen: (entry: FileEntry) => void;
  onContext: (e: React.MouseEvent, entry: FileEntry) => void;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  selectedIds?: string[];
  onSelect: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onSelectRange: (fromIdx: number, toIdx: number) => void;
  onSelectAll: () => void;
  onRename?: (id: string, newName: string) => void;
  renamingId?: string | null;
  onStartRename?: (id: string | null) => void;
  missingFiles?: Set<string>;
  onToggleFavorite?: (entry: FileEntry) => void;
  onPin?: (entry: FileEntry) => void;
}

const ROW_HEIGHT = 48;

export function FileList({
  files,
  thumbnails,
  onLoadThumbnail,
  onOpen,
  onContext,
  sortKey,
  sortDirection,
  onSort,
  selectedIds = [],
  onSelect,
  onToggleSelect,
  onSelectRange,
  onSelectAll,
  onRename,
  renamingId,
  onStartRename,
  missingFiles = new Set(),
  onToggleFavorite,
  onPin,
}: FileListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);
  const typeAheadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const typeAheadBufferRef = useRef('');
  const [renameValues, setRenameValues] = useState<Record<string, string>>({});

  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  useEffect(() => {
    const start = Math.max(0, focusIdx - 5);
    const end = Math.min(files.length, focusIdx + 10);
    for (let i = start; i < end; i++) {
      const entry = files[i];
      if (entry && !thumbnails.has(entry.id)) {
        onLoadThumbnail(entry);
      }
    }
  }, [files, focusIdx, thumbnails, onLoadThumbnail]);

  const navigate = useCallback(
    (dir: number) => {
      setFocusIdx((i) => Math.max(0, Math.min(i + dir, files.length - 1)));
    },
    [files.length],
  );

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigate(1);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigate(-1);
      }
      if (e.key === 'Home') {
        e.preventDefault();
        setFocusIdx(0);
      }
      if (e.key === 'End') {
        e.preventDefault();
        setFocusIdx(files.length - 1);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const file = files[focusIdx];
        if (!file) return;
        onOpen(file);
      }
      if (isCtrl && e.key === 'a') {
        e.preventDefault();
        onSelectAll();
      }
      if (e.key === 'F2') {
        e.preventDefault();
        const entry = files[focusIdx];
        if (entry) {
          onStartRename?.(entry.id);
          setRenameValues((prev) => ({ ...prev, [entry.id]: entry.name }));
        }
      }

      // Type-ahead navigation
      if (!isCtrl && e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
        e.preventDefault();
        const char = e.key.toLowerCase();

        // Clear existing timeout
        if (typeAheadTimeoutRef.current) {
          clearTimeout(typeAheadTimeoutRef.current);
        }

        // Append to buffer
        typeAheadBufferRef.current += char;

        // Find first matching file
        const matchIdx = files.findIndex((f) =>
          f.name.toLowerCase().startsWith(typeAheadBufferRef.current),
        );

        if (matchIdx >= 0) {
          setFocusIdx(matchIdx);
        }

        // Set timeout to clear buffer
        typeAheadTimeoutRef.current = setTimeout(() => {
          typeAheadBufferRef.current = '';
        }, 800);
      }
    },
    [navigate, focusIdx, onOpen, files, onSelectAll, onStartRename],
  );

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = renameValues[id];
        if (value?.trim() && value !== files.find((f) => f.id === id)?.name) {
          onRename?.(id, value.trim());
        }
        onStartRename?.(null); // Exit rename mode
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setRenameValues((prev) => ({ ...prev, [id]: files.find((f) => f.id === id)?.name ?? '' }));
        onStartRename?.(null); // Exit rename mode
      }
    },
    [renameValues, files, onRename, onStartRename],
  );

  const handleRenameBlur = useCallback(
    (id: string) => {
      const value = renameValues[id];
      if (value?.trim() && value !== files.find((f) => f.id === id)?.name) {
        onRename?.(id, value.trim());
      }
      onStartRename?.(null); // Exit rename mode
    },
    [renameValues, files, onRename, onStartRename],
  );

  const handleRowClick = useCallback(
    (e: React.MouseEvent, fileIdx: number) => {
      const entry = files[fileIdx];
      if (!entry) return;

      const isCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      if (isCtrl && isShift) {
        // Ctrl+Shift: range selection while preserving existing selection
        if (lastSelectedIdx !== null) {
          onSelectRange(lastSelectedIdx, fileIdx);
        } else {
          onSelectRange(0, fileIdx);
        }
      } else if (isShift) {
        // Shift: range selection, clear previous selection
        if (lastSelectedIdx !== null) {
          onSelectRange(lastSelectedIdx, fileIdx);
        } else {
          onSelectRange(0, fileIdx);
        }
      } else if (isCtrl) {
        // Ctrl: toggle selection
        onToggleSelect(entry.id);
        setLastSelectedIdx(fileIdx);
      } else {
        // Normal click: select single item
        onSelect(entry.id);
        setLastSelectedIdx(fileIdx);
      }
    },
    [files, lastSelectedIdx, onSelect, onToggleSelect, onSelectRange],
  );

  const columns: { key: SortKey; label: string; sortable: boolean }[] = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'updated', label: 'Modified', sortable: true },
    { key: 'size', label: 'Size', sortable: true },
  ];

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: ARIA grid role required for virtualized list */}
      <div
        ref={containerRef}
        role="grid"
        aria-label="File list"
        aria-rowcount={files.length}
        tabIndex={0}
        onKeyDown={handleKey}
        className="home-list"
        style={{ height: '100%', overflow: 'auto' }}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: ARIA row role required for virtualized list */}
        <div role="row" aria-rowindex={0} className="file-row file-row--header" tabIndex={-1}>
          <div />
          {columns.map((col) => (
            <>
              {/* biome-ignore lint/a11y/useSemanticElements: columnheader role required for sortable grid header */}
              <button
                key={col.key}
                type="button"
                role="columnheader"
                aria-sort={
                  sortKey === col.key
                    ? sortDirection === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
                tabIndex={-1}
                className="file-row__sort-btn"
                onClick={() => onSort(col.key)}
              >
                {col.label}
                {sortKey === col.key && (
                  <Icon
                    name={sortDirection === 'asc' ? 'ChevronUp' : 'ChevronDown'}
                    label={undefined}
                    size="0.75em"
                  />
                )}
              </button>
            </>
          ))}
          <div />
          <div />
          <div />
        </div>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const entry = files[virtualRow.index];
            if (!entry) return null;
            const isSelected = selectedIds.includes(entry.id);
            return (
              <>
                {/* biome-ignore lint/a11y/useSemanticElements: ARIA row role required for virtualized list */}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled at grid container level */}
                <div
                  key={entry.id}
                  role="row"
                  aria-rowindex={virtualRow.index + 2}
                  aria-selected={isSelected}
                  className={`file-row ${isSelected ? 'file-row--selected' : ''} ${missingFiles.has(entry.id) ? 'file-row--missing' : ''}`}
                  tabIndex={virtualRow.index === focusIdx ? 0 : -1}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${ROW_HEIGHT}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={(e) => handleRowClick(e, virtualRow.index)}
                  onContextMenu={(e) => onContext(e, entry)}
                  onFocus={() => setFocusIdx(virtualRow.index)}
                >
                  <div className="file-row__thumb">
                    <Thumbnail
                      src={thumbnails.get(entry.id)}
                      alt={entry.name}
                      radius="sm"
                      className="file-row__thumb-img"
                    />
                  </div>
                  {renamingId === entry.id ? (
                    <input
                      type="text"
                      value={renameValues[entry.id] ?? entry.name}
                      onChange={(e) =>
                        setRenameValues((prev) => ({ ...prev, [entry.id]: e.target.value }))
                      }
                      onKeyDown={(e) => handleRenameKeyDown(e, entry.id)}
                      onBlur={() => handleRenameBlur(entry.id)}
                      className="file-row__rename-input"
                      style={{
                        background: 'var(--color-surface-raised)',
                        border: '1px solid var(--color-interactive-default)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '2px 4px',
                        fontSize: 'var(--font-size-sm)',
                        fontWeight: 'var(--font-weight-medium)',
                        color: 'var(--color-text-primary)',
                        outline: 'none',
                        width: '100%',
                      }}
                    />
                  ) : (
                    <span className="file-row__name">{entry.name}</span>
                  )}
                  <span className="file-row__meta">{formatRelativeTime(entry.updatedAt)}</span>
                  <span className="file-row__meta">
                    {entry.size > 0 ? formatBytes(entry.size) : ''}
                  </span>
                  {onToggleFavorite && (
                    <button
                      type="button"
                      className={`file-row__fav ${entry.favoritedAt && entry.favoritedAt > 0 ? 'file-row__fav--active' : ''}`}
                      aria-label={
                        entry.favoritedAt && entry.favoritedAt > 0
                          ? 'Remove from Favorites'
                          : 'Add to Favorites'
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(entry);
                      }}
                    >
                      <Icon
                        name="Star"
                        fill={entry.favoritedAt && entry.favoritedAt > 0 ? 'currentColor' : 'none'}
                        label={undefined}
                        size="0.85em"
                      />
                    </button>
                  )}
                  <span className="file-card__badge">{entry.kind}</span>
                  <button
                    type="button"
                    className="file-row__pin"
                    aria-pressed={entry.pinned}
                    aria-label={entry.pinned ? 'Unpin' : 'Pin'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPin?.(entry);
                    }}
                  >
                    <Icon name={entry.pinned ? 'Pin' : 'PinOff'} label={undefined} size="0.85em" />
                  </button>
                </div>
              </>
            );
          })}
        </div>
      </div>
    </>
  );
}
