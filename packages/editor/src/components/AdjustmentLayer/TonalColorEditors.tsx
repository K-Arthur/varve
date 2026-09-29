import { estimateRelativeWhiteBalance } from '@varve/engine';
import type { Adjustment } from '@varve/scene';
import { gamutMapToSrgbUnit } from '@varve/shared';
import { Button, Select } from '@varve/ui';
import { useState } from 'react';
import { NumberField } from '../Inspector/controls/NumberField';
import { SourceChannels } from './SourceChannels';
import { TonalSlider } from './TonalSlider';
import './tonalEditors.css';

type Props = {
  adjustment: Adjustment;
  onChange: (patch: Partial<Adjustment>) => void;
  sourceImageData?: ImageData | null;
  histogramSourceLabel?: string;
};

export function WhiteBalanceEditor({
  adjustment,
  onChange,
  sourceImageData,
  histogramSourceLabel,
}: Props) {
  const [message, setMessage] = useState(
    'Choose a known gray patch on the upstream source preview.',
  );
  if (adjustment.kind !== 'whiteBalance') return null;
  const apply = (patch?: { x: number; y: number; radius: number }) => {
    if (!sourceImageData) return;
    const result = estimateRelativeWhiteBalance(sourceImageData, patch);
    if (!result.ok) {
      setMessage(result.reason);
      return;
    }
    onChange({
      temperature: 0,
      tint: 0,
      redGain: result.gains[0],
      greenGain: result.gains[1],
      blueGain: result.gains[2],
    } as Partial<Adjustment>);
    setMessage(
      `Applied relative gains from ${result.samples} source samples. Repeating uses the same upstream stage.`,
    );
  };
  return (
    <div className="tonal-editor">
      <p className="tonal-editor__hint">
        Relative correction of rendered RGB. Positive warmth adds red; positive tint adds magenta.
        RAW As Shot remains in RAW Develop.
      </p>
      <TonalSlider
        label="Relative warmth"
        value={adjustment.temperature}
        min={-100}
        max={100}
        step={0.1}
        onChange={(temperature) => onChange({ temperature } as Partial<Adjustment>)}
      />
      <TonalSlider
        label="Relative tint"
        value={adjustment.tint}
        min={-100}
        max={100}
        step={0.1}
        onChange={(tint) => onChange({ tint } as Partial<Adjustment>)}
      />
      <div className="tonal-editor__fields">
        {(['redGain', 'greenGain', 'blueGain'] as const).map((key) => (
          <NumberField
            key={key}
            label={key.replace('Gain', ' gain')}
            displayLabel={key.replace('Gain', '')}
            value={adjustment[key]}
            min={0.25}
            max={4}
            step={0.01}
            onChange={(value) => onChange({ [key]: value } as Partial<Adjustment>)}
          />
        ))}
      </div>
      <div className="tonal-editor__actions">
        <Button variant="secondary" size="sm" disabled={!sourceImageData} onClick={() => apply()}>
          Auto neutral
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange({
              temperature: 0,
              tint: 0,
              redGain: 1,
              greenGain: 1,
              blueGain: 1,
            } as Partial<Adjustment>);
            setMessage('Choose a known gray patch on the upstream source preview.');
          }}
        >
          Reset white balance
        </Button>
      </div>
      <p className="tonal-editor__hint" role="status">
        {message}
      </p>
      <SourceChannels
        source={sourceImageData}
        label={histogramSourceLabel}
        onSample={(x, y) => apply({ x, y, radius: 1 })}
      />
    </div>
  );
}

export function SplitToneEditor({ adjustment, onChange }: Props) {
  if (adjustment.kind !== 'splitTone') return null;
  const swatch = (range: 'shadow' | 'highlight') => {
    const rgb = gamutMapToSrgbUnit([
      0.6,
      adjustment[`${range}Saturation`] * 0.15,
      (adjustment[`${range}Hue`] * Math.PI) / 180,
    ]);
    return (
      <div
        className="tonal-editor__swatch"
        role="img"
        aria-label={`${range} hue reference at lightness 60 percent`}
        style={{ backgroundColor: `rgb(${rgb.map(Math.round).join(' ')})` }}
      />
    );
  };

  const control = (
    key:
      | 'shadowHue'
      | 'highlightHue'
      | 'shadowSaturation'
      | 'highlightSaturation'
      | 'balance'
      | 'blending'
      | 'strength',
    label: string,
    hue = false,
  ) => (
    <TonalSlider
      key={key}
      label={label}
      value={adjustment[key]}
      min={key === 'blending' ? 0.01 : 0}
      max={hue ? 360 : 1}
      step={hue ? 1 : 0.01}
      displayScale={hue ? 1 : 100}
      unit={hue ? '°' : '%'}
      onChange={(value) => onChange({ [key]: value } as Partial<Adjustment>)}
    />
  );
  return (
    <div className="tonal-editor">
      <p className="tonal-editor__hint">
        Adds shadow and highlight chroma at the source lightness. Black and white stay protected.
      </p>
      <Select
        label="Split tone preset"
        value="custom"
        onChange={(value) => {
          if (value === 'cool-warm')
            onChange({
              shadowHue: 240,
              shadowSaturation: 0.18,
              highlightHue: 65,
              highlightSaturation: 0.15,
              balance: 0.5,
              blending: 0.6,
              strength: 1,
            } as Partial<Adjustment>);
          if (value === 'warm-cool')
            onChange({
              shadowHue: 35,
              shadowSaturation: 0.15,
              highlightHue: 250,
              highlightSaturation: 0.12,
              balance: 0.5,
              blending: 0.6,
              strength: 1,
            } as Partial<Adjustment>);
        }}
        options={[
          { value: 'custom', label: 'Custom / current' },
          { value: 'cool-warm', label: 'Cool shadows · warm highlights' },
          { value: 'warm-cool', label: 'Warm shadows · cool highlights' },
        ]}
      />
      {swatch('shadow')}
      {control('shadowHue', 'Shadow hue', true)}
      {control('shadowSaturation', 'Shadow saturation')}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange({ shadowSaturation: 0 } as Partial<Adjustment>)}
      >
        Reset shadows
      </Button>
      {swatch('highlight')}
      {control('highlightHue', 'Highlight hue', true)}
      {control('highlightSaturation', 'Highlight saturation')}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange({ highlightSaturation: 0 } as Partial<Adjustment>)}
      >
        Reset highlights
      </Button>
      {control('balance', 'Shadow range pivot')}
      {control('blending', 'Transition width')}
      {control('strength', 'Toning strength')}
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          onChange({
            shadowSaturation: 0,
            highlightSaturation: 0,
            balance: 0.5,
            blending: 0.5,
            strength: 1,
          } as Partial<Adjustment>)
        }
      >
        Reset split toning
      </Button>
    </div>
  );
}
