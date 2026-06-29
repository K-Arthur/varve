import type { FileEntry } from '@strata/platform';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { FileCard } from './FileCard';

export interface FileGridProps {
  files: readonly FileEntry[];
  thumbnails: Map<string, string | null>;
  onLoadThumbnail: (entry: FileEntry) => void;
  onOpen: (entry: FileEntry) => void;
  onContext: (e: React.MouseEvent, entry: FileEntry) => void;
  onFileDragStart?: (e: React.DragEvent, entry: FileEntry) => void;
  selectedIds: string[];
}

const COL_WIDTH = 14 * 16 + 24; // 14rem + padding
const CARD_HEIGHT = 220;
const GAP = 12;

export function FileGrid({
  files,
  thumbnails,
  onLoadThumbnail,
  onOpen,
  onContext,
  onFileDragStart,
  selectedIds,
}: FileGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  const [focusIdx, setFocusIdx] = useState(0);

  const rowCount = Math.ceil(files.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => CARD_HEIGHT + GAP,
    overscan: 2,
  });

  useEffect(() => {
    function calc() {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const n = Math.max(1, Math.floor((w + GAP) / (COL_WIDTH + GAP)));
      setColumns(n);
    }
    calc();
    const observer = new ResizeObserver(calc);
    if (containerRef.current)
      containerRef.current.parentElement && observer.observe(containerRef.current.parentElement);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // Trigger lazy thumbnail loading for visible cards
    const visibleStart = Math.max(0, Math.floor(focusIdx / columns) - 1);
    const visibleEnd = Math.min(files.length, visibleStart + columns * 4);
    for (let i = visibleStart; i < visibleEnd; i++) {
      const entry = files[i];
      if (entry && !thumbnails.has(entry.id)) {
        onLoadThumbnail(entry);
      }
    }
  }, [files, columns, focusIdx, thumbnails, onLoadThumbnail]);

  const navigate = useCallback(
    (dir: number, wrap = true) => {
      setFocusIdx((i) => {
        const next = i + dir;
        if (wrap) {
          if (next < 0) return files.length - 1;
          if (next >= files.length) return 0;
          return next;
        }
        return Math.max(0, Math.min(next, files.length - 1));
      });
    },
    [files.length],
  );

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigate(1);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigate(-1);
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigate(columns);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigate(-columns);
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
    [navigate, columns, focusIdx, onOpen, files],
  );

  useEffect(() => {
    const idx = files.findIndex((f) => f.pinned);
    if (idx >= 0) setFocusIdx(idx);
  }, [files]);

  const sortableIds = files.filter((f) => !f.trashedAt).map((f) => f.id);

  return (
    <div
      ref={containerRef}
      role="grid"
      aria-label="File grid"
      aria-rowcount={rowCount}
      aria-colcount={columns}
      tabIndex={0}
      onKeyDown={handleKey}
      className="home-grid"
      style={{
        height: virtualizer.getTotalSize(),
        position: 'relative',
      }}
    >
      <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
        const rowIdx = virtualRow.index;
        const startIdx = rowIdx * columns;
        return (
          <div
            key={rowIdx}
            role="row"
            aria-rowindex={rowIdx + 1}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: virtualRow.size,
              transform: `translateY(${virtualRow.start}px)`,
              display: 'flex',
              gap: `${GAP}px`,
            }}
          >
            {Array.from({ length: columns }, (_, colIdx) => {
              const fileIdx = startIdx + colIdx;
              const entry = files[fileIdx];
              if (!entry) return <div key={colIdx} style={{ flex: 1 }} />;
              const isSelected = selectedIds.includes(entry.id);
              const thumb = thumbnails.get(entry.id);
              const loading = thumb === undefined;
              return (
                <FileCard
                  key={entry.id}
                  entry={entry}
                  thumbnail={thumb ?? null}
                  thumbnailLoading={loading}
                  selected={isSelected}
                  onOpen={onOpen}
                  onContext={onContext}
                  onFileDragStart={onFileDragStart}
                  tabIndex={fileIdx === focusIdx ? 0 : -1}
                  style={{
                    flex: `0 0 ${COL_WIDTH}px`,
                  }}
                  onFocus={() => setFocusIdx(fileIdx)}
                  ref={(el) => {
                    if (fileIdx === focusIdx) el?.focus();
                  }}
                />
              );
            })}
          </div>
        );
      })}
      </SortableContext>
    </div>
  );
}
