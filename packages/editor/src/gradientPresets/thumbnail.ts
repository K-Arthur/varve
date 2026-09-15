/**
 * Gradient preset thumbnail/display helpers (pure, no React).
 *
 * Renders a preset as a CSS `linear-gradient` (sampled in the preset's
 * interpolation space so the thumbnail matches the renderer). Opacity stops
 * are composited into the sampled alpha so previews are faithful.
 */

import type { GradientMapOpacityStop, GradientMapStop } from '@varve/engine';
import { sampleGradientMapAlpha, sampleGradientMapColor } from '@varve/engine';
import type { GradientPreset } from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Number(a).toFixed(3)})`;
}

function engineStops(preset: GradientPreset): GradientMapStop[] {
  return preset.colorStops.map((stop) => ({
    id: stop.id,
    position: stop.position,
    midpoint: stop.midpoint,
    color: managedColorToRgba(stop.color),
  }));
}

function engineOpacityStops(preset: GradientPreset): GradientMapOpacityStop[] {
  return preset.opacityStops.map((stop) => ({
    id: stop.id,
    position: stop.position,
    midpoint: stop.midpoint,
    opacity: stop.opacity,
  }));
}

function sampleStops(preset: GradientPreset, samples = 33): string[] {
  const stops = engineStops(preset);
  const opacityStops = engineOpacityStops(preset);
  return Array.from({ length: samples }, (_, index) => {
    const position = index / (samples - 1);
    const color = sampleGradientMapColor(stops, position, {
      interpolation: preset.interpolation,
    });
    const alpha = sampleGradientMapAlpha(stops, opacityStops, position);
    return `${rgba(color[0], color[1], color[2], alpha)} ${(position * 100).toFixed(2)}%`;
  });
}

/** Build a CSS linear-gradient preview string for a preset. */
export function gradientPresetToCss(preset: GradientPreset): string {
  if (preset.colorStops.length === 0) return 'linear-gradient(90deg, #000 0%, #000 100%)';
  return `linear-gradient(90deg, ${sampleStops(preset).join(', ')})`;
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
    const stops = engineStops(preset);
    const opacityStops = engineOpacityStops(preset);
    for (let index = 0; index < 33; index += 1) {
      const position = index / 32;
      const color = sampleGradientMapColor(stops, position, {
        interpolation: preset.interpolation,
      });
      const alpha = sampleGradientMapAlpha(stops, opacityStops, position);
      gradient.addColorStop(position, rgba(color[0], color[1], color[2], alpha));
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  return canvas;
}
