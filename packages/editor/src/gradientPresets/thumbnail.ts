/**
 * Gradient preset thumbnail/display helpers (pure, no React).
 *
 * Renders a preset as a CSS `linear-gradient` (sampled in the preset's
 * interpolation space so the thumbnail matches the renderer). Opacity stops
 * are composited into the sampled alpha so previews are faithful.
 */
import type { GradientPreset } from '@strata/scene';
import { expandGradientStops } from '@strata/shared';

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Number(a).toFixed(3)})`;
}

/** Opacity at a position (linear, midpoint-biased) from the opacity stops. */
function opacityAt(preset: GradientPreset, position: number): number {
  const stops = preset.opacityStops;
  if (stops.length === 0) return 1;
  if (position <= stops[0]!.position) return stops[0]!.opacity;
  const last = stops[stops.length - 1]!;
  if (position >= last.position) return last.opacity;
  for (let i = 0; i < stops.length - 1; i++) {
    const lo = stops[i]!;
    const hi = stops[i + 1]!;
    if (position >= lo.position && position <= hi.position) {
      const t =
        hi.position - lo.position === 0
          ? 0
          : (position - lo.position) / (hi.position - lo.position);
      return lo.opacity + (hi.opacity - lo.opacity) * t;
    }
  }
  return last.opacity;
}

/** Build a CSS linear-gradient preview string for a preset. */
export function gradientPresetToCss(preset: GradientPreset): string {
  if (preset.colorStops.length === 0) return 'linear-gradient(90deg, #000 0%, #000 100%)';
  if (preset.colorStops.length === 1) {
    const c = preset.colorStops[0]!.color as {
      space: 'rgb';
      r: number;
      g: number;
      b: number;
      a: number;
    };
    const pos = preset.colorStops[0]!.position;
    const a = (c.a / 255) * opacityAt(preset, pos);
    return `linear-gradient(90deg, ${rgba(c.r, c.g, c.b, a)} 0%, ${rgba(c.r, c.g, c.b, a)} 100%)`;
  }
  const inputs = preset.colorStops.map((s) => ({
    position: s.position,
    midpoint: s.midpoint,
    color: {
      space: 'rgb' as const,
      r: (s.color as { space: 'rgb'; r: number }).r,
      g: (s.color as { space: 'rgb'; g: number }).g,
      b: (s.color as { space: 'rgb'; b: number }).b,
      a: (s.color as { space: 'rgb'; a: number }).a,
    },
  }));
  const samples = expandGradientStops(inputs, preset.interpolation, 12);
  const parts = samples.map((s) => {
    const opacity = opacityAt(preset, s.position) * (s.color.a / 255);
    return `${rgba(s.color.r, s.color.g, s.color.b, opacity)} ${(s.position * 100).toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

/** Render a preset into a small canvas (used for import review thumbnails). */
export function renderPresetThumbnail(
  preset: GradientPreset,
  width = 96,
  height = 24,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    const inputs = preset.colorStops.map((s) => ({
      position: s.position,
      midpoint: s.midpoint,
      color: {
        space: 'rgb' as const,
        r: (s.color as { space: 'rgb'; r: number }).r,
        g: (s.color as { space: 'rgb'; g: number }).g,
        b: (s.color as { space: 'rgb'; b: number }).b,
        a: (s.color as { space: 'rgb'; a: number }).a,
      },
    }));
    const samples = expandGradientStops(inputs, preset.interpolation, 12);
    for (const s of samples) {
      const opacity = opacityAt(preset, s.position) * (s.color.a / 255);
      gradient.addColorStop(s.position, rgba(s.color.r, s.color.g, s.color.b, opacity));
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  return canvas;
}
