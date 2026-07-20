import type { LayerColor } from '@strata/scene';
import { SOLID_CHROME_ICONS, SOLID_TOOL_ICONS, SolidIcon } from '@strata/ui';

export interface LayerBulkBarProps {
  selectedCount: number;
  onGroup: () => void;
  onLockAll: () => void;
  onUnlockAll: () => void;
  onHideAll: () => void;
  onShowAll: () => void;
  onColorTag: (color: LayerColor) => void;
  onDeleteAll: () => void;
}

const LAYER_COLORS: NonNullable<LayerColor>[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'gray',
];

const COLOR_LABELS: Record<NonNullable<LayerColor>, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  gray: 'Gray',
};

export function LayerBulkBar({
  selectedCount,
  onGroup,
  onLockAll,
  onUnlockAll,
  onHideAll,
  onShowAll,
  onColorTag,
  onDeleteAll,
}: LayerBulkBarProps) {
  if (selectedCount < 2) return null;

  return (
    <div className="layers-bulk-bar" role="toolbar" aria-label="Bulk layer actions">
      <span className="layers-bulk-bar__count">{selectedCount} selected</span>
      <div className="layers-bulk-bar__actions">
        <button
          type="button"
          className="layers-bulk-bar__btn"
          onClick={onGroup}
          aria-label="Group"
          title="Group layers"
        >
          <SolidIcon name={SOLID_TOOL_ICONS.group} size="0.85em" />
        </button>
        <button
          type="button"
          className="layers-bulk-bar__btn"
          onClick={onLockAll}
          aria-label="Lock all"
          title="Lock all"
        >
          <SolidIcon name={SOLID_CHROME_ICONS.lock} size="0.85em" />
        </button>
        <button
          type="button"
          className="layers-bulk-bar__btn"
          onClick={onUnlockAll}
          aria-label="Unlock all"
          title="Unlock all"
        >
          <SolidIcon name={SOLID_CHROME_ICONS.unlock} size="0.85em" />
        </button>
        <button
          type="button"
          className="layers-bulk-bar__btn"
          onClick={onHideAll}
          aria-label="Hide all"
          title="Hide all"
        >
          <SolidIcon name={SOLID_CHROME_ICONS.visibilityOff} size="0.85em" />
        </button>
        <button
          type="button"
          className="layers-bulk-bar__btn"
          onClick={onShowAll}
          aria-label="Show all"
          title="Show all"
        >
          <SolidIcon name={SOLID_CHROME_ICONS.visibility} size="0.85em" />
        </button>
        <div className="layers-bulk-bar__color-group">
          {LAYER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`layers-bulk-bar__color-btn layers-bulk-bar__color-btn--${c}`}
              onClick={() => onColorTag(c)}
              aria-label={COLOR_LABELS[c]}
              title={COLOR_LABELS[c]}
            />
          ))}
        </div>
        <button
          type="button"
          className="layers-bulk-bar__btn layers-bulk-bar__btn--delete"
          onClick={onDeleteAll}
          aria-label="Delete all"
          title="Delete all selected"
        >
          <SolidIcon name={SOLID_CHROME_ICONS.trash} size="0.85em" />
        </button>
      </div>
    </div>
  );
}
