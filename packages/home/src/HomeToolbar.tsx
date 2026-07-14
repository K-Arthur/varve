import type { FileKind, SortDirection, SortKey, ViewMode } from '@strata/platform';
import { Button, Icon } from '@strata/ui';
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
  return (
    <>
      <div className="strata-home__toolbar-left">
        <Button
          variant="ghost"
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        >
          <Icon name={sidebarCollapsed ? 'Menu' : 'Menu'} label={undefined} />
        </Button>
        <Button variant="primary" onClick={onNewFile} data-testid="new-file-button">
          <Icon name="Plus" label={undefined} />
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
          <Icon
            name={sortDirection === 'asc' ? 'ChevronUp' : 'ChevronDown'}
            label={undefined}
            size="0.85em"
          />
        </Button>
        <Button
          variant="ghost"
          onClick={() => onViewModeChange(viewMode === 'grid' ? 'list' : 'grid')}
          aria-label={viewMode === 'grid' ? 'List view' : 'Grid view'}
          title={viewMode === 'grid' ? 'List view' : 'Grid view'}
        >
          <Icon
            name={viewMode === 'grid' ? 'List' : 'LayoutGrid'}
            label={undefined}
            size="0.85em"
          />
        </Button>
      </div>
    </>
  );
}
