/**
 * SpotHealTool — click-to-fix tool for small blemishes.
 *
 * Click on a blemish and the tool selects a bounded nearby source region using
 * a deterministic texture-variance heuristic. It is deliberately not
 * content-aware synthesis: no pixels are invented and the source is frozen at
 * the beginning of the operation.
 *
 * Research basis: Photoshop Spot Healing Brush, GIMP Heal selection.
 *                 Poisson image editing (Pérez et al. 2003) as the standard the
 *                 simple mean-shift approximation is measured against.
 */
import type { BrushDab, RasterLayerNode, RasterTile } from '@varve/scene';
import { compositeSpotHealDabOnNode, snapshotTiles } from '@varve/scene';
import { BaseTool } from './BaseTool';
import { rasterLocalPoint, resolveRetouchTarget } from './rasterTarget';
import { buildRetouchSampleSource, type SamplingScope } from './retouchSampling';
import { selectionCoverageForDab } from './selectionCoverage';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

export interface SpotHealOptions {
  brushSize: number;
  hardness: number;
  opacity: number;
  flow: number;
  /** Keep existing transparency: never extend coverage onto empty pixels. */
  alphaLock: boolean;
  samplingScope: SamplingScope;
}

export class SpotHealTool extends BaseTool {
  id = 'spotHeal' as const;

  private options: SpotHealOptions = {
    brushSize: 20,
    hardness: 1,
    opacity: 1,
    flow: 1,
    alphaLock: false,
    samplingScope: 'current',
  };

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onPointerDown(
    e: PointerEvent,
    ctx: ToolContext,
  ): { consumed: boolean; captured?: boolean } {
    const target = resolveRetouchTarget(ctx);
    if (target.kind !== 'raster') {
      ctx.announce(target.reason);
      return { consumed: false };
    }
    const rasterNodeId = target.nodeId;
    const node = ctx.getNode(rasterNodeId);
    if (node?.kind !== 'rasterLayer') {
      ctx.announce('Spot Heal could not resolve its raster target');
      return { consumed: false };
    }
    const world = ctx.canvasToWorld(e.clientX, e.clientY);
    const local = rasterLocalPoint(ctx, rasterNodeId, world);
    const radius = Math.max(0.5, this.options.brushSize / 2);
    const dab: BrushDab = {
      x: local.x,
      y: local.y,
      radius,
      opacity: this.options.opacity,
      flow: this.options.flow,
      hardness: this.options.hardness,
      angle: 0,
      roundness: 1,
      strokeT: 0,
      strokeDistance: 0,
    };
    ctx.beginTransaction();
    const sourceTiles = this.buildSamplingSource(ctx, node);
    // Same selection clipping as clone/heal: a soft brush must never repair
    // past the boundary the user drew.
    const coverage = selectionCoverageForDab(ctx, rasterNodeId, dab, ctx.areaSelection);
    const healOptions = {
      sourceTiles,
      offsetX: 0,
      offsetY: 0,
      coverage,
      alphaLock: this.options.alphaLock,
    };
    const preview = compositeSpotHealDabOnNode(node, dab, healOptions);
    const changed = preview !== node;
    if (!changed) {
      ctx.abortTransaction();
      ctx.announce('Spot Heal found no valid nearby source patch');
      return { consumed: true };
    }
    ctx.updateNode(rasterNodeId, (current) => {
      if (current.kind !== 'rasterLayer') return current;
      return compositeSpotHealDabOnNode(current, dab, healOptions);
    });
    ctx.commitTransaction();
    ctx.announce('Spot healed from a nearby source patch');
    return { consumed: true };
  }

  setOptions(opts: Partial<SpotHealOptions>): void {
    Object.assign(this.options, opts);
  }

  getOptions(): Readonly<SpotHealOptions> {
    return { ...this.options };
  }

  private buildSamplingSource(ctx: ToolContext, node: RasterLayerNode): Map<string, RasterTile> {
    if (this.options.samplingScope === 'current') return snapshotTiles(node);
    const result = buildRetouchSampleSource(ctx, node, this.options.samplingScope);
    if (result.truncated) {
      ctx.announce(
        'Merged sampling reached its size budget; some transformed layers were not sampled.',
      );
    }
    return result.tiles;
  }
}
