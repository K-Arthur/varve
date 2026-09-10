import type { Adjustment, ColorBalanceAdjustment, ColorBalanceTriplet } from '@varve/scene';
import { Switch, type Tab, Tabs } from '@varve/ui';
import { useState } from 'react';
import { RangeValueControl } from '../Inspector/controls/RangeValueControl';

type TonalRange = 'shadows' | 'midtones' | 'highlights';
type Axis = keyof ColorBalanceTriplet;

const RANGES: readonly Tab<TonalRange>[] = [
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
  const setAxis = (range: TonalRange, axis: Axis) => (value: number) => {
    onChange({
      [range]: { ...adjustment[range], [axis]: value },
    } as unknown as Partial<Adjustment>);
  };

  const resetCurrent = () => onChange({ [activeRange]: { ...ZERO } } as Partial<Adjustment>);
  const resetAll = () =>
    onChange({ shadows: { ...ZERO }, midtones: { ...ZERO }, highlights: { ...ZERO } });

  return (
    <div className="color-balance-editor">
      <Tabs
        label="Tonal range"
        tabs={RANGES}
        activeTab={activeRange}
        onTabChange={setActiveRange}
        variant="soft"
        size="sm"
        tabListClassName="color-balance-editor__tabs"
        panelClassName="color-balance-editor__range-panel"
        renderPanel={(range) => {
          const active = adjustment[range.value];
          return (
            <div className="color-balance-editor__axes">
              {AXES.map((axis) => (
                <div className="color-balance-editor__axis" key={axis.key}>
                  <div className="color-balance-editor__axis-labels">
                    <span>{axis.left}</span>
                    <output aria-label={`${axis.label} value`}>{active[axis.key]}</output>
                    <span className="color-balance-editor__axis-label--right">{axis.right}</span>
                  </div>
                  <RangeValueControl
                    label={`${range.label} ${axis.label}`}
                    rangeAriaLabel={`${range.label} ${axis.label}`}
                    rangeClassName="adj-editor__slider"
                    min={-100}
                    max={100}
                    value={active[axis.key]}
                    onChange={setAxis(range.value, axis.key)}
                    onRangePointerDown={onEditStart}
                    onRangePointerUp={onEditEnd}
                    onRangePointerCancel={onEditEnd}
                    onRangeKeyDown={onEditStart}
                    onRangeKeyUp={onEditEnd}
                  />
                </div>
              ))}
            </div>
          );
        }}
      />

      <Switch
        className="adj-editor__checkbox-row"
        label="Preserve luminosity"
        checked={adjustment.preserveLuminosity}
        onChange={(event) => onChange({ preserveLuminosity: event.target.checked })}
      />

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
