import type { GradientMapStop, Histogram } from '@varve/engine';
import { computeHistogramStats, sampleGradientMapColor } from '@varve/engine';
import type { GradientInterpolationSpace } from '@varve/scene';
import { useEffect, useMemo, useRef } from 'react';

const WIDTH = 300;
const HEIGHT = 132;
const HISTOGRAM_HEIGHT = 104;
const RAMP_HEIGHT = 14;

function drawDistribution(
  canvas: HTMLCanvasElement,
  histogram: Histogram,
  stops: GradientMapStop[],
  interpolation: GradientInterpolationSpace,
  reverse: boolean,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const styles = getComputedStyle(document.documentElement);
  const muted = styles.getPropertyValue('--color-text-muted').trim() || '#8b949e';
  const surface = styles.getPropertyValue('--color-surface-sunken').trim() || '#111820';
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = surface;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  let max = 0;
  for (const count of histogram.luminance) max = Math.max(max, count);
  if (max > 0) {
    ctx.fillStyle = muted;
    const barWidth = WIDTH / histogram.luminance.length;
    for (let index = 0; index < histogram.luminance.length; index += 1) {
      const height = (histogram.luminance[index]! / max) * HISTOGRAM_HEIGHT;
      ctx.fillRect(index * barWidth, HISTOGRAM_HEIGHT - height, Math.max(1, barWidth), height);
    }
  }

  for (let x = 0; x < WIDTH; x += 1) {
    const position = x / Math.max(1, WIDTH - 1);
    const color = sampleGradientMapColor(stops, position, { interpolation, reverse });
    ctx.fillStyle = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
    ctx.fillRect(x, HISTOGRAM_HEIGHT, 1, RAMP_HEIGHT);
  }
  ctx.strokeStyle = muted;
  ctx.globalAlpha = 0.55;
  ctx.strokeRect(0.5, HISTOGRAM_HEIGHT + 0.5, WIDTH - 1, RAMP_HEIGHT - 1);
  ctx.globalAlpha = 1;
}

export function GradientMapTonalDistribution({
  histogram,
  stops,
  interpolation = 'oklab',
  reverse = false,
}: {
  histogram?: Histogram | null;
  stops: GradientMapStop[];
  interpolation?: GradientInterpolationSpace;
  reverse?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statsSummary = useMemo(() => {
    if (!histogram || histogram.totalPixels === 0) return 'Input tonal distribution unavailable.';
    const stats = computeHistogramStats(histogram.luminance, histogram.opaquePixels);
    return (
      `Input tonal distribution: mean ${stats.mean.toFixed(0)}, median ${stats.median}, ` +
      `5th percentile ${stats.percentile5}, 95th percentile ${stats.percentile95}.`
    );
  }, [histogram]);

  useEffect(() => {
    if (histogram) {
      drawDistribution(canvasRef.current!, histogram, stops, interpolation, reverse);
    }
  }, [histogram, interpolation, reverse, stops]);

  return (
    <section className="gradient-map-tonal" aria-label="Gradient map tonal distribution">
      <div className="gradient-map-tonal__header">
        <span>Input tonal distribution</span>
        <span className="gradient-map-tonal__hint">Shadows to highlights</span>
      </div>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        aria-label={statsSummary}
        role="img"
        style={{ width: '100%', height: HEIGHT, background: 'var(--color-surface-sunken)' }}
      />
      {!histogram && <p className="gradient-map-tonal__empty">Histogram unavailable</p>}
      <div className="gradient-map-tonal__legend" aria-hidden="true">
        <span>Shadows</span>
        <span>Highlights</span>
      </div>
    </section>
  );
}
