import type { FileKind, SortDirection, SortKey, ViewMode } from '@strata/platform';
import { Button, SOLID_CHROME_ICONS, SolidIcon, ViewModeSwitcher } from '@strata/ui';
import { FilterDropdown } from './FilterDropdown';

export interface HomeToolbarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
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
}

export function HomeToolbar({
  sidebarCollapsed,
  onToggleSidebar,
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
}: HomeToolbarProps) {
  const viewModeOptions = [
    { value: 'grid' as ViewMode, label: 'Grid', icon: SOLID_CHROME_ICONS.layoutGrid },
    { value: 'list' as ViewMode, label: 'List', icon: SOLID_CHROME_ICONS.list },
  ];

  return (
    <>
      <div className="strata-home__toolbar-left">
        <Button
          variant="ghost"
          onClick={onToggleSidebar}
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
      <div className="strata-home__toolbar-right">
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
        <Button
          variant="ghost"
          onClick={onSortDirToggle}
          aria-label={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
          title={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
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
