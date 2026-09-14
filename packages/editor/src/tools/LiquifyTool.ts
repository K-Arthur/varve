/**
 * LiquifyTool — brush-driven, non-destructive raster deformation.
 *
 * Model
 * -----
 * The tool edits a persisted output→source displacement field on the target
 * node (see `@varve/scene` `applyLiquifyDabToSceneNode`). It never rewrites
 * the layer's tiles, so a stroke is reversible by removing or restoring the
 * field, and repeated previews resample the original pixels instead of
 * warping already-warped data. One undo transaction covers one stroke.
 *
 * Targets
 * -------
 * - A single raster layer: its own deformation.
 * - A frequency-separation group: a shared deformation applied to the
 *   recombined composite (keeps linked tone/detail aligned).
 * - A band inside a separation (advanced): deforms only that component.
 *
 * Input
 * -----
 * Coalesced pointer events are processed in order; predicted events are
 * ignored (they must never be committed twice). Push uses the incremental
 * pointer delta, so holding still cannot drift. Bloat/pucker/twirl scale by
 * elapsed time so a 240 Hz device deforms at the same rate as a 60 Hz mouse.
 */

import type { LiquifyDab, LiquifyMode } from '@varve/engine';
import { createFreezeSampler } from '@varve/engine';
import {
  applyLiquifyDabToSceneNode,
  decodeNodeFreezeMask,
  type FreezeMaskData,
  findFrequencySeparationForBand,
  freezeMaskDimensions,
  getFrequencySeparationState,
  type RasterLayerNode,
  setLiquifyFreezeMaskOnNode,
  stampFreezeMaskData,
} from '@varve/scene';
import { BaseTool } from './BaseTool';
import { collectSourceEvents } from './inputNormalizer';
import {
  type LiquifyFreezeTool,
  patchLiquifyOverlay,
  resetLiquifyOverlay,
} from './liquifyOverlayState';
import { rasterLocalPoint } from './rasterTarget';
import type { CursorSpec, GestureResult, ToolContext } from './types';

export interface LiquifyToolOptions {
  /** Brush diameter in layer pixels. */
  brushSize: number;
  /** 0..1 deformation strength. */
  strength: number;
  /** 0..1 falloff hardness (1 = hard edge). */
  hardness: number;
  pressureEnabled: boolean;
  mode: LiquifyMode;
  freezeTool: LiquifyFreezeTool;
  showGrid: boolean;
  showFreeze: boolean;
}

export const DEFAULT_LIQUIFY_OPTIONS: LiquifyToolOptions = {
  brushSize: 160,
  strength: 0.6,
  hardness: 0.5,
  pressureEnabled: true,
  mode: 'push',
  freezeTool: 'off',
  showGrid: false,
  showFreeze: true,
};

interface LiquifyTarget {
  id: string;
  width: number;
  height: number;
  /** Freeze masks persist only on raster layers in this version. */
  freezeSupported: boolean;
}

export function resolveLiquifyTarget(
  ctx: Pick<ToolContext, 'document' | 'selection'>,
): LiquifyTarget | null {
  if (ctx.selection.length !== 1) return null;
  const node = ctx.document.nodes[ctx.selection[0]!];
  if (!node || node.visible === false) return null;
  if (node.kind === 'rasterLayer') {
    if (node.locked) return null;
    return { id: node.id, width: node.width, height: node.height, freezeSupported: true };
  }
  if (node.kind === 'group' && getFrequencySeparationState(node)) {
    const state = getFrequencySeparationState(node)!;
    const low = ctx.document.nodes[state.lowNodeId] as RasterLayerNode | undefined;
    if (low?.kind !== 'rasterLayer') return null;
    if (node.locked) return null;
    // Freeze masks are persisted per raster layer in this version; a group
    // target accepts deformation only, with a clear message.
    return { id: node.id, width: low.width, height: low.height, freezeSupported: false };
  }
  return null;
}

export function liquifyUnsupportedReason(
  ctx: Pick<ToolContext, 'document' | 'selection'>,
): string | null {
  if (ctx.selection.length === 0)
    return 'Select a raster layer, a frequency separation group, or one of its bands';
  if (ctx.selection.length > 1) return 'Liquify edits one target at a time';
  const node = ctx.document.nodes[ctx.selection[0]!];
  if (!node) return 'The selected node no longer exists';
  if (node.visible === false) return 'The selected layer is hidden';
  if (node.locked) return 'The selected layer is locked';
  if (node.kind === 'rasterLayer') return null;
  if (node.kind === 'group' && getFrequencySeparationState(node)) return null;
  const separation = findFrequencySeparationForBand(ctx.document, ctx.selection[0]!);
  if (separation) {
    return 'Use the separation group as the target for a shared deformation, or select a band for a single-component edit';
  }
  return 'Liquify works on raster layers and frequency separation groups';
}

export class LiquifyTool extends BaseTool {
  override id = 'liquify' as const;

  private options: LiquifyToolOptions = { ...DEFAULT_LIQUIFY_OPTIONS };
  private transactionOpen = false;
  private target: LiquifyTarget | null = null;
  private lastLayerPoint: { x: number; y: number } | null = null;
  private lastSampleTime = 0;
  private sessionFreeze: FreezeMaskData | null = null;
  private freezeSampler: ReturnType<typeof createFreezeSampler> = null;
  private freezeDirty = false;
  private sessionFreezeRevision = 0;

  onSettingsChange?: (settings: LiquifyToolOptions) => void;

  override cursor(): CursorSpec {
    return { css: 'none' };
  }

  getOptions(): Readonly<LiquifyToolOptions> {
    return this.options;
  }

  setOptions(patch: Partial<LiquifyToolOptions>): void {
    this.options = { ...this.options, ...patch };
    this.onSettingsChange?.({ ...this.options });
    if (this.drag.kind === 'dragging') this.updateDraftSafely();
  }

  /** Options can change mid-stroke; refresh the cursor ring without a ctx. */
  private updateDraftSafely(): void {
    patchLiquifyOverlay({
      radiusLayer: this.options.brushSize / 2,
      hardness: this.options.hardness,
      mode: this.options.mode,
      freezeTool: this.options.freezeTool,
      showGrid: this.options.showGrid,
      showFreeze: this.options.showFreeze,
    });
  }

  override onActivate(ctx: ToolContext): void {
    super.onActivate?.(ctx);
    ctx.setDraft(null);
    const target = resolveLiquifyTarget(ctx);
    if (!target) {
      const reason = liquifyUnsupportedReason(ctx);
      if (reason) ctx.announce(`Liquify unavailable: ${reason}`);
    }
    this.publishOverlay(ctx, target);
  }

  override onDeactivate(ctx: ToolContext): void {
    if (this.transactionOpen) this.abortStroke(ctx);
    ctx.setDraft(null);
    this.target = null;
    resetLiquifyOverlay();
  }

  override onPointerDown(event: PointerEvent, ctx: ToolContext): GestureResult {
    if (this.drag.kind !== 'idle') return { consumed: false };
    const target = resolveLiquifyTarget(ctx);
    if (!target) {
      const reason = liquifyUnsupportedReason(ctx);
      if (reason) ctx.announce(`Liquify unavailable: ${reason}`);
      this.publishOverlay(ctx, null);
      return { consumed: false };
    }
    this.target = target;
    ctx.beginTransaction();
    this.transactionOpen = true;

    const world = ctx.canvasToWorld(event.clientX, event.clientY);
    const point = rasterLocalPoint(ctx, target.id, world);
    this.lastLayerPoint = point;
    this.lastSampleTime = event.timeStamp || performance.now();

    if (this.options.freezeTool !== 'off' && !target.freezeSupported) {
      ctx.announce(
        'Freeze masks are not available on a frequency separation group; deforming the composite',
      );
    }
    if (this.options.freezeTool !== 'off' && target.freezeSupported) {
      this.sessionFreeze =
        decodeNodeFreezeMask(ctx.document.nodes[target.id] as never) ??
        this.allocateSessionFreeze(target);
      this.freezeSampler = createFreezeSampler(
        this.sessionFreeze.width,
        this.sessionFreeze.height,
        this.sessionFreeze.data,
      );
      this.freezeDirty = false;
      this.stampFreeze(ctx, point);
      this.publishOverlay(ctx, target, point);
    } else {
      this.freezeSampler = this.loadPersistedFreezeSampler(ctx, target);
      this.applyDab(ctx, {
        x: point.x,
        y: point.y,
        radius: this.radiusForPressure(event.pressure),
        strength: this.options.strength,
        pressure: this.pressureFor(event.pressure),
        deltaX: 0,
        deltaY: 0,
      });
      this.publishOverlay(ctx, target, point);
    }

    const result = super.onPointerDown(event, ctx);
    return result;
  }

  override onPointerMove(event: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== event.pointerId) {
      // Hover: keep the cursor overlay in sync.
      const target = resolveLiquifyTarget(ctx);
      if (target) {
        const world = ctx.canvasToWorld(event.clientX, event.clientY);
        this.publishOverlay(ctx, target, rasterLocalPoint(ctx, target.id, world));
      }
      return;
    }
    const target = this.target;
    if (!target) return;
    this.drag.currentCanvas = { x: event.clientX, y: event.clientY };
    this.drag.currentWorld = ctx.canvasToWorld(event.clientX, event.clientY);

    const events =
      ctx.sourceEvents.length > 0 ? ctx.sourceEvents : collectSourceEvents(event, true);
    for (const ev of events) {
      if (ev.isPredicted) continue;
      const world = ctx.canvasToWorld(ev.clientX, ev.clientY);
      const point = rasterLocalPoint(ctx, target.id, world);
      const now = ev.time > 0 ? ev.time : performance.now();
      const dtMs = Math.max(0, now - this.lastSampleTime);
      this.lastSampleTime = now;

      if (this.options.freezeTool !== 'off' && this.sessionFreeze) {
        this.stampFreeze(ctx, point);
      } else {
        const previous = this.lastLayerPoint ?? point;
        const rawPressure = this.options.pressureEnabled ? ev.pressure : 0.75;
        this.applyDab(ctx, {
          x: point.x,
          y: point.y,
          radius: this.radiusForPressure(rawPressure),
          strength: this.options.strength,
          pressure: this.pressureFor(rawPressure),
          deltaX: point.x - previous.x,
          deltaY: point.y - previous.y,
          dtMs: dtMs || 16.7,
        });
      }
      this.lastLayerPoint = point;
      this.publishOverlay(ctx, target, point);
    }

    const predicted = events.filter((candidate) => candidate.isPredicted);
    if (predicted.length > 0) {
      const last = predicted[predicted.length - 1]!;
      const world = ctx.canvasToWorld(last.clientX, last.clientY);
      this.publishOverlay(ctx, target, rasterLocalPoint(ctx, target.id, world));
    }
    this.updateDraft(ctx);
  }

  override onPointerUp(event: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== event.pointerId) return;
    const target = this.target;
    const point =
      target && this.lastLayerPoint
        ? this.lastLayerPoint
        : target
          ? rasterLocalPoint(ctx, target.id, ctx.canvasToWorld(event.clientX, event.clientY))
          : null;

    if (target && point) {
      if (this.options.freezeTool !== 'off' && this.sessionFreeze) {
        this.stampFreeze(ctx, point);
      } else {
        const previous = this.lastLayerPoint ?? point;
        const rawPressure = this.options.pressureEnabled ? event.pressure : 0.75;
        this.applyDab(ctx, {
          x: point.x,
          y: point.y,
          radius: this.radiusForPressure(rawPressure),
          strength: this.options.strength,
          pressure: this.pressureFor(rawPressure),
          deltaX: point.x - previous.x,
          deltaY: point.y - previous.y,
          dtMs: 16.7,
        });
      }
    }

    if (this.transactionOpen) {
      this.commitFreezeIfDirty(ctx);
      ctx.commitTransaction();
      this.transactionOpen = false;
    }
    ctx.setDraft(null);
    super.onPointerUp(event, ctx);
    this.lastLayerPoint = null;
    this.sessionFreeze = null;
    this.freezeSampler = null;
    this.freezeDirty = false;
    const resolved = resolveLiquifyTarget(ctx);
    this.publishOverlay(ctx, resolved);
  }

  override onPointerCancel(_event: PointerEvent, ctx: ToolContext): void {
    this.abortStroke(ctx);
  }

  override onDragCancel(ctx: ToolContext): void {
    this.abortStroke(ctx);
  }

  override onKeyDown(event: KeyboardEvent, ctx: ToolContext): boolean {
    if (event.key === 'Escape' && this.transactionOpen) {
      this.abortStroke(ctx);
      ctx.setDraft(null);
      return true;
    }
    if (event.key === '[') {
      this.setOptions({
        brushSize: Math.max(4, this.options.brushSize - Math.max(4, this.options.brushSize * 0.1)),
      });
      ctx.announce(`Liquify size: ${Math.round(this.options.brushSize)}px`);
      return true;
    }
    if (event.key === ']') {
      this.setOptions({
        brushSize: Math.min(
          4000,
          this.options.brushSize + Math.max(4, this.options.brushSize * 0.1),
        ),
      });
      ctx.announce(`Liquify size: ${Math.round(this.options.brushSize)}px`);
      return true;
    }
    return false;
  }

  /** Called by the options panel before a Reset All transaction. */
  getActiveTarget(ctx: ToolContext): LiquifyTarget | null {
    return resolveLiquifyTarget(ctx);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private allocateSessionFreeze(target: LiquifyTarget): FreezeMaskData {
    const dimensions = freezeMaskDimensions(target.width, target.height);
    return {
      width: dimensions.width,
      height: dimensions.height,
      data: new Uint8Array(dimensions.width * dimensions.height),
    };
  }

  private loadPersistedFreezeSampler(
    ctx: ToolContext,
    target: LiquifyTarget,
  ): ReturnType<typeof createFreezeSampler> {
    const node = ctx.document.nodes[target.id];
    if (!node) return null;
    const mask = decodeNodeFreezeMask(node as never);
    if (!mask) return null;
    return createFreezeSampler(mask.width, mask.height, mask.data);
  }

  private stampFreeze(_ctx: ToolContext, point: { x: number; y: number }): void {
    if (!this.sessionFreeze) return;
    const target = this.target;
    if (!target) return;
    const freeze = this.options.freezeTool === 'freeze';
    stampFreezeMaskData(
      this.sessionFreeze,
      target.width,
      target.height,
      point.x,
      point.y,
      this.options.brushSize / 2,
      freeze,
      this.options.hardness,
    );
    this.freezeSampler = createFreezeSampler(
      this.sessionFreeze.width,
      this.sessionFreeze.height,
      this.sessionFreeze.data,
    );
    this.freezeDirty = true;
    this.sessionFreezeRevision += 1;
  }

  private commitFreezeIfDirty(ctx: ToolContext): void {
    const target = this.target;
    const mask = this.sessionFreeze;
    if (!target || !mask || !this.freezeDirty) return;
    if (!target.freezeSupported) {
      ctx.announce('Freeze masks are not supported on this target in this version');
      return;
    }
    ctx.updateNode(target.id, (node) => setLiquifyFreezeMaskOnNode(node as RasterLayerNode, mask));
  }

  private applyDab(ctx: ToolContext, dab: LiquifyDab): void {
    const target = this.target;
    if (!target) return;
    const mode = this.options.mode;
    if (mode === 'push' && dab.deltaX === 0 && dab.deltaY === 0) return;
    ctx.updateNode(target.id, (node) => {
      const updated = applyLiquifyDabToSceneNode(node, mode, dab, this.freezeSampler, ctx.document);
      return updated ?? node;
    });
  }

  private radiusForPressure(pressure: number): number {
    const base = this.options.brushSize / 2;
    if (!this.options.pressureEnabled) return base;
    return Math.max(1, base * (0.35 + 0.65 * this.pressureFor(pressure)));
  }

  private pressureFor(pressure: number): number {
    if (!this.options.pressureEnabled) return 1;
    // Mouse pointers report 0 pressure while buttons are down; treat that as
    // full pressure rather than dropping the stroke.
    return pressure > 0 ? Math.max(0.05, Math.min(1, pressure)) : 1;
  }

  private updateDraft(ctx: ToolContext): void {
    const target = this.target;
    const point = this.lastLayerPoint;
    if (!target || !point) return;
    const world = this.layerToWorld(ctx, target.id, point);
    const radius = this.options.brushSize / 2;
    ctx.setDraft({
      kind: 'ellipse',
      x: world.x - radius,
      y: world.y - radius,
      w: radius * 2,
      h: radius * 2,
      label: `${Math.round(this.options.brushSize)}px ${this.modeLabel()}`,
    });
  }

  private layerToWorld(
    ctx: ToolContext,
    nodeId: string,
    point: { x: number; y: number },
  ): { x: number; y: number } {
    const transform = ctx.getWorldTransform?.(nodeId);
    if (!transform) return point;
    const [a, b, c, d, e, f] = transform;
    return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
  }

  private modeLabel(): string {
    if (this.options.freezeTool === 'freeze') return 'Freeze';
    if (this.options.freezeTool === 'thaw') return 'Thaw';
    switch (this.options.mode) {
      case 'bloat':
        return 'Expand';
      case 'pucker':
        return 'Contract';
      case 'twirl-cw':
        return 'Twirl CW';
      case 'twirl-ccw':
        return 'Twirl CCW';
      case 'restore':
        return 'Restore';
      case 'smooth':
        return 'Smooth';
      default:
        return 'Push';
    }
  }

  private publishOverlay(
    ctx: ToolContext,
    target: LiquifyTarget | null,
    cursor?: { x: number; y: number },
  ): void {
    const node = target ? ctx.document.nodes[target.id] : null;
    const persistedFreeze =
      node && 'liquifyFreeze' in node
        ? ((node as { liquifyFreeze?: import('@varve/engine').LiquifyFreezeMask }).liquifyFreeze ??
          null)
        : null;
    patchLiquifyOverlay({
      targetId: target?.id ?? null,
      cursorLayer: cursor ?? null,
      radiusLayer: this.options.brushSize / 2,
      hardness: this.options.hardness,
      mode: this.options.mode,
      freezeTool: this.options.freezeTool,
      sessionFreeze: this.sessionFreeze,
      sessionFreezeRevision: this.sessionFreezeRevision,
      persistedFreeze,
      showGrid: this.options.showGrid,
      showFreeze: this.options.showFreeze,
    });
  }

  private abortStroke(ctx: ToolContext): void {
    if (!this.transactionOpen) return;
    ctx.abortTransaction();
    this.transactionOpen = false;
    ctx.setDraft(null);
    this.lastLayerPoint = null;
    this.sessionFreeze = null;
    this.freezeSampler = null;
    this.freezeDirty = false;
    const target = resolveLiquifyTarget(ctx);
    this.publishOverlay(ctx, target);
  }

  destroy(): void {
    resetLiquifyOverlay();
  }
}
