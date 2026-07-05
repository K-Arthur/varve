import type { BlendMode } from '@strata/scene';
import { CHROME_ICONS, Icon } from '@strata/ui';
import { useCallback, useRef, useState } from 'react';
import type { LayerFilterSpec } from './layerFilterTypes';
import { DEFAULT_FILTER } from './layerFilterTypes';

interface LayerFilterBarProps {
  filter: LayerFilterSpec;
  onChange: (filter: LayerFilterSpec) => void;
  matchCount: number;
  totalCount: number;
}

const KIND_CHIPS: { value: LayerFilterSpec['kinds'][number]; label: string }[] = [
  { value: 'shape', label: 'Shape' },
  { value: 'text', label: 'Text' },
  { value: 'frame', label: 'Frame' },
  { value: 'group', label: 'Group' },
  { value: 'image', label: 'Image' },
  { value: 'adjustment', label: 'Adjustment' },
];

const ATTRIBUTE_CHIPS: {
  value: keyof NonNullable<LayerFilterSpec['attributes']>;
  label: string;
  trueLabel?: string;
  falseLabel?: string;
}[] = [
  { value: 'locked', label: 'Locked', trueLabel: 'Locked' },
  { value: 'visible', label: 'Visible', trueLabel: 'Visible', falseLabel: 'Hidden' },
  { value: 'hasChildren', label: 'Has Children', trueLabel: 'Children' },
  { value: 'hasEffects', label: 'Has Effects', trueLabel: 'Effects' },
  { value: 'isMasked', label: 'Is Masked', trueLabel: 'Masked' },
  { value: 'isComponent', label: 'Component', trueLabel: 'Component' },
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

export function LayerFilterBar({ filter, onChange, matchCount, totalCount }: LayerFilterBarProps) {
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

  const clearAll = useCallback(() => {
    onChange(DEFAULT_FILTER);
    filterRef.current?.focus();
  }, [onChange]);

  return (
    <div className="layers-filter-bar" role="search" aria-label="Filter layers">
      <div className="layers-filter-bar__search-row">
        <Icon name={CHROME_ICONS.search} size="0.85em" aria-hidden />
        <input
          ref={filterRef}
          className="layers-filter-bar__input"
          type="search"
          placeholder="Filter by name..."
          aria-label="Filter layers by name"
          value={filter.search}
          onChange={(e) => onChange({ ...filter, search: e.target.value })}
        />
        {filter.search && (
          <button
            type="button"
            className="layers-filter-bar__clear-search"
            onClick={() => onChange({ ...filter, search: '' })}
            aria-label="Clear search"
          >
            <Icon name={CHROME_ICONS.close} size="0.75em" />
          </button>
        )}
        <button
          type="button"
          className="layers-filter-bar__toggle-advanced"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide filter options' : 'Show filter options'}
        >
          <Icon name={expanded ? CHROME_ICONS.chevronUp : CHROME_ICONS.filter} size="0.85em" />
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
        <div
          className="layers-filter-bar__advanced"
          role="group"
          aria-label="Filter by type and attributes"
        >
          <div className="layers-filter-bar__section">
            <span className="layers-filter-bar__section-label">Type</span>
            <div
              className="layers-filter-bar__chips"
              role="listbox"
              aria-label="Filter by type"
              aria-multiselectable="true"
            >
              {KIND_CHIPS.map((chip) => {
                const active = filter.kinds.includes(chip.value);
                return (
                  <button
                    key={chip.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`layers-filter-bar__chip${active ? ' layers-filter-bar__chip--active' : ''}`}
                    onClick={() => toggleKind(chip.value)}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="layers-filter-bar__section">
            <span className="layers-filter-bar__section-label">Attribute</span>
            <div className="layers-filter-bar__chips" role="group" aria-label="Filter by attribute">
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
                    title={isOn ? chip.trueLabel : isOff ? chip.falseLabel : chip.label}
                  >
                    {isOn ? chip.trueLabel : isOff ? chip.falseLabel : chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="layers-filter-bar__section">
            <span className="layers-filter-bar__section-label">Blend</span>
            <div
              className="layers-filter-bar__chips"
              role="listbox"
              aria-label="Filter by blend mode"
              aria-multiselectable="true"
            >
              {BLEND_CHIPS.map((chip) => {
                const active = filter.blendModes.includes(chip.value);
                return (
                  <button
                    key={chip.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`layers-filter-bar__chip${active ? ' layers-filter-bar__chip--active' : ''}`}
                    onClick={() => toggleBlendMode(chip.value)}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="layers-filter-bar__count" aria-live="polite">
        {hasActiveFilter
          ? `${matchCount} of ${totalCount} layer${totalCount !== 1 ? 's' : ''}`
          : `${totalCount} layer${totalCount !== 1 ? 's' : ''}`}
      </div>
    </div>
  );
}
