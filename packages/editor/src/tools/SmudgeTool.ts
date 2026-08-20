/**
 * SmudgeTool — drags existing pixels in the direction of motion.
 *
 * Unlike PaintTool which deposits new colour, SmudgeTool transports colour
 * that is already on the canvas. Settings are shared with PaintTool via the
 * BrushSection UI.
 *
 * Architecture:
 * - Reuses the same brush preset model as PaintTool (radius, hardness, spacing)
 * - Carries a per-stroke pigment reservoir, so smudging picks colour up, moves
 *   it, and lays it back down with a trail that fades — rather than displacing
 *   pixels by a fixed offset, which produced a uniform smear with no falloff
 * - Uses `compositeSmudgeDab` from @varve/scene for tile-level compositing
 * - Requires an existing raster layer to smudge (creates one if needed)
 */

import type { AreaSelection } from '@varve/engine';
import type { BrushPreset, RasterLayerNode, SmudgeState } from '@varve/scene';
import {
  compositeSmudgeDab,
  createSmudgeState,
  defaultBrushPreset,
  generateDabs,
  type SmudgeOptions as SmudgeEngineOptions,
  smoothStrokePoints,
  strokePoint,
} from '@varve/scene';
import { BaseTool } from './BaseTool';
import { collectSourceEvents, type NormalizedInputEvent } from './inputNormalizer';
import { PreviewCanvas } from './previewCanvas';
import { createRasterTarget, findEditableRasterLayer, rasterLocalPoint } from './rasterTarget';
import { selectionCoverageForDab } from './selectionCoverage';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

/**
 * UI-facing smudge modes. `sampling` moves only existing pigment, `mixing`
 * starts the brush loaded with the foreground colour, and `fingerpaint` folds
 * the foreground into the reservoir on every pickup.
 */
export type SmudgeMode = 'sampling' | 'mixing' | 'fingerpaint';

function engineMode(mode: SmudgeMode): SmudgeEngineOptions['mode'] {
  switch (mode) {
    case 'fingerpaint':
      return 'fingerPaint';
    case 'mixing':
      return 'loaded';
    default:
      return 'pure';
  }
}

export class SmudgeTool extends BaseTool {
  id = 'smudge' as const;

  private preset: BrushPreset;
  private strokePoints: import('@varve/scene').StrokePoint[] = [];
  private rasterNodeId: string | null = null;
  private strokeGeneration = 0;
  private transactionOpen = false;
  private previewCanvas = new PreviewCanvas();
  private strokeAreaSelection: AreaSelection | null = null;
  private mode: SmudgeMode = 'sampling';
  /**
   * Reservoir carried by the brush for the current stroke. Created at
   * pointer-down and discarded at pointer-up, so a new stroke always starts
   * with a clean brush rather than whatever the last one was holding.
   */
  private smudgeState: SmudgeState | null = null;
  private strokeForeground: [number, number, number, number] = [0, 0, 0, 255];

  onSettingsChange?: (settings: {
    presetId: string;
    radius: number;
    opacity: number;
    flow: number;
    hardness: number;
    smoothing: number;
    spacing: number;
    smudgeStrength: number;
  }) => void;

  constructor() {
    super();
    this.preset = defaultBrushPreset('smudge-brush', 'Smudge Brush');
    this.preset.smudgeStrength = 0.5;
    this.preset.blendMode = 'normal';
    this.preset.smoothing = 0.4;
  }

  cursor(state: ToolCursorState): CursorSpec {
    if (state === 'drag') return { css: 'none' };
    return { css: 'crosshair' };
  }

  updatePresetFromSettings(settings: {
    presetId: string;
    radius: number;
    opacity: number;
    flow: number;
    hardness: number;
    smoothing: number;
    spacing: number;
    smudgeStrength: number;
    smudgeMode?: SmudgeMode;
  }): void {
    this.preset.id = settings.presetId;
    this.preset.radius = settings.radius;
    this.preset.opacity = settings.opacity;
    this.preset.flow = settings.flow;
    this.preset.hardness = settings.hardness;
    this.preset.smoothing = settings.smoothing;
    this.preset.spacing = settings.spacing;
    this.preset.smudgeStrength = settings.smudgeStrength;
    if (settings.smudgeMode) this.mode = settings.smudgeMode;
  }

  /** Current reservoir contents, for tool-options readouts and tests. */
  getSmudgeState(): Readonly<SmudgeState> | null {
    return this.smudgeState;
  }

  getSettings(): {
    presetId: string;
    radius: number;
    opacity: number;
    flow: number;
    hardness: number;
    smoothing: number;
    spacing: number;
    smudgeStrength: number;
  } {
    return {
      presetId: this.preset.id,
      radius: this.preset.radius,
      opacity: this.preset.opacity,
      flow: this.preset.flow,
      hardness: this.preset.hardness,
      smoothing: this.preset.smoothing,
      spacing: this.preset.spacing,
      smudgeStrength: this.preset.smudgeStrength,
    };
  }

  /** Monotonically increasing id for the current stroke, bumped on each
   *  pointer-down. Exposed so callers can detect whether a stroke that was
   *  in flight has since been superseded by a new one. */
  get currentStrokeGeneration(): number {
    return this.strokeGeneration;
  }

  override onActivate(ctx: ToolContext): void {
    ctx.setDraft(null);
  }

  override onDeactivate(ctx: ToolContext): void {
    if (this.transactionOpen) {
      this.abortStroke(ctx);
    }
    ctx.setDraft(null);
    this.previewCanvas.clear();
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    if (this.drag.kind !== 'idle') return { consumed: false };
    const result = super.onPointerDown(e, ctx);
    if (!result.consumed) return result;

    ctx.beginTransaction();
    this.transactionOpen = true;

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const rasterNodeId = this.findOrCreateRasterLayer(ctx, world);
    if (!rasterNodeId) {
      ctx.abortTransaction();
      this.transactionOpen = false;
      return { consumed: false };
    }
    this.rasterNodeId = rasterNodeId;
    this.strokeAreaSelection = ctx.areaSelection ?? null;
    this.strokeForeground = [...ctx.foregroundColor];
    this.smudgeState = createSmudgeState(this.engineOptions());
    this.strokeGeneration++;

    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    const avgTilt = (Math.abs(e.tiltX ?? 0) + Math.abs(e.tiltY ?? 0)) / 2;
    const local = rasterLocalPoint(ctx, rasterNodeId, world);
    const sp = strokePoint(local.x, local.y, { pressure, tilt: avgTilt });
    this.strokePoints = [sp];
    this.updatePreview(ctx);

    return result;
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    this.drag.currentCanvas = { x: e.clientX, y: e.clientY };
    this.drag.currentWorld = ctx.canvasToWorld(e.clientX, e.clientY);

    const events = ctx.sourceEvents.length > 0 ? ctx.sourceEvents : collectSourceEvents(e, true);

    for (const ev of events) {
      if (ev.isPredicted) continue;
      const world = ctx.canvasToWorld(ev.clientX, ev.clientY);
      const local = rasterLocalPoint(ctx, this.rasterNodeId, world);
      const pressure = ev.pressure > 0 ? ev.pressure : 0.5;
      const tilt = (Math.abs(ev.tiltX) + Math.abs(ev.tiltY)) / 2;
      this.sampleStrokePoint(local, pressure, ev.time, tilt);
    }

    // Process confirmed events to tiles
    this.flushDabs(ctx);

    // Render predicted events as preview overlay
    const predicted = events.filter((event) => event.isPredicted);
    if (predicted.length > 0) {
      this.renderPredictedPreview(ctx, predicted);
    }

    this.updatePreview(ctx);
  }

  override onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const local = rasterLocalPoint(ctx, this.rasterNodeId, world);
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    const tilt = (Math.abs(e.tiltX ?? 0) + Math.abs(e.tiltY ?? 0)) / 2;
    this.sampleStrokePoint(local, pressure, undefined, tilt);

    this.flushDabs(ctx);
    ctx.commitTransaction();
    this.transactionOpen = false;
    ctx.setDraft(null);
    this.previewCanvas.clear();

    super.onPointerUp(e, ctx);
    this.resetState();
  }

  override onPointerCancel(_e: PointerEvent, ctx: ToolContext): void {
    this.abortStroke(ctx);
  }

  override onDragCancel(_ctx: ToolContext): void {
    this.abortStroke(_ctx);
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape' && this.drag.kind === 'dragging') {
      this.abortStroke(ctx);
      ctx.setDraft(null);
      return true;
    }
    if (e.key === '[') {
      this.preset.radius = Math.max(1, this.preset.radius - 2);
      ctx.announce(`Brush size: ${Math.round(this.preset.radius)}px`);
      this.onSettingsChange?.(this.getSettings());
      if (this.drag.kind === 'dragging') this.updatePreview(ctx);
      return true;
    }
    if (e.key === ']') {
      this.preset.radius += 2;
      ctx.announce(`Brush size: ${Math.round(this.preset.radius)}px`);
      this.onSettingsChange?.(this.getSettings());
      if (this.drag.kind === 'dragging') this.updatePreview(ctx);
      return true;
    }
    return false;
  }

  private sampleStrokePoint(
    world: { x: number; y: number },
    pressure: number,
    time?: number,
    tilt?: number,
  ): void {
    const pts = this.strokePoints;
    if (pts.length === 0) return;
    const last = pts[pts.length - 1]!;
    const t = time ?? performance.now();

    const dx = world.x - last.x;
    const dy = world.y - last.y;
    if (dx * dx + dy * dy < 1) return;

    const speed = t - last.time > 0 ? (Math.sqrt(dx * dx + dy * dy) / (t - last.time)) * 1000 : 0;
    const direction = Math.atan2(dy, dx);
    const sp = strokePoint(world.x, world.y, {
      pressure,
      tilt: tilt ?? last.tilt,
      direction,
      speed,
      time: t,
    });
    pts.push(sp);
  }

  /** Engine options for the current settings snapshot. */
  private engineOptions(coverage: import('@varve/scene').CoverageMask | null = null) {
    return {
      mode: engineMode(this.mode),
      strength: this.preset.smudgeStrength,
      // Pickup is derived from strength so one artist-facing control drives
      // both how much moves and how long the trail is, rather than exposing a
      // second knob whose interaction with the first is hard to predict.
      pickup: Math.max(0.05, Math.min(1, this.preset.smudgeStrength * 0.7)),
      foreground: this.strokeForeground,
      initialLoad: 1,
      coverage,
    };
  }

  private flushDabs(ctx: ToolContext): void {
    const rasterNodeId = this.rasterNodeId;
    if (!rasterNodeId) return;

    const pts = this.strokePoints;
    if (pts.length < 2) return;

    const smoothed = smoothStrokePoints(pts, this.preset.smoothing);
    const dabs = generateDabs(smoothed, this.preset);
    if (dabs.length === 0) return;

    const state = this.smudgeState;
    if (!state) return;

    ctx.updateNode(rasterNodeId, (node) => {
      let updated = node as RasterLayerNode;
      for (const dab of dabs) {
        const coverage = selectionCoverageForDab(ctx, rasterNodeId, dab, this.strokeAreaSelection);
        updated = compositeSmudgeDab(updated, dab, state, this.engineOptions(coverage));
      }
      return updated;
    });

    this.strokePoints = [pts[pts.length - 1]!];
  }

  private renderPredictedPreview(ctx: ToolContext, predictedEvents: NormalizedInputEvent[]): void {
    if (predictedEvents.length === 0) return;

    const canvas = ctx.canvasElement;
    if (!canvas) return;

    this.previewCanvas.ensureSize(canvas.width, canvas.height);
    this.previewCanvas.clear();

    const pts: import('@varve/scene').StrokePoint[] = [];
    for (const ev of predictedEvents) {
      const world = ctx.canvasToWorld(ev.clientX, ev.clientY);
      const local = rasterLocalPoint(ctx, this.rasterNodeId, world);
      const pressure = ev.pressure > 0 ? ev.pressure : 0.5;
      const tilt = (Math.abs(ev.tiltX) + Math.abs(ev.tiltY)) / 2;
      pts.push(strokePoint(local.x, local.y, { pressure, tilt }));
    }

    if (pts.length < 2) return;
    const smoothed = smoothStrokePoints(pts, this.preset.smoothing);
    const dabs = generateDabs(smoothed, this.preset);
    if (dabs.length === 0) return;

    const color: [number, number, number, number] = ctx.foregroundColor;
    this.previewCanvas.drawPredictedDabs(dabs, color);
  }

  private updatePreview(ctx: ToolContext): void {
    const radius = this.preset.radius;
    ctx.setDraft({
      kind: 'ellipse',
      x: this.drag.currentWorld.x - radius,
      y: this.drag.currentWorld.y - radius,
      w: radius * 2,
      h: radius * 2,
      label: `${Math.round(radius)}px`,
    });
  }

  private findOrCreateRasterLayer(
    ctx: ToolContext,
    world: { x: number; y: number },
  ): string | null {
    const existing = findEditableRasterLayer(ctx);
    if (existing) return existing;
    return createRasterTarget(ctx, world);
  }

  private abortStroke(ctx: ToolContext): void {
    if (!this.transactionOpen) return;
    ctx.abortTransaction();
    this.transactionOpen = false;
    ctx.setDraft(null);
    this.previewCanvas.clear();
    this.resetState();
  }

  private resetState(): void {
    this.strokePoints = [];
    this.rasterNodeId = null;
    this.strokeAreaSelection = null;
  }

  /** Called by the editor when the tool is being torn down. */
  destroy(): void {
    this.previewCanvas.destroy();
  }
}
