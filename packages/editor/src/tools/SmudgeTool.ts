/**
 * SmudgeTool — drags existing pixels in the direction of motion.
 *
 * Unlike PaintTool which deposits new color, SmudgeTool displaces existing
 * pixel data. Settings are shared with PaintTool via the BrushSection UI.
 *
 * Architecture:
 * - Reuses the same brush preset model as PaintTool (radius, hardness, spacing)
 * - Adds smudgeStrength (0-1) controlling how far pixels are dragged per frame
 * - Uses `compositeSmudgeDabOnNode` from @varve/scene for tile-level compositing
 * - Requires an existing raster layer to smudge (creates one if needed)
 */

import type { BrushPreset, RasterLayerNode } from '@varve/scene';
import {
  compositeSmudgeDabOnNode,
  defaultBrushPreset,
  generateDabs,
  smoothStrokePoints,
  strokePoint,
} from '@varve/scene';
import { BaseTool } from './BaseTool';
import { collectSourceEvents, type NormalizedInputEvent } from './inputNormalizer';
import { PreviewCanvas } from './previewCanvas';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

export type SmudgeMode = 'sampling' | 'mixing' | 'fingerpaint';

export class SmudgeTool extends BaseTool {
  id = 'smudge' as const;

  private preset: BrushPreset;
  private strokePoints: import('@varve/scene').StrokePoint[] = [];
  private rasterNodeId: string | null = null;
  private strokeGeneration = 0;
  private transactionOpen = false;
  private previewCanvas = new PreviewCanvas();

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
  }): void {
    this.preset.id = settings.presetId;
    this.preset.radius = settings.radius;
    this.preset.opacity = settings.opacity;
    this.preset.flow = settings.flow;
    this.preset.hardness = settings.hardness;
    this.preset.smoothing = settings.smoothing;
    this.preset.spacing = settings.spacing;
    this.preset.smudgeStrength = settings.smudgeStrength;
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

    const rasterNodeId = this.findOrCreateRasterLayer(ctx);
    if (!rasterNodeId) {
      ctx.abortTransaction();
      this.transactionOpen = false;
      return { consumed: false };
    }
    this.rasterNodeId = rasterNodeId;
    this.strokeGeneration++;

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    const avgTilt = (Math.abs(e.tiltX ?? 0) + Math.abs(e.tiltY ?? 0)) / 2;
    const sp = strokePoint(world.x, world.y, { pressure, tilt: avgTilt });
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
      const pressure = ev.pressure > 0 ? ev.pressure : 0.5;
      const tilt = (Math.abs(ev.tiltX) + Math.abs(ev.tiltY)) / 2;
      this.sampleStrokePoint(world, pressure, ev.time, tilt);
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
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    const tilt = (Math.abs(e.tiltX ?? 0) + Math.abs(e.tiltY ?? 0)) / 2;
    this.sampleStrokePoint(world, pressure, undefined, tilt);

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

  private flushDabs(ctx: ToolContext): void {
    const rasterNodeId = this.rasterNodeId;
    if (!rasterNodeId) return;

    const pts = this.strokePoints;
    if (pts.length < 2) return;

    const smoothed = smoothStrokePoints(pts, this.preset.smoothing);
    const dabs = generateDabs(smoothed, this.preset);
    if (dabs.length === 0) return;

    const first = smoothed[0]!;
    const last = smoothed[smoothed.length - 1]!;
    const direction = Math.atan2(last.y - first.y, last.x - first.x);

    ctx.updateNode(rasterNodeId, (node) => {
      const raster = node as RasterLayerNode;
      let updated = raster;
      for (const dab of dabs) {
        updated = compositeSmudgeDabOnNode(updated, dab, direction, this.preset.smudgeStrength);
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
      const pressure = ev.pressure > 0 ? ev.pressure : 0.5;
      const tilt = (Math.abs(ev.tiltX) + Math.abs(ev.tiltY)) / 2;
      pts.push(strokePoint(world.x, world.y, { pressure, tilt }));
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

  private findOrCreateRasterLayer(ctx: ToolContext): string | null {
    const existing = this.findExistingRasterLayer(ctx);
    if (existing) return existing;
    return ctx.createRasterLayer(4096, 4096);
  }

  private findExistingRasterLayer(ctx: ToolContext): string | null {
    const doc = ctx.document;
    const pageId = doc.activePageId;
    const contentRootId = pageId
      ? (doc.pages ?? []).find((p) => p.id === pageId)?.contentRoot
      : null;

    const candidates: string[] = contentRootId
      ? ((doc.nodes[contentRootId] as { children?: string[] })?.children ?? doc.rootChildren)
      : doc.rootChildren;

    for (const nodeId of candidates) {
      const node = doc.nodes[nodeId];
      if (node?.kind === 'rasterLayer') {
        return nodeId;
      }
    }
    return null;
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
  }

  /** Called by the editor when the tool is being torn down. */
  destroy(): void {
    this.previewCanvas.destroy();
  }
}
