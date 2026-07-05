import { useDroppable } from '@dnd-kit/core';
import type { IconName } from '@strata/ui';
import type { SavedSearch } from '@strata/platform';
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
  /** Called to create a new project. */
  onCreateProject?: () => void;
  /** Saved searches to display below the main navigation. */
  savedSearches?: SavedSearch[];
  /** Currently active saved search id. */
  activeSavedSearchId?: string | null;
  /** Called when a saved search delete button is clicked. */
  onDeleteSavedSearch?: (id: string) => void;
  /** Counts to show on section badges, keyed by section id. */
  sectionCounts?: Record<string, number>;
}

const SECTION_LEADER_IDS = new Set([
  'recent',
  'all',
  'drafts',
  'favorites',
  'templates',
  'assets',
  'activity',
  'trash',
]);

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <span
      className="sidebar-section__chevron"
      style={{
        transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
        display: 'inline-flex',
        transition: 'transform 0.15s ease',
      }}
    >
      <Icon name="ChevronDown" label={undefined} size="0.75em" />
    </span>
  );
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

function SectionHeader({
  id,
  label,
  count,
  collapsed,
  onToggle,
}: {
  id: string;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="sidebar-section__header"
      onClick={() => onToggle(id)}
      aria-expanded={!collapsed}
    >
      <ChevronIcon collapsed={collapsed} />
      <span>{label}</span>
      <span className="sidebar-section__count">{count > 0 ? count : ''}</span>
    </button>
  );
}

export function SidebarNav({
  entries,
  activeId,
  onSelect,
  onPin,
  onDropOnProject,
  onCreateProject,
  savedSearches,
  activeSavedSearchId,
  onDeleteSavedSearch,
  sectionCounts,
}: SidebarNavProps) {
  const [focusIdx, setFocusIdx] = useState(0);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const navRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  const toggleSection = useCallback((id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isCollapsed = useCallback((id: string) => collapsedSections.has(id), [collapsedSections]);

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

  const renderEntry = (entry: SidebarEntry, i: number, isProject: boolean) => {
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
            isActive={entry.id === activeId}
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
        aria-selected={entry.id === activeId}
        tabIndex={i === focusIdx ? 0 : -1}
        className={`sidebar-item ${entry.id === activeId ? 'sidebar-item--active' : ''}`}
        onClick={() => onSelect(entry.id)}
        onMouseEnter={() => setFocusIdx(i)}
      >
        <Icon name={entry.icon} label={undefined} className="sidebar-item__icon" />
        <span>{entry.label}</span>
        <span className="sidebar-item__count">{entry.count}</span>
      </button>
    );
  };

  // Group entries into sections for rendering
  const sectionOrder = ['recent', 'all', 'drafts', 'favorites'];
  const bottomSectionOrder = ['templates', 'assets', 'activity', 'trash'];
  const sectionLabels: Record<string, string | undefined> = {
    recent: 'Recent',
    all: 'All Files',
    drafts: 'Drafts',
    favorites: 'Favorites',
    templates: 'Templates',
    assets: 'Assets',
    activity: 'Activity',
    trash: 'Trash',
  };

  const entryMap = new Map(entries.map((e) => [e.id, e]));
  const projectEntries = entries.filter((e) => !SECTION_LEADER_IDS.has(e.id));

  const getCount = (id: string) => sectionCounts?.[id] ?? entryMap.get(id)?.count ?? 0;

  return (
    <nav
      className="sidebar-section"
      ref={navRef}
      onKeyDown={handleKey}
      aria-label="File navigation"
    >
      {onCreateProject && (
        <button
          type="button"
          className="sidebar-item sidebar-item--new-project"
          onClick={(e) => {
            e.stopPropagation();
            onCreateProject();
          }}
          aria-label="New project"
        >
          <Icon name="Plus" label={undefined} className="sidebar-item__icon" />
          <span>New Project</span>
        </button>
      )}

      {/* Top sections: Recent, All Files, Drafts, Favorites */}
      {sectionOrder.map((sectionId) => {
        const entry = entryMap.get(sectionId);
        if (!entry) return null;
        const collapsed = isCollapsed(sectionId);
        return (
          <div key={sectionId}>
            <SectionHeader
              id={sectionId}
              label={sectionLabels[sectionId] ?? entry.label}
              count={getCount(sectionId)}
              collapsed={collapsed}
              onToggle={toggleSection}
            />
            {!collapsed && renderEntry(entry, entries.indexOf(entry), false)}
          </div>
        );
      })}

      {/* Projects section */}
      {projectEntries.length > 0 && (
        <div>
          <SectionHeader
            id="projects"
            label="Projects"
            count={projectEntries.length}
            collapsed={isCollapsed('projects')}
            onToggle={toggleSection}
          />
          {!isCollapsed('projects') &&
            projectEntries.map((entry) => renderEntry(entry, entries.indexOf(entry), true))}
        </div>
      )}

      {bottomSectionOrder.map((sectionId) => {
        const entry = entryMap.get(sectionId);
        if (!entry) return null;
        const collapsed = isCollapsed(sectionId);
        return (
          <div key={sectionId}>
            <SectionHeader
              id={sectionId}
              label={sectionLabels[sectionId] ?? entry.label}
              count={getCount(sectionId)}
              collapsed={collapsed}
              onToggle={toggleSection}
            />
            {!collapsed && renderEntry(entry, entries.indexOf(entry), false)}
          </div>
        );
      })}

      {savedSearches && savedSearches.length > 0 && (
        <div style={{ marginTop: 'var(--space-1)' }}>
          <div
            style={{
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--color-text-tertiary)',
            }}
          >
            Saved Searches
          </div>
          {savedSearches.map((search) => (
            <button
              key={search.id}
              type="button"
              role="option"
              aria-selected={activeSavedSearchId === search.id}
              className={`sidebar-item ${activeSavedSearchId === search.id ? 'sidebar-item--active' : ''}`}
              onClick={() => onSelect(search.id)}
            >
              <Icon name="Search" label={undefined} className="sidebar-item__icon" />
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {search.name}
              </span>
              <button
                type="button"
                aria-label={`Delete saved search "${search.name}"`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteSavedSearch?.(search.id);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  color: 'var(--color-text-tertiary)',
                  opacity: 0.6,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                <Icon name="X" label={undefined} size="0.85em" />
              </button>
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
