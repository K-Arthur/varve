import type { BlendMode, LayerColor } from '@varve/scene';
import { SearchField, SOLID_CHROME_ICONS, SolidIcon } from '@varve/ui';
import { useCallback, useRef, useState } from 'react';
import type { LayersQuickFilter } from '../../workspace/workspaceTypes';
import { LayerColorTagPicker } from './LayerColorTagPicker';
import { DEFAULT_FILTER, type LayerFilterSpec } from './layerFilterTypes';

interface LayerFilterBarProps {
  filter: LayerFilterSpec;
  onChange: (filter: LayerFilterSpec) => void;
  matchCount: number;
  totalCount: number;
  /** One-click presets configured by the active workspace. */
  quickFilters?: readonly LayersQuickFilter[];
  /** Workspace-provided search placeholder copy. */
  searchPlaceholder?: string;
  /** Select every row in the current filtered projection. */
  onSelectMatches?: () => void;
}

/**
 * Attribute dimensions whose value is a boolean flag. Restricting the quick
 * filter target to these keys keeps `attributes[key] = true` type-safe (a
 * union key over the whole interface includes `layerColor`, whose type is not
 * boolean).
 */
type BooleanAttributeKey =
  | 'locked'
  | 'visible'
  | 'hasChildren'
  | 'isComponent'
  | 'isInstance'
  | 'hasEffects'
  | 'isMasked'
  | 'mobileHidden'
  | 'mobileOnly'
  | 'threadedText'
  | 'exportRegion'
  | 'animated';

/**
 * Quick-filter presets map onto the same attribute dimensions as the advanced
 * chips; a preset is therefore a shortcut, never a second filter model.
 */
const QUICK_FILTER_TARGET: Record<LayersQuickFilter, BooleanAttributeKey> = {
  animated: 'animated',
  'mobile-hidden': 'mobileHidden',
  'threaded-text': 'threadedText',
  'export-regions': 'exportRegion',
  masks: 'isMasked',
  components: 'isComponent',
};

const QUICK_FILTER_LABELS: Record<LayersQuickFilter, string> = {
  animated: 'Animated',
  'mobile-hidden': 'Mobile hidden',
  'threaded-text': 'Threaded text',
  'export-regions': 'Export regions',
  masks: 'Masked',
  components: 'Components',
};

const KIND_CHIPS: { value: LayerFilterSpec['kinds'][number]; label: string }[] = [
  { value: 'shape', label: 'Shape' },
  { value: 'text', label: 'Text' },
  { value: 'frame', label: 'Frame' },
  { value: 'group', label: 'Group' },
  { value: 'path', label: 'Path' },
  { value: 'rasterLayer', label: 'Raster' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'table', label: 'Table' },
];

/**
 * Attribute chips cycle through three states: unset → require the attribute →
 * require its absence. Every state needs a visible label; a chip without a
 * `falseLabel` would render as an empty, invisible button on its second click
 * (the state still filtered the tree, but nothing on screen said so).
 */
const ATTRIBUTE_CHIPS: {
  value: keyof NonNullable<LayerFilterSpec['attributes']>;
  label: string;
  trueLabel: string;
  falseLabel: string;
}[] = [
  { value: 'locked', label: 'Locked', trueLabel: 'Locked', falseLabel: 'Unlocked' },
  { value: 'visible', label: 'Visible', trueLabel: 'Visible', falseLabel: 'Hidden' },
  { value: 'hasChildren', label: 'Has Children', trueLabel: 'Children', falseLabel: 'No Children' },
  { value: 'hasEffects', label: 'Has Effects', trueLabel: 'Effects', falseLabel: 'No Effects' },
  { value: 'isMasked', label: 'Is Masked', trueLabel: 'Masked', falseLabel: 'Not Masked' },
  { value: 'isComponent', label: 'Component', trueLabel: 'Component', falseLabel: 'Not Component' },
];

const BLEND_CHIPS: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'colorDodge', label: 'Color Dodge' },
  { value: 'colorBurn', label: 'Color Burn' },
  { value: 'hardLight', label: 'Hard Light' },
  { value: 'softLight', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
];

export function LayerFilterBar({
  filter,
  onChange,
  matchCount,
  totalCount,
  quickFilters = [],
  searchPlaceholder = 'Filter layers…',
  onSelectMatches,
}: LayerFilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  const hasActiveFilter =
    filter.search !== '' ||
    filter.kinds.length > 0 ||
    Object.values(filter.attributes).some((v) => v !== undefined) ||
    filter.blendModes.length > 0;

  const toggleKind = useCallback(
    (kind: LayerFilterSpec['kinds'][number]) => {
      const next = filter.kinds.includes(kind)
        ? filter.kinds.filter((k) => k !== kind)
        : [...filter.kinds, kind];
      onChange({ ...filter, kinds: next });
    },
    [filter, onChange],
  );

  const toggleAttribute = useCallback(
    (attr: keyof NonNullable<LayerFilterSpec['attributes']>) => {
      const current = filter.attributes[attr];
      const next: LayerFilterSpec['attributes'] = {
        ...filter.attributes,
        [attr]: current === undefined ? true : current === true ? false : undefined,
      };
      if (next[attr] === undefined) delete next[attr];
      onChange({ ...filter, attributes: next });
    },
    [filter, onChange],
  );

  const toggleBlendMode = useCallback(
    (blend: BlendMode) => {
      const next = filter.blendModes.includes(blend)
        ? filter.blendModes.filter((b) => b !== blend)
        : [...filter.blendModes, blend];
      onChange({ ...filter, blendModes: next });
    },
    [filter, onChange],
  );

  const setLayerColorFilter = useCallback(
    (color: LayerColor) => {
      onChange({
        ...filter,
        attributes: { ...filter.attributes, layerColor: color },
      });
    },
    [filter, onChange],
  );

  const clearLayerColorFilter = useCallback(() => {
    const { layerColor: _layerColor, ...attributes } = filter.attributes;
    onChange({ ...filter, attributes });
  }, [filter, onChange]);

  const clearAll = useCallback(() => {
    onChange(DEFAULT_FILTER);
    filterRef.current?.focus();
  }, [onChange]);

  const toggleQuickFilter = useCallback(
    (preset: LayersQuickFilter) => {
      const key = QUICK_FILTER_TARGET[preset];
      const wasActive = filter.attributes[key] === true;
      const merged: LayerFilterSpec['attributes'] = { ...filter.attributes };
      merged[key] = true;
      if (wasActive) delete merged[key];
      onChange({ ...filter, attributes: merged });
    },
    [filter, onChange],
  );

  return (
    <search className="layers-filter-bar" aria-label="Filter layers">
      <div className="layers-filter-bar__search-row">
        <SearchField
          ref={filterRef}
          value={filter.search}
          onChange={(v) => onChange({ ...filter, search: v })}
          placeholder={searchPlaceholder}
          aria-label="Filter layers by name"
          resultCount={matchCount}
        />
        <button
          type="button"
          className={`layers-filter-bar__toggle-advanced${expanded || hasActiveFilter ? ' layers-filter-bar__toggle-advanced--active' : ''}`}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide filter options' : 'Show filter options'}
        >
          <SolidIcon
            name={expanded ? SOLID_CHROME_ICONS.chevronUp : SOLID_CHROME_ICONS.filter}
            size="0.85em"
          />
        </button>
        {hasActiveFilter && (
          <button
            type="button"
            className="layers-filter-bar__clear-all"
            onClick={clearAll}
            aria-label="Clear all filters"
          >
            Clear
          </button>
        )}
      </div>

      {expanded && (
        <fieldset
          className="layers-filter-bar__advanced"
          aria-label="Filter by type and attributes"
        >
          <div className="layers-filter-bar__section">
            <span className="layers-filter-bar__section-label">Type</span>
            {/* Toggle buttons in a labelled group, not a listbox: each chip is
                independently focusable and pressing it toggles, which is the
                button/aria-pressed contract. A listbox would require option
                children, a roving tab stop, and arrow-key handling. */}
            <fieldset className="layers-filter-bar__chips" aria-label="Filter by type">
              {KIND_CHIPS.map((chip) => {
                const active = filter.kinds.includes(chip.value);
                return (
                  <button
                    key={chip.value}
                    type="button"
                    aria-pressed={active}
                    className={`layers-filter-bar__chip${active ? ' layers-filter-bar__chip--active' : ''}`}
                    onClick={() => toggleKind(chip.value)}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </fieldset>
          </div>

          <div className="layers-filter-bar__section">
            <span className="layers-filter-bar__section-label">Attribute</span>
            <fieldset className="layers-filter-bar__chips" aria-label="Filter by attribute">
              {ATTRIBUTE_CHIPS.map((chip) => {
                const attrVal = filter.attributes[chip.value];
                const isOn = attrVal === true;
                const isOff = attrVal === false;
                const active = isOn || isOff;
                return (
                  <button
                    key={chip.value}
                    type="button"
                    className={`layers-filter-bar__chip${isOn ? ' layers-filter-bar__chip--active' : ''}${isOff ? ' layers-filter-bar__chip--inverse' : ''}`}
                    onClick={() => toggleAttribute(chip.value)}
                    aria-pressed={active}
                  >
                    {isOn ? chip.trueLabel : isOff ? chip.falseLabel : chip.label}
                  </button>
                );
              })}
            </fieldset>
          </div>

          <div className="layers-filter-bar__section">
            <span className="layers-filter-bar__section-label">Blend</span>
            <fieldset className="layers-filter-bar__chips" aria-label="Filter by blend mode">
              {BLEND_CHIPS.map((chip) => {
                const active = filter.blendModes.includes(chip.value);
                return (
                  <button
                    key={chip.value}
                    type="button"
                    aria-pressed={active}
                    className={`layers-filter-bar__chip${active ? ' layers-filter-bar__chip--active' : ''}`}
                    onClick={() => toggleBlendMode(chip.value)}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </fieldset>
          </div>

          <div className="layers-filter-bar__section">
            <span className="layers-filter-bar__section-label">Color tag</span>
            <LayerColorTagPicker
              value={filter.attributes.layerColor}
              includeNoTag
              ariaLabel="Filter by color tag"
              onChange={setLayerColorFilter}
            />
            {filter.attributes.layerColor !== undefined && (
              <button
                type="button"
                className="layers-filter-bar__clear-tag"
                onClick={clearLayerColorFilter}
              >
                Clear color tag filter
              </button>
            )}
          </div>
        </fieldset>
      )}

      {quickFilters.length > 0 && (
        // biome-ignore lint/a11y/useSemanticElements: named workspace filter toggles are buttons, not form fields.
        <div className="layers-filter-bar__quick" role="group" aria-label="Workspace filters">
          {quickFilters.map((preset) => {
            const key = QUICK_FILTER_TARGET[preset];
            const active = filter.attributes[key] === true;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={active}
                className={`layers-filter-bar__chip layers-filter-bar__chip--quick${active ? ' layers-filter-bar__chip--active' : ''}`}
                onClick={() => toggleQuickFilter(preset)}
              >
                {QUICK_FILTER_LABELS[preset]}
              </button>
            );
          })}
        </div>
      )}

      {hasActiveFilter && (
        <div className="layers-filter-bar__count" aria-live="polite">
          {matchCount} of {totalCount} layer{totalCount !== 1 ? 's' : ''}
          {onSelectMatches && matchCount > 0 && (
            <button
              type="button"
              className="layers-filter-bar__select-matches"
              onClick={onSelectMatches}
            >
              Select matches
            </button>
          )}
        </div>
      )}
    </search>
  );
}
