import type {
  Adjustment,
  EdgeInkAdjustment,
  MosaicAdjustment,
  MotionBlurAdjustment,
  SurfaceSmoothAdjustment,
} from '@varve/engine';
import { Switch } from '@varve/ui';
import { RangeValueControl } from '../Inspector/controls/RangeValueControl';

export interface SpatialEffectEditorProps {
  adjustment: Adjustment;
  onChange: (patch: Partial<Adjustment>) => void;
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="adj-editor__slider-row">
      <div className="adj-editor__slider-label">
        <span>{label}</span>
        <span>
          {value}
          {unit ?? ''}
        </span>
      </div>
      <RangeValueControl
        label={label}
        rangeClassName="adj-editor__slider"
        rangeAriaLabel={label}
        min={min}
        max={max}
        step={step}
        unit={unit}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

export function SpatialEffectEditor({ adjustment, onChange }: SpatialEffectEditorProps) {
  switch (adjustment.kind) {
    case 'motionBlur': {
      const effect = adjustment as MotionBlurAdjustment;
      return (
        <div className="adj-editor__group">
          <Slider
            label="Distance"
            value={effect.distance}
            min={0}
            max={128}
            step={1}
            unit=" px"
            onChange={(value) => onChange({ distance: value })}
          />
          <Slider
            label="Angle"
            value={effect.angle}
            min={-180}
            max={180}
            step={1}
            unit="°"
            onChange={(value) => onChange({ angle: value })}
          />
          <p className="adj-editor__hint">
            The line follows the object, so camera rotation does not change the authored direction.
          </p>
        </div>
      );
    }
    case 'mosaic': {
      const effect = adjustment as MosaicAdjustment;
      return (
        <div className="adj-editor__group">
          <Slider
            label="Block size"
            value={effect.blockSize}
            min={2}
            max={128}
            step={1}
            unit=" px"
            onChange={(value) => onChange({ blockSize: value })}
          />
          <Slider
            label="Grid origin X"
            value={effect.originX}
            min={-128}
            max={128}
            step={1}
            unit=" px"
            onChange={(value) => onChange({ originX: value })}
          />
          <Slider
            label="Grid origin Y"
            value={effect.originY}
            min={-128}
            max={128}
            step={1}
            unit=" px"
            onChange={(value) => onChange({ originY: value })}
          />
          <p className="adj-editor__hint">
            Mosaic averages pixels for styling. It is not a secure redaction tool.
          </p>
        </div>
      );
    }
    case 'surfaceSmooth': {
      const effect = adjustment as SurfaceSmoothAdjustment;
      return (
        <div className="adj-editor__group">
          <Slider
            label="Radius"
            value={effect.radius}
            min={0}
            max={8}
            step={0.1}
            unit=" px"
            onChange={(value) => onChange({ radius: value })}
          />
          <Slider
            label="Edge sensitivity"
            value={effect.sensitivity}
            min={1}
            max={128}
            step={1}
            onChange={(value) => onChange({ sensitivity: value })}
          />
          <p className="adj-editor__hint">
            A guided two-pass smoother reduces texture while protecting luminance edges.
          </p>
        </div>
      );
    }
    case 'edgeInk': {
      const effect = adjustment as EdgeInkAdjustment;
      return (
        <div className="adj-editor__group">
          <Slider
            label="Radius"
            value={effect.radius}
            min={1}
            max={8}
            step={1}
            unit=" px"
            onChange={(value) => onChange({ radius: value })}
          />
          <Slider
            label="Threshold"
            value={effect.threshold}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => onChange({ threshold: value })}
          />
          <Slider
            label="Softness"
            value={effect.softness}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => onChange({ softness: value })}
          />
          <div className="adj-editor__row">
            <Switch
              label="Transparent background"
              checked={effect.transparentBackground}
              onChange={(event) => onChange({ transparentBackground: event.target.checked })}
            />
          </div>
          <p className="adj-editor__hint">
            Sobel contours are composited over the selected paper colour.
          </p>
        </div>
      );
    }
    default:
      return null;
  }
}
