import type { FileKind, SortDirection, SortKey, ViewMode } from '@strata/platform';
import { Button, Icon, SearchField, SegmentedControl, type SegmentedOption } from '@strata/ui';
import { FilterDropdown } from './FilterDropdown';

export interface HomeToolbarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  query: string;
  onQueryChange: (q: string) => void;
  resultCount: number;
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
  onSaveSearch?: () => void;
}

const sortOptions: SegmentedOption<SortKey>[] = [
  { value: 'opened', label: 'Opened' },
  { value: 'updated', label: 'Modified' },
  { value: 'name', label: 'Name' },
  { value: 'created', label: 'Created' },
  { value: 'size', label: 'Size' },
];

const viewOptions: SegmentedOption<ViewMode>[] = [
  { value: 'grid', label: 'Grid', icon: 'LayoutGrid' },
  { value: 'list', label: 'List', icon: 'List' },
];

export function HomeToolbar({
  sidebarCollapsed,
  onToggleSidebar,
  viewMode,
  onViewModeChange,
  query,
  onQueryChange,
  resultCount,
  sortKey,
  sortDirection,
  onSortKeyChange,
  onSortDirToggle,
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
  onSaveSearch,
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
        <Button variant="primary" onClick={onNewFile}>
          <Icon name="Plus" label={undefined} />
          New File
        </Button>
        <Button variant="secondary" onClick={onOpenFromDisk}>
          Open...
        </Button>
        {onOpenImport && (
          <Button variant="secondary" onClick={onOpenImport}>
            <Icon name="Upload" label={undefined} />
            Import
          </Button>
        )}
      </div>
      <div className="strata-home__toolbar-center">
        <SearchField value={query} onChange={onQueryChange} resultCount={resultCount} />
        {query && onSaveSearch && (
          <Button variant="ghost" onClick={onSaveSearch} aria-label="Save current search">
            <Icon name="Save" label={undefined} size="0.85em" />
            Save
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
        <div className="search-sort-group">
          <SegmentedControl<SortKey>
            label="Sort by"
            value={sortKey}
            options={sortOptions}
            onChange={onSortKeyChange}
          />
          <Button
            variant="ghost"
            onClick={onSortDirToggle}
            aria-label={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
          >
            <Icon
              name={sortDirection === 'asc' ? 'ChevronUp' : 'ChevronDown'}
              label={undefined}
              size="0.85em"
            />
          </Button>
        </div>
        <SegmentedControl<ViewMode>
          label="View"
          value={viewMode}
          options={viewOptions}
          onChange={onViewModeChange}
        />
      </div>
    </>
  );
}
