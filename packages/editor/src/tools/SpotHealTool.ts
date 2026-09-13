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
import type { BrushDab, RasterLayerNode, RasterTile } from '@varve/scene';
import { compositeSpotHealDabOnNode, flattenTilesForSampling, snapshotTiles } from '@varve/scene';
import { BaseTool } from './BaseTool';
import { findEditableRasterLayer, rasterLocalPoint } from './rasterTarget';
import type { CursorSpec, ToolContext, ToolCursorState } from './types';

export interface SpotHealOptions {
  brushSize: number;
  hardness: number;
  opacity: number;
  flow: number;
  sampleAllLayers: boolean;
}

export class SpotHealTool extends BaseTool {
  id = 'spotHeal' as const;

  private options: SpotHealOptions = {
    brushSize: 20,
    hardness: 1,
    opacity: 1,
    flow: 1,
    sampleAllLayers: false,
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
    const sourceTiles = this.options.sampleAllLayers
      ? this.flattenVisibleStack(ctx, node as RasterLayerNode)
      : snapshotTiles(node as RasterLayerNode);
    const preview = compositeSpotHealDabOnNode(node as RasterLayerNode, dab, {
      sourceTiles,
      offsetX: 0,
      offsetY: 0,
    });
    const changed = preview !== node;
    if (!changed) {
      ctx.abortTransaction();
      ctx.announce('Spot Heal found no valid nearby source patch');
      return { consumed: true };
    }
    ctx.updateNode(rasterNodeId, (current) => {
      if (current.kind !== 'rasterLayer') return current;
      return compositeSpotHealDabOnNode(current, dab, {
        sourceTiles,
        offsetX: 0,
        offsetY: 0,
      });
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

  private flattenVisibleStack(ctx: ToolContext, target: RasterLayerNode): Map<string, RasterTile> {
    const layers: Array<{ tiles: Map<string, RasterTile>; opacity?: number; visible?: boolean }> =
      [];
    for (const node of Object.values(ctx.document.nodes)) {
      if (node.kind !== 'rasterLayer') continue;
      layers.push({ tiles: node.tiles, opacity: node.opacity, visible: node.visible });
    }
    return layers.length > 0 ? flattenTilesForSampling(layers) : snapshotTiles(target);
  }
}
