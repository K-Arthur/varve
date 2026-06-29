import type { FileEntry, SortDirection, SortKey } from '@strata/platform';
import { formatBytes, formatRelativeTime } from '@strata/platform';
import { Icon } from '@strata/ui';
import { useVirtualizer } from '@tanstack/react-virtual';
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
}: FileListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(0);

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
        onOpen(files[focusIdx]!);
      }
    },
    [navigate, focusIdx, onOpen, files],
  );

  const columns: { key: SortKey; label: string; sortable: boolean }[] = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'updated', label: 'Modified', sortable: true },
    { key: 'size', label: 'Size', sortable: true },
  ];

  return (
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
      <div
        role="row"
        aria-rowindex={0}
        className="file-row"
        style={{
          cursor: 'default',
          fontWeight: 'var(--font-weight-semibold)',
          borderBottom: '2px solid var(--color-border-strong)',
        }}
      >
        <div />
        {columns.map((col) => (
          <button
            key={col.key}
            type="button"
            role="columnheader"
            aria-sort={
              sortKey === col.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
            }
            tabIndex={-1}
            className="file-row__name"
            style={{
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              textAlign: 'left',
              font: 'inherit',
              color: 'inherit',
            }}
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
        ))}
        <div />
      </div>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const entry = files[virtualRow.index];
          if (!entry) return null;
          const isSelected = selectedIds.includes(entry.id);
          return (
            <div
              key={entry.id}
              role="row"
              aria-rowindex={virtualRow.index + 2}
              aria-selected={isSelected}
              className={`file-row ${isSelected ? 'file-row--selected' : ''}`}
              tabIndex={virtualRow.index === focusIdx ? 0 : -1}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${ROW_HEIGHT}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              onClick={() => onOpen(entry)}
              onContextMenu={(e) => onContext(e, entry)}
              onFocus={() => setFocusIdx(virtualRow.index)}
            >
              <div className="file-row__thumb">
                {thumbnails.get(entry.id) ? (
                  <img src={thumbnails.get(entry.id)!} alt="" className="file-row__thumb-img" />
                ) : (
                  <div className="file-card__skeleton" />
                )}
              </div>
              <span className="file-row__name">{entry.name}</span>
              <span className="file-row__meta">{formatRelativeTime(entry.updatedAt)}</span>
              <span className="file-row__meta">
                {entry.size > 0 ? formatBytes(entry.size) : ''}
              </span>
              <span className="file-card__badge">{entry.kind}</span>
              <button
                type="button"
                className="file-row__pin"
                aria-pressed={entry.pinned}
                aria-label={entry.pinned ? 'Unpin' : 'Pin'}
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <Icon name={entry.pinned ? 'Pin' : 'PinOff'} label={undefined} size="0.85em" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
