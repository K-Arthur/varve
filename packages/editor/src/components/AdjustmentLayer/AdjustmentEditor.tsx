import type { Adjustment } from '@strata/scene';
import { useCallback } from 'react';
import './adjustment.css';

export interface AdjustmentEditorProps {
  adjustment: Adjustment;
  onChange: (patch: Partial<Adjustment>) => void;
}

export function AdjustmentEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const handleSlider = useCallback(
    (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ [key]: Number(e.target.value) } as Partial<Adjustment>);
    },
    [onChange],
  );

  const handleNumber = useCallback(
    (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number.parseFloat(e.target.value);
      if (!Number.isNaN(v)) {
        onChange({ [key]: v } as Partial<Adjustment>);
      }
    },
    [onChange],
  );

  switch (adjustment.kind) {
    case 'brightness':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Brightness</span>
            <span>{adjustment.value}</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={-100}
            max={100}
            value={adjustment.value}
            onChange={handleSlider('value')}
            aria-label="Brightness"
          />
        </div>
      );

    case 'contrast':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Contrast</span>
            <span>{adjustment.value}</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={-100}
            max={100}
            value={adjustment.value}
            onChange={handleSlider('value')}
            aria-label="Contrast"
          />
        </div>
      );

    case 'levels':
      return <LevelsEditor adjustment={adjustment} onChange={onChange} />;

    case 'curves':
      return <CurvesEditor adjustment={adjustment} onChange={onChange} />;

    case 'selectiveColor':
      return <SelectiveColorEditor adjustment={adjustment} onChange={onChange} />;

    case 'colorBalance':
      return <ColorBalanceEditor adjustment={adjustment} onChange={onChange} />;

    case 'exposure':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>EV</span>
            <span>{adjustment.value}</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={-10}
            max={10}
            step={0.1}
            value={adjustment.value}
            onChange={handleSlider('value')}
            aria-label="Exposure"
          />
          <div className="adj-editor__row">
            <span className="adj-editor__label">Offset</span>
            <input
              type="number"
              className="adj-editor__number"
              value={adjustment.offset}
              onChange={handleNumber('offset')}
              step={0.01}
              aria-label="Offset"
            />
          </div>
          <div className="adj-editor__row">
            <span className="adj-editor__label">Gamma</span>
            <input
              type="number"
              className="adj-editor__number"
              value={adjustment.gammaCorrection}
              onChange={handleNumber('gammaCorrection')}
              step={0.01}
              min={0.01}
              max={10}
              aria-label="Gamma correction"
            />
          </div>
        </div>
      );

    case 'temperature':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Temperature</span>
            <span>{adjustment.value}</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={-100}
            max={100}
            value={adjustment.value}
            onChange={handleSlider('value')}
            aria-label="Temperature"
          />
        </div>
      );

    case 'saturation':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Saturation</span>
            <span>{adjustment.value}</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={-100}
            max={100}
            value={adjustment.value}
            onChange={handleSlider('value')}
            aria-label="Saturation"
          />
        </div>
      );

    case 'hueRotate':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Hue</span>
            <span>{adjustment.value}°</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={-180}
            max={180}
            value={adjustment.value}
            onChange={handleSlider('value')}
            aria-label="Hue rotate"
          />
        </div>
      );

    case 'sepia':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Sepia</span>
            <span>{adjustment.value}%</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={0}
            max={100}
            value={adjustment.value}
            onChange={handleSlider('value')}
            aria-label="Sepia"
          />
        </div>
      );

    case 'grayscale':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Grayscale</span>
            <span>{adjustment.value}%</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={0}
            max={100}
            value={adjustment.value}
            onChange={handleSlider('value')}
            aria-label="Grayscale"
          />
        </div>
      );

    case 'invert':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Invert</span>
            <span>{adjustment.value}%</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={0}
            max={100}
            value={adjustment.value}
            onChange={handleSlider('value')}
            aria-label="Invert"
          />
        </div>
      );

    case 'opacity':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Opacity</span>
            <span>{adjustment.value}%</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={0}
            max={100}
            value={adjustment.value}
            onChange={handleSlider('value')}
            aria-label="Opacity"
          />
        </div>
      );

    case 'blur':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Radius</span>
            <span>{adjustment.radius}px</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={0}
            max={50}
            step={0.5}
            value={adjustment.radius}
            onChange={handleSlider('radius')}
            aria-label="Blur radius"
          />
        </div>
      );

    case 'sharpen':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__row">
            <span className="adj-editor__label">Amount</span>
            <input
              type="number"
              className="adj-editor__number"
              value={adjustment.amount}
              onChange={handleNumber('amount')}
              step={0.1}
              aria-label="Sharpen amount"
            />
          </div>
          <div className="adj-editor__row">
            <span className="adj-editor__label">Radius</span>
            <input
              type="number"
              className="adj-editor__number"
              value={adjustment.radius}
              onChange={handleNumber('radius')}
              step={0.5}
              min={0.5}
              aria-label="Sharpen radius"
            />
          </div>
          <div className="adj-editor__row">
            <span className="adj-editor__label">Threshold</span>
            <input
              type="number"
              className="adj-editor__number"
              value={adjustment.threshold}
              onChange={handleNumber('threshold')}
              step={1}
              min={0}
              aria-label="Sharpen threshold"
            />
          </div>
        </div>
      );

    case 'tint':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Tint</span>
            <span>{adjustment.value}</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={-100}
            max={100}
            value={adjustment.value}
            onChange={handleSlider('value')}
            aria-label="Tint"
          />
        </div>
      );

    case 'vibrance':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Vibrance</span>
            <span>{adjustment.value}</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={-100}
            max={100}
            value={adjustment.value}
            onChange={handleSlider('value')}
            aria-label="Vibrance"
          />
        </div>
      );

    case 'channelMixer':
      return <ChannelMixerEditor adjustment={adjustment} onChange={onChange} />;

    case 'photoFilter':
      return <PhotoFilterEditor adjustment={adjustment} onChange={onChange} />;

    case 'halftone':
      return <HalftoneEditor adjustment={adjustment} onChange={onChange} />;

    default:
      return (
        <div className="adj-editor__slider-row">
          <span className="adj-editor__label" style={{ color: 'var(--text-tertiary)' }}>
            No editor for {(adjustment as Adjustment).kind}
          </span>
        </div>
      );
  }
}

function LevelsEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@strata/scene').LevelsAdjustment;
  const handleNumber = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number.parseFloat(e.target.value);
    if (!Number.isNaN(v)) {
      onChange({ [key]: v } as unknown as Partial<Adjustment>);
    }
  };
  const handleSelect = (key: string) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ [key]: e.target.value } as unknown as Partial<Adjustment>);
  };

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Channel</span>
        <select
          className="adj-editor__select"
          value={adj.channel}
          onChange={handleSelect('channel')}
          aria-label="Channel"
        >
          <option value="rgb">RGB</option>
          <option value="red">Red</option>
          <option value="green">Green</option>
          <option value="blue">Blue</option>
        </select>
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Input Shadows</span>
        <input
          type="number"
          className="adj-editor__number"
          value={adj.inputShadows}
          onChange={handleNumber('inputShadows')}
          min={0}
          max={255}
          aria-label="Input shadows"
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Input Midtones</span>
        <input
          type="number"
          className="adj-editor__number"
          value={adj.inputMidtones}
          onChange={handleNumber('inputMidtones')}
          min={0.01}
          max={9.99}
          step={0.01}
          aria-label="Input midtones"
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Input Highlights</span>
        <input
          type="number"
          className="adj-editor__number"
          value={adj.inputHighlights}
          onChange={handleNumber('inputHighlights')}
          min={0}
          max={255}
          aria-label="Input highlights"
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Output Shadows</span>
        <input
          type="number"
          className="adj-editor__number"
          value={adj.outputShadows}
          onChange={handleNumber('outputShadows')}
          min={0}
          max={255}
          aria-label="Output shadows"
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Output Highlights</span>
        <input
          type="number"
          className="adj-editor__number"
          value={adj.outputHighlights}
          onChange={handleNumber('outputHighlights')}
          min={0}
          max={255}
          aria-label="Output highlights"
        />
      </div>
    </div>
  );
}

function CurvesEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@strata/scene').CurvesAdjustment;
  const handleNumber = (key: string, idx: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number.parseFloat(e.target.value);
    if (Number.isNaN(v)) return;
    const points = adj.points.map((p, i) => (i === idx ? { ...p, [key]: v } : p));
    onChange({ points } as unknown as Partial<Adjustment>);
  };
  const handleSelect = (key: string) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ [key]: e.target.value } as unknown as Partial<Adjustment>);
  };
  const addPoint = () => {
    const last = adj.points[adj.points.length - 1];
    const newInput = last ? Math.min(255, last.input + 32) : 0;
    const newOutput = last ? Math.min(255, last.output + 32) : 0;
    onChange({
      points: [...adj.points, { input: newInput, output: newOutput }],
    } as unknown as Partial<Adjustment>);
  };
  const removePoint = (idx: number) => () => {
    if (adj.points.length <= 2) return;
    onChange({
      points: adj.points.filter((_, i) => i !== idx),
    } as unknown as Partial<Adjustment>);
  };

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Channel</span>
        <select
          className="adj-editor__select"
          value={adj.channel}
          onChange={handleSelect('channel')}
          aria-label="Curve channel"
        >
          <option value="rgb">RGB</option>
          <option value="red">Red</option>
          <option value="green">Green</option>
          <option value="blue">Blue</option>
        </select>
      </div>
      <div className="adj-editor__curve-points">
        {adj.points.map((pt, i) => (
          <div key={i} className="adj-editor__curve-point">
            <span className="adj-editor__curve-point-label">{i + 1}</span>
            <input
              type="number"
              className="adj-editor__number"
              value={pt.input}
              onChange={handleNumber('input', i)}
              min={0}
              max={255}
              aria-label={`Point ${i + 1} input`}
              title="Input"
            />
            <span style={{ color: 'var(--text-tertiary)', fontSize: '11px' }} aria-hidden="true">
              to
            </span>
            <input
              type="number"
              className="adj-editor__number"
              value={pt.output}
              onChange={handleNumber('output', i)}
              min={0}
              max={255}
              aria-label={`Point ${i + 1} output`}
              title="Output"
            />
            {adj.points.length > 2 && (
              <button
                type="button"
                className="adj-editor__curve-add"
                onClick={removePoint(i)}
                aria-label={`Remove point ${i + 1}`}
                style={{
                  border: 'none',
                  color: 'var(--color-danger)',
                  cursor: 'pointer',
                  fontSize: '11px',
                  padding: '0 4px',
                }}
              >
                X
              </button>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="adj-editor__curve-add" onClick={addPoint}>
        + Add point
      </button>
    </div>
  );
}

function SelectiveColorEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@strata/scene').SelectiveColorAdjustment;
  const handleSlider = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ [key]: Number(e.target.value) } as unknown as Partial<Adjustment>);
  };
  const handleSelect = (key: string) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ [key]: e.target.value } as unknown as Partial<Adjustment>);
  };

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Color Range</span>
        <select
          className="adj-editor__select"
          value={adj.colorRange}
          onChange={handleSelect('colorRange')}
          aria-label="Color range"
        >
          {(
            [
              'reds',
              'yellows',
              'greens',
              'cyans',
              'blues',
              'magentas',
              'whites',
              'neutrals',
              'blacks',
            ] as const
          ).map((r) => (
            <option key={r} value={r}>
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Relative</span>
        <input
          type="checkbox"
          checked={adj.relative}
          onChange={(e) =>
            onChange({ relative: e.target.checked } as unknown as Partial<Adjustment>)
          }
          aria-label="Relative adjustment"
        />
      </div>
      {(['cyan', 'magenta', 'yellow', 'black'] as const).map((channel) => (
        <div key={channel} className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>{channel.charAt(0).toUpperCase() + channel.slice(1)}</span>
            <span>{adj[channel]}</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={-100}
            max={100}
            value={adj[channel]}
            onChange={handleSlider(channel)}
            aria-label={channel}
          />
        </div>
      ))}
    </div>
  );
}

function ColorBalanceEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@strata/scene').ColorBalanceAdjustment;
  const handleTriplet =
    (range: 'shadows' | 'midtones' | 'highlights', key: string) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      onChange({
        [range]: { ...adj[range], [key]: v },
      } as unknown as Partial<Adjustment>);
    };

  const TripletRow = ({
    label,
    range,
  }: {
    label: string;
    range: 'shadows' | 'midtones' | 'highlights';
  }) => (
    <div className="adj-editor__triplet">
      <span
        style={{
          fontSize: 'var(--font-size-xs)',
          fontWeight: 'var(--font-weight-semibold)',
          color: 'var(--text-secondary)',
        }}
      >
        {label}
      </span>
      <div className="adj-editor__triplet-row">
        <span className="adj-editor__triplet-label">Cyan / Red</span>
        <input
          type="range"
          className="adj-editor__slider"
          min={-100}
          max={100}
          value={adj[range].cyanRed}
          onChange={handleTriplet(range, 'cyanRed')}
          aria-label={`${label} cyan/red`}
        />
        <span style={{ fontSize: '10px', minWidth: 24, textAlign: 'right' }}>
          {adj[range].cyanRed}
        </span>
      </div>
      <div className="adj-editor__triplet-row">
        <span className="adj-editor__triplet-label">Magenta / Green</span>
        <input
          type="range"
          className="adj-editor__slider"
          min={-100}
          max={100}
          value={adj[range].magentaGreen}
          onChange={handleTriplet(range, 'magentaGreen')}
          aria-label={`${label} magenta/green`}
        />
        <span style={{ fontSize: '10px', minWidth: 24, textAlign: 'right' }}>
          {adj[range].magentaGreen}
        </span>
      </div>
      <div className="adj-editor__triplet-row">
        <span className="adj-editor__triplet-label">Yellow / Blue</span>
        <input
          type="range"
          className="adj-editor__slider"
          min={-100}
          max={100}
          value={adj[range].yellowBlue}
          onChange={handleTriplet(range, 'yellowBlue')}
          aria-label={`${label} yellow/blue`}
        />
        <span style={{ fontSize: '10px', minWidth: 24, textAlign: 'right' }}>
          {adj[range].yellowBlue}
        </span>
      </div>
    </div>
  );

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Preserve Luminosity</span>
        <input
          type="checkbox"
          checked={adj.preserveLuminosity}
          onChange={(e) =>
            onChange({ preserveLuminosity: e.target.checked } as unknown as Partial<Adjustment>)
          }
          aria-label="Preserve luminosity"
        />
      </div>
      <TripletRow label="Shadows" range="shadows" />
      <TripletRow label="Midtones" range="midtones" />
      <TripletRow label="Highlights" range="highlights" />
    </div>
  );
}

function ChannelMixerEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@strata/scene').ChannelMixerAdjustment;
  const handleNumber = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number.parseFloat(e.target.value);
    if (!Number.isNaN(v)) {
      onChange({ [key]: v } as unknown as Partial<Adjustment>);
    }
  };
  const handleSelect = (key: string) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ [key]: e.target.value } as unknown as Partial<Adjustment>);
  };

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Output Channel</span>
        <select
          className="adj-editor__select"
          value={adj.outputChannel}
          onChange={handleSelect('outputChannel')}
          aria-label="Output channel"
        >
          <option value="red">Red</option>
          <option value="green">Green</option>
          <option value="blue">Blue</option>
        </select>
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Monochrome</span>
        <input
          type="checkbox"
          checked={adj.monochrome}
          onChange={(e) =>
            onChange({ monochrome: e.target.checked } as unknown as Partial<Adjustment>)
          }
          aria-label="Monochrome"
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Red %</span>
        <input
          type="number"
          className="adj-editor__number"
          value={adj.redPercent}
          onChange={handleNumber('redPercent')}
          step={1}
          aria-label="Red percent"
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Green %</span>
        <input
          type="number"
          className="adj-editor__number"
          value={adj.greenPercent}
          onChange={handleNumber('greenPercent')}
          step={1}
          aria-label="Green percent"
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Blue %</span>
        <input
          type="number"
          className="adj-editor__number"
          value={adj.bluePercent}
          onChange={handleNumber('bluePercent')}
          step={1}
          aria-label="Blue percent"
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Constant</span>
        <input
          type="number"
          className="adj-editor__number"
          value={adj.constant}
          onChange={handleNumber('constant')}
          step={1}
          aria-label="Constant"
        />
      </div>
    </div>
  );
}

function HalftoneEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@strata/scene').HalftoneAdjustment;
  const handleSelect = (key: string) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ [key]: e.target.value } as unknown as Partial<Adjustment>);
  };
  const handleNumber = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number.parseFloat(e.target.value);
    if (!Number.isNaN(v)) {
      onChange({ [key]: v } as unknown as Partial<Adjustment>);
    }
  };

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Method</span>
        <select
          className="adj-editor__select"
          value={adj.method}
          onChange={handleSelect('method')}
          aria-label="Screening method"
        >
          <option value="am">AM (clustered dot)</option>
          <option value="fm">FM (stochastic)</option>
        </select>
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Pattern</span>
        <select
          className="adj-editor__select"
          value={adj.pattern}
          onChange={handleSelect('pattern')}
          aria-label="Halftone pattern"
        >
          <option value="dot">Dot</option>
          <option value="line">Line</option>
          <option value="cross">Cross</option>
          <option value="circle">Circle</option>
        </select>
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Dot Shape</span>
        <select
          className="adj-editor__select"
          value={adj.dotShape}
          onChange={handleSelect('dotShape')}
          aria-label="Dot shape"
        >
          <option value="round">Round</option>
          <option value="elliptical">Elliptical</option>
          <option value="square">Square</option>
          <option value="diamond">Diamond</option>
          <option value="line">Line</option>
        </select>
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Channel</span>
        <select
          className="adj-editor__select"
          value={adj.channel}
          onChange={handleSelect('channel')}
          aria-label="Ink channel"
        >
          <option value="k">Black (K)</option>
          <option value="c">Cyan (C)</option>
          <option value="m">Magenta (M)</option>
          <option value="y">Yellow (Y)</option>
          <option value="cmyk">CMYK (all channels)</option>
        </select>
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Frequency (LPI)</span>
          <span>{adj.frequency}</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={5}
          max={150}
          step={1}
          value={adj.frequency}
          onChange={handleNumber('frequency')}
          aria-label="Screen frequency in lines per inch"
          disabled={adj.channel === 'cmyk'}
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Angle</span>
          <span>{adj.angle}°</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={179}
          step={1}
          value={adj.angle}
          onChange={handleNumber('angle')}
          aria-label="Screen angle in degrees"
          disabled={adj.channel === 'cmyk'}
        />
      </div>
      {adj.channel === 'cmyk' && (
        <div className="adj-editor__row">
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--text-tertiary)',
            }}
          >
            CMYK mode screens each ink at its standard press angle (C 15°, M 75°, Y 0°, K 45°) to
            avoid moiré between channels.
          </span>
        </div>
      )}
    </div>
  );
}

function PhotoFilterEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@strata/scene').PhotoFilterAdjustment;
  const handleSlider = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ [key]: Number(e.target.value) } as unknown as Partial<Adjustment>);
  };

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Density</span>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={100}
          value={adj.density}
          onChange={handleSlider('density')}
          aria-label="Density"
        />
        <span style={{ fontSize: '10px', minWidth: 24, textAlign: 'right' }}>{adj.density}</span>
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Preserve Luminosity</span>
        <input
          type="checkbox"
          checked={adj.preserveLuminosity}
          onChange={(e) =>
            onChange({ preserveLuminosity: e.target.checked } as unknown as Partial<Adjustment>)
          }
          aria-label="Preserve luminosity"
        />
      </div>
    </div>
  );
}
