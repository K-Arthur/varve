import type { LayerColor } from '@varve/scene';
import {
  SOLID_CHROME_ICONS,
  SOLID_TOOL_ICONS,
  SolidIcon,
  Tooltip,
  TooltipProvider,
} from '@varve/ui';
import { type LayerColorPickerValue, LayerColorTagPicker } from './LayerColorTagPicker';

export interface LayerBulkBarProps {
  selectedCount: number;
  selectedColor?: LayerColorPickerValue;
  onGroup: () => void;
  onLockAll: () => void;
  onUnlockAll: () => void;
  onHideAll: () => void;
  onShowAll: () => void;
  onColorTag: (color: LayerColor) => void;
  onClearColorTag: () => void;
  onDeleteAll: () => void;
}

export function LayerBulkBar({
  selectedCount,
  selectedColor,
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
          <LayerColorTagPicker
            ariaLabel="Set color tag for selected layers"
            value={selectedColor}
            includeClear
            clearLabel="Clear layer color"
            onChange={(color) => {
              if (color === null) onClearColorTag();
              else onColorTag(color);
            }}
          />
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
