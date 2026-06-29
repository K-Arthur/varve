import type { SortDirection, SortKey, ViewMode } from '@strata/platform';
import { Button, Icon, SearchField, SegmentedControl, type SegmentedOption } from '@strata/ui';

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
      </div>
      <div className="strata-home__toolbar-center">
        <SearchField value={query} onChange={onQueryChange} resultCount={resultCount} />
      </div>
      <div className="strata-home__toolbar-right">
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
