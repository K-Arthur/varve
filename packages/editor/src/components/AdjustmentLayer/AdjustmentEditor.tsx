import type { Color, CurvePoint } from '@varve/engine';
import {
  COLOR_HALFTONE_PRESETS,
  HALFTONE_PRESETS,
  LUT_INPUT_SPACE_LABELS,
  parseLutFile,
  serializeLutForDocument,
  TRITONE_PRESETS,
} from '@varve/engine';
import type { Adjustment, Document, ManagedColor } from '@varve/scene';
import { rgbFromTuple } from '@varve/scene';
import { denormalizeChannel, managedColorToRgba, normalizeChannel } from '@varve/shared';
import { Select } from '@varve/ui';
import { ColorPicker } from '@varve/ui/components/ColorPicker';
import { useCallback, useMemo, useRef, useState } from 'react';
import { CurveEditor } from '../Inspector/controls/CurveEditor';
import { GradientMapAdjustmentSection } from '../Inspector/controls/GradientMapAdjustmentSection';
import { HistogramWidget } from '../Inspector/controls/HistogramWidget';
import {
  BloomEditor,
  CausticsEditor,
  CrtEditor,
  DitherEditor,
  LensFlareEditor,
  LightLeakEditor,
  LightShaftsEditor,
  PaletteSnapEditor,
  RgbSplitEditor,
  VhsEditor,
} from './LiveEffectEditors';
import './adjustment.css';

export interface AdjustmentEditorProps {
  adjustment: Adjustment;
  onChange: (patch: Partial<Adjustment>) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  /** Document for palette import sources (document swatches). */
  doc?: Document;
  /**
   * Source histogram for the adjustment's scope targets.
   * Computed asynchronously by useAdjustmentHistogram.
   * Used by Levels (HistogramWidget) and Curves (background display).
   */
  sourceHistogram?: import('@varve/engine').Histogram | null;
}

export function AdjustmentEditor({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
  doc,
  sourceHistogram,
}: AdjustmentEditorProps) {
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

    case 'shadowHighlight':
      return (
        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Shadows</span>
            <span>{adjustment.shadows}</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={0}
            max={100}
            value={adjustment.shadows}
            onChange={handleSlider('shadows')}
            aria-label="Shadows"
          />
          <div className="adj-editor__slider-label">
            <span>Highlights</span>
            <span>{adjustment.highlights}</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={0}
            max={100}
            value={adjustment.highlights}
            onChange={handleSlider('highlights')}
            aria-label="Highlights"
          />
          <div className="adj-editor__slider-label">
            <span>Tonal width</span>
            <span>{adjustment.tonalWidth}</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={0}
            max={100}
            value={adjustment.tonalWidth}
            onChange={handleSlider('tonalWidth')}
            aria-label="Tonal width"
          />
          <div className="adj-editor__slider-label">
            <span>Midpoint</span>
            <span>{adjustment.midpoint}</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={0}
            max={100}
            value={adjustment.midpoint}
            onChange={handleSlider('midpoint')}
            aria-label="Midpoint"
          />
        </div>
      );

    case 'levels':
      return (
        <LevelsEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
          sourceHistogram={sourceHistogram}
        />
      );

    case 'curves':
      return (
        <CurvesEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
          sourceHistogram={sourceHistogram}
        />
      );

    case 'selectiveColor':
      return (
        <SelectiveColorEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );

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
      return (
        <PhotoFilterEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );

    case 'shadowHighlight':
      return <ShadowHighlightEditor adjustment={adjustment} onChange={onChange} />;

    case 'halftone':
      return <HalftoneEditor adjustment={adjustment} onChange={onChange} />;

    case 'gradientMap': {
      const adj = adjustment as import('@varve/scene').GradientMapAdjustment;
      return (
        <GradientMapAdjustmentSection
          adjustment={adj}
          onChange={(patch) => onChange(patch as unknown as Partial<Adjustment>)}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );
    }

    case 'tritone':
      return (
        <TritoneEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );

    case 'colorHalftone':
      return (
        <ColorHalftoneEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );

    case 'duotone':
      return (
        <DuotoneEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );

    case 'blackAndWhite':
      return (
        <BlackAndWhiteEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );

    case 'posterize':
      return <PosterizeEditor adjustment={adjustment} onChange={onChange} />;

    case 'threshold':
      return <ThresholdEditor adjustment={adjustment} onChange={onChange} />;

    case 'lut':
      return (
        <LutEditor
          adjustment={adjustment}
          onChange={onChange}
          onEditStart={onEditStart}
          onEditEnd={onEditEnd}
        />
      );

    case 'dither':
      return <DitherEditor adjustment={adjustment} onChange={onChange} />;

    case 'paletteSnap':
      return <PaletteSnapEditor adjustment={adjustment} onChange={onChange} doc={doc} />;

    case 'bloom':
      return <BloomEditor adjustment={adjustment} onChange={onChange} />;

    case 'rgbSplit':
      return <RgbSplitEditor adjustment={adjustment} onChange={onChange} />;

    case 'crt':
      return <CrtEditor adjustment={adjustment} onChange={onChange} />;

    case 'vhs':
      return <VhsEditor adjustment={adjustment} onChange={onChange} />;

    case 'lightShafts':
      return <LightShaftsEditor adjustment={adjustment} onChange={onChange} />;

    case 'lensFlare':
      return <LensFlareEditor adjustment={adjustment} onChange={onChange} />;

    case 'lightLeak':
      return <LightLeakEditor adjustment={adjustment} onChange={onChange} />;

    case 'caustics':
      return <CausticsEditor adjustment={adjustment} onChange={onChange} />;

    default:
      return (
        <div className="adj-editor__slider-row">
          <span className="adj-editor__label" style={{ color: 'var(--color-text-muted)' }}>
            No editor for {(adjustment as Adjustment).kind}
          </span>
        </div>
      );
  }

  function LutEditor({ adjustment, onChange }: AdjustmentEditorProps) {
    const adj = adjustment as import('@varve/engine').LutAdjustment;
    const fileRef = useRef<HTMLInputElement>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [lutMeta, setLutMeta] = useState<{ name: string; format: string; size: number } | null>(
      null,
    );

    const handleFileChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const text = typeof reader.result === 'string' ? reader.result : null;
          if (!text) {
            setStatus('Failed to read file');
            return;
          }
          try {
            const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
            if (ext === 'cube' || ext === '3dl') {
              const result = parseLutFile(file.name, text);
              const json = serializeLutForDocument(result.transform);
              onChange({
                lutJson: json,
                originalFilename: file.name,
                inputSpace: 'sRGB',
                interpolation: 'tetrahedral',
                intensity: 1,
                linearize: false,
              } as unknown as Partial<Adjustment>);
              const kind = result.transform.kind;
              const size =
                kind === 'shaper3d' ? result.transform.lut3d.size : result.transform.size;
              setLutMeta({
                name: result.title ?? file.name,
                format: result.format,
                size,
              });
              const warning = result.warnings?.[0] ? `; ${result.warnings[0]}` : '';
              setStatus(
                `Imported ${result.format.toUpperCase()} (${kind === '1d' ? '1D' : '3D'} ${size}^${kind === '3d' ? '3' : '1'}${warning})`,
              );
            } else {
              setStatus(`Unsupported format: .${ext}`);
            }
          } catch (err) {
            setStatus(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
          }
          e.target.value = '';
        };
        reader.readAsText(file);
      },
      [onChange],
    );

    return (
      <div className="adj-lut-editor">
        <input
          ref={fileRef}
          type="file"
          accept=".cube,.3dl"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        <button
          type="button"
          className="adj-editor__row adj-lut-editor__import-btn"
          onClick={() => fileRef.current?.click()}
        >
          <span
            className="adj-editor__label"
            style={{ minWidth: 'auto', flex: 1, textAlign: 'center' }}
          >
            {lutMeta ? 'Replace LUT File' : 'Import LUT File'}
          </span>
        </button>

        {status && (
          <div className="adj-lut-editor__status">
            <span>{status}</span>
          </div>
        )}

        {lutMeta && (
          <div className="adj-lut-editor__meta">
            <span className="adj-editor__label">{lutMeta.name}</span>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              {lutMeta.format.toUpperCase()} | {lutMeta.size}^
              {lutMeta.format === '3dl' ||
              (adj.lutJson &&
                (() => {
                  try {
                    return JSON.parse(adj.lutJson)?.kind === '3d';
                  } catch {
                    return false;
                  }
                })())
                ? '3'
                : '1'}
            </span>
          </div>
        )}

        <div className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>Intensity</span>
            <span>{Math.round((adj.intensity ?? 1) * 100)}%</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={0}
            max={100}
            step={1}
            value={Math.round((adj.intensity ?? 1) * 100)}
            onChange={(e) =>
              onChange({
                intensity: Number(e.target.value) / 100,
              } as unknown as Partial<Adjustment>)
            }
            aria-label="LUT intensity"
          />
        </div>

        <div className="adj-editor__row">
          <span className="adj-editor__label">Interpolation</span>
          <Select
            label="Interpolation method"
            value={adj.interpolation ?? 'tetrahedral'}
            options={[
              { value: 'nearest', label: 'Nearest' },
              { value: 'trilinear', label: 'Trilinear' },
              { value: 'tetrahedral', label: 'Tetrahedral' },
            ]}
            onChange={(v) =>
              onChange({
                interpolation: v as 'nearest' | 'trilinear' | 'tetrahedral',
              } as unknown as Partial<Adjustment>)
            }
          />
        </div>

        <div className="adj-editor__row">
          <span className="adj-editor__label">Input Space</span>
          <Select
            label="Input colour space"
            value={adj.inputSpace ?? 'sRGB'}
            options={Object.entries(LUT_INPUT_SPACE_LABELS).map(([k, v]) => ({
              value: k,
              label: v,
            }))}
            onChange={(v) => onChange({ inputSpace: v } as unknown as Partial<Adjustment>)}
          />
        </div>

        <div className="adj-editor__row">
          <span className="adj-editor__label">Linearize</span>
          <input
            type="checkbox"
            checked={adj.linearize ?? false}
            onChange={(e) =>
              onChange({ linearize: e.target.checked } as unknown as Partial<Adjustment>)
            }
            aria-label="Linearize before applying"
          />
        </div>
      </div>
    );
  }
}

// LevelsAdjustment (document model: inputShadows/inputMidtones/inputHighlights/
// outputShadows/outputHighlights) and HistogramWidget's LevelParams (inputBlack/
// gamma/inputWhite/outputBlack/outputWhite) are the same five concepts under
// different names — no unit/space conversion, just a field-rename adapter.
function levelsAdjustmentToParams(
  adj: import('@varve/scene').LevelsAdjustment,
): import('@varve/engine').LevelParams {
  return {
    inputBlack: adj.inputShadows,
    gamma: adj.inputMidtones,
    inputWhite: adj.inputHighlights,
    outputBlack: adj.outputShadows,
    outputWhite: adj.outputHighlights,
  };
}

function paramsToLevelsAdjustmentPatch(
  params: import('@varve/engine').LevelParams,
): Partial<import('@varve/scene').LevelsAdjustment> {
  return {
    inputShadows: params.inputBlack,
    inputMidtones: params.gamma,
    inputHighlights: params.inputWhite,
    outputShadows: params.outputBlack,
    outputHighlights: params.outputWhite,
  };
}

function LevelsEditor({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
  sourceHistogram,
}: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').LevelsAdjustment;
  const handleSelect = (key: string) => (value: string) => {
    onChange({ [key]: value } as unknown as Partial<Adjustment>);
  };

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Channel</span>
        <Select
          label="Channel"
          value={adj.channel}
          options={[
            { value: 'rgb', label: 'RGB' },
            { value: 'red', label: 'Red' },
            { value: 'green', label: 'Green' },
            { value: 'blue', label: 'Blue' },
          ]}
          onChange={handleSelect('channel')}
        />
      </div>
      <HistogramWidget
        histogram={sourceHistogram ?? undefined}
        levels={levelsAdjustmentToParams(adj)}
        onChange={(params) => onChange(paramsToLevelsAdjustmentPatch(params))}
        onDragStart={onEditStart}
        onDragEnd={onEditEnd}
      />
    </div>
  );
}

// CurvesAdjustment.points ({input, output}, 0-255, document/render space) and
// CurveEditor's CurvePoint ({x, y}, 0-1, plot space) are the same tonal curve
// in two different unit systems — a straight linear scale, not a lossy or
// structural conversion. Order is preserved (not re-sorted) so a drag that
// moves one point doesn't reshuffle the others; CurveEditor already sorts by
// x internally for rendering/hit-testing.
export function curvesPointsToCurvePoints(
  points: import('@varve/scene').CurvesPoint[],
): CurvePoint[] {
  return points.map((p) => ({ x: p.input / 255, y: p.output / 255 }));
}

export function curvePointsToCurvesPoints(
  points: CurvePoint[],
): import('@varve/scene').CurvesPoint[] {
  return points.map((p) => ({
    input: Math.round(Math.max(0, Math.min(1, p.x)) * 255),
    output: Math.round(Math.max(0, Math.min(1, p.y)) * 255),
  }));
}

function CurvesEditor({ adjustment, onChange, onEditStart, onEditEnd }: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').CurvesAdjustment;
  const handleSelect = (key: string) => (value: string) => {
    onChange({ [key]: value } as unknown as Partial<Adjustment>);
  };

  return (
    <div>
      <CurveEditor
        value={curvesPointsToCurvePoints(adj.points)}
        onChange={(points) =>
          onChange({ points: curvePointsToCurvesPoints(points) } as unknown as Partial<Adjustment>)
        }
        channel={adj.channel as 'rgb' | 'red' | 'green' | 'blue'}
        onChannelChange={handleSelect('channel')}
        onDragStart={onEditStart}
        onDragEnd={onEditEnd}
      />
    </div>
  );
}

function SelectiveColorEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').SelectiveColorAdjustment;
  const handleSlider = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ [key]: Number(e.target.value) } as unknown as Partial<Adjustment>);
  };
  const handleSelect = (key: string) => (value: string) => {
    onChange({ [key]: value } as unknown as Partial<Adjustment>);
  };

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Color Range</span>
        <Select
          label="Color range"
          value={adj.colorRange}
          options={[
            { value: 'reds', label: 'Reds' },
            { value: 'yellows', label: 'Yellows' },
            { value: 'greens', label: 'Greens' },
            { value: 'cyans', label: 'Cyans' },
            { value: 'blues', label: 'Blues' },
            { value: 'magentas', label: 'Magentas' },
            { value: 'whites', label: 'Whites' },
            { value: 'neutrals', label: 'Neutrals' },
            { value: 'blacks', label: 'Blacks' },
          ]}
          onChange={handleSelect('colorRange')}
        />
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
  const adj = adjustment as import('@varve/scene').ColorBalanceAdjustment;
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
        <span style={{ fontSize: 'var(--font-size-2xs)', minWidth: 24, textAlign: 'right' }}>
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
        <span style={{ fontSize: 'var(--font-size-2xs)', minWidth: 24, textAlign: 'right' }}>
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
        <span style={{ fontSize: 'var(--font-size-2xs)', minWidth: 24, textAlign: 'right' }}>
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
  const adj = adjustment as import('@varve/scene').ChannelMixerAdjustment;
  const handleNumber = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number.parseFloat(e.target.value);
    if (!Number.isNaN(v)) {
      onChange({ [key]: v } as unknown as Partial<Adjustment>);
    }
  };
  const handleSelect = (key: string) => (value: string) => {
    onChange({ [key]: value } as unknown as Partial<Adjustment>);
  };

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Output Channel</span>
        <Select
          label="Output channel"
          value={adj.outputChannel}
          options={[
            { value: 'red', label: 'Red' },
            { value: 'green', label: 'Green' },
            { value: 'blue', label: 'Blue' },
          ]}
          onChange={handleSelect('outputChannel')}
        />
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
  const adj = adjustment as import('@varve/scene').HalftoneAdjustment;
  const handleSelect = (key: string) => (value: string) => {
    onChange({ [key]: value } as unknown as Partial<Adjustment>);
  };
  const handleNumber = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number.parseFloat(e.target.value);
    if (!Number.isNaN(v)) {
      onChange({ [key]: v } as unknown as Partial<Adjustment>);
    }
  };

  const currentPresetId = useMemo(() => {
    const match = HALFTONE_PRESETS.find(
      (p) =>
        p.params.pattern === adj.pattern &&
        p.params.frequency === adj.frequency &&
        p.params.angle === adj.angle &&
        p.params.dotShape === adj.dotShape &&
        p.params.channel === adj.channel &&
        p.params.method === adj.method,
    );
    return match?.id ?? '';
  }, [adj]);

  const handlePresetSelect = (value: string) => {
    const preset = HALFTONE_PRESETS.find((p) => p.id === value);
    if (preset) {
      const { pattern, ...rest } = preset.params;
      onChange({ pattern, ...rest } as unknown as Partial<Adjustment>);
    }
  };

  const fgColor = adj.foregroundColor ?? [0, 0, 0];
  const bgColor = adj.backgroundColor ?? [255, 255, 255];
  const isMonoChannel = adj.channel !== 'cmyk';

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Preset</span>
        <Select
          label="Halftone preset"
          value={currentPresetId}
          placeholder="Custom"
          options={HALFTONE_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
          onChange={handlePresetSelect}
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Method</span>
        <Select
          label="Screening method"
          value={adj.method}
          options={[
            { value: 'am', label: 'AM (clustered dot)' },
            { value: 'fm', label: 'FM (stochastic)' },
          ]}
          onChange={handleSelect('method')}
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Pattern</span>
        <Select
          label="Halftone pattern"
          value={adj.pattern}
          options={[
            { value: 'dot', label: 'Dot' },
            { value: 'line', label: 'Line' },
            { value: 'cross', label: 'Cross' },
            { value: 'circle', label: 'Circle' },
          ]}
          onChange={handleSelect('pattern')}
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Dot Shape</span>
        <Select
          label="Dot shape"
          value={adj.dotShape}
          options={[
            { value: 'round', label: 'Round' },
            { value: 'elliptical', label: 'Elliptical' },
            { value: 'square', label: 'Square' },
            { value: 'diamond', label: 'Diamond' },
            { value: 'line', label: 'Line' },
          ]}
          onChange={handleSelect('dotShape')}
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Channel</span>
        <Select
          label="Ink channel"
          value={adj.channel}
          options={[
            { value: 'k', label: 'Black (K)' },
            { value: 'c', label: 'Cyan (C)' },
            { value: 'm', label: 'Magenta (M)' },
            { value: 'y', label: 'Yellow (Y)' },
            { value: 'cmyk', label: 'CMYK (all channels)' },
          ]}
          onChange={handleSelect('channel')}
        />
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
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Threshold</span>
          <span>{adj.threshold ?? 128}</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={255}
          step={1}
          value={adj.threshold ?? 128}
          onChange={handleNumber('threshold')}
          aria-label="Halftone threshold"
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Intensity</span>
          <span>{Math.round((adj.intensity ?? 1) * 100)}%</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={100}
          step={1}
          value={Math.round((adj.intensity ?? 1) * 100)}
          onChange={(e) =>
            onChange({ intensity: Number(e.target.value) / 100 } as unknown as Partial<Adjustment>)
          }
          aria-label="Halftone intensity"
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Softness</span>
          <span>{Math.round((adj.softness ?? 0) * 100)}%</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={100}
          step={1}
          value={Math.round((adj.softness ?? 0) * 100)}
          onChange={(e) =>
            onChange({ softness: Number(e.target.value) / 100 } as unknown as Partial<Adjustment>)
          }
          aria-label="Dot edge softness"
        />
      </div>
      <div className="adj-editor__row">
        <label className="adj-editor__label" htmlFor="halftone-invert">
          <input
            id="halftone-invert"
            type="checkbox"
            checked={adj.invert ?? false}
            onChange={(e) =>
              onChange({ invert: e.target.checked } as unknown as Partial<Adjustment>)
            }
            aria-label="Invert halftone output"
          />
          Invert
        </label>
      </div>
      {isMonoChannel && (
        <>
          <div className="adj-editor__row">
            <span className="adj-editor__label">Ink Color</span>
            <ColorPicker
              value={rgbFromTuple([fgColor[0], fgColor[1], fgColor[2], 255])}
              onChange={(c: ManagedColor) => {
                const rgb = managedColorToRgba(c);
                onChange({
                  foregroundColor: [rgb[0], rgb[1], rgb[2]],
                } as unknown as Partial<Adjustment>);
              }}
            />
          </div>
          <div className="adj-editor__row">
            <span className="adj-editor__label">Paper Color</span>
            <ColorPicker
              value={rgbFromTuple([bgColor[0], bgColor[1], bgColor[2], 255])}
              onChange={(c: ManagedColor) => {
                const rgb = managedColorToRgba(c);
                onChange({
                  backgroundColor: [rgb[0], rgb[1], rgb[2]],
                } as unknown as Partial<Adjustment>);
              }}
            />
          </div>
        </>
      )}
      {adj.channel === 'cmyk' && (
        <div className="adj-editor__row">
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-muted)',
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

function ColorHalftoneEditor({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
}: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/engine').ColorHalftoneAdjustment;
  const handleSelect = (key: string) => (value: string) => {
    onChange({ [key]: value } as unknown as Partial<Adjustment>);
  };
  const handleSlider = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ [key]: Number(e.target.value) } as unknown as Partial<Adjustment>);
  };

  const currentPresetId = useMemo(() => {
    const match = COLOR_HALFTONE_PRESETS.find(
      (p) =>
        p.params.screenSize === adj.screenSize &&
        p.params.angle === adj.angle &&
        p.params.dotShape === adj.dotShape &&
        p.params.mode === adj.mode,
    );
    return match?.id ?? '';
  }, [adj]);

  const handlePresetSelect = (value: string) => {
    const preset = COLOR_HALFTONE_PRESETS.find((p) => p.id === value);
    if (preset) {
      onChange({
        screenSize: preset.params.screenSize,
        angle: preset.params.angle,
        dotShape: preset.params.dotShape,
        mode: preset.params.mode,
        inkColor: preset.params.inkColor ? ([...preset.params.inkColor] as Color) : undefined,
      } as unknown as Partial<Adjustment>);
    }
  };

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Preset</span>
        <Select
          label="Color halftone preset"
          value={currentPresetId}
          placeholder="Custom"
          options={COLOR_HALFTONE_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
          onChange={handlePresetSelect}
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Mode</span>
        <Select
          label="Channel mode"
          value={adj.mode}
          options={[
            { value: 'cmyk', label: 'CMYK' },
            { value: 'rgb', label: 'RGB' },
            { value: 'mono', label: 'Mono' },
          ]}
          onChange={handleSelect('mode')}
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Dot Shape</span>
        <Select
          label="Dot shape"
          value={adj.dotShape}
          options={[
            { value: 'round', label: 'Round' },
            { value: 'square', label: 'Square' },
            { value: 'diamond', label: 'Diamond' },
            { value: 'line', label: 'Line' },
          ]}
          onChange={handleSelect('dotShape')}
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Screen Size</span>
          <span>{adj.screenSize} LPI</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={3}
          max={60}
          step={1}
          value={adj.screenSize}
          onChange={handleSlider('screenSize')}
          aria-label="Screen size"
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
          max={359}
          step={1}
          value={adj.angle}
          onChange={handleSlider('angle')}
          aria-label="Screen angle"
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Intensity</span>
          <span>{Math.round(adj.intensity * 100)}%</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={100}
          step={1}
          value={Math.round(adj.intensity * 100)}
          onChange={(e) =>
            onChange({ intensity: Number(e.target.value) / 100 } as unknown as Partial<Adjustment>)
          }
          aria-label="Color halftone intensity"
        />
      </div>
      {adj.mode === 'mono' && (
        <>
          <div className="adj-editor__row">
            <span className="adj-editor__label">Ink Color</span>
          </div>
          <ColorPicker
            value={colorToManaged(adj.inkColor ?? [0, 0, 0, 255])}
            onChange={(c) =>
              onChange({ inkColor: managedToColor(c) } as unknown as Partial<Adjustment>)
            }
            onInteractionStart={onEditStart}
            onInteractionEnd={onEditEnd}
          />
        </>
      )}
    </div>
  );
}

function PhotoFilterEditor({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
}: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').PhotoFilterAdjustment;
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
        <span style={{ fontSize: 'var(--font-size-2xs)', minWidth: 24, textAlign: 'right' }}>
          {adj.density}
        </span>
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Filter Color</span>
      </div>
      <ColorPicker
        value={colorToManaged(adj.color)}
        onChange={(color) =>
          onChange({ color: managedToColor(color) } as unknown as Partial<Adjustment>)
        }
        onInteractionStart={onEditStart}
        onInteractionEnd={onEditEnd}
      />
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

function ShadowHighlightEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/engine').ShadowHighlightAdjustment;
  const handleSlider = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ [key]: Number(e.target.value) } as unknown as Partial<Adjustment>);
  };

  return (
    <div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Shadows</span>
          <span>{adj.shadows}</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={100}
          value={adj.shadows}
          onChange={handleSlider('shadows')}
          aria-label="Shadow brightening"
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Highlights</span>
          <span>{adj.highlights}</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={100}
          value={adj.highlights}
          onChange={handleSlider('highlights')}
          aria-label="Highlight recovery"
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Tonal Width</span>
          <span>{adj.tonalWidth}</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={100}
          value={adj.tonalWidth}
          onChange={handleSlider('tonalWidth')}
          aria-label="Tonal width"
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Midpoint</span>
          <span>{adj.midpoint}</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={100}
          value={adj.midpoint}
          onChange={handleSlider('midpoint')}
          aria-label="Midpoint"
        />
      </div>
    </div>
  );
}

function colorToManaged(c: Color): ManagedColor {
  return rgbFromTuple(c);
}

function managedToColor(c: ManagedColor): Color {
  // Engine adjustment colors are 0-255 tuples: normalize at the color's own
  // bit depth first, so a uint16/float color cannot corrupt the parameter
  // scale (a raw 32768 channel would be misread as byte 32768).
  if (c.space === 'rgb') {
    const bd = c.bitDepth ?? 'uint8';
    return [
      denormalizeChannel(normalizeChannel(c.r, bd), 'uint8'),
      denormalizeChannel(normalizeChannel(c.g, bd), 'uint8'),
      denormalizeChannel(normalizeChannel(c.b, bd), 'uint8'),
      denormalizeChannel(normalizeChannel(c.a, bd), 'uint8'),
    ] as Color;
  }
  const [r, g, b, a] = managedColorToRgba(c as Parameters<typeof managedColorToRgba>[0]);
  return [r, g, b, a] as Color;
}

function DuotoneEditor({ adjustment, onChange, onEditStart, onEditEnd }: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').DuotoneAdjustment;
  const handleColor = (key: 'shadowColor' | 'highlightColor') => (c: ManagedColor) => {
    onChange({ [key]: managedToColor(c) } as unknown as Partial<Adjustment>);
  };

  return (
    <div className="adj-editor__group">
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Shadow Point</span>
          <span>{adj.shadowPoint.toFixed(2)}</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={1}
          step={0.01}
          value={adj.shadowPoint}
          onChange={(e) =>
            onChange({ shadowPoint: Number(e.target.value) } as unknown as Partial<Adjustment>)
          }
          aria-label="Shadow point"
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Highlight Point</span>
          <span>{adj.highlightPoint.toFixed(2)}</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={1}
          step={0.01}
          value={adj.highlightPoint}
          onChange={(e) =>
            onChange({ highlightPoint: Number(e.target.value) } as unknown as Partial<Adjustment>)
          }
          aria-label="Highlight point"
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Intensity</span>
          <span>{adj.intensity.toFixed(2)}</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={1}
          step={0.01}
          value={adj.intensity}
          onChange={(e) =>
            onChange({ intensity: Number(e.target.value) } as unknown as Partial<Adjustment>)
          }
          aria-label="Intensity"
        />
      </div>
      <div className="adj-editor__color-row">
        <span className="adj-editor__label">Shadow Color</span>
        <ColorPicker
          value={
            {
              space: 'rgb',
              r: adj.shadowColor[0],
              g: adj.shadowColor[1],
              b: adj.shadowColor[2],
              a: adj.shadowColor[3] ?? 255,
            } as ManagedColor
          }
          onChange={handleColor('shadowColor')}
          onInteractionStart={onEditStart}
          onInteractionEnd={onEditEnd}
        />
      </div>
      <div className="adj-editor__color-row">
        <span className="adj-editor__label">Highlight Color</span>
        <ColorPicker
          value={
            {
              space: 'rgb',
              r: adj.highlightColor[0],
              g: adj.highlightColor[1],
              b: adj.highlightColor[2],
              a: adj.highlightColor[3] ?? 255,
            } as ManagedColor
          }
          onChange={handleColor('highlightColor')}
          onInteractionStart={onEditStart}
          onInteractionEnd={onEditEnd}
        />
      </div>
      <label className="adj-editor__checkbox-row">
        <input
          type="checkbox"
          checked={adj.preserveLuminosity}
          onChange={(e) =>
            onChange({ preserveLuminosity: e.target.checked } as unknown as Partial<Adjustment>)
          }
        />
        <span>Preserve Luminosity</span>
      </label>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Interpolation</span>
        <Select
          label="Duotone interpolation"
          value={adj.interpolation ?? 'smoothstep'}
          options={[
            { value: 'smoothstep', label: 'Smooth' },
            { value: 'linear', label: 'Linear' },
          ]}
          onChange={(value) =>
            onChange({
              interpolation: value as 'smoothstep' | 'linear',
            } as unknown as Partial<Adjustment>)
          }
        />
      </div>
    </div>
  );
}

function BlackAndWhiteEditor({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
}: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').BlackAndWhiteAdjustment;
  const channels: { key: keyof import('@varve/scene').BlackAndWhiteAdjustment; label: string }[] = [
    { key: 'reds', label: 'Reds' },
    { key: 'yellows', label: 'Yellows' },
    { key: 'greens', label: 'Greens' },
    { key: 'cyans', label: 'Cyans' },
    { key: 'blues', label: 'Blues' },
    { key: 'magentas', label: 'Magentas' },
  ];

  return (
    <div className="adj-editor__group">
      {channels.map((ch) => (
        <div key={ch.key} className="adj-editor__slider-row">
          <div className="adj-editor__slider-label">
            <span>{ch.label}</span>
            <span>{adj[ch.key] as number}</span>
          </div>
          <input
            type="range"
            className="adj-editor__slider"
            min={-200}
            max={300}
            value={adj[ch.key] as number}
            onChange={(e) =>
              onChange({ [ch.key]: Number(e.target.value) } as unknown as Partial<Adjustment>)
            }
            aria-label={ch.label}
          />
        </div>
      ))}
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Brightness</span>
          <span>{adj.brightness}</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={-100}
          max={100}
          value={adj.brightness}
          onChange={(e) =>
            onChange({ brightness: Number(e.target.value) } as unknown as Partial<Adjustment>)
          }
          aria-label="Brightness"
        />
      </div>
      <label className="adj-editor__checkbox-row">
        <input
          type="checkbox"
          checked={adj.preserveLuminosity}
          onChange={(e) =>
            onChange({ preserveLuminosity: e.target.checked } as unknown as Partial<Adjustment>)
          }
        />
        <span>Preserve Luminosity</span>
      </label>
      <label className="adj-editor__checkbox-row">
        <input
          type="checkbox"
          checked={adj.tintColor !== undefined}
          onChange={(event) =>
            onChange({
              tintColor: event.target.checked ? ([190, 170, 140, 255] as Color) : undefined,
            } as unknown as Partial<Adjustment>)
          }
        />
        <span>Tint</span>
      </label>
      {adj.tintColor && (
        <ColorPicker
          value={colorToManaged(adj.tintColor)}
          onChange={(color) =>
            onChange({ tintColor: managedToColor(color) } as unknown as Partial<Adjustment>)
          }
          onInteractionStart={onEditStart}
          onInteractionEnd={onEditEnd}
        />
      )}
    </div>
  );
}

function PosterizeEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').PosterizeAdjustment;
  return (
    <div className="adj-editor__slider-row">
      <div className="adj-editor__slider-label">
        <span>Levels</span>
        <span>{adj.levels}</span>
      </div>
      <input
        type="range"
        className="adj-editor__slider"
        min={2}
        max={256}
        value={adj.levels}
        onChange={(e) =>
          onChange({ levels: Number(e.target.value) } as unknown as Partial<Adjustment>)
        }
        aria-label="Posterize levels"
      />
    </div>
  );
}

function ThresholdEditor({ adjustment, onChange }: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').ThresholdAdjustment;
  return (
    <div className="adj-editor__slider-row">
      <div className="adj-editor__slider-label">
        <span>Level</span>
        <span>{adj.level}</span>
      </div>
      <input
        type="range"
        className="adj-editor__slider"
        min={0}
        max={255}
        value={adj.level}
        onChange={(e) =>
          onChange({ level: Number(e.target.value) } as unknown as Partial<Adjustment>)
        }
        aria-label="Threshold level"
      />
    </div>
  );
}

function TritoneEditor({ adjustment, onChange, onEditStart, onEditEnd }: AdjustmentEditorProps) {
  const adj = adjustment as import('@varve/scene').TritoneAdjustment;
  const handleColor =
    (key: 'shadowColor' | 'midtoneColor' | 'highlightColor') => (c: ManagedColor) => {
      onChange({ [key]: managedToColor(c) } as unknown as Partial<Adjustment>);
    };

  const currentPresetId = useMemo(() => {
    const match = TRITONE_PRESETS.find(
      (p) =>
        p.shadowColor[0] === adj.shadowColor[0] &&
        p.shadowColor[1] === adj.shadowColor[1] &&
        p.shadowColor[2] === adj.shadowColor[2] &&
        p.midtoneColor[0] === adj.midtoneColor[0] &&
        p.midtoneColor[1] === adj.midtoneColor[1] &&
        p.midtoneColor[2] === adj.midtoneColor[2] &&
        p.highlightColor[0] === adj.highlightColor[0] &&
        p.highlightColor[1] === adj.highlightColor[1] &&
        p.highlightColor[2] === adj.highlightColor[2] &&
        Math.abs(p.shadowPoint - adj.shadowPoint) < 0.01 &&
        Math.abs(p.highlightPoint - adj.highlightPoint) < 0.01,
    );
    return match?.id ?? '';
  }, [adj]);

  const handlePresetSelect = (value: string) => {
    const preset = TRITONE_PRESETS.find((p) => p.id === value);
    if (preset) {
      onChange({
        shadowColor: [...preset.shadowColor] as Color,
        midtoneColor: [...preset.midtoneColor] as Color,
        highlightColor: [...preset.highlightColor] as Color,
        shadowPoint: preset.shadowPoint,
        highlightPoint: preset.highlightPoint,
      } as unknown as Partial<Adjustment>);
    }
  };

  return (
    <div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Preset</span>
        <Select
          label="Tritone preset"
          value={currentPresetId}
          placeholder="Custom"
          options={TRITONE_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
          onChange={handlePresetSelect}
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Shadow Color</span>
      </div>
      <ColorPicker
        value={colorToManaged(adj.shadowColor)}
        onChange={handleColor('shadowColor')}
        onInteractionStart={onEditStart}
        onInteractionEnd={onEditEnd}
      />
      <div className="adj-editor__row">
        <span className="adj-editor__label">Midtone Color</span>
      </div>
      <ColorPicker
        value={colorToManaged(adj.midtoneColor)}
        onChange={handleColor('midtoneColor')}
        onInteractionStart={onEditStart}
        onInteractionEnd={onEditEnd}
      />
      <div className="adj-editor__row">
        <span className="adj-editor__label">Highlight Color</span>
      </div>
      <ColorPicker
        value={colorToManaged(adj.highlightColor)}
        onChange={handleColor('highlightColor')}
        onInteractionStart={onEditStart}
        onInteractionEnd={onEditEnd}
      />
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Shadow Point</span>
          <span>{Math.round(adj.shadowPoint * 100)}%</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={100}
          step={1}
          value={Math.round(adj.shadowPoint * 100)}
          onChange={(e) =>
            onChange({
              shadowPoint: Number(e.target.value) / 100,
            } as unknown as Partial<Adjustment>)
          }
          aria-label="Shadow point"
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Highlight Point</span>
          <span>{Math.round(adj.highlightPoint * 100)}%</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={100}
          step={1}
          value={Math.round(adj.highlightPoint * 100)}
          onChange={(e) =>
            onChange({
              highlightPoint: Number(e.target.value) / 100,
            } as unknown as Partial<Adjustment>)
          }
          aria-label="Highlight point"
        />
      </div>
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Intensity</span>
          <span>{Math.round(adj.intensity * 100)}%</span>
        </div>
        <input
          type="range"
          className="adj-editor__slider"
          min={0}
          max={100}
          step={1}
          value={Math.round(adj.intensity * 100)}
          onChange={(e) =>
            onChange({ intensity: Number(e.target.value) / 100 } as unknown as Partial<Adjustment>)
          }
          aria-label="Tritone intensity"
        />
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
      <div className="adj-editor__row">
        <span className="adj-editor__label">Interpolation</span>
        <Select
          label="Interpolation method"
          value={adj.interpolation ?? 'smoothstep'}
          options={[
            { value: 'smoothstep', label: 'Smooth' },
            { value: 'linear', label: 'Linear' },
          ]}
          onChange={(v) =>
            onChange({
              interpolation: v as 'smoothstep' | 'linear',
            } as unknown as Partial<Adjustment>)
          }
        />
      </div>
    </div>
  );
}
