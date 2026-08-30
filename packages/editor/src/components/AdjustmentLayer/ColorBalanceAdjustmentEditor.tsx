import type { Adjustment, ColorBalanceAdjustment, ColorBalanceTriplet } from '@varve/scene';
import { useState } from 'react';
import { RangeValueControl } from '../Inspector/controls/RangeValueControl';

type TonalRange = 'shadows' | 'midtones' | 'highlights';
type Axis = keyof ColorBalanceTriplet;

const RANGES: { value: TonalRange; label: string }[] = [
  { value: 'shadows', label: 'Shadows' },
  { value: 'midtones', label: 'Midtones' },
  { value: 'highlights', label: 'Highlights' },
];

const AXES: { key: Axis; left: string; right: string; label: string }[] = [
  { key: 'cyanRed', left: 'Cyan', right: 'Red', label: 'Cyan to Red' },
  { key: 'magentaGreen', left: 'Magenta', right: 'Green', label: 'Magenta to Green' },
  { key: 'yellowBlue', left: 'Yellow', right: 'Blue', label: 'Yellow to Blue' },
];

const ZERO: ColorBalanceTriplet = { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 };

export function ColorBalanceAdjustmentEditor({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
}: {
  adjustment: ColorBalanceAdjustment;
  onChange: (patch: Partial<Adjustment>) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}) {
  const [activeRange, setActiveRange] = useState<TonalRange>('shadows');
  const active = adjustment[activeRange];

  const setAxis = (axis: Axis) => (value: number) => {
    onChange({
      [activeRange]: { ...active, [axis]: value },
    } as unknown as Partial<Adjustment>);
  };

  const resetCurrent = () => onChange({ [activeRange]: { ...ZERO } } as Partial<Adjustment>);
  const resetAll = () =>
    onChange({ shadows: { ...ZERO }, midtones: { ...ZERO }, highlights: { ...ZERO } });

  return (
    <div className="color-balance-editor">
      <div className="color-balance-editor__tabs" role="tablist" aria-label="Tonal range">
        {RANGES.map((range) => (
          <button
            key={range.value}
            type="button"
            role="tab"
            aria-selected={activeRange === range.value}
            className={`color-balance-editor__tab${activeRange === range.value ? ' is-active' : ''}`}
            onClick={() => setActiveRange(range.value)}
          >
            {range.label}
          </button>
        ))}
      </div>

      <div className="color-balance-editor__axes">
        {AXES.map((axis) => (
          <div className="color-balance-editor__axis" key={axis.key}>
            <div className="color-balance-editor__axis-labels">
              <span>{axis.left}</span>
              <output aria-label={`${axis.label} value`}>{active[axis.key]}</output>
              <span className="color-balance-editor__axis-label--right">{axis.right}</span>
            </div>
            <RangeValueControl
              label={`${RANGES.find((range) => range.value === activeRange)!.label} ${axis.label}`}
              rangeAriaLabel={`${RANGES.find((range) => range.value === activeRange)!.label} ${axis.label}`}
              rangeClassName="adj-editor__slider"
              min={-100}
              max={100}
              value={active[axis.key]}
              onChange={setAxis(axis.key)}
              onRangePointerDown={onEditStart}
              onRangePointerUp={onEditEnd}
              onRangePointerCancel={onEditEnd}
              onRangeKeyDown={onEditStart}
              onRangeKeyUp={onEditEnd}
            />
          </div>
        ))}
      </div>

      <label className="adj-editor__checkbox-row">
        <input
          type="checkbox"
          checked={adjustment.preserveLuminosity}
          onChange={(event) => onChange({ preserveLuminosity: event.target.checked })}
        />
        Preserve luminosity
      </label>

      <div className="color-balance-editor__actions">
        <button type="button" className="adj-panel__effect-action" onClick={resetCurrent}>
          Reset {RANGES.find((range) => range.value === activeRange)!.label}
        </button>
        <button type="button" className="adj-panel__effect-action" onClick={resetAll}>
          Reset all
        </button>
      </div>
    </div>
  );
}
