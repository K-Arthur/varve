/**
 * PaintTool — raster brush and eraser.
 *
 * One pointer stroke is one `PaintStrokeSession`: it owns the identity
 * (`strokeId` + `generation`), a frozen snapshot of the brush preset, colour,
 * alpha lock and area selection, the open history transaction and the
 * accumulated dirty bounds. Nothing about a stroke in progress is read back out
 * of shared editor state, so changing brush size or colour mid-stroke cannot
 * produce a stroke built from two different brushes, and a cancelled stroke is
 * identifiable precisely enough that its late worker results can be rejected.
 *
 * Dab generation is delegated to `BrushWorkerHost`, which runs the canonical
 * `@varve/scene` stroke engine either on a worker or on the main thread. This
 * tool only decides *where* dabs land and *how* they are clipped, so the worker
 * and synchronous paths cannot drift apart in brush semantics.
 */
import type { AreaSelection } from '@varve/engine';
import type { BrushDab, BrushPreset, RasterLayerNode } from '@varve/scene';
import { compositeDabOnNode, defaultBrushPreset, eraseDabOnNode, strokePoint } from '@varve/scene';
import { BrushWorkerHost, type StrokeBatchEvent } from '../render/brushWorkerHost';
import { BaseTool } from './BaseTool';
import { collectSourceEvents } from './inputNormalizer';
import { normalizePressure, normalizeTilt } from './pointerDynamics';
import { createRasterTarget, findEditableRasterLayer, rasterLocalPoint } from './rasterTarget';
import { selectionCoverageForDab } from './selectionCoverage';
import { resolveSymmetryTransforms, type SymmetrySettings, transformStrokePoint } from './symmetry';
import type { CursorSpec, GestureResult, ToolContext, ToolCursorState } from './types';

export interface BrushToolSettings {
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
}

/** One symmetry copy of the stroke: its own engine, sharing the session. */
interface SymmetryBranch {
  /** Identity suffix so each mirrored copy is an independent engine stroke. */
  strokeId: string;
  /** Maps a source stroke point into this branch's coordinates. */
  transform: (p: { x: number; y: number; direction: number }) => {
    x: number;
    y: number;
    direction: number;
  };
}

/** Everything that belongs to one continuous pointer stroke. */
interface PaintStrokeSession {
  strokeId: string;
  generation: number;
  rasterNodeId: string;
  /** Frozen at pointer-down; the stroke never re-reads live settings. */
  preset: BrushPreset;
  color: [number, number, number, number];
  alphaLock: boolean;
  areaSelection: AreaSelection | null;
  eraser: boolean;
  branches: SymmetryBranch[];
  /** True when this stroke created its own raster layer. */
  ownsLayer: boolean;
  transactionOpen: boolean;
  /** Union of every dab's bounds, in layer pixels. */
  dirty: { minX: number; minY: number; maxX: number; maxY: number } | null;
  dabCount: number;
  startedAt: number;
}

export class PaintTool extends BaseTool {
  id: 'paint' | 'eraser';

  private preset: BrushPreset;
  private eraserMode: boolean;
  private alphaLock = false;
  private symmetry: SymmetrySettings | null = null;
  private workerHost: BrushWorkerHost | null = null;
  private session: PaintStrokeSession | null = null;
  private nextGeneration = 1;
  private lastSamplePoint: import('@varve/scene').StrokePoint | null = null;
  private ctxRef: ToolContext | null = null;
  private lastOwnedLayer = false;
  private lastStrokeBounds: { x: number; y: number; w: number; h: number } | null = null;

  onSettingsChange?: (settings: BrushToolSettings) => void;

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

  /** Symmetry is a stroke transform, not a second tool. Snapshotted per stroke. */
  setSymmetry(settings: SymmetrySettings | null): void {
    this.symmetry = settings;
  }

  updatePresetFromSettings(settings: BrushToolSettings): void {
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

  getSettings(): BrushToolSettings {
    return {
      presetId: this.preset.id,
      radius: this.preset.radius,
      opacity: this.preset.opacity,
      flow: this.preset.flow,
      hardness: this.preset.hardness,
      smoothing: this.preset.smoothing,
      spacing: this.preset.spacing,
      alphaLock: this.alphaLock,
      blendMode: this.preset.blendMode,
    };
  }

  /** Whether the raster layer used by the current/most recent stroke was newly
   *  created by this tool, as opposed to an existing layer that was reused. */
  get ownsCurrentLayer(): boolean {
    return this.session?.ownsLayer ?? this.lastOwnedLayer;
  }

  /** Monotonic id of the current stroke, for callers detecting supersession. */
  get currentStrokeGeneration(): number {
    return this.session?.generation ?? this.nextGeneration - 1;
  }

  getWorkerHost(): BrushWorkerHost {
    if (!this.workerHost) this.setWorkerHost(new BrushWorkerHost());
    return this.workerHost as BrushWorkerHost;
  }

  setWorkerHost(host: BrushWorkerHost): void {
    this.workerHost = host;
    host.onBatch = (batch) => this.applyBatch(batch);
  }

  override onActivate(ctx: ToolContext): void {
    ctx.setDraft(null);
  }

  override onDeactivate(ctx: ToolContext): void {
    if (this.session) this.abortStroke(ctx);
    ctx.setDraft(null);
  }

  destroy(): void {
    this.workerHost?.destroy();
    this.workerHost = null;
  }

  // ── Pointer lifecycle ─────────────────────────────────────────────────────

  override onPointerDown(e: PointerEvent, ctx: ToolContext): GestureResult {
    if (this.drag.kind !== 'idle') return { consumed: false };
    const result = super.onPointerDown(e, ctx);
    if (!result.consumed) return result;

    this.ctxRef = ctx;
    ctx.beginTransaction();

    const rasterNodeId = this.findOrCreateRasterLayer(ctx);
    if (!rasterNodeId) {
      ctx.abortTransaction();
      return { consumed: false };
    }

    const generation = this.nextGeneration++;
    const preset = { ...this.preset, dynamics: [...this.preset.dynamics] };
    const baseStrokeId = `${this.id}:${rasterNodeId}`;
    const branches = this.buildBranches(baseStrokeId);
    const session: PaintStrokeSession = {
      strokeId: baseStrokeId,
      generation,
      rasterNodeId,
      // Snapshot: the rest of the stroke is immune to settings changes.
      preset,
      color: this.eraserMode ? [0, 0, 0, 0] : [...ctx.foregroundColor],
      alphaLock: this.alphaLock,
      areaSelection: ctx.areaSelection ?? null,
      eraser: this.eraserMode,
      branches,
      ownsLayer: this.lastOwnedLayer,
      transactionOpen: true,
      dirty: null,
      dabCount: 0,
      startedAt: nowMs(),
    };
    this.session = session;

    const host = this.getWorkerHost();
    for (const branch of branches) {
      // Seed from the branch identity, not the clock: every mirrored copy gets
      // its own jitter stream, and replaying a stroke reproduces it exactly.
      host.beginStroke(branch.strokeId, generation, preset, hashSeed(`${branch.strokeId}#${generation}`));
    }

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const local = rasterLocalPoint(ctx, rasterNodeId, world);
    const sp = strokePoint(local.x, local.y, {
      pressure: normalizePressure(e.pressure, ctx.pointerType),
      tilt: normalizeTilt(e.tiltX, e.tiltY),
      time: e.timeStamp,
    });
    this.lastSamplePoint = sp;
    this.dispatch(session, [sp]);

    this.updatePreview(ctx);
    return result;
  }

  override onPointerMove(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    const session = this.session;
    if (!session) return;
    this.ctxRef = ctx;
    this.drag.currentCanvas = { x: e.clientX, y: e.clientY };
    this.drag.currentWorld = ctx.canvasToWorld(e.clientX, e.clientY);

    const events = ctx.sourceEvents.length > 0 ? ctx.sourceEvents : collectSourceEvents(e, true);
    const batch: import('@varve/scene').StrokePoint[] = [];
    for (const ev of events) {
      if (ev.isPredicted) continue;
      const world = ctx.canvasToWorld(ev.clientX, ev.clientY);
      const local = rasterLocalPoint(ctx, session.rasterNodeId, world);
      const sp = this.makeSample(
        local,
        normalizePressure(ev.pressure, ctx.pointerType),
        ev.time,
        normalizeTilt(ev.tiltX, ev.tiltY),
      );
      if (sp) batch.push(sp);
    }
    if (batch.length > 0) this.dispatch(session, batch);
    this.updatePreview(ctx);
  }

  override onPointerUp(e: PointerEvent, ctx: ToolContext): void {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== e.pointerId) return;
    const session = this.session;
    if (!session) {
      super.onPointerUp(e, ctx);
      return;
    }
    this.ctxRef = ctx;

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const local = rasterLocalPoint(ctx, session.rasterNodeId, world);
    const sp = this.makeSample(
      local,
      normalizePressure(e.pressure, ctx.pointerType),
      e.timeStamp,
      normalizeTilt(e.tiltX, e.tiltY),
    );
    if (sp) this.dispatch(session, [sp]);

    super.onPointerUp(e, ctx);
    ctx.setDraft(null);

    const host = this.getWorkerHost();
    let outstanding = session.branches.length;
    for (const branch of session.branches) {
      host.endStroke(branch.strokeId, session.generation, () => {
        outstanding--;
        // A cancel between pointer-up and the last batch replaces the session.
        if (outstanding > 0 || this.session !== session) return;
        this.finishStroke(ctx);
      });
    }
  }

  override onDragCancel(ctx: ToolContext): void {
    this.abortStroke(ctx);
  }

  override onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean {
    if (e.key === 'Escape' && this.drag.kind === 'dragging') {
      this.abortStroke(ctx);
      return true;
    }
    if (e.key === '[' || e.key === ']') {
      const delta = e.key === '[' ? -2 : 2;
      this.preset.radius = Math.max(1, Math.min(1000, this.preset.radius + delta));
      ctx.announce(`Brush size: ${Math.round(this.preset.radius)}px`);
      this.onSettingsChange?.(this.getSettings());
      return true;
    }
    return false;
  }

  // ── Stroke body ───────────────────────────────────────────────────────────

  private buildBranches(baseStrokeId: string): SymmetryBranch[] {
    const transforms = resolveSymmetryTransforms(this.symmetry);
    return transforms.map((transform, index) => ({
      strokeId: index === 0 ? baseStrokeId : `${baseStrokeId}~${index}`,
      transform,
    }));
  }

  /** Feed samples to every symmetry branch, transformed into its space. */
  private dispatch(
    session: PaintStrokeSession,
    points: readonly import('@varve/scene').StrokePoint[],
  ): void {
    const host = this.getWorkerHost();
    for (const branch of session.branches) {
      const mapped = points.map((p) => transformStrokePoint(p, branch.transform));
      host.appendPoints(branch.strokeId, session.generation, mapped);
    }
  }

  private makeSample(
    local: { x: number; y: number },
    pressure: number,
    time: number | undefined,
    tilt: number,
  ): import('@varve/scene').StrokePoint | null {
    const last = this.lastSamplePoint;
    const t = time ?? nowMs();
    if (!last) {
      const sp = strokePoint(local.x, local.y, { pressure, tilt, time: t });
      this.lastSamplePoint = sp;
      return sp;
    }
    const dx = local.x - last.x;
    const dy = local.y - last.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Sub-0.25px moves carry no geometric information but do flood the queue.
    if (dist < 0.25) return null;
    const dt = t - last.time;
    const speed = dt > 0 ? (dist / dt) * 1000 : 0;
    const sp = strokePoint(local.x, local.y, {
      pressure,
      tilt,
      direction: Math.atan2(dy, dx),
      speed,
      time: t,
    });
    this.lastSamplePoint = sp;
    return sp;
  }

  /** Apply one generated batch to canonical document state. */
  private applyBatch(batch: StrokeBatchEvent): void {
    const session = this.session;
    const ctx = this.ctxRef;
    if (!session || !ctx) return;
    // Identity check: a batch from a superseded stroke must never paint.
    if (batch.generation !== session.generation) return;
    if (!session.branches.some((b) => b.strokeId === batch.strokeId)) return;
    if (batch.dabs.length === 0) return;

    const { alphaLock, eraser, color, areaSelection, rasterNodeId } = session;
    ctx.updateNode(rasterNodeId, (node) => {
      let updated = node as RasterLayerNode;
      for (const dab of batch.dabs) {
        const coverage = selectionCoverageForDab(ctx, rasterNodeId, dab, areaSelection);
        updated = eraser
          ? eraseDabOnNode(updated, dab, { coverage })
          : compositeDabOnNode(updated, dab, color, { alphaLock, coverage });
      }
      return updated;
    });

    session.dabCount += batch.dabs.length;
    this.growDirty(session, batch.dabs);
  }

  private growDirty(session: PaintStrokeSession, dabs: readonly BrushDab[]): void {
    for (const d of dabs) {
      const minX = d.x - d.radius;
      const minY = d.y - d.radius;
      const maxX = d.x + d.radius;
      const maxY = d.y + d.radius;
      if (!session.dirty) {
        session.dirty = { minX, minY, maxX, maxY };
        continue;
      }
      const dirty = session.dirty;
      if (minX < dirty.minX) dirty.minX = minX;
      if (minY < dirty.minY) dirty.minY = minY;
      if (maxX > dirty.maxX) dirty.maxX = maxX;
      if (maxY > dirty.maxY) dirty.maxY = maxY;
    }
  }

  /** Bounds touched by the most recent stroke, in layer pixels. */
  getLastStrokeBounds(): { x: number; y: number; w: number; h: number } | null {
    return this.lastStrokeBounds;
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
    const existing = findEditableRasterLayer(ctx);
    if (existing) {
      this.lastOwnedLayer = false;
      return existing;
    }
    const nodeId = createRasterTarget(ctx, this.drag.startWorld);
    this.lastOwnedLayer = nodeId !== null;
    return nodeId;
  }

  private abortStroke(ctx: ToolContext): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    // Cancel the stroke that is actually in flight — its own generation, not a
    // freshly incremented one that no worker job was ever tagged with.
    for (const branch of session.branches) {
      this.workerHost?.cancelStroke(branch.strokeId, session.generation);
    }
    if (session.transactionOpen) ctx.abortTransaction();
    ctx.setDraft(null);
    this.lastSamplePoint = null;
  }

  private finishStroke(ctx: ToolContext): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    if (session.dirty) {
      this.lastStrokeBounds = {
        x: session.dirty.minX,
        y: session.dirty.minY,
        w: session.dirty.maxX - session.dirty.minX,
        h: session.dirty.maxY - session.dirty.minY,
      };
    }
    if (session.transactionOpen) ctx.commitTransaction();
    ctx.setDraft(null);
    this.lastSamplePoint = null;
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Stable 32-bit hash so a stroke's jitter is reproducible from its identity. */
function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
