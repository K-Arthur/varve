/**
 * Deterministic brush thumbnails.
 *
 * A preview must depend only on the preset, never on ambient editor state.
 * Using the current foreground colour would mean every thumbnail changed when
 * the user picked a new colour — invalidating the whole cache and making two
 * screenshots of the same brush disagree.
 *
 * The stroke is a fixed S-curve with a pressure ramp, so a preview shows the
 * things that actually distinguish brushes: taper, spacing, hardness, grain and
 * jitter. The seed is derived from the preset id, so the same brush draws the
 * same thumbnail every time.
 */
import type { BrushPreset } from '@varve/scene';
import { appendStrokePoints, beginStroke, strokePoint } from '@varve/scene';

export interface BrushPreviewOptions {
  width: number;
  height: number;
  /** Device pixel ratio to render at. Clamped, since thumbnails are small. */
  pixelRatio?: number;
  /** Ink colour. Fixed by default so previews are comparable. */
  ink?: string;
}

/** Bumped whenever the preview drawing changes, to invalidate cached images. */
export const BRUSH_PREVIEW_RENDERER_VERSION = 2;

const DEFAULT_INK = '#1b1b1f';

/**
 * Fingerprint identifying a rendered preview.
 *
 * Includes only what the image depends on, so editing a preset invalidates its
 * thumbnail while unrelated app state never does.
 */
export function brushPreviewFingerprint(
  preset: BrushPreset,
  options: BrushPreviewOptions,
): string {
  const relevant = [
    preset.id,
    preset.shape,
    preset.radius,
    preset.opacity,
    preset.flow,
    preset.hardness,
    preset.spacing,
    preset.angle,
    preset.roundness,
    preset.positionJitter,
    preset.sizeJitter,
    preset.opacityJitter,
    preset.rotationJitter,
    preset.smoothing,
    preset.grainId ?? '',
    preset.grainScale,
    preset.grainRotation,
    preset.grainContrast,
    preset.grainInvert,
    preset.grainAnchor,
    preset.eraser,
    preset.blendMode,
    preset.dynamics.map((d) => `${d.input}:${d.target}:${d.min}:${d.max}:${d.curve.join(',')}`).join('|'),
    options.width,
    options.height,
    options.pixelRatio ?? 1,
    options.ink ?? DEFAULT_INK,
    BRUSH_PREVIEW_RENDERER_VERSION,
  ];
  return relevant.join('~');
}

/** Stable 32-bit hash, so a preset's preview jitter is reproducible. */
function seedFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Sample points for the preview stroke: an S-curve across the tile with
 * pressure ramping up and back down, which exercises taper at both ends.
 */
export function previewStrokePoints(width: number, height: number) {
  const points = [];
  const steps = 48;
  const marginX = width * 0.12;
  const span = width - marginX * 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = marginX + span * t;
    const y = height / 2 + Math.sin(t * Math.PI * 1.6) * height * 0.22;
    // Ramp 0.05 → 1 → 0.05 so both the lead-in and lead-out taper show.
    const pressure = Math.max(0.05, Math.sin(t * Math.PI));
    points.push(strokePoint(x, y, { pressure, time: i * 12, tilt: 0 }));
  }
  return points;
}

/**
 * Render a preview into a canvas 2D context.
 *
 * Drawn with plain canvas arcs rather than the tile compositor: a thumbnail
 * does not need document-accurate pixels, and going through the raster path
 * would allocate tiles per preview for hundreds of brushes.
 */
export function renderBrushPreview(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  preset: BrushPreset,
  options: BrushPreviewOptions,
): void {
  const { width, height } = options;
  const ink = options.ink ?? DEFAULT_INK;
  ctx.clearRect(0, 0, width, height);

  // Scale the brush so a 300px brush and a 3px brush both read as themselves
  // without either filling or vanishing from the tile.
  const displayRadius = Math.max(0.6, Math.min(height * 0.3, preset.radius * 0.45));
  const scaled: BrushPreset = { ...preset, radius: displayRadius, smoothing: preset.smoothing };

  const state = beginStroke(preset.id, 0, scaled, seedFor(preset.id));
  const { dabs } = appendStrokePoints(state, previewStrokePoints(width, height));

  ctx.save();
  if (preset.eraser) {
    // An eraser has nothing to erase on an empty tile, so show its footprint
    // as an outline instead of drawing nothing at all.
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    for (const dab of dabs) {
      ctx.beginPath();
      ctx.ellipse(dab.x, dab.y, dab.radius, dab.radius * dab.roundness, dab.angle, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  ctx.fillStyle = ink;
  // Not every 2D context implementation provides gradients (headless canvases
  // and test environments among them); a flat dab is a worse preview than a
  // soft one, but an exception would take the whole panel down.
  const canGradient = typeof ctx.createRadialGradient === 'function';
  for (const dab of dabs) {
    const alpha = Math.max(0, Math.min(1, dab.opacity * dab.flow));
    if (alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    if (dab.hardness >= 0.99 || !canGradient) {
      ctx.beginPath();
      ctx.ellipse(dab.x, dab.y, dab.radius, dab.radius * dab.roundness, dab.angle, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const gradient = ctx.createRadialGradient(
        dab.x,
        dab.y,
        dab.radius * dab.hardness,
        dab.x,
        dab.y,
        Math.max(dab.radius, dab.radius * dab.hardness + 0.01),
      );
      gradient.addColorStop(0, ink);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(dab.x, dab.y, dab.radius, dab.radius * dab.roundness, dab.angle, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ink;
    }
  }
  ctx.restore();
}

interface CacheEntry {
  fingerprint: string;
  dataUrl: string;
  lastUsed: number;
}

/**
 * Bounded thumbnail cache.
 *
 * Keyed by fingerprint, so a preset edit produces a miss and unrelated state
 * changes do not. Bounded by count because hundreds of full-resolution canvases
 * for twenty visible tiles is exactly how a brush browser eats memory.
 */
export class BrushPreviewCache {
  private entries = new Map<string, CacheEntry>();
  private clock = 0;

  constructor(private maxEntries = 240) {}

  get size(): number {
    return this.entries.size;
  }

  get(presetId: string, fingerprint: string): string | null {
    const entry = this.entries.get(presetId);
    if (!entry || entry.fingerprint !== fingerprint) return null;
    entry.lastUsed = ++this.clock;
    return entry.dataUrl;
  }

  set(presetId: string, fingerprint: string, dataUrl: string): void {
    this.entries.set(presetId, { fingerprint, dataUrl, lastUsed: ++this.clock });
    this.trim();
  }

  invalidate(presetId: string): void {
    this.entries.delete(presetId);
  }

  clear(): void {
    this.entries.clear();
  }

  private trim(): void {
    if (this.entries.size <= this.maxEntries) return;
    const byAge = [...this.entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [id] of byAge) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(id);
    }
  }
}

/** Render a preview to a data URL, using and populating `cache`. */
export function brushPreviewDataUrl(
  preset: BrushPreset,
  options: BrushPreviewOptions,
  cache: BrushPreviewCache,
): string | null {
  const fingerprint = brushPreviewFingerprint(preset, options);
  const cached = cache.get(preset.id, fingerprint);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;

  const ratio = Math.max(1, Math.min(2, options.pixelRatio ?? 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(options.width * ratio);
  canvas.height = Math.round(options.height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof canvas.toDataURL !== 'function') return null;
  let url: string;
  try {
    ctx.scale(ratio, ratio);
    renderBrushPreview(ctx, preset, options);
    url = canvas.toDataURL('image/png');
  } catch {
    // A thumbnail is never worth failing a render over.
    return null;
  }
  cache.set(preset.id, fingerprint, url);
  return url;
}
