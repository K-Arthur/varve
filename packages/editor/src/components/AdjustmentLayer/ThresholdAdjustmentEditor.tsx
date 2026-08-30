import type { Histogram } from '@varve/engine';
import type { Adjustment, ThresholdAdjustment } from '@varve/scene';
import { Select } from '@varve/ui';
import { useEffect, useRef } from 'react';
import { RangeValueControl } from '../Inspector/controls/RangeValueControl';

const HISTOGRAM_WIDTH = 300;
const HISTOGRAM_HEIGHT = 92;

function drawThresholdHistogram(
  ctx: CanvasRenderingContext2D,
  histogram: Histogram | undefined,
  level: number,
  histogramColor: string,
  markerColor: string,
) {
  ctx.clearRect(0, 0, HISTOGRAM_WIDTH, HISTOGRAM_HEIGHT);
  const values = histogram?.luminance;
  if (values && histogram?.opaquePixels !== 0) {
    let peak = 0;
    for (const value of values) peak = Math.max(peak, value);
    if (peak > 0) {
      ctx.fillStyle = histogramColor;
      const barWidth = HISTOGRAM_WIDTH / values.length;
      for (let i = 0; i < values.length; i++) {
        const height = (values[i]! / peak) * (HISTOGRAM_HEIGHT - 8);
        ctx.fillRect(i * barWidth, HISTOGRAM_HEIGHT - height, Math.max(1, barWidth), height);
      }
    }
  }

  ctx.strokeStyle = markerColor;
  ctx.lineWidth = 2;
  const markerX = (Math.max(0, Math.min(255, level)) / 255) * HISTOGRAM_WIDTH;
  ctx.beginPath();
  ctx.moveTo(markerX, 0);
  ctx.lineTo(markerX, HISTOGRAM_HEIGHT);
  ctx.stroke();
}

function ThresholdHistogram({ histogram, level }: { histogram?: Histogram | null; level: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const colors = getComputedStyle(document.documentElement);
    drawThresholdHistogram(
      ctx,
      histogram ?? undefined,
      level,
      colors.getPropertyValue('--color-text-muted').trim() || '#888',
      colors.getPropertyValue('--color-interactive-default').trim() || '#39d0c6',
    );
  }, [histogram, level]);

  return (
    <div className="threshold-editor__histogram">
      <canvas
        ref={canvasRef}
        width={HISTOGRAM_WIDTH}
        height={HISTOGRAM_HEIGHT}
        role="img"
        aria-label={`Luminance histogram with threshold marker at ${Math.round(level)}`}
      />
      {!histogram && <span className="threshold-editor__empty">Histogram unavailable</span>}
    </div>
  );
}

const LUMINANCE_OPTIONS = [
  { value: 'relative-luminance', label: 'Relative luminance' },
  { value: 'average-rgb', label: 'Average RGB' },
  { value: 'max-channel', label: 'Maximum channel' },
] as const;

export function ThresholdAdjustmentEditor({
  adjustment,
  onChange,
  onEditStart,
  onEditEnd,
  sourceHistogram,
}: {
  adjustment: ThresholdAdjustment;
  onChange: (patch: Partial<Adjustment>) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  sourceHistogram?: Histogram | null;
}) {
  const luminanceMode = adjustment.luminanceMode ?? 'relative-luminance';
  return (
    <div className="threshold-editor">
      <ThresholdHistogram histogram={sourceHistogram} level={adjustment.level} />
      <div className="adj-editor__slider-row">
        <div className="adj-editor__slider-label">
          <span>Threshold level</span>
          <span>{Math.round(adjustment.level)}</span>
        </div>
        <RangeValueControl
          label="Threshold level"
          rangeClassName="adj-editor__slider"
          min={0}
          max={255}
          value={adjustment.level}
          onChange={(value) => onChange({ level: value })}
          onRangePointerDown={onEditStart}
          onRangePointerUp={onEditEnd}
          onRangePointerCancel={onEditEnd}
          onRangeKeyDown={onEditStart}
          onRangeKeyUp={onEditEnd}
        />
      </div>
      <div className="adj-editor__row">
        <span className="adj-editor__label">Tonal source</span>
        <Select
          label="Threshold tonal source"
          value={luminanceMode}
          options={[...LUMINANCE_OPTIONS]}
          onChange={(value) =>
            onChange({ luminanceMode: value as ThresholdAdjustment['luminanceMode'] })
          }
        />
      </div>
      <p className="adj-editor__hint">
        Pixels at or above the marker become white; pixels below it become black. Transparent pixels
        keep their hidden color and alpha.
      </p>
    </div>
  );
}
