import { useDroppable } from '@dnd-kit/core';
import type { IconName } from '@strata/ui';
import { Icon } from '@strata/ui';
import {
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

export interface SidebarEntry {
  id: string;
  label: string;
  icon: IconName;
  count: number;
  pinned?: boolean;
}

export interface SidebarNavProps {
  entries: readonly SidebarEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onPin?: (id: string) => void;
  /** Called when a file is dropped on a project entry. */
  onDropOnProject?: (fileId: string, projectId: string) => void;
}

function SidebarProjectRow({
  entry,
  isActive,
  focusIdx,
  idx,
  onSelect,
  setFocusIdx,
  onPin,
  onDropOnProject,
  dropTargetId,
  setDropTargetId,
}: {
  entry: SidebarEntry;
  isActive: boolean;
  focusIdx: number;
  idx: number;
  onSelect: (id: string) => void;
  setFocusIdx: (i: number) => void;
  onPin?: (id: string) => void;
  onDropOnProject?: (fileId: string, projectId: string) => void;
  dropTargetId: string | null;
  setDropTargetId: (id: string | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: entry.id,
    data: { type: 'project' },
  });
  const isDropTarget = dropTargetId === entry.id || isOver;

  const handleDragOver = (e: DragEvent) => {
    if (onDropOnProject) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTargetId(entry.id);
    }
  };

  const handleDragLeave = () => {
    if (dropTargetId === entry.id) setDropTargetId(null);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropTargetId(null);
    if (!onDropOnProject) return;
    const fileId = e.dataTransfer.getData('text/strata-file-id');
    if (fileId) onDropOnProject(fileId, entry.id);
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      role="option"
      aria-selected={isActive}
      tabIndex={idx === focusIdx ? 0 : -1}
      className={`sidebar-item ${isActive ? 'sidebar-item--active' : ''} ${isDropTarget ? 'sidebar-item--drop-target' : ''}`}
      onClick={() => onSelect(entry.id)}
      onMouseEnter={() => setFocusIdx(idx)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Icon name={entry.icon} label={undefined} className="sidebar-item__icon" />
      <span>{entry.label}</span>
      <span className="sidebar-item__count">{entry.count}</span>
      {onPin && entry.pinned !== undefined && (
        <button
          type="button"
          className="sidebar-item__pin"
          aria-pressed={entry.pinned}
          aria-label={entry.pinned ? `Unpin ${entry.label}` : `Pin ${entry.label}`}
          onClick={(e) => {
            e.stopPropagation();
            onPin(entry.id);
          }}
        >
          <Icon name={entry.pinned ? 'Pin' : 'PinOff'} label={undefined} size="0.85em" />
        </button>
      )}
    </button>
  );
}

export function SidebarNav({
  entries,
  activeId,
  onSelect,
  onPin,
  onDropOnProject,
}: SidebarNavProps) {
  const [focusIdx, setFocusIdx] = useState(0);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const idx = entries.findIndex((e) => e.id === activeId);
    if (idx >= 0) setFocusIdx(idx);
  }, [activeId, entries]);

  useEffect(() => {
    const el = itemRefs.current[focusIdx];
    el?.focus();
  }, [focusIdx]);

  const navigate = useCallback(
    (dir: number) => {
      setFocusIdx((i) => {
        const next = i + dir;
        if (next < 0) return 0;
        if (next >= entries.length) return entries.length - 1;
        return next;
      });
    },
    [entries.length],
  );

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          navigate(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          navigate(-1);
          break;
        case 'Home':
          e.preventDefault();
          setFocusIdx(0);
          break;
        case 'End':
          e.preventDefault();
          setFocusIdx(entries.length - 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          onSelect(entries[focusIdx]?.id ?? '');
          break;
      }
    },
    [navigate, entries, focusIdx, onSelect],
  );

  return (
    <nav
      className="sidebar-section"
      ref={navRef}
      onKeyDown={handleKey}
      aria-label="File navigation"
    >
      {entries.map((entry, i) => {
        const isActive = entry.id === activeId;
        const isProject = !['recent', 'all', 'templates', 'trash'].includes(entry.id);

        if (isProject) {
          return (
            <div
              key={entry.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
            >
              <SidebarProjectRow
                entry={entry}
                isActive={isActive}
                focusIdx={focusIdx}
                idx={i}
                onSelect={onSelect}
                setFocusIdx={setFocusIdx}
                onPin={onPin}
                onDropOnProject={onDropOnProject}
                dropTargetId={dropTargetId}
                setDropTargetId={setDropTargetId}
              />
            </div>
          );
        }

        return (
          <button
            key={entry.id}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            role="option"
            aria-selected={isActive}
            tabIndex={i === focusIdx ? 0 : -1}
            className={`sidebar-item ${isActive ? 'sidebar-item--active' : ''}`}
            onClick={() => onSelect(entry.id)}
            onMouseEnter={() => setFocusIdx(i)}
          >
            <Icon name={entry.icon} label={undefined} className="sidebar-item__icon" />
            <span>{entry.label}</span>
            <span className="sidebar-item__count">{entry.count}</span>
          </button>
        );
      })}
    </nav>
  );
}
