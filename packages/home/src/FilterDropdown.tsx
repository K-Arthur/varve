import type { FileKind } from '@varve/platform';
import { Button, Icon, Popover } from '@varve/ui';
import { useCallback } from 'react';

export interface FilterDropdownProps {
  kinds: FileKind[];
  pinnedOnly: boolean;
  dateFrom: number | null;
  dateTo: number | null;
  onKindsChange: (kinds: FileKind[]) => void;
  onPinnedOnlyChange: (pinned: boolean) => void;
  onDateFromChange: (date: number | null) => void;
  onDateToChange: (date: number | null) => void;
  onClear: () => void;
}

const ALL_KINDS: { value: FileKind; label: string }[] = [
  { value: 'strata', label: 'Varve' },
  { value: 'figma', label: 'Figma' },
  { value: 'illustrator', label: 'Illustrator' },
  { value: 'image', label: 'Image' },
  { value: 'unknown', label: 'Other' },
];

function activeFilterCount(
  kinds: string[],
  pinnedOnly: boolean,
  dateFrom: number | null,
  dateTo: number | null,
): number {
  let count = 0;
  if (kinds.length > 0) count++;
  if (pinnedOnly) count++;
  if (dateFrom !== null) count++;
  if (dateTo !== null) count++;
  return count;
}

export function FilterDropdown({
  kinds,
  pinnedOnly,
  dateFrom,
  dateTo,
  onKindsChange,
  onPinnedOnlyChange,
  onDateFromChange,
  onDateToChange,
  onClear,
}: FilterDropdownProps) {
  const count = activeFilterCount(kinds, pinnedOnly, dateFrom, dateTo);

  const toggleKind = useCallback(
    (kind: FileKind) => {
      if (kinds.includes(kind)) {
        onKindsChange(kinds.filter((k) => k !== kind));
      } else {
        onKindsChange([...kinds, kind]);
      }
    },
    [kinds, onKindsChange],
  );

  return (
    <Popover
      popover={
        <div className="filter-dropdown" role="dialog" aria-label="Filters">
          <div className="filter-dropdown__header">
            <span className="filter-dropdown__title">Filters</span>
            {count > 0 && (
              <button type="button" className="filter-dropdown__clear" onClick={onClear}>
                Clear all
              </button>
            )}
          </div>

          <div className="filter-dropdown__section filter-dropdown__section-kinds">
            <span className="filter-dropdown__section-label">File type</span>
            {ALL_KINDS.map(({ value, label }) => (
              <label key={value} className="filter-dropdown__checkbox-label">
                <input
                  type="checkbox"
                  checked={kinds.includes(value)}
                  onChange={() => toggleKind(value)}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="filter-dropdown__section filter-dropdown__section-date">
            <span className="filter-dropdown__section-label">Date modified</span>
            <div className="filter-dropdown__date-row">
              <label className="filter-dropdown__date-label">
                From
                <input
                  type="date"
                  value={dateFrom ? dateToInputValue(dateFrom) : ''}
                  onChange={(e) =>
                    onDateFromChange(e.target.value ? dateFromInput(e.target.value) : null)
                  }
                />
              </label>
              <label className="filter-dropdown__date-label">
                To
                <input
                  type="date"
                  value={dateTo ? dateToInputValue(dateTo) : ''}
                  onChange={(e) =>
                    onDateToChange(e.target.value ? dateFromInput(e.target.value) : null)
                  }
                />
              </label>
            </div>
          </div>

          <div className="filter-dropdown__section">
            <label className="filter-dropdown__pinned-toggle">
              <input
                type="checkbox"
                checked={pinnedOnly}
                onChange={(e) => onPinnedOnlyChange(e.target.checked)}
              />
              Pinned only
            </label>
          </div>
        </div>
      }
    >
      <Button variant="ghost" aria-label={`Filters${count > 0 ? ` (${count} active)` : ''}`}>
        <Icon name="ListFilter" label={undefined} />
        Filters
        {count > 0 && <span className="filter-dropdown__badge">{count}</span>}
      </Button>
    </Popover>
  );
}

function dateToInputValue(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toISOString().slice(0, 10);
}

function dateFromInput(value: string): number {
  return new Date(`${value}T00:00:00Z`).getTime();
}
