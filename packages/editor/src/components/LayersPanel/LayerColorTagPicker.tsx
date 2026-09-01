import {
  LAYER_COLOR_LABELS,
  LAYER_COLORS,
  type LayerColor,
  type LayerColorName,
} from '@varve/scene';
import { SOLID_CHROME_ICONS, SolidIcon } from '@varve/ui';

export type LayerColorPickerValue = LayerColor | 'mixed' | undefined;

export interface LayerColorTagPickerProps {
  value?: LayerColorPickerValue;
  onChange: (color: LayerColor) => void;
  /** Include an explicit button for filtering untagged layers. */
  includeNoTag?: boolean;
  /** Include a clear button that calls onChange(null). */
  includeClear?: boolean;
  clearLabel?: string;
  ariaLabel?: string;
}

/**
 * Shared color-tag control for assignment and filtering. The picker owns the
 * stable tag vocabulary and labels; callers own whether null means “clear an
 * assignment” or “filter for untagged layers.”
 */
export function LayerColorTagPicker({
  value,
  onChange,
  includeNoTag = false,
  includeClear = false,
  clearLabel = 'Clear color tag',
  ariaLabel = 'Color tags',
}: LayerColorTagPickerProps) {
  return (
    <fieldset className="layer-color-tag-picker" aria-label={ariaLabel}>
      {value === 'mixed' && (
        <span className="layer-color-tag-picker__mixed" role="status">
          Mixed tags
        </span>
      )}
      {LAYER_COLORS.map((color: LayerColorName) => {
        const label = LAYER_COLOR_LABELS[color];
        const selected = value === color;
        return (
          <button
            key={color}
            type="button"
            className={`layer-color-tag-picker__button layer-color-tag-picker__button--${color}`}
            onClick={() => onChange(color)}
            aria-label={label}
            aria-pressed={selected}
            title={`${label} color tag`}
          />
        );
      })}
      {includeNoTag && (
        <button
          type="button"
          className={`layer-color-tag-picker__button layer-color-tag-picker__button--none${value === null ? ' layer-color-tag-picker__button--selected' : ''}`}
          onClick={() => onChange(null)}
          aria-label="No color tag"
          aria-pressed={value === null}
          title="Filter untagged layers"
        >
          <span aria-hidden="true">—</span>
        </button>
      )}
      {includeClear && (
        <button
          type="button"
          className="layer-color-tag-picker__button layer-color-tag-picker__button--clear"
          onClick={() => onChange(null)}
          aria-label={clearLabel}
          title={clearLabel}
        >
          <SolidIcon name={SOLID_CHROME_ICONS.close} size="0.65em" />
        </button>
      )}
    </fieldset>
  );
}
