import { useDroppable } from '@dnd-kit/core';
import type { SavedSearch } from '@varve/platform';
import type { SolidIconName } from '@varve/ui';
import { SearchField, SOLID_CHROME_ICONS, SolidIcon, Tooltip } from '@varve/ui';
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
  icon: SolidIconName;
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
  /** Search query for the sidebar search field. */
  searchQuery?: string;
  /** Called when sidebar search query changes. */
  onSearchQueryChange?: (query: string) => void;
  /** Result count for the sidebar search field. */
  searchResultCount?: number;
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
    // The rotation transition lives in home.css so the reduced-motion media
    // query can disable it. An inline transition could not be overridden by
    // CSS, so it animated even under prefers-reduced-motion: reduce.
    <span
      className="sidebar-section__chevron"
      style={{
        transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
        display: 'inline-flex',
      }}
    >
      <SolidIcon name={SOLID_CHROME_ICONS.chevronDown} label={undefined} size="0.75em" />
    </span>
  );
}

function SidebarProjectRow({
  entry,
  isActive,
  focusIdx,
  idx,
  onSelect,
  setFocusIdx: _setFocusIdx,
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
    <div
      ref={setNodeRef}
      className={`sidebar-item-row ${isDropTarget ? 'sidebar-item-row--drop-target' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="application"
      tabIndex={-1}
    >
      <button
        type="button"
        aria-current={isActive ? 'page' : undefined}
        tabIndex={idx === focusIdx ? 0 : -1}
        className={`sidebar-item sidebar-item--flex ${isActive ? 'sidebar-item--active' : ''}`}
        onClick={() => onSelect(entry.id)}
      >
        <SolidIcon
          name={entry.icon as SolidIconName}
          label={undefined}
          className="sidebar-item__icon"
        />
        <span className="sidebar-item__label">{entry.label}</span>
        {entry.count > 0 && <span className="sidebar-item__count">{entry.count}</span>}
      </button>
      {onPin && entry.pinned !== undefined && (
        <button
          type="button"
          className="sidebar-item-row__action"
          aria-pressed={entry.pinned}
          aria-label={entry.pinned ? `Unpin ${entry.label}` : `Pin ${entry.label}`}
          onClick={(e) => {
            e.stopPropagation();
            onPin(entry.id);
          }}
        >
          <SolidIcon
            name={entry.pinned ? SOLID_CHROME_ICONS.pin : SOLID_CHROME_ICONS.pinOff}
            label={undefined}
            size="0.85em"
          />
        </button>
      )}
    </div>
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
  searchQuery,
  onSearchQueryChange,
  searchResultCount,
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
        aria-current={entry.id === activeId ? 'page' : undefined}
        tabIndex={i === focusIdx ? 0 : -1}
        className={`sidebar-item ${entry.id === activeId ? 'sidebar-item--active' : ''}`}
        onClick={() => onSelect(entry.id)}
      >
        <SolidIcon
          name={entry.icon as SolidIconName}
          label={undefined}
          className="sidebar-item__icon"
        />
        <span>{entry.label}</span>
        {entry.count > 0 && <span className="sidebar-item__count">{entry.count}</span>}
      </button>
    );
  };

  const entryMap = new Map(entries.map((e) => [e.id, e]));
  const projectEntries = entries.filter((e) => !SECTION_LEADER_IDS.has(e.id));

  const getCount = (id: string) => sectionCounts?.[id] ?? entryMap.get(id)?.count ?? 0;

  // Top nav items (single-target, no collapsible wrapper needed)
  const topNavIds = ['recent', 'all', 'drafts', 'favorites'];
  // Bottom nav items
  const bottomNavIds = ['templates', 'assets', 'activity', 'trash'];

  return (
    <nav
      className="sidebar-section"
      ref={navRef}
      onKeyDown={handleKey}
      aria-label="File navigation"
    >
      {/* Sidebar search field */}
      {onSearchQueryChange && (
        <div className="sidebar-search">
          <SearchField
            value={searchQuery ?? ''}
            onChange={onSearchQueryChange}
            resultCount={searchResultCount}
            placeholder="Search files…"
          />
        </div>
      )}

      {/* Top nav items — direct single-click navigation, no collapsible wrapper */}
      <div className="sidebar-group">
        {topNavIds.map((id) => {
          const entry = entryMap.get(id);
          if (!entry) return null;
          return renderEntry(entry, entries.indexOf(entry), false);
        })}
      </div>

      {/* Projects section — collapsible because it can contain multiple items */}
      {projectEntries.length > 0 && (
        <div className="sidebar-group">
          <div className="sidebar-group__header">
            <button
              type="button"
              className="sidebar-section__header"
              onClick={() => toggleSection('projects')}
              aria-expanded={!isCollapsed('projects')}
              aria-controls="sidebar-projects-list"
            >
              <ChevronIcon collapsed={isCollapsed('projects')} />
              <span>Projects</span>
              <span className="sidebar-section__count">
                {getCount('projects') > 0 ? getCount('projects') : projectEntries.length}
              </span>
            </button>
            {onCreateProject && (
              <Tooltip label="New project">
                <button
                  type="button"
                  className="sidebar-group__add"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateProject();
                  }}
                  aria-label="New project"
                >
                  <SolidIcon name={SOLID_CHROME_ICONS.plus} label={undefined} size="0.85em" />
                </button>
              </Tooltip>
            )}
          </div>
          {!isCollapsed('projects') && (
            <div id="sidebar-projects-list">
              {projectEntries.map((entry) => renderEntry(entry, entries.indexOf(entry), true))}
            </div>
          )}
        </div>
      )}

      {/* Bottom nav items */}
      <div className="sidebar-group sidebar-group--bottom">
        {bottomNavIds.map((id) => {
          const entry = entryMap.get(id);
          if (!entry) return null;
          return renderEntry(entry, entries.indexOf(entry), false);
        })}
      </div>

      {savedSearches && savedSearches.length > 0 && (
        <div className="sidebar-group">
          <div className="sidebar-group__label">Saved Searches</div>
          {savedSearches.map((search) => (
            <div key={search.id} className="sidebar-item-row">
              <button
                type="button"
                aria-current={activeSavedSearchId === search.id ? 'page' : undefined}
                className={`sidebar-item sidebar-item--flex ${activeSavedSearchId === search.id ? 'sidebar-item--active' : ''}`}
                onClick={() => onSelect(search.id)}
              >
                <SolidIcon
                  name={SOLID_CHROME_ICONS.search}
                  label={undefined}
                  className="sidebar-item__icon"
                />
                <span className="sidebar-item__label">{search.name}</span>
              </button>
              {onDeleteSavedSearch && (
                <button
                  type="button"
                  className="sidebar-item-row__action"
                  aria-label={`Delete saved search "${search.name}"`}
                  onClick={() => onDeleteSavedSearch(search.id)}
                >
                  <SolidIcon name={SOLID_CHROME_ICONS.close} label={undefined} size="0.85em" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
