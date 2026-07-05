import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import type { FileEntry } from '@strata/platform';
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
  onSelect: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onSelectRange: (fromIdx: number, toIdx: number) => void;
  onSelectAll: () => void;
  onRename?: (id: string, newName: string) => void;
  renamingId?: string | null;
  onStartRename?: (id: string | null) => void;
  missingFiles?: Set<string>;
  onToggleFavorite?: (entry: FileEntry) => void;
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
  onSelect,
  onToggleSelect,
  onSelectRange,
  onSelectAll,
  onRename,
  renamingId,
  onStartRename,
  missingFiles = new Set(),
  onToggleFavorite,
}: FileGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  const [focusIdx, setFocusIdx] = useState(0);
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);
  const typeAheadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const typeAheadBufferRef = useRef('');
  // Tracks intent to programmatically move focus (keyboard navigation only).
  // Set before calling setFocusIdx so the effect below can distinguish
  // keyboard-driven focus moves from incidental re-renders (e.g. thumbnail loads).
  const pendingFocusRef = useRef(false);
  const focusedCardRef = useRef<HTMLDivElement | null>(null);

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

  // Focus the card after keyboard navigation (not on incidental re-renders)
  useEffect(() => {
    if (pendingFocusRef.current) {
      focusedCardRef.current?.focus();
      pendingFocusRef.current = false;
    }
  }, [focusIdx]);

  const navigate = useCallback(
    (dir: number, wrap = true) => {
      pendingFocusRef.current = true;
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
      const isCtrl = e.ctrlKey || e.metaKey;

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
        pendingFocusRef.current = true;
        setFocusIdx(0);
      }
      if (e.key === 'End') {
        e.preventDefault();
        pendingFocusRef.current = true;
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
    [navigate, columns, focusIdx, onOpen, files, onSelectAll],
  );

  const handleCardClick = useCallback(
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

  useEffect(() => {
    const idx = files.findIndex((f) => f.pinned);
    if (idx >= 0) setFocusIdx(idx);
  }, [files]);

  const sortableIds = files.filter((f) => !f.trashedAt).map((f) => f.id);

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: ARIA grid role required for virtualized grid */}
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
              <>
                {/* biome-ignore lint/a11y/useSemanticElements: ARIA row role required for virtualized grid */}
                <div
                  key={rowIdx}
                  role="row"
                  aria-rowindex={rowIdx + 1}
                  tabIndex={-1}
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
                    if (!entry) return <div key={`empty-${fileIdx}`} style={{ flex: 1 }} />;
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
                        onClick={(e) => handleCardClick(e, fileIdx)}
                        onRename={onRename}
                        isRenaming={renamingId === entry.id}
                        onStartRename={() => onStartRename?.(entry.id)}
                        isMissing={missingFiles.has(entry.id)}
                        onToggleFavorite={onToggleFavorite}
                        tabIndex={fileIdx === focusIdx ? 0 : -1}
                        style={{
                          flex: `0 0 ${COL_WIDTH}px`,
                        }}
                        onFocus={() => setFocusIdx(fileIdx)}
                        ref={(el) => {
                          if (fileIdx === focusIdx) focusedCardRef.current = el;
                        }}
                      />
                    );
                  })}
                </div>
              </>
            );
          })}
        </SortableContext>
      </div>
    </>
  );
}
