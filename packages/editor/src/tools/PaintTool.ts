import type { BrushDab, BrushPreset, RasterLayerNode } from '@strata/scene';
import {
  compositeDabOnNode,
  defaultBrushPreset,
  generateDabs,
  seedJitter,
  smoothStrokePoints,
  strokePoint,
  tilesForBounds,
} from '@strata/scene';
import { BrushWorkerHost } from '../render/brushWorkerHost';
import { BaseTool } from './BaseTool';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

export class PaintTool extends BaseTool {
  id: 'paint' | 'eraser';

  private preset: BrushPreset;
  private eraserMode: boolean;
  private strokePoints: import('@strata/scene').StrokePoint[] = [];
  private rasterNodeId: string | null = null;
  private transactionOpen = false;
  private workerHost: BrushWorkerHost | null = null;

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
  }): void {
    this.preset.id = settings.presetId;
    this.preset.radius = settings.radius;
    this.preset.opacity = settings.opacity;
    this.preset.flow = settings.flow;
    this.preset.hardness = settings.hardness;
    this.preset.smoothing = settings.smoothing;
    this.preset.spacing = settings.spacing;
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

    // Seed deterministic jitter for this stroke
    seedJitter(Math.round(performance.now() * 1000) & 0x7fffffff);

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

    const events =
      typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length > 0
        ? e.getCoalescedEvents()
        : [e];

    for (const ev of events) {
      const world = ctx.canvasToWorld(ev.clientX, ev.clientY);
      const pressure = ev.pressure > 0 ? ev.pressure : 0.5;
      const tilt = (Math.abs(ev.tiltX ?? 0) + Math.abs(ev.tiltY ?? 0)) / 2;
      this.sampleStrokePoint(world, pressure, undefined, tilt);
    }

    this.flushDabs(ctx);
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

    super.onPointerUp(e, ctx);
    this.resetState();
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
  }

  /** Worker-thread dab generation with synchronous compositing on main thread. */
  private flushDabsWorker(
    ctx: ToolContext,
    pts: import('@strata/scene').StrokePoint[],
    color: [number, number, number, number],
  ): void {
    const rasterNodeId = this.rasterNodeId;
    if (!rasterNodeId) return;

    const strokeId = `${rasterNodeId}-${performance.now()}`;
    const jitterSeed = Math.round(performance.now() * 1000) & 0x7fffffff;

    this.workerHost!.generateDabs(strokeId, pts, this.preset, color, jitterSeed)
      .then(({ dabs }) => {
        if (dabs.length === 0 || rasterNodeId !== this.rasterNodeId) return;
        ctx.updateNode(rasterNodeId, (node) => {
          const raster = node as RasterLayerNode;
          let updated = raster;
          for (const dab of dabs) {
            if (this.eraserMode) {
              updated = this.eraseDabOnNode(updated, dab);
            } else {
              updated = compositeDabOnNode(updated, dab, color, false);
            }
          }
          return updated;
        });
      })
      .catch(() => {
        this.flushDabsSync(ctx, pts, color);
      });
  }

  /** Synchronous fallback for when the worker is unavailable. */
  private flushDabsSync(
    ctx: ToolContext,
    pts: import('@strata/scene').StrokePoint[],
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
          updated = this.eraseDabOnNode(updated, dab);
        } else {
          updated = compositeDabOnNode(updated, dab, color, false);
        }
      }
      return updated;
    });
  }

  private eraseDabOnNode(node: RasterLayerNode, dab: BrushDab): RasterLayerNode {
    const dabDiameter = Math.ceil(dab.radius * 2);
    const startX = Math.floor(dab.x - dab.radius);
    const startY = Math.floor(dab.y - dab.radius);

    const tileKeys = tilesForBounds(startX, startY, dabDiameter, dabDiameter);
    const TILE_SIZE = 128;
    const newTiles = new Map(node.tiles);

    for (const { col, row } of tileKeys) {
      const key = `${col}:${row}`;
      const tile = newTiles.get(key);
      if (!tile) continue;

      const newPixels = new Uint8ClampedArray(tile.pixels);
      const tileOriginX = col * TILE_SIZE;
      const tileOriginY = row * TILE_SIZE;

      const size = Math.ceil(dab.radius * 2);
      const offsetX = Math.round(dab.x - tileOriginX - dab.radius);
      const offsetY = Math.round(dab.y - tileOriginY - dab.radius);

      for (let my = 0; my < size; my++) {
        const py = offsetY + my;
        if (py < 0 || py >= TILE_SIZE) continue;
        for (let mx = 0; mx < size; mx++) {
          const px = offsetX + mx;
          if (px < 0 || px >= TILE_SIZE) continue;

          const idx = (py * TILE_SIZE + px) * 4;
          const currentAlpha = newPixels[idx + 3]!;
          const newAlpha = Math.max(0, currentAlpha - Math.round(dab.opacity * dab.flow * 255));
          newPixels[idx + 3] = newAlpha;
        }
      }

      newTiles.set(key, { pixels: newPixels, version: tile.version + 1 });
    }

    return { ...node, tiles: newTiles };
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

    const nodeId = ctx.createRasterLayer(4096, 4096);
    this.ownsLayer = true;
    return nodeId;
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
    this.resetState();
  }

  private resetState(): void {
    this.strokePoints = [];
    this.rasterNodeId = null;
    this.ownsLayer = false;
  }
}
