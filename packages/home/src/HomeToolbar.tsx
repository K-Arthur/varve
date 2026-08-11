import type {
  FileKind,
  RecentWorkspaceFilter,
  SidebarSection,
  SortDirection,
  SortKey,
  ViewMode,
} from '@varve/platform';
import {
  Button,
  Popover,
  SOLID_CHROME_ICONS,
  SolidIcon,
  Tooltip,
  VarveLogo,
  ViewModeSwitcher,
} from '@varve/ui';
import { type RefObject, useCallback, useState } from 'react';
import { FilterDropdown } from './FilterDropdown';

const WORKSPACE_FILTER_OPTIONS: { value: RecentWorkspaceFilter['mode']; label: string }[] = [
  { value: 'all', label: 'All Recent' },
  { value: 'relevant', label: 'Relevant to Workspace' },
  { value: 'pinned', label: 'Pinned Only' },
];

export interface HomeToolbarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  /** Ref to the sidebar toggle button, so the drawer can restore focus on close. */
  sidebarToggleRef?: RefObject<HTMLButtonElement | null>;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSortKeyChange: (k: SortKey) => void;
  onSortDirToggle: () => void;
  onNewFile: () => void;
  onOpenFromDisk: () => void;
  onOpenImport?: () => void;
  kindFilter: FileKind[];
  pinnedOnly: boolean;
  dateFrom: number | null;
  dateTo: number | null;
  onKindFilterChange: (kinds: FileKind[]) => void;
  onPinnedOnlyChange: (pinned: boolean) => void;
  onDateFromChange: (date: number | null) => void;
  onDateToChange: (date: number | null) => void;
  onClearFilters: () => void;
  section?: SidebarSection;
  recentWorkspaceFilter?: RecentWorkspaceFilter;
  onRecentWorkspaceFilterChange?: (f: RecentWorkspaceFilter) => void;
}

export function HomeToolbar({
  sidebarCollapsed,
  onToggleSidebar,
  sidebarToggleRef,
  viewMode,
  onViewModeChange,
  onNewFile,
  onOpenFromDisk,
  onOpenImport,
  kindFilter,
  pinnedOnly,
  dateFrom,
  dateTo,
  onKindFilterChange,
  onPinnedOnlyChange,
  onDateFromChange,
  onDateToChange,
  onClearFilters,
  sortDirection,
  onSortDirToggle,
  section,
  recentWorkspaceFilter,
  onRecentWorkspaceFilterChange,
}: HomeToolbarProps) {
  const [wsFilterOpen, setWsFilterOpen] = useState(false);
  const viewModeOptions = [
    { value: 'grid' as ViewMode, label: 'Grid', icon: SOLID_CHROME_ICONS.layoutGrid },
    { value: 'list' as ViewMode, label: 'List', icon: SOLID_CHROME_ICONS.list },
  ];

  const currentWsFilterLabel =
    WORKSPACE_FILTER_OPTIONS.find((o) => o.value === (recentWorkspaceFilter?.mode ?? 'all'))
      ?.label ?? 'All Recent';

  const handleWsFilterSelect = useCallback(
    (mode: RecentWorkspaceFilter['mode']) => {
      onRecentWorkspaceFilterChange?.({ mode, editorMode: recentWorkspaceFilter?.editorMode });
      setWsFilterOpen(false);
    },
    [onRecentWorkspaceFilterChange, recentWorkspaceFilter?.editorMode],
  );

  return (
    <>
      <div className="varve-home__toolbar-left">
        <span className="varve-home__brand" aria-hidden>
          <VarveLogo size={18} />
        </span>
        <Button
          variant="ghost"
          onClick={onToggleSidebar}
          ref={sidebarToggleRef}
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        >
          <SolidIcon name={SOLID_CHROME_ICONS.menu} label={undefined} />
        </Button>
        <Button variant="primary" onClick={onNewFile} data-testid="new-file-button">
          <SolidIcon name={SOLID_CHROME_ICONS.plus} label={undefined} />
          New
        </Button>
        <Button variant="ghost" onClick={onOpenFromDisk}>
          Open…
        </Button>
        {onOpenImport && (
          <Button variant="ghost" onClick={onOpenImport}>
            Import
          </Button>
        )}
      </div>
      <div className="varve-home__toolbar-right">
        {section === 'recent' && onRecentWorkspaceFilterChange && (
          <Popover
            open={wsFilterOpen}
            onOpenChange={setWsFilterOpen}
            popover={
              <div
                className="varve-home__ws-filter-dropdown"
                role="listbox"
                aria-label="Workspace filter"
              >
                {WORKSPACE_FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={(recentWorkspaceFilter?.mode ?? 'all') === opt.value}
                    className={`varve-home__ws-filter-option ${
                      (recentWorkspaceFilter?.mode ?? 'all') === opt.value
                        ? 'varve-home__ws-filter-option--active'
                        : ''
                    }`}
                    onClick={() => handleWsFilterSelect(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            }
          >
            <Button variant="ghost" aria-label="Workspace filter">
              <SolidIcon name={SOLID_CHROME_ICONS.filter} label={undefined} size="0.85em" />
              {currentWsFilterLabel}
            </Button>
          </Popover>
        )}
        <FilterDropdown
          kinds={kindFilter}
          pinnedOnly={pinnedOnly}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onKindsChange={onKindFilterChange}
          onPinnedOnlyChange={onPinnedOnlyChange}
          onDateFromChange={onDateFromChange}
          onDateToChange={onDateToChange}
          onClear={onClearFilters}
        />
        <Tooltip label={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}>
          <Button
            variant="ghost"
            onClick={onSortDirToggle}
            aria-label={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
          >
            <SolidIcon
              name={
                sortDirection === 'asc'
                  ? SOLID_CHROME_ICONS.chevronUp
                  : SOLID_CHROME_ICONS.chevronDown
              }
              label={undefined}
              size="0.85em"
            />
          </Button>
        </Tooltip>
        <ViewModeSwitcher
          label="View mode"
          value={viewMode}
          options={viewModeOptions}
          onChange={onViewModeChange}
        />
      </div>
    </>
  );
}
