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
import type {
  BrushDab,
  BrushPreset,
  RasterLayerNode,
  StrokeEngineState,
  WetPaintManager,
} from '@varve/scene';
import {
  appendStrokePoints,
  beginStroke,
  cloneStrokeEngineState,
  compositeDabOnNode,
  defaultBrushPreset,
  eraseDabOnNode,
  maskValueFromColor,
} from '@varve/scene';
import { BrushWorkerHost, type StrokeBatchEvent } from '../render/brushWorkerHost';
import { getPaintProfiler } from '../render/paintProfiler';
import { BaseTool } from './BaseTool';
import {
  collectSourceEvents,
  inputToStrokePoint,
  type NormalizedInputEvent,
  normalizeInputEvent,
} from './inputNormalizer';
import {
  beginMaskPaintSession,
  commitMaskPaintSession,
  encodeMaskRgba,
  type MaskPaintSession,
  paintMaskDab,
} from './maskPaintSession';
import { resolvePaintTarget } from './paintTarget';
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
  wet: boolean;
  /** Wet-edge parameters for this stroke, or null when the effect is off. */
  wetEdge: { size: number; darken: number } | null;
  /** Set when this stroke paints a mask rather than layer pixels. */
  mask: MaskPaintSession | null;
  /** Mask coverage the brush paints towards, from the foreground luminance. */
  maskValue: number;
  branches: SymmetryBranch[];
  /**
   * Main-thread mirrors of confirmed branch state. They exist solely to fork
   * a predicted overlay and never composite pixels or touch history.
   */
  previewStates: Map<string, StrokeEngineState>;
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
  private wetPaint: WetPaintManager | null = null;
  private onWetDeposit: (() => void) | null = null;
  /**
   * Decodes a stored mask PNG. Injectable because decoding needs a canvas and
   * an already-loaded image, which the editor owns and headless callers do not.
   */
  private decodeMask: (
    dataUrl: string,
  ) => { data: Uint8ClampedArray; width: number; height: number } | null = () => null;

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

  /**
   * Supply the wet-paint runtime. `onDeposit` wakes the drying scheduler; it is
   * only called when paint is actually laid down, so a dry document never
   * schedules a frame.
   */
  setWetPaint(manager: WetPaintManager | null, onDeposit?: () => void): void {
    this.wetPaint = manager;
    this.onWetDeposit = onDeposit ?? null;
  }

  /** Supply the mask decoder used when a stroke targets a layer mask. */
  setMaskDecoder(
    decode: (dataUrl: string) => { data: Uint8ClampedArray; width: number; height: number } | null,
  ): void {
    this.decodeMask = decode;
  }

  /** Enable or disable wet media for subsequent strokes. */
  setWetEnabled(enabled: boolean, mixStrength?: number, dryingRate?: number): void {
    this.preset.wetEnabled = enabled;
    if (mixStrength !== undefined) this.preset.wetMixStrength = mixStrength;
    if (dryingRate !== undefined) this.preset.wetDryingRate = dryingRate;
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

    // One resolver decides where paint goes, so a refusal can be explained
    // rather than looking like the tool is broken.
    const target = resolvePaintTarget({
      document: ctx.document as never,
      selection: ctx.selection,
      maskEditTarget: ctx.maskEditTarget ?? null,
      fallbackLayerId: findEditableRasterLayer(ctx),
    });

    let maskSession: MaskPaintSession | null = null;
    let rasterNodeId: string | null = null;

    if (target.kind === 'rasterMask') {
      maskSession = beginMaskPaintSession(ctx, target.nodeId, this.decodeMask);
      if (!maskSession) {
        ctx.announce('That mask could not be opened for painting.');
        ctx.abortTransaction();
        return { consumed: false };
      }
      rasterNodeId = target.nodeId;
    } else if (target.kind === 'rasterLayer') {
      rasterNodeId = target.nodeId;
      this.lastOwnedLayer = false;
    } else {
      if (!target.canCreateLayer) {
        // Locked or hidden: say why instead of silently doing nothing.
        ctx.announce(target.reason);
        ctx.abortTransaction();
        return { consumed: false };
      }
      rasterNodeId = this.findOrCreateRasterLayer(ctx);
    }

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
      wet: !this.eraserMode && preset.wetEnabled && !maskSession,
      wetEdge:
        preset.wetEnabled && preset.wetEdge && !maskSession
          ? { size: preset.wetEdgeSize, darken: preset.wetEdgeDarken }
          : null,
      mask: maskSession,
      // Painting a mask sets coverage, not colour: white reveals, black
      // conceals. An eraser on a mask reveals, mirroring its meaning on pixels.
      maskValue: this.eraserMode ? 1 : maskValueFromColor(ctx.foregroundColor),
      branches,
      previewStates: new Map(),
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
      const seed = hashSeed(`${branch.strokeId}#${generation}`);
      host.beginStroke(branch.strokeId, generation, preset, seed);
      session.previewStates.set(
        branch.strokeId,
        beginStroke(branch.strokeId, generation, preset, seed),
      );
    }

    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const local = rasterLocalPoint(ctx, rasterNodeId, world);
    const sp = inputToStrokePoint(normalizeInputEvent(e), local);
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
      const sp = this.makeSample(local, ev);
      if (sp) batch.push(sp);
    }
    if (batch.length > 0) this.dispatch(session, batch);
    this.updatePreview(ctx, this.predictedDabs(session, events, ctx));
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
    const sp = this.makeSample(local, normalizeInputEvent(e));
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
      const previewState = session.previewStates.get(branch.strokeId);
      if (previewState) appendStrokePoints(previewState, mapped);
    }
  }

  /**
   * Generate a replaceable predicted continuation from a clone of confirmed
   * engine state. Neither the authoritative worker state nor this tool's
   * confirmed sample cursor is advanced by this method.
   */
  private predictedDabs(
    session: PaintStrokeSession,
    events: readonly NormalizedInputEvent[],
    ctx: ToolContext,
  ): BrushDab[] {
    const predicted = events.filter((event) => event.isPredicted);
    if (predicted.length === 0 || this.eraserMode) return [];

    const points: import('@varve/scene').StrokePoint[] = [];
    let previous = this.lastSamplePoint;
    for (const input of predicted) {
      const world = ctx.canvasToWorld(input.clientX, input.clientY);
      const local = rasterLocalPoint(ctx, session.rasterNodeId, world);
      const time = previous ? Math.max(previous.time, input.time) : input.time;
      const point = inputToStrokePoint({ ...input, time }, local, previous ?? undefined);
      points.push(point);
      previous = point;
    }
    if (points.length === 0) return [];

    const dabs: BrushDab[] = [];
    for (const branch of session.branches) {
      const confirmed = session.previewStates.get(branch.strokeId);
      if (!confirmed) continue;
      const continuation = cloneStrokeEngineState(confirmed);
      const mapped = points.map((point) => transformStrokePoint(point, branch.transform));
      dabs.push(...appendStrokePoints(continuation, mapped, { final: true }).dabs);
    }
    return dabs;
  }

  private makeSample(
    local: { x: number; y: number },
    input: NormalizedInputEvent,
  ): import('@varve/scene').StrokePoint | null {
    const last = this.lastSamplePoint;
    if (!last) {
      const sp = inputToStrokePoint(input, local);
      this.lastSamplePoint = sp;
      return sp;
    }
    // Reordered packets and an auto-pan continuation can carry an earlier
    // timestamp. Keep the stream monotonic without inventing a speed spike.
    const time = Math.max(last.time, input.time);
    if (
      time === last.time &&
      local.x === last.x &&
      local.y === last.y &&
      input.pressure === last.pressure
    ) {
      return null;
    }
    // Retain even zero-distance samples: their pressure, tilt and timestamp
    // form the correct endpoint for dynamics interpolation on the next
    // non-zero segment. Discarding sub-pixel samples was the first avoidable
    // loss of continuous stylus state in the authoritative path.
    const sp = inputToStrokePoint({ ...input, time }, local, last);
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
    const profiler = getPaintProfiler();
    const compositeStart = profiler.enabled ? nowMs() : 0;

    if (session.mask) {
      // Mask strokes accumulate in their own coverage plane and are committed
      // once at pointer-up, so undo restores mask pixels without touching the
      // content underneath.
      for (const dab of batch.dabs) {
        const coverage = selectionCoverageForDab(ctx, rasterNodeId, dab, areaSelection);
        paintMaskDab(session.mask, dab, session.maskValue, coverage);
      }
      if (profiler.enabled) profiler.compositeTook(nowMs() - compositeStart);
      session.dabCount += batch.dabs.length;
      this.growDirty(session, batch.dabs);
      return;
    }

    let deposited = false;
    ctx.updateNode(rasterNodeId, (node) => {
      let updated = node as RasterLayerNode;
      for (const dab of batch.dabs) {
        const coverage = selectionCoverageForDab(ctx, rasterNodeId, dab, areaSelection);
        if (eraser) {
          updated = eraseDabOnNode(updated, dab, { coverage });
          continue;
        }
        const dabColor = session.wet ? this.mixWet(session, dab, color) : color;
        if (session.wet) deposited = true;
        updated = compositeDabOnNode(updated, dab, dabColor, {
          alphaLock,
          coverage,
          wetEdge: session.wetEdge,
        });
      }
      return updated;
    });
    // Waking the scheduler is what starts drying; a stroke that deposited no
    // wet paint leaves the document idle.
    if (deposited) this.onWetDeposit?.();

    if (profiler.enabled) profiler.compositeTook(nowMs() - compositeStart);
    session.dabCount += batch.dabs.length;
    this.growDirty(session, batch.dabs);
  }

  /**
   * Mix a dab's colour with the wet film already on the layer, and mark the
   * dab's footprint wet.
   *
   * Mixing is evaluated once at the dab centre rather than per pixel: the wet
   * film is a low-frequency quantity, and a per-pixel solve would multiply the
   * cost of every textured wet brush for a difference the eye does not resolve
   * at dab spacing. Wetness is registered on a lattice across the footprint so
   * a later crossing stroke finds wet paint anywhere the dab covered, not only
   * at its centre.
   */
  private mixWet(
    session: PaintStrokeSession,
    dab: BrushDab,
    color: [number, number, number, number],
  ): [number, number, number, number] {
    const wet = this.wetPaint;
    if (!wet) return color;
    const amount = Math.max(0, Math.min(1, dab.opacity * dab.flow));
    const mixed = wet.addPaint(
      session.rasterNodeId,
      dab.x,
      dab.y,
      color,
      amount,
      session.preset.wetMixStrength,
    );
    const step = Math.max(1, Math.floor(dab.radius / 2));
    for (let dy = -dab.radius; dy <= dab.radius; dy += step) {
      for (let dx = -dab.radius; dx <= dab.radius; dx += step) {
        if (dx * dx + dy * dy > dab.radius * dab.radius) continue;
        if (dx === 0 && dy === 0) continue;
        wet.addPaint(
          session.rasterNodeId,
          dab.x + dx,
          dab.y + dy,
          mixed,
          amount,
          session.preset.wetMixStrength,
        );
      }
    }
    return mixed;
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

  private updatePreview(ctx: ToolContext, predictedDabs: readonly BrushDab[] = []): void {
    const session = this.session;
    if (session && predictedDabs.length > 0) {
      ctx.setDraft({
        kind: 'predicted-stroke',
        dabs: predictedDabs,
        color: session.color,
        transform: ctx.getWorldTransform?.(session.rasterNodeId) ?? [1, 0, 0, 1, 0, 0],
      });
      return;
    }
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
    if (session.mask) {
      const committed = commitMaskPaintSession(ctx, session.mask, encodeMaskRgba);
      if (!committed) {
        // Nothing was painted (or encoding failed): do not leave an empty
        // entry in history for the user to undo past.
        if (session.transactionOpen) ctx.abortTransaction();
        ctx.setDraft(null);
        this.lastSamplePoint = null;
        return;
      }
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
