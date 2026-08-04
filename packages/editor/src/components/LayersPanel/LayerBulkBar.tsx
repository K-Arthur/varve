import type { LayerColor } from '@varve/scene';
import {
  SOLID_CHROME_ICONS,
  SOLID_TOOL_ICONS,
  SolidIcon,
  Tooltip,
  TooltipProvider,
} from '@varve/ui';

export interface LayerBulkBarProps {
  selectedCount: number;
  onGroup: () => void;
  onLockAll: () => void;
  onUnlockAll: () => void;
  onHideAll: () => void;
  onShowAll: () => void;
  onColorTag: (color: LayerColor) => void;
  onClearColorTag: () => void;
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
  onClearColorTag,
  onDeleteAll,
}: LayerBulkBarProps) {
  if (selectedCount < 2) return null;

  return (
    <div className="layers-bulk-bar" role="toolbar" aria-label="Bulk layer actions">
      <span className="layers-bulk-bar__count">{selectedCount} selected</span>
      <TooltipProvider>
        <div className="layers-bulk-bar__actions">
          <Tooltip label="Group layers">
            <button
              type="button"
              className="layers-bulk-bar__btn"
              onClick={onGroup}
              aria-label="Group"
            >
              <SolidIcon name={SOLID_TOOL_ICONS.group} size="0.85em" />
            </button>
          </Tooltip>
          <Tooltip label="Lock all">
            <button
              type="button"
              className="layers-bulk-bar__btn"
              onClick={onLockAll}
              aria-label="Lock all"
            >
              <SolidIcon name={SOLID_CHROME_ICONS.lock} size="0.85em" />
            </button>
          </Tooltip>
          <Tooltip label="Unlock all">
            <button
              type="button"
              className="layers-bulk-bar__btn"
              onClick={onUnlockAll}
              aria-label="Unlock all"
            >
              <SolidIcon name={SOLID_CHROME_ICONS.unlock} size="0.85em" />
            </button>
          </Tooltip>
          <Tooltip label="Hide all">
            <button
              type="button"
              className="layers-bulk-bar__btn"
              onClick={onHideAll}
              aria-label="Hide all"
            >
              <SolidIcon name={SOLID_CHROME_ICONS.visibilityOff} size="0.85em" />
            </button>
          </Tooltip>
          <Tooltip label="Show all">
            <button
              type="button"
              className="layers-bulk-bar__btn"
              onClick={onShowAll}
              aria-label="Show all"
            >
              <SolidIcon name={SOLID_CHROME_ICONS.visibility} size="0.85em" />
            </button>
          </Tooltip>
          <div className="layers-bulk-bar__color-group">
            {LAYER_COLORS.map((c) => (
              <Tooltip key={c} label={COLOR_LABELS[c]}>
                <button
                  type="button"
                  className={`layers-bulk-bar__color-btn layers-bulk-bar__color-btn--${c}`}
                  onClick={() => onColorTag(c)}
                  aria-label={COLOR_LABELS[c]}
                />
              </Tooltip>
            ))}
            <Tooltip label="Clear layer colour">
              <button
                type="button"
                className="layers-bulk-bar__color-btn layers-bulk-bar__color-btn--clear"
                onClick={onClearColorTag}
                aria-label="Clear layer colour"
              >
                <SolidIcon name={SOLID_CHROME_ICONS.close} size="0.65em" />
              </button>
            </Tooltip>
          </div>
          <Tooltip label="Delete all selected">
            <button
              type="button"
              className="layers-bulk-bar__btn layers-bulk-bar__btn--delete"
              onClick={onDeleteAll}
              aria-label="Delete all"
            >
              <SolidIcon name={SOLID_CHROME_ICONS.trash} size="0.85em" />
            </button>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}
