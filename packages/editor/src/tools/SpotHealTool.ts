/**
 * SpotHealTool — click-to-fix tool for small blemishes.
 *
 * Click on a blemish and the tool selects a bounded nearby source region using
 * a deterministic texture-variance heuristic. It is deliberately not
 * content-aware synthesis: no pixels are invented and the source is frozen at
 * the beginning of the operation.
 *
 * Research basis: Photoshop Spot Healing Brush, GIMP Heal selection.
 *                 Content-aware fill (PatchMatch algorithm).
 */
import type { BrushDab, RasterLayerNode } from '@varve/scene';
import {
  compositeSpotHealDabOnNode,
  snapshotTiles,
} from '@varve/scene';
import { BaseTool } from './BaseTool';
import { findEditableRasterLayer, rasterLocalPoint } from './rasterTarget';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

interface SpotHealOptions {
  brushSize: number;
  type: 'content-aware' | 'proximity-match';
}

export class SpotHealTool extends BaseTool {
  id = 'spotHeal' as const;

  private options: SpotHealOptions = {
    brushSize: 20,
    type: 'proximity-match',
  };

  override cursor(_state: ToolCursorState): CursorSpec {
    return { css: 'crosshair' };
  }

  override onPointerDown(
    e: PointerEvent,
    ctx: ToolContext,
  ): { consumed: boolean; captured?: boolean } {
    const rasterNodeId = findEditableRasterLayer(ctx);
    if (!rasterNodeId) {
      ctx.announce('Spot Heal needs an editable raster layer with source pixels');
      return { consumed: false };
    }
    const node = ctx.getNode(rasterNodeId);
    if (!node || node.kind !== 'rasterLayer') {
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
      opacity: 1,
      flow: 1,
      hardness: 1,
      angle: 0,
      roundness: 1,
      strokeT: 0,
      strokeDistance: 0,
      lengthReference: 1,
    };
    let changed = false;
    ctx.beginTransaction();
    const sourceTiles = snapshotTiles(node as RasterLayerNode);
    ctx.updateNode(rasterNodeId, (current) => {
      if (current.kind !== 'rasterLayer') return current;
      const next = compositeSpotHealDabOnNode(current, dab, {
        sourceTiles,
        offsetX: 0,
        offsetY: 0,
      });
      changed = next !== current;
      return next;
    });
    if (changed) {
      ctx.commitTransaction();
      ctx.announce('Spot healed from a nearby source patch');
    } else {
      ctx.abortTransaction();
      ctx.announce('Spot Heal found no valid nearby source patch');
    }
    return { consumed: true };
  }

  setOptions(opts: Partial<SpotHealOptions>): void {
    Object.assign(this.options, opts);
  }
}
