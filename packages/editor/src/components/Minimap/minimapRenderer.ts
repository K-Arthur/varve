/**
 * Minimap Canvas2D renderer — draws the minimap scene to a canvas context.
 *
 * Separated from the React component for testability and to support
 * offscreen rendering (e.g., for thumbnails or WebWorker preparation).
 *
 * Rendering strategy:
 * - Frames: filled rectangles with a subtle border
 * - Shapes: filled rectangles in a muted tone
 * - Text: thin filled rectangles
 * - Groups: dashed outlines (transparent fill)
 * - Hidden nodes: very faint outlines
 * - Selected nodes: accent-colored stroke
 * - Outliers: marked with an X pattern
 * - Viewport indicator: filled + stroked rectangle
 * - Frame labels: rendered above frame outlines when space permits
 */

import type { MinimapEntry, MinimapScene, MinimapTransform } from './minimapLayout';
import { worldRectToMinimap } from './minimapLayout';

/* -------------------------------------------------------------------------- */
/*  Color tokens (resolved from CSS vars at render time)                      */
/* -------------------------------------------------------------------------- */

export interface MinimapColors {
  /** Canvas background. */
  background: string;
  /** Frame fill (slightly lighter than background). */
  frameFill: string;
  /** Frame stroke. */
  frameStroke: string;
  /** Shape fill. */
  shapeFill: string;
  /** Shape stroke. */
  shapeStroke: string;
  /** Text fill. */
  textFill: string;
  /** Group outline (dashed). */
  groupStroke: string;
  /** Selection stroke (accent). */
  selectionStroke: string;
  /** Viewport fill. */
  viewportFill: string;
  /** Viewport stroke. */
  viewportStroke: string;
  /** Hidden node fill. */
  hiddenFill: string;
  /** Locked node stroke pattern. */
  lockedStroke: string;
  /** Outlier marker. */
  outlierStroke: string;
  /** Frame label text. */
  labelFill: string;
}

/** Resolve minimap colors from CSS custom properties, falling back to defaults. */
export function resolveMinimapColors(
  getVar: (name: string, fallback: string) => string,
): MinimapColors {
  return {
    background: getVar('--color-surface-raised', '#1e1e1e'),
    frameFill: getVar('--color-surface-default', '#2a2a2a'),
    frameStroke: getVar('--color-border-subtle', '#555'),
    shapeFill: getVar('--color-border-subtle', '#444'),
    shapeStroke: getVar('--color-border-subtle', '#555'),
    textFill: getVar('--color-border-subtle', '#666'),
    groupStroke: getVar('--color-border-subtle', '#39d0c6'),
    selectionStroke: getVar('--color-interactive-default', '#39d0c6'),
    viewportFill: getVar('--color-interactive-default', '#39d0c6'),
    viewportStroke: getVar('--color-interactive-default', '#39d0c6'),
    hiddenFill: 'rgba(128, 128, 128, 0.15)',
    lockedStroke: '#666',
    outlierStroke: '#ff6b6b',
    labelFill: getVar('--color-text-muted', '#999'),
  };
}

/* -------------------------------------------------------------------------- */
/*  Drawing primitives                                                        */
/* -------------------------------------------------------------------------- */

function drawFrameEntry(
  ctx: CanvasRenderingContext2D,
  entry: MinimapEntry,
  tf: MinimapTransform,
  colors: MinimapColors,
): void {
  const mm = worldRectToMinimap(entry.bounds, tf);

  // Fill
  ctx.fillStyle = entry.visible ? colors.frameFill : colors.hiddenFill;
  ctx.fillRect(mm.x, mm.y, mm.w, mm.h);

  // Stroke
  ctx.strokeStyle = entry.visible ? colors.frameStroke : colors.hiddenFill;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeRect(mm.x, mm.y, mm.w, mm.h);
}

function drawShapeEntry(
  ctx: CanvasRenderingContext2D,
  entry: MinimapEntry,
  tf: MinimapTransform,
  colors: MinimapColors,
): void {
  const mm = worldRectToMinimap(entry.bounds, tf);

  ctx.fillStyle = entry.visible ? colors.shapeFill : colors.hiddenFill;
  ctx.fillRect(mm.x, mm.y, mm.w, mm.h);
}

function drawTextEntry(
  ctx: CanvasRenderingContext2D,
  entry: MinimapEntry,
  tf: MinimapTransform,
  colors: MinimapColors,
): void {
  const mm = worldRectToMinimap(entry.bounds, tf);

  ctx.fillStyle = entry.visible ? colors.textFill : colors.hiddenFill;
  ctx.fillRect(mm.x, mm.y, mm.w, mm.h);
}

function drawGroupEntry(
  ctx: CanvasRenderingContext2D,
  entry: MinimapEntry,
  tf: MinimapTransform,
  colors: MinimapColors,
): void {
  const mm = worldRectToMinimap(entry.bounds, tf);

  ctx.strokeStyle = entry.visible ? colors.groupStroke : colors.hiddenFill;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 2]);
  ctx.strokeRect(mm.x, mm.y, mm.w, mm.h);
  ctx.setLineDash([]);
}

function drawAdjustmentEntry(
  ctx: CanvasRenderingContext2D,
  entry: MinimapEntry,
  tf: MinimapTransform,
): void {
  const mm = worldRectToMinimap(entry.bounds, tf);

  // Adjustment nodes: thin horizontal bar
  ctx.fillStyle = 'rgba(128, 128, 255, 0.3)';
  ctx.fillRect(mm.x, mm.y, mm.w, Math.max(mm.h, 2));
}

function drawSelectionHighlight(
  ctx: CanvasRenderingContext2D,
  entry: MinimapEntry,
  tf: MinimapTransform,
  colors: MinimapColors,
): void {
  const mm = worldRectToMinimap(entry.bounds, tf);

  ctx.strokeStyle = colors.selectionStroke;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeRect(mm.x - 1, mm.y - 1, mm.w + 2, mm.h + 2);
}

function drawFrameLabel(
  ctx: CanvasRenderingContext2D,
  entry: MinimapEntry,
  tf: MinimapTransform,
  colors: MinimapColors,
): void {
  if (!entry.name || entry.name.startsWith('Frame ') || entry.name.startsWith('Rect ')) return;

  const mm = worldRectToMinimap(entry.bounds, tf);

  // Only draw label if the frame is large enough
  if (mm.w < 20 || mm.h < 8) return;

  const fontSize = Math.min(8, Math.max(5, mm.w / entry.name.length));
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  ctx.fillStyle = colors.labelFill;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Clip text to frame bounds
  ctx.save();
  ctx.beginPath();
  ctx.rect(mm.x + 1, mm.y + 1, mm.w - 2, mm.h - 2);
  ctx.clip();
  ctx.fillText(entry.name, mm.x + 2, mm.y + 2);
  ctx.restore();
}

function drawOutlierMarker(
  ctx: CanvasRenderingContext2D,
  entry: MinimapEntry,
  tf: MinimapTransform,
  colors: MinimapColors,
): void {
  const mm = worldRectToMinimap(entry.bounds, tf);

  ctx.strokeStyle = colors.outlierStroke;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(mm.x, mm.y, mm.w, mm.h);
  ctx.setLineDash([]);

  // Draw X in center
  const cx = mm.x + mm.w / 2;
  const cy = mm.y + mm.h / 2;
  const s = Math.min(mm.w, mm.h) * 0.3;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy - s);
  ctx.lineTo(cx + s, cy + s);
  ctx.moveTo(cx + s, cy - s);
  ctx.lineTo(cx - s, cy + s);
  ctx.stroke();
}

function drawViewportIndicator(
  ctx: CanvasRenderingContext2D,
  viewportRect: { x: number; y: number; w: number; h: number },
  colors: MinimapColors,
): void {
  const { x, y, w, h } = viewportRect;

  // Fill with semi-transparent accent
  const r = parseInt(colors.viewportStroke.slice(1, 3), 16) || 57;
  const g = parseInt(colors.viewportStroke.slice(3, 5), 16) || 208;
  const b = parseInt(colors.viewportStroke.slice(5, 7), 16) || 198;
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.12)`;
  ctx.fillRect(x, y, w, h);

  // Stroke
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.6)`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(x, y, w, h);
}

/* -------------------------------------------------------------------------- */
/*  Main render function                                                      */
/* -------------------------------------------------------------------------- */

/** Render the minimap scene to a canvas context. */
export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  scene: MinimapScene,
  tf: MinimapTransform,
  viewportRect: { x: number; y: number; w: number; h: number },
  colors: MinimapColors,
  dpr: number = 1,
): void {
  const { mmWidth, mmHeight } = tf;

  // Clear and fill background
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, mmWidth, mmHeight);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, mmWidth, mmHeight);

  // Draw entries back-to-front (last entries are on top in paint order)
  // We draw in reverse for proper visual stacking
  for (let i = scene.entries.length - 1; i >= 0; i--) {
    const entry = scene.entries[i]!;

    // Skip zero-bounds entries (adjustment nodes without geometry)
    if (
      entry.bounds.w === 0 &&
      entry.bounds.h === 0 &&
      entry.kind !== 'frame' &&
      entry.kind !== 'group'
    ) {
      continue;
    }

    switch (entry.kind) {
      case 'frame':
        drawFrameEntry(ctx, entry, tf, colors);
        break;
      case 'group':
        drawGroupEntry(ctx, entry, tf, colors);
        break;
      case 'text':
        drawTextEntry(ctx, entry, tf, colors);
        break;
      case 'adjustment':
        drawAdjustmentEntry(ctx, entry, tf);
        break;
      default:
        drawShapeEntry(ctx, entry, tf, colors);
        break;
    }
  }

  // Draw frame labels (only for top-level frames with custom names)
  for (const entry of scene.entries) {
    if (entry.isFrame && entry.depth <= 1 && entry.name) {
      drawFrameLabel(ctx, entry, tf, colors);
    }
  }

  // Draw selection highlights on top
  for (const entry of scene.entries) {
    if (entry.selected) {
      drawSelectionHighlight(ctx, entry, tf, colors);
    }
  }

  // Draw outlier markers
  for (const outlier of scene.outliers) {
    drawOutlierMarker(ctx, outlier, tf, colors);
  }

  // Draw viewport indicator last (on top of everything)
  drawViewportIndicator(ctx, viewportRect, colors);
}

/** Render at a specific DPR. Handles canvas sizing. */
export function renderMinimapToCanvas(
  canvas: HTMLCanvasElement,
  scene: MinimapScene,
  tf: MinimapTransform,
  viewportRect: { x: number; y: number; w: number; h: number },
  colors: MinimapColors,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = tf.mmWidth * dpr;
  canvas.height = tf.mmHeight * dpr;
  canvas.style.width = `${tf.mmWidth}px`;
  canvas.style.height = `${tf.mmHeight}px`;

  renderMinimap(ctx, scene, tf, viewportRect, colors, dpr);
}
