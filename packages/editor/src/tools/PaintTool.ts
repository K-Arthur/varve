import type { BrushPreset, RasterLayerNode } from '@varve/scene';
import {
  compositeDabOnNode,
  defaultBrushPreset,
  eraseDabOnNode,
  generateDabs,
  seedJitter,
  smoothStrokePoints,
  strokePoint,
} from '@varve/scene';
import { BrushWorkerHost } from '../render/brushWorkerHost';
import { BaseTool } from './BaseTool';
import { collectSourceEvents } from './inputNormalizer';
import { createRasterTarget, findEditableRasterLayer, rasterLocalPoint } from './rasterTarget';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

export class PaintTool extends BaseTool {
  id: 'paint' | 'eraser';

  private preset: BrushPreset;
  private eraserMode: boolean;
  private strokePoints: import('@varve/scene').StrokePoint[] = [];
  private lastSmoothedPoint: import('@varve/scene').StrokePoint | null = null;
  private rasterNodeId: string | null = null;
  private strokeGeneration = 0;
  private transactionOpen = false;
  private workerHost: BrushWorkerHost | null = null;
  private ownsLayer = false;
  private alphaLock = false;
  private pendingWorkerJobs = 0;
  private workerStrokeEnding = false;

  /** Called when the brush settings change (e.g., from keyboard shortcut).
   *  Editor sets this to update the editor state. */
  onSettingsChange?: (settings: {
    presetId: string;
    radius: number;
    opacity: number;
    flow: number;
    hardness: number;
    smoothing: number;
    spacing: number;
  }) => void;

  constructor(eraser: boolean = false) {
    super();
    this.eraserMode = eraser;
    this.id = eraser ? 'eraser' : 'paint';
    this.preset = defaultBrushPreset(
      eraser ? 'eraser-brush' : 'paint-brush',
      eraser ? 'Eraser' : 'Paint Brush',
    );
    if (eraser) {
      this.preset.eraser = true;
      this.preset.blendMode = 'normal';
    }
  }

  cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  /** Update internal preset fields from an external settings object. */
  updatePresetFromSettings(settings: {
    presetId: string;
    radius: number;
    opacity: number;
    flow: number;
    hardness: number;
    smoothing: number;
    spacing: number;
    grainId?: string | null;
    grainScale?: number;
    grainRotation?: number;
    grainContrast?: number;
    grainInvert?: boolean;
    alphaLock?: boolean;
    blendMode?: string;
  }): void {
    this.preset.id = settings.presetId;
    this.preset.radius = settings.radius;
    this.preset.opacity = settings.opacity;
    this.preset.flow = settings.flow;
    this.preset.hardness = settings.hardness;
    this.preset.smoothing = settings.smoothing;
    this.preset.spacing = settings.spacing;
    if (settings.grainId !== undefined) this.preset.grainId = settings.grainId ?? undefined;
    if (settings.grainScale !== undefined) this.preset.grainScale = settings.grainScale;
    if (settings.grainRotation !== undefined) this.preset.grainRotation = settings.grainRotation;
    if (settings.grainContrast !== undefined) this.preset.grainContrast = settings.grainContrast;
    if (settings.grainInvert !== undefined) this.preset.grainInvert = settings.grainInvert;
    if (settings.alphaLock !== undefined) this.alphaLock = settings.alphaLock;
    if (settings.blendMode !== undefined) this.preset.blendMode = settings.blendMode;
  }

  /** Return current preset values mapped to the brush settings shape. */
  getSettings(): {
    presetId: string;
    radius: number;
    opacity: number;
    flow: number;
    hardness: number;
    smoothing: number;
    spacing: number;
  } {
    return {
      presetId: this.preset.id,
      radius: this.preset.radius,
      opacity: this.preset.opacity,
      flow: this.preset.flow,
      hardness: this.preset.hardness,
      smoothing: this.preset.smoothing,
      spacing: this.preset.spacing,
    };
  }

  /** Whether the raster layer used by the current/most recent stroke was newly
   *  created by this tool, as opposed to an existing layer that was reused. */
  get ownsCurrentLayer(): boolean {
    return this.ownsLayer;
  }

  /** Lazily create and return the brush worker host. */
  getWorkerHost(): BrushWorkerHost {
    if (!this.workerHost) {
      this.workerHost = new BrushWorkerHost();
    }
    return this.workerHost;
  }

  /** Override the worker host (used by tests to inject a mock). */
  setWorkerHost(host: BrushWorkerHost): void {
    this.workerHost = host;
  }

  override onActivate(ctx: ToolContext): void {
    ctx.setDraft(null);
  }

  override onDeactivate(ctx: ToolContext): void {
    if (this.transactionOpen) {
      this.abortStroke(ctx);
    }
    ctx.setDraft(null);
  }

  /** Destroy the worker host (called when the tool instance is being torn down). */
  destroy(): void {
    this.workerHost?.destroy();
    this.workerHost = null;
  }

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    if (this.drag.kind !== 'idle') return { consumed: false };
    const result = super.onPointerDown(e, ctx);
    if (!result.consumed) return result;

    ctx.beginTransaction();
    this.transactionOpen = true;

    const world = ctx.canvasToWorld(e.clientX, e.clientY);

    const rasterNodeId = this.findOrCreateRasterLayer(ctx);
    if (!rasterNodeId) {
      ctx.abortTransaction();
      this.transactionOpen = false;
      return { consumed: false };
    }
    this.rasterNodeId = rasterNodeId;
    this.strokeGeneration++;
    this.workerStrokeEnding = false;

    // Seed deterministic jitter for this stroke
    seedJitter(Math.round(performance.now() * 1000) & 0x7fffffff);

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

    this.flushDabs(ctx);
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
    super.onPointerUp(e, ctx);
    if (this.pendingWorkerJobs > 0) {
      this.workerStrokeEnding = true;
      ctx.setDraft(null);
    } else {
      this.finishStroke(ctx);
    }
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
      if (this.drag.kind === 'dragging') this.paintPreview(ctx);
      return true;
    }
    if (e.key === ']') {
      this.preset.radius += 2;
      ctx.announce(`Brush size: ${Math.round(this.preset.radius)}px`);
      this.onSettingsChange?.(this.getSettings());
      if (this.drag.kind === 'dragging') this.paintPreview(ctx);
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
    if (pts.length < 1) return;

    const color: [number, number, number, number] = this.eraserMode
      ? [0, 0, 0, 0]
      : ctx.foregroundColor;

    // Try worker path; fall back synchronously if unavailable or slow.
    if (this.workerHost?.isUsingWorker) {
      this.flushDabsWorker(ctx, pts, color);
    } else {
      this.flushDabsSync(ctx, pts, color);
    }

    // Keep the last point for EMA smoothing continuity, then clear
    // processed points so the next flush only sends new samples.
    this.lastSmoothedPoint = pts[pts.length - 1] ?? null;
    this.strokePoints = this.lastSmoothedPoint ? [this.lastSmoothedPoint] : [];
  }

  /** Worker-thread dab generation with synchronous compositing on main thread. */
  private flushDabsWorker(
    ctx: ToolContext,
    pts: import('@varve/scene').StrokePoint[],
    color: [number, number, number, number],
  ): void {
    const rasterNodeId = this.rasterNodeId;
    const gen = this.strokeGeneration;
    if (!rasterNodeId) return;

    const strokeId = `${rasterNodeId}-${gen}`;
    const jitterSeed = gen * 7919;

    this.pendingWorkerJobs++;
    this.workerHost!.generateDabs(strokeId, pts, this.preset, jitterSeed)
      .then(({ dabs }) => {
        // Stale-result guard: reject if a newer generation has started
        // (tool switched, new stroke, or undo/redo invalidated this one).
        if (gen !== this.strokeGeneration) return;
        if (dabs.length === 0 || rasterNodeId !== this.rasterNodeId) return;
        ctx.updateNode(rasterNodeId, (node) => {
          const raster = node as RasterLayerNode;
          let updated = raster;
          for (const dab of dabs) {
            if (this.eraserMode) {
              updated = eraseDabOnNode(updated, dab);
            } else {
              updated = compositeDabOnNode(updated, dab, color, false);
            }
          }
          return updated;
        });
      })
      .catch(() => {
        if (gen !== this.strokeGeneration) return;
        this.flushDabsSync(ctx, pts, color);
      })
      .finally(() => {
        this.pendingWorkerJobs = Math.max(0, this.pendingWorkerJobs - 1);
        if (this.workerStrokeEnding && this.pendingWorkerJobs === 0) {
          this.finishStroke(ctx);
        }
      });
  }

  /** Synchronous fallback for when the worker is unavailable. */
  private flushDabsSync(
    ctx: ToolContext,
    pts: import('@varve/scene').StrokePoint[],
    color: [number, number, number, number],
  ): void {
    const rasterNodeId = this.rasterNodeId;
    if (!rasterNodeId) return;

    const smoothed = smoothStrokePoints(pts, this.preset.smoothing);
    const dabs = generateDabs(smoothed, this.preset);
    if (dabs.length === 0) return;

    ctx.updateNode(rasterNodeId, (node) => {
      const raster = node as RasterLayerNode;
      let updated = raster;
      for (const dab of dabs) {
        if (this.eraserMode) {
          updated = eraseDabOnNode(updated, dab);
        } else {
          updated = compositeDabOnNode(updated, dab, color, this.alphaLock, this.preset.blendMode);
        }
      }
      return updated;
    });
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

  private paintPreview(_ctx: ToolContext): void {
    // Preview updated during pointer move
  }

  private findOrCreateRasterLayer(ctx: ToolContext): string | null {
    const existing = this.findExistingRasterLayer(ctx);
    if (existing) {
      this.ownsLayer = false;
      return existing;
    }

    const nodeId = createRasterTarget(ctx, this.drag.startWorld);
    this.ownsLayer = true;
    return nodeId;
  }

  private findExistingRasterLayer(ctx: ToolContext): string | null {
    return findEditableRasterLayer(ctx);
  }

  private abortStroke(ctx: ToolContext): void {
    if (!this.transactionOpen) return;
    this.strokeGeneration++;
    this.workerStrokeEnding = false;
    if (this.rasterNodeId) {
      this.workerHost?.cancelStroke(`${this.rasterNodeId}-${this.strokeGeneration}`);
    }
    ctx.abortTransaction();
    this.transactionOpen = false;
    ctx.setDraft(null);
    this.resetState();
  }

  private finishStroke(ctx: ToolContext): void {
    if (!this.transactionOpen) return;
    ctx.commitTransaction();
    this.transactionOpen = false;
    ctx.setDraft(null);
    this.resetState();
  }

  private resetState(): void {
    this.strokePoints = [];
    this.lastSmoothedPoint = null;
    this.rasterNodeId = null;
    this.ownsLayer = false;
    this.workerStrokeEnding = false;
  }
}
